// Heerlen 3D — kern: scène, km-vakken (gebouwen + terrein), kaarttegels als textuur, aanklikken, camera.
// Coördinaten: RD (EPSG:28992) → three: x = RDx − O.x, y = NAP-hoogte, z = −(RDy − O.y)  (noord = −z).
// Data komt uit data/*.js (gebouwd met tools/build-data.cjs) en roept H3D.area/chunk/pois aan.
const H3D = (() => {
  const H = { chunks: new Map(), listeners: {} };
  const on = (ev, fn) => (H.listeners[ev] ||= []).push(fn);
  const emit = (ev, ...a) => (H.listeners[ev] || []).forEach(fn => fn(...a));
  H.on = on;

  // ---------- MRT (iso, stap 2): elk ingebouwd materiaal schrijft naast kleur ook normaal (view) + diepte naar uitvoer 1 ----------
  // Zo is de omlijning-invoer er in dezelfde render (geen 2e scène-render met NRM). Bij gewone targets/scherm wordt uitvoer 1 genegeerd.
  // Doorzichtig → vec4(0): met blending blijft staan wat er lag (selectie, stippellijn, schaduwvlak). Eigen ShaderMaterials in de scène: zelf gNrm schrijven (zie POOL).
  // #ifdef gl_FragColor = alleen fragment shader in WebGL2 (daar is het een macro).
  // Normaal/diepte-doel = RG32F (half zoveel geheugenverkeer als RGBA32F in de omlijning): R = normaal octaëdrisch 2×12 bit als geheel getal, G = diepte (> 0, leeg = 0).
  const NRM_GLSL = `
vec2 nrmPack(vec3 n, float d) { n /= abs(n.x) + abs(n.y) + abs(n.z); vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  e = floor(clamp(e * 0.5 + 0.5, 0.0, 1.0) * 4095.0 + 0.5); return vec2(e.x * 4096.0 + e.y, d); }
vec3 nrmUnpack(float p) { float x = floor(p / 4096.0); vec2 e = vec2(x, p - x * 4096.0) / 4095.0 * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y)); float t = max(-n.z, 0.0); n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t); return normalize(n); }
`;
  H.NRM_GLSL = NRM_GLSL;
  THREE.ShaderChunk.common += '\nvarying vec3 vMrtV;\n#ifdef gl_FragColor\nlayout(location = 1) out highp vec4 gNrm;\n' + NRM_GLSL + '#endif\n';
  THREE.ShaderChunk.project_vertex += '\nvMrtV = mvPosition.xyz;';
  THREE.ShaderChunk.opaque_fragment += '\n#ifdef gl_FragColor\n#ifdef OPAQUE\ngNrm = vec4(nrmPack(normalize(cross(dFdx(vMrtV), dFdy(vMrtV))), -vMrtV.z), 0.0, 1.0);\n#else\ngNrm = vec4(0.0);\n#endif\n#endif';
  // ShadowMaterial (schaduwvlak diorama) heeft geen opaque_fragment → zonder gNrm faalt de draw ("missing fragment shader outputs")
  THREE.ShaderLib.shadow.fragmentShader = THREE.ShaderLib.shadow.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>\n#ifdef gl_FragColor\ngNrm = vec4(0.0);\n#endif');

  // ---------- RD ↔ WGS84 (~1 m) ----------
  function rd2wgs(x, y) {
    const dX = (x - 155000) * 1e-5, dY = (y - 463000) * 1e-5;
    const N = 3235.65389 * dY - 32.58297 * dX ** 2 - 0.2475 * dY ** 2 - 0.84978 * dX ** 2 * dY - 0.0655 * dY ** 3
      - 0.01709 * dX ** 2 * dY ** 2 - 0.00738 * dX + 0.0053 * dX ** 4 - 0.00039 * dX ** 2 * dY ** 3 + 0.00033 * dX ** 4 * dY - 0.00012 * dX * dY;
    const E = 5260.52916 * dX + 105.94684 * dX * dY + 2.45656 * dX * dY ** 2 - 0.81885 * dX ** 3 + 0.05594 * dX * dY ** 3
      - 0.05607 * dX ** 3 * dY + 0.01199 * dY - 0.00256 * dX ** 3 * dY ** 2 + 0.00128 * dX * dY ** 4 + 0.00022 * dY ** 2 - 0.00022 * dX ** 2 + 0.00026 * dX ** 5;
    return [52.1551744 + N / 3600, 5.38720621 + E / 3600];
  }
  H.rd2wgs = rd2wgs;

  // ---------- Kaartstijlen (alle met CORS *, werken als WebGL-textuur vanaf file://) ----------
  const STYLES = {
    kaart: { label: 'Kaart', url: (z, x, y) => `https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/pastel/EPSG:3857/${z}/${x}/${y}.png`, attr: 'Kaart © PDOK/Kadaster', bg: '#d6e8bc' },
    straten: { label: 'Straten', url: (z, x, y) => `https://${'abcd'[(x + y) % 4]}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`, attr: 'Kaart © OpenStreetMap, © CARTO', bg: '#f2efe9' },
  };
  H.STYLES = STYLES;
  let style = 'kaart';
  try { style = STYLES[localStorage.getItem('h3d.style')] ? localStorage.getItem('h3d.style') : style; } catch {}

  // ---------- Scène ----------
  const SKY = new THREE.Color('#cfd9e2');
  let renderer, scene, camera, persp, ortho, controls, sun, hemi, O, area, ground, outline;
  // Iso (modus 'iso'): orthografische camera, kijkhoek 26,57° (2:1), draaien per kwartslag; cel-shaded look + omlijning (design/2_iso.html optie 6)
  const ISO_POLAR = Math.PI / 2 - Math.atan(0.5), ISO_H0 = 500, TAN21 = Math.tan(21 * Math.PI / 180);
  const isoHalf = () => ISO_H0 / ortho.zoom; // zichtbare halve hoogte (m)
  const isoD = (h = isoHalf()) => 6 * h + 2000; // afstand ortho-camera ↔ doel (beeld gelijk, alleen diepte/near/far)
  // iso: 4 vaste zoomstanden (zichtbare halve hoogte, m); scrollen springt vloeiend naar de volgende. Grond/detail rekenen alleen
  // op deze standen (bij stilstand), tussendoor niets → geen herschilderen of uploads midden in een zoom
  const ISO_LEVELS = [70, 220, 700, 2200];
  const levelOf = h => { let k = 0; for (let i = 1; i < ISO_LEVELS.length; i++) if (Math.abs(Math.log(h / ISO_LEVELS[i])) < Math.abs(Math.log(h / ISO_LEVELS[k]))) k = i; return k; };
  const snapHalf = h => ISO_LEVELS[levelOf(h)];
  const snapAz = t => Math.PI / 4 + Math.round((t - Math.PI / 4) / (Math.PI / 2)) * Math.PI / 2;
  let iso = false;
  const MAT = {
    // gewone panden bewust neutraal (licht warmgrijs), zodat opgelichte plekken eruit springen
    wall: new THREE.MeshLambertMaterial({ color: '#eeeae4', flatShading: true }),
    roof: new THREE.MeshLambertMaterial({ color: '#bdb5ab', flatShading: true }),
    sel: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthTest: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
  };
  let dirty = true;
  const redraw = () => { dirty = true; };
  H.redraw = redraw;
  // na de upload naar de GPU de kopie in het werkgeheugen weggooien (canvas → 1×1, DataTexture-data → null). Opnieuw tekenen = nieuw canvas/nieuwe textuur
  H.freeAfterUpload = tex => { tex.onUpdate = () => { tex.onUpdate = null; const im = tex.image; if (im && im.getContext) im.width = im.height = 1; else if (im && im.data) im.data = null; }; return tex; };

  function init() {
    const el = document.getElementById('view');
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) { document.body.classList.add('no-webgl'); return; }
    H.renderer = renderer; renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // zie renderlus: alleen bij stilstand + verandering
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    scene = H.scene = new THREE.Scene();
    scene.background = SKY;
    scene.fog = new THREE.Fog(SKY, 7000, 18000);
    camera = persp = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 2, 40000);
    ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 20000);
    const setOrtho = () => { const a = el.clientWidth / el.clientHeight; Object.assign(ortho, { left: -ISO_H0 * a, right: ISO_H0 * a, top: ISO_H0, bottom: -ISO_H0 }); ortho.updateProjectionMatrix(); };
    setOrtho();

    hemi = new THREE.HemisphereLight('#ffffff', '#8d8577', 1.6);
    scene.add(hemi);
    sun = new THREE.DirectionalLight('#fff4e2', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = false;          // slepen = over de grond schuiven (kaartgevoel)
    controls.zoomToCursor = true;
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.minDistance = 25; controls.maxDistance = 15000;
    controls.maxPolarAngle = 1.45;
    controls.addEventListener('change', redraw);
    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleT); emit('interact'); });
    controls.addEventListener('end', () => {
      if (mode === 'rond') idleT = setTimeout(() => { controls.autoRotate = true; }, 4000);
      if (camera === ortho && !fly) { const h = isoHalf(), s = snapHalf(h); if (Math.abs(s - h) / h > 0.01) { const [x, y] = toRD(controls.target); H.flyTo(x, y, { half: s, ms: 300, arc: false }); } } // knijpen: naar dichtstbijzijnde zoomstand
    });
    renderer.domElement.addEventListener('wheel', isoWheel, { capture: true, passive: false }); // vóór OrbitControls

    addEventListener('resize', () => {
      persp.aspect = el.clientWidth / el.clientHeight; persp.updateProjectionMatrix(); setOrtho();
      renderer.setSize(el.clientWidth, el.clientHeight); redraw();
    });
    setupPicking(renderer.domElement);
    applyNight();
    requestAnimationFrame(loop);
    if (area) start();
  }

  // ---------- Hoogte op een RD-punt (bilineair uit het terrein van een geladen vak) ----------
  // Terrein overdreven: hoogteverschillen × EXAG rond NAP H0 (alles in de scène gebruikt heightAt/ex; panden schuiven per stuk mee).
  const EXAG = 1.5, H0 = 80, ex = h => H0 + (h - H0) * EXAG, unex = h => H0 + (h - H0) / EXAG;
  H.EXAG = EXAG; H.unex = unex;
  function demAt(c, x, y) { // echte NAP-hoogte in vak c
    const N = c.demN, s = c.demStep, gx = (x - c.x0) / s, gy = (c.y0 + area.km - y) / s;
    const cx = Math.min(N - 2, Math.max(0, Math.floor(gx))), cy = Math.min(N - 2, Math.max(0, Math.floor(gy))), fx = gx - cx, fy = gy - cy;
    const d = c.dem, k = cy * N + cx;
    return ((d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fy) + (d[k + N] * (1 - fx) + d[k + N + 1] * fx) * fy) / 100;
  }
  function heightAt(x, y) {
    const c = H.chunks.get(Math.floor(x / area.km) + '_' + Math.floor(y / area.km));
    return c?.dem ? ex(demAt(c, x, y)) : H.baseH ?? 100;
  }
  H.heightAt = heightAt;
  const toWorld = (x, y, h) => new THREE.Vector3(x - O[0], h ?? heightAt(x, y), -(y - O[1]));
  const toRD = v => [v.x + O[0], O[1] - v.z];
  H.toWorld = toWorld; H.toRD = toRD;

  // ---------- Gebied + vakken laden ----------
  H.area = a => { area = a; O = a.origin; H.areaInfo = a; if (renderer) start(); };
  function start() {
    // ondergrond rondom (buiten de gemeente) zodat de wereld niet in het niets eindigt
    ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000).rotateX(-Math.PI / 2), terrMat(new THREE.MeshLambertMaterial({ color: STYLES[style].bg })));
    ground.position.y = 60; // geen schaduw: ligt ver onder het terrein, schaduwen zouden verschoven vallen
    scene.add(ground);
    restoreView();
    if (mode !== '3d') applyMode(mode, false);
    const t = controls.target, d2 = ([i, j]) => (i * area.km + 500 - O[0] - t.x) ** 2 + (j * area.km + 500 - O[1] + t.z) ** 2;
    const order = area.chunks.slice().sort((p, q) => d2(p) - d2(q)); // dichtbij eerst
    let next = 0, done = 0, busy = 0;
    const finished = () => { busy--; emit('progress', ++done, order.length); if (done === order.length) allLoaded(); pump(); };
    const pump = () => {
      while (busy < 2 && next < order.length) {
        const [i, j] = order[next++], s = document.createElement('script'); busy++;
        s.src = `data/tiles/c_${i}_${j}.js`;
        s.onerror = finished; s.onload = () => s.remove();
        document.head.appendChild(s);
      }
    };
    H._afterChunk = finished; // elk vak roept dit aan na verwerking
    emit('progress', 0, order.length);
    pump();
  }
  function allLoaded() {
    // gemeentegrens als lijntje over het terrein
    const pts = area.outline.map(([x, y]) => toWorld(x, y, heightAt(x, y) + 1.5));
    const line = outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#7b3f8c', dashSize: 18, gapSize: 12, transparent: true, opacity: 0.8 }));
    line.computeLineDistances();
    scene.add(line);
    allIn = true; buildLayers();
    emit('loaded');
    redraw();
  }

  const terrIdx = new Map(); // 'N:stap' → gedeelde index (alle vakken hebben hetzelfde raster)
  function terrIndex(N, st) {
    const k = N + ':' + st; let a = terrIdx.get(k); if (a) return a;
    const ti = [];
    for (let r = 0; r < N - 1; r += st) for (let q = 0; q < N - 1; q += st) {
      const r2 = Math.min(N - 1, r + st), q2 = Math.min(N - 1, q + st), a0 = r * N + q, b0 = r2 * N + q, a1 = r * N + q2, b1 = r2 * N + q2;
      ti.push(a0, b0, a1, a1, b0, b1);
    }
    terrIdx.set(k, a = new THREE.BufferAttribute(N * N > 65535 ? new Uint32Array(ti) : new Uint16Array(ti), 1));
    return a;
  }
  // ---------- Iso: muren per richting (A1) ----------
  // Muurdriehoeken per vak gesorteerd in 5 stukken: 0 = altijd (schuin/op de grens), 1–4 = normaal naar +x (O), +z (Z), −x (W), −z (N).
  // Binnen elk stuk blijft de pandvolgorde → per pand per stuk één aaneengesloten reeks: c.wS (6 begin-offsets, t.o.v. muurbegin),
  // c.wB[s * nPand + b] = eerste driehoek van pand b in stuk s. Iso tekent alleen de stukken die naar de camera wijzen (wallGroups).
  const SIN_E = Math.cos(ISO_POLAR), COS_E = Math.sin(ISO_POLAR), WALL_MARG = 133 * Math.PI / 180, WALL_ALL = 31;
  function sortWalls(c, pos, idx, nr, nw) {
    const nB = c.bW.length, slot = new Uint8Array(nw), cnt = new Uint32Array(5), Q = Math.PI / 2;
    for (let f = 0; f < nw; f++) {
      const k = (nr + f) * 3, a = idx[k] * 3, b = idx[k + 1] * 3, d = idx[k + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
      let sl = 0;
      if (L > 1e-9) { // veilig in een richting als hij vanaf de iso-camera (ook 2° naast de diagonaal) onzichtbaar is bij de afgewende kant
        const ang = Math.atan2(nz, nx), q = Math.round(ang / Q), th = Math.abs(ang - q * Q);
        if ((ny / L) * SIN_E + (Math.hypot(nx, nz) / L) * COS_E * Math.cos(WALL_MARG - th) < -1e-3) sl = 1 + (q & 3);
      }
      slot[f] = sl; cnt[sl]++;
    }
    const wS = new Uint32Array(6); for (let k = 0; k < 5; k++) wS[k + 1] = wS[k] + cnt[k];
    const wB = new Uint32Array(5 * nB), fill = wS.slice(0, 5), src = idx.slice(nr * 3, (nr + nw) * 3);
    for (let b = 0; b < nB; b++) {
      const f0 = b ? c.bW[b] : 0, f1 = b + 1 < nB ? c.bW[b + 1] : nw;
      for (let k = 0; k < 5; k++) wB[k * nB + b] = fill[k];
      for (let f = f0; f < f1; f++) { const o = (nr + fill[slot[f]]++) * 3; idx[o] = src[f * 3]; idx[o + 1] = src[f * 3 + 1]; idx[o + 2] = src[f * 3 + 2]; }
    }
    c.wS = wS; c.wB = wB;
  }
  function wallRuns(c, b) { // muurdriehoeken van pand b als [f0, f1) t.o.v. muurbegin (één reeks per richting)
    const nB = c.bW.length, out = [];
    if (!c.wB) { out.push([c.bW[b], b + 1 < nB ? c.bW[b + 1] : c.nw]); return out; }
    for (let k = 0; k < 5; k++) { const i = k * nB + b, f0 = c.wB[i], f1 = b + 1 < nB ? c.wB[i + 1] : c.wS[k + 1]; if (f1 > f0) out.push([f0, f1]); }
    return out;
  }
  function wallGroups(c, mask) { // groepen: dak + aaneengesloten zichtbare muurstukken (lege stukken tellen als doorlopend)
    if (!c.wS || c.wMask === mask) return false;
    const g = c.mesh.geometry, nr = c.nr; c.wMask = mask;
    g.clearGroups(); g.addGroup(0, nr * 3, 0);
    let a = -1;
    for (let k = 0; k <= 5; k++) {
      const vis = k < 5 && ((mask >> k & 1) || c.wS[k + 1] === c.wS[k]);
      if (vis && a < 0) a = k;
      if (!vis && a >= 0) { const f0 = c.wS[a], f1 = c.wS[k]; if (f1 > f0) g.addGroup((nr + f0) * 3, (f1 - f0) * 3, 1); a = -1; }
    }
    return true;
  }
  function b64bytes(s) { const bin = atob(s), n = bin.length, u = new Uint8Array(n); for (let k = 0; k < n; k++) u[k] = bin.charCodeAt(k); return u; }
  H.chunk = async (h, b64) => {
    try {
      const buf = await new Response(new Blob([b64bytes(b64)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const A = (T, k) => new T(buf, h.lay[k][0], h.lay[k][1]), S = (T, k) => A(T, k).slice(); // S = eigen kopie: anders houdt een view de hele uitgepakte buffer (±1 MB/vak) vast
      const c = {
        i: h.i, j: h.j, x0: h.i * area.km, y0: h.j * area.km, nr: h.nr, nw: h.nw, demN: h.demN, demStep: h.demStep,
        ids: S(Float64Array, 'ids'), bR: S(Uint32Array, 'bR'), bW: S(Uint32Array, 'bW'), year: S(Int16Array, 'year'), hgt: S(Uint16Array, 'hgt'), fl: S(Uint8Array, 'fl'), dem: S(Uint16Array, 'dem'),
      };
      // gebouwen: detail (LoD 2.2) + lichte variant voor ver weg (LoD 1.2, oudere data: geen)
      const ax = h.ox - O[0], az = h.oy - O[1];
      const build = (vk, rk, wk, nv, nr, nw, perBuilding) => {
        const V = A(Uint16Array, vk), pos = new Float32Array(nv * 3);
        for (let k = 0; k < nv; k++) {
          pos[k * 3] = ax + V[k * 3] * h.qxy;
          pos[k * 3 + 1] = V[k * 3 + 2] * h.qz;
          pos[k * 3 + 2] = -(az + V[k * 3 + 1] * h.qxy);
        }
        const idx = new Uint32Array((nr + nw) * 3);
        let w = 0;
        for (const key of [rk, wk]) { const D = A(Int32Array, key); let p = 0; for (let k = 0; k < D.length; k++) idx[w++] = (p += D[k]); }
        const seed = new Float32Array(nv).fill(0.37); // vast willekeurig getal per pand (iso: kleur per pand); ver-weg-variant één tint
        const lift = y => (EXAG - 1) * (y - H0), done = new Uint8Array(nv);
        if (perBuilding) for (let b = 0; b < c.bR.length; b++) {
          const r0 = c.bR[b] * 3, r1 = (b + 1 < c.bR.length ? c.bR[b + 1] : nr) * 3, w0 = (nr + c.bW[b]) * 3, w1 = (nr + (b + 1 < c.bW.length ? c.bW[b + 1] : nw)) * 3;
          let lo = Infinity;
          for (let k = w0; k < w1; k++) lo = Math.min(lo, pos[idx[k] * 3 + 1] + 1); // voet = laagste muurpunt + 1 m
          if (lo === Infinity) { const v = idx[r0] * 3; lo = demAt(c, pos[v] + O[0], O[1] - pos[v + 2]); }
          const dy = EXAG !== 1 ? lift(lo) : 0, sd = Math.abs((Math.sin(b * 12.9898 + c.i * 78.233 + c.j * 3.71) * 43758.5453) % 1);
          for (const [a, e] of [[r0, r1], [w0, w1]]) for (let k = a; k < e; k++) { const v = idx[k]; seed[v] = sd; if (!done[v]) { done[v] = 1; pos[v * 3 + 1] += dy; } }
        }
        if (EXAG !== 1) for (let v = 0; v < nv; v++) if (!done[v]) pos[v * 3 + 1] += lift(demAt(c, pos[v * 3] + O[0], O[1] - pos[v * 3 + 2]));
        if (perBuilding) sortWalls(c, pos, idx, nr, nw); // iso: muren per richting (A1)
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
        g.addGroup(0, nr * 3, 0); g.addGroup(nr * 3, nw * 3, 1);
        g.computeBoundingSphere(); g.computeBoundingBox();
        const m = new THREE.Mesh(g, [MAT.roof, MAT.wall]);
        m.castShadow = m.receiveShadow = true; m.userData.chunk = c;
        scene.add(m);
        return m;
      };
      c.mesh = build('v', 'roof', 'wall', h.nv, h.nr, h.nw, true);
      wallGroups(c, isoWallMask());
      // schaduwkaart: altijd alle muren (zon staat los van de camera); eerste muurgroep tijdelijk over alle muren, de rest leeg
      c.mesh.onBeforeShadow = (r, o, cam, sc, geo, dm, gr) => {
        if (!gr || gr.materialIndex !== 1 || c.wMask === WALL_ALL) return;
        gr._s = gr.start; gr._n = gr.count;
        if (gr === geo.groups[1]) { gr.start = c.nr * 3; gr.count = c.nw * 3; } else gr.count = 0;
      };
      c.mesh.onAfterShadow = (r, o, cam, sc, geo, dm, gr) => { if (gr && gr._n !== undefined) { gr.start = gr._s; gr.count = gr._n; gr._n = undefined; } };
      if (h.nv1) { c.lo = build('v1', 'roof1', 'wall1', h.nv1, h.nr1, h.nw1); c.lo.visible = false; c.lo.castShadow = false; }
      // terrein
      const N = h.demN, s = h.demStep, tp = new Float32Array(N * N * 3);
      let minH = Infinity;
      for (let r = 0; r < N; r++) for (let q = 0; q < N; q++) {
        const k = r * N + q, hh = ex(c.dem[k] / 100); minH = Math.min(minH, hh);
        tp[k * 3] = c.x0 + q * s - O[0]; tp[k * 3 + 1] = hh; tp[k * 3 + 2] = -(c.y0 + area.km - r * s - O[1]);
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
      tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * N * 2), 2));
      tg.setIndex(terrIndex(N, 1)); tg.computeVertexNormals(); tg.computeBoundingSphere(); c.tStep = 1;
      c.terrain = new THREE.Mesh(tg, terrMat(new THREE.MeshLambertMaterial({ color: STYLES[style].bg })));
      c.terrain.receiveShadow = true; c.terrain.renderOrder = 1; // terrein als laatste (dure shader): wat panden/linten/bomen bedekken valt weg in de dieptetest
      c.terrain.userData.chunk = c;
      scene.add(c.terrain);
      if (H.baseH === undefined || minH - 3 < H.baseH) { H.baseH = minH - 3; if (ground) ground.position.y = H.baseH; }
      H.chunks.set(h.i + '_' + h.j, c);
      c.level = 0;
      chunkMarks(c);
      applyHidden(c);
      emit('chunk', c); // iso/*.js: eigen spul per vak (c.i, c.j, c.x0, c.y0 in RD, c.mesh, c.terrain)
      shadowDirty = true; redraw();
    } catch (e) { console.error('vak', h.i, h.j, e); }
    H._afterChunk?.();
  };

  // ---------- Kaarttegels op het terrein: detail naar afstand ----------
  const TS = 256, lon2px = (lon, z) => (lon + 180) / 360 * TS * 2 ** z;
  const lat2py = (lat, z) => { const f = lat * Math.PI / 180; return (1 - Math.log(Math.tan(f) + 1 / Math.cos(f)) / Math.PI) / 2 * TS * 2 ** z; };
  const tileQ = []; let tileBusy = 0;
  function chunkDist(c, p, vert = 0.8) { // afstand van punt p tot het vak (vlak), hoogte telt voor `vert`
    const x0 = c.x0 - O[0], x1 = x0 + area.km, z1 = -(c.y0 - O[1]), z0 = z1 - area.km;
    const dx = Math.max(x0 - p.x, 0, p.x - x1), dz = Math.max(z0 - p.z, 0, p.z - z1), dy = Math.max(0, p.y - heightAt(c.x0 + 500, c.y0 + 500));
    return Math.hypot(dx, dz, dy * vert);
  }
  // smallere lens (Plat) = camera verder weg; afstanden omrekenen naar wat je ziet bij de gewone lens
  // iso: alles even groot (geen perspectief) → afstand tot de camera × lens ≈ afstand waarop de gewone lens hetzelfde toont
  const lens = () => camera === ortho ? isoHalf() / TAN21 / camera.position.distanceTo(controls.target) : Math.tan(persp.fov * Math.PI / 360) / TAN21;
  const viewDist = () => camera.position.distanceTo(controls.target) * lens();
  // halve breedte van het schaduwkader (en waarbinnen panden schaduw werpen)
  const shadowExt = () => camera === ortho ? Math.max(350, Math.min(3000, Math.max(isoHalf() * ortho.right / ISO_H0, isoHalf() * 2.2) * 1.1))
    : Math.max(350, Math.min(2600, viewDist() * 1.1));
  H.lens = lens;
  function wantLevel(c) {
    if (camera === ortho) { // iso: overal dezelfde schaal → tegelniveau uit meters per schermpixel (incl. pixeldichtheid), niet uit afstand
      const h = isoHalf(), mpp = 2 * h / (renderer.domElement.clientHeight * PR); // tegel z: ±98 730 / 2^z m per px op 50,9° NB
      const z = Math.min(18, Math.max(15, Math.ceil(Math.log2(98730 / mpp) - 0.15))); // iso: geen z14 (A1)
      return chunkDist(c, controls.target, 0) < Math.max(h * ortho.right / ISO_H0, h * 2.3) ? z : Math.max(15, z - 2); // buiten beeld grover
    }
    const d = chunkDist(c, camera.position) * lens();
    return d < 650 ? 18 : d < 1700 ? 17 : d < 4500 ? 16 : d < 9000 ? 15 : 14;
  }
  // ---------- Snelheid: ver weg lichte gebouwen, schaduw alleen rond het doel ----------
  const LO_FAR = 2300, SHADOW_OFF = 3600;
  // iso: welke muurstukken naar de camera wijzen (bit 0 = altijd, bit 1+q = richting q); tijdens draaien/vliegen alles
  function isoWallMask() {
    if (camera !== ortho || fly) return WALL_ALL;
    const a = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x), Q = Math.PI / 2;
    const off = (((a - Q / 2) % Q) + Q) % Q;
    if (Math.min(off, Q - off) > 2 * Math.PI / 180) return WALL_ALL;
    let m = 1;
    for (let q = 0; q < 4; q++) if (Math.cos(a - q * Q) > 0) m |= 2 << q;
    return m;
  }
  function setWallMask(m) { let ch = false; for (const c of H.chunks.values()) if (wallGroups(c, m)) ch = true; return ch; }
  on('turn', () => { if (setWallMask(WALL_ALL)) redraw(); }); // meteen alles, updateDetail loopt maar elke 400 ms
  function updateDetail() {
    const mv = moveNow; // tijdens bewegen alleen grover (goedkoper) maken; fijner, schaduw en emit('detail') pas bij stilstand
    let ch = setWallMask(isoWallMask());
    const dist = viewDist();
    const shadows = sun.castShadow ? dist < SHADOW_OFF + 300 : dist < SHADOW_OFF - 300; // marge: niet steeds wisselen
    if (shadows !== sun.castShadow && !mv) { sun.castShadow = shadows; ch = true; }
    const S = shadowExt() + 200;
    // iso: één terreinstap voor alle vakken naar pixels per meter (ortho = overal dezelfde schaal): rastercel 10 m ≥ ±6 px, anders grover
    // (fijn terrein ver uitgezoomd = piepkleine driehoeken, kostte ±25 ms GPU op Iris Pro)
    renderer.getDrawingBufferSize(dbs);
    const ppm = camera === ortho ? dbs.y / (2 * isoHalf()) : 0, isoSt = ppm >= 0.6 ? 1 : ppm >= 0.3 ? 2 : 4;
    for (const c of H.chunks.values()) {
      const d = chunkDist(c, camera.position) * lens(), far = !!c.lo && camera !== ortho && (c.lo.visible ? d > LO_FAR - 200 : d > LO_FAR + 200); // iso: altijd LoD 2.2 (A1)
      if (c.lo && c.lo.visible !== far && (far || !mv)) { c.lo.visible = far; c.mesh.visible = !far; ch = true; }
      const cast = shadows && !far && chunkDist(c, controls.target, 0) < S;
      if (c.mesh.castShadow !== cast && !mv) { c.mesh.castShadow = cast; ch = true; }
      if (c.trees) { // bomen: dichtbij alles, verder weg uitgedund, heel ver weg geen
        const f = d < 1800 ? 1 : d < 4000 ? 1 / 3 : d < 8000 ? 1 / 8 : 0, lo = dbs.y / (2 * d * TAN21) < TREE_LO_PPM; // d × lens → px/m zoals in iso
        for (const im of c.trees) {
          const g = lo ? im.geoLo : im.geoHi; if (im.geometry !== g && (lo || !mv)) { im.geometry = g; ch = true; }
          const n = Math.round(im.full * f), cs = cast && f === 1;
          if (im.count !== n && (n < im.count || !mv)) { im.count = n; ch = true; }
          if (im.castShadow !== cs && !mv) { im.castShadow = cs; ch = true; }
        }
      }
      const st = camera === ortho ? isoSt : d < 2500 ? 1 : d < 6000 ? 2 : 4; // terrein grover ver weg (naden vallen weg tegen de ondergrond); iso: overal dezelfde stap (geen naden)
      if (st !== c.tStep && (st > c.tStep || !mv)) { c.tStep = st; c.terrain.geometry.setIndex(terrIndex(c.demN, st)); ch = true; }
    }
    if (ch) { shadowDirty = true; redraw(); }
    if (!mv) emit('detail', dist); // iso/*.js: eigen uitdunning naar afstand (H.chunkDist(c) × H.lens()); bij stilstand
  }
  H.viewDist = () => viewDist();
  H.chunkDist = (c, p = camera.position) => chunkDist(c, p);
  function texture(c, z) {
    const tok = c.texTok = (c.texTok || 0) + 1, st = style;
    const corners = [[c.x0, c.y0], [c.x0 + area.km, c.y0], [c.x0, c.y0 + area.km], [c.x0 + area.km, c.y0 + area.km]].map(([x, y]) => rd2wgs(x, y));
    const pxs = corners.map(([la, lo]) => lon2px(lo, z)), pys = corners.map(([la]) => lat2py(la, z));
    const tx0 = Math.floor(Math.min(...pxs) / TS), tx1 = Math.floor(Math.max(...pxs) / TS), ty0 = Math.floor(Math.min(...pys) / TS), ty1 = Math.floor(Math.max(...pys) / TS);
    const cv = document.createElement('canvas'); cv.width = (tx1 - tx0 + 1) * TS; cv.height = (ty1 - ty0 + 1) * TS;
    const ctx = cv.getContext('2d', { willReadFrequently: st === 'kaart' }); ctx.fillStyle = STYLES[st].bg; ctx.fillRect(0, 0, cv.width, cv.height);
    let todo = (tx1 - tx0 + 1) * (ty1 - ty0 + 1), ok = 0;
    const finish = () => {
      if (tok !== c.texTok || st !== style) return;
      if (moveNow) { setTimeout(finish, 150); return; } // omkleuren + uploaden niet midden in een beweging
      if (!ok) { c.level = z; return; } // offline: kale kleur houden
      if (st === 'kaart') recolor(ctx, landCanvas(c, z, tx0, ty0, cv.width, cv.height));
      const N = c.demN, s = c.demStep, uv = c.terrain.geometry.attributes.uv;
      for (let r = 0; r < N; r++) for (let q = 0; q < N; q++) {
        const [la, lo] = rd2wgs(c.x0 + q * s, c.y0 + area.km - r * s), k = r * N + q;
        uv.setXY(k, (lon2px(lo, z) - tx0 * TS) / cv.width, 1 - (lat2py(la, z) - ty0 * TS) / cv.height);
      }
      uv.needsUpdate = true;
      const tex = H.freeAfterUpload(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const m = c.terrain.material;
      m.map?.dispose(); m.map = tex; m.color.set('#ffffff'); m.needsUpdate = true;
      c.level = z; redraw();
    };
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) tileQ.push({
      c, tok, pri: () => -c.wantZ, run: done => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => { if (tok === c.texTok) { ctx.drawImage(img, (tx - tx0) * TS, (ty - ty0) * TS); ok++; } done(); };
        img.onerror = () => done();
        img.src = STYLES[st].url(z, tx, ty);
      }, after: () => { if (--todo === 0) finish(); },
    });
    pumpTiles();
  }
  // PDOK pastel tekent wegen roze (#ffbfb3) en geel (#fff2b3) → grijs. Herkennen op tint: rood sterkst en (g−b)/(r−min)
  // ≈ 0,16 (roze) of ≈ 0,83 (geel); pand-perzik #ffe6cc = 0,51 en groen (g sterkst) blijven. Randpixels (wit + weg) gaan naar wit + grijs.
  // Daarna: (bijna) witte kaartgrond → kleur van het landgebruik (lappendeken), lichtblauw water → dieper blauw.
  const ROAD_GREY = [206, 203, 199], PINK = [255, 191, 179], YEL = [255, 242, 179], WATER = [126, 174, 211];
  function recolor(ctx, land) {
    const W = ctx.canvas.width, Hh = ctx.canvas.height, im = ctx.getImageData(0, 0, W, Hh), d = im.data, ld = land.getContext('2d').getImageData(0, 0, W, Hh).data;
    for (let k = 0; k < d.length; k += 4) {
      let r = d[k], g = d[k + 1], b = d[k + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b), ch = mx - mn;
      if (r >= g && r >= b && ch >= 6) {
        const q = (g - b) / ch, src = q < 0.3 ? PINK : q > 0.72 ? YEL : null;
        if (src) {
          const a = Math.min(1, ch / 76);
          d[k] = r = Math.max(0, Math.min(255, r + (ROAD_GREY[0] - src[0]) * a)); d[k + 1] = g = Math.max(0, Math.min(255, g + (ROAD_GREY[1] - src[1]) * a)); d[k + 2] = b = Math.max(0, Math.min(255, b + (ROAD_GREY[2] - src[2]) * a));
          continue;
        }
      }
      if (b > r + 12 && b >= g) { const a = Math.min(1, (b - r) / 40) * 0.8; d[k] = r + (WATER[0] - r) * a; d[k + 1] = g + (WATER[1] - g) * a; d[k + 2] = b + (WATER[2] - b) * a; continue; }
      const w = Math.min(1, Math.max(0, (mn - 222) / 22)) * Math.min(1, Math.max(0, (24 - ch) / 14)); // hoe "kaartwit"
      if (w > 0) for (let i = 0; i < 3; i++) d[k + i] += (ld[k + i] - d[k + i]) * w;
    }
    ctx.putImageData(im, 0, 0);
  }
  // landgebruik (data/layers.js `land` + bossen) op een canvas in tegelpixels; grote vlakken eerst, kleine erbovenop
  const LAND_C = { akker: ['#efe0a4', '#e6e7a8', '#f1d59e', '#dfe9a6'], erf: ['#ead9bf'], weide: ['#c9e4a4'], gras: ['#c4e2a0'], park: ['#b3d996'], boomgaard: ['#c2dc98'],
    tuin: ['#d3e6ae'], sport: ['#b9df9c'], kerkhof: ['#bcd3a6'], wonen: ['#f1e2cf'], werk: ['#e9dcef'], winkel: ['#f5d8d0'], industrie: ['#ddd6e8'], bouw: ['#e8dcc0'],
    heide: ['#dcc6dc'], struik: ['#c6dca4'], bos: ['#a3cc88'] };
  let landPolys = null;
  function landCanvas(c, z, tx0, ty0, W, Hh) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const x = cv.getContext('2d'); x.fillStyle = STYLES.kaart.bg; x.fillRect(0, 0, W, Hh);
    const d = H.layerData; if (!d) return cv;
    if (!landPolys) {
      landPolys = [...(d.land || []).map(([k, a]) => [k, a]), ...(d.woods || []).map(([, a]) => ['bos', a])].map(([k, a], n) => {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, A = 0;
        for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); const j = (i + 2) % a.length; A += a[i] * a[j + 1] - a[j] * a[i + 1]; }
        const pal = LAND_C[k] || LAND_C.gras;
        return { a, x0, y0, x1, y1, A: Math.abs(A), col: pal[(n * 7919) % pal.length] };
      }).sort((p, q) => q.A - p.A);
    }
    const ox = tx0 * TS, oy = ty0 * TS, X0 = c.x0 - 50, Y0 = c.y0 - 50, X1 = c.x0 + area.km + 50, Y1 = c.y0 + area.km + 50;
    for (const p of landPolys) {
      if (p.x1 < X0 || p.x0 > X1 || p.y1 < Y0 || p.y0 > Y1) continue;
      x.beginPath();
      for (let i = 0; i < p.a.length; i += 2) { const [la, lo] = rd2wgs(p.a[i], p.a[i + 1]); const px = lon2px(lo, z) - ox, py = lat2py(la, z) - oy; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.fillStyle = p.col; x.fill();
    }
    return cv;
  }
  function pumpTiles() {
    tileQ.sort((a, b) => a.pri() - b.pri());
    while (tileBusy < 12 && tileQ.length) {
      const t = tileQ.shift();
      if (t.tok !== t.c.texTok) { t.after(); continue; }
      tileBusy++;
      t.run(() => { tileBusy--; t.after(); pumpTiles(); });
    }
  }
  let lastLod = 0;
  function updateTextures(now) {
    if (now - lastLod < 400) return;
    lastLod = now;
    updateDetail();
    if (camera === ortho || moveNow) return; // iso: eigen grond (iso/ground.js) i.p.v. PDOK-tegels → niets laden; terug naar Oud laadt vanzelf bij. Bewegen: pas bij stilstand
    for (const c of H.chunks.values()) {
      const z = wantLevel(c); c.wantZ = z;
      if (z !== c.level && z !== c.pendingZ) { c.pendingZ = z; texture(c, z); }
    }
  }
  H.setStyle = s => {
    if (!STYLES[s] || s === style) return;
    style = s; try { localStorage.setItem('h3d.style', s); } catch {}
    ground?.material.color.set(STYLES[s].bg);
    for (const c of H.chunks.values()) { c.level = 0; c.pendingZ = 0; }
    lastLod = 0; emit('style', s); redraw();
  };
  H.getStyle = () => style;

  // ---------- Aanklikken: pand of grond ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let selMesh = null;
  function setupPicking(dom) {
    let down = null;
    dom.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY, performance.now()]; });
    dom.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || performance.now() - down[2] > 600) return;
      const r = dom.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const objs = [];
      for (const c of H.chunks.values()) objs.push(c.mesh, c.terrain);
      const hit = ray.intersectObjects(objs, false)[0];
      selKey = null;
      if (!hit) { select(null); emit('pick', null); return; }
      const c = hit.object.userData.chunk, [x, y] = toRD(hit.point);
      if (hit.object === c.mesh) {
        selKey = null;
        const b = buildingOf(c, hit.faceIndex), here = byBuilding.get(c.i + '_' + c.j + ':' + b) || [];
        select(c, b, !!here.length);
        emit('pick', { type: 'pand', x, y, h: demAt(c, x, y), info: buildingInfo(c, b), marks: here });
      } else { select(null); emit('pick', { type: 'grond', x, y, h: demAt(c, x, y) }); }
    });
  }
  function upper(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; } return lo - 1; }
  const wallOf = (c, f) => { if (!c.wB) return upper(c.bW, f); const k = upper(c.wS, f), nB = c.bW.length; return upper(c.wB.subarray(k * nB, (k + 1) * nB), f); };
  const buildingOf = (c, f) => f < c.nr ? upper(c.bR, f) : wallOf(c, f - c.nr);
  function buildingInfo(c, b) {
    return { id: String(c.ids[b]).padStart(16, '0'), year: c.year[b] || null, height: c.hgt[b] / 10, floors: c.fl[b] || null };
  }
  function facesOf(c, b, out, wallOut = out) { // driehoeken van pand b: dak → out, muur → wallOut (standaard ook out)
    const I = c.mesh.geometry.index.array;
    const r0 = c.bR[b], r1 = b + 1 < c.bR.length ? c.bR[b + 1] : c.nr;
    for (let f = r0; f < r1; f++) out.push(I[f * 3], I[f * 3 + 1], I[f * 3 + 2]);
    for (const [w0, w1] of wallRuns(c, b)) for (let f = w0; f < w1; f++) { const k = (c.nr + f) * 3; wallOut.push(I[k], I[k + 1], I[k + 2]); }
    return out;
  }
  let pulseT0 = 0, selKey = null;
  function select(c, b, isPlace = false) { // isPlace: wit knipperen op de categoriekleur, anders rood
    if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
    if (c) {
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', c.mesh.geometry.attributes.position); sg.setIndex(facesOf(c, b, []));
      MAT.sel.color.set(isPlace ? '#ffffff' : '#ff3355');
      selMesh = new THREE.Mesh(sg, MAT.sel); scene.add(selMesh);
      pulseT0 = performance.now();
    }
    redraw();
  }
  H.clearSelection = () => { selKey = null; select(null); };

  // gedeelde shader-uniforms (licht, iso-look)
  const pal = a => a.map(c => new THREE.Color(c));
  const U = { uNight: { value: 0 }, uIso: { value: 0 }, uLvl: { value: 1 }, uDim: { value: 0 }, uEye: { value: new THREE.Vector3() },
    uPalR: { value: pal(['#c95f48', '#b85443', '#5f7f9e', '#d08a52', '#a9584a', '#6f8f6a', '#c96e4f', '#6d86a3']) },   // iso-daken
    uPalW: { value: pal(['#f2dcb6', '#f4e6c9', '#dfe6cf', '#d6e2e8', '#efd5c4', '#f7ecd8', '#e9d3c9', '#e7e2cc']) } }; // iso-gevels
  // ---------- Andere gebouwen dimmen (vager, platter) ----------
  let dim = false;
  try { dim = localStorage.getItem('h3d.dim') === '1'; } catch {}
  function applyDim() {
    MAT.wall.color.set(dim ? '#f7f6f3' : '#eeeae4'); MAT.roof.color.set(dim ? '#e6e3de' : '#bdb5ab');
    const k = dim ? 1 - night : 0; // 's avonds geen eigen licht op gewone panden
    MAT.wall.emissive.setScalar(0.0703 * k); MAT.roof.emissive.setScalar(0.0437 * k); // = #4a4a4a / #3a3a3a (lineair)
    U.uDim.value = dim ? 1 : 0;
    redraw();
  }
  let night = 0, nightGoal = 0; // 0 = dag, 1 = nacht (zie "Licht")
  applyDim();
  H.setDim = on => { dim = !!on; try { localStorage.setItem('h3d.dim', dim ? '1' : '0'); } catch {} applyDim(); };
  H.getDim = () => dim;

  // ---------- Licht: dag / avond / nu (volgt de klok), met verlichte ramen en gloeiende plekken ----------
  // iso: licht in 3 harde tinten (licht/half/schaduw), relatief aan het lichtniveau (uLvl) zodat de avond donkerder blijft
  function addCel(s) {
    Object.assign(s.uniforms, { uIso: U.uIso, uLvl: U.uLvl });
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uIso, uLvl;')
      .replace('#include <opaque_fragment>', `if (uIso > 0.5) {
        float a = max(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), 0.001);
        float l = dot(outgoingLight - totalEmissiveRadiance, vec3(0.3, 0.59, 0.11)) / a / uLvl;
        outgoingLight = diffuseColor.rgb * uLvl * (l < 0.62 ? 0.52 : l < 1.05 ? 0.8 : 1.04) + totalEmissiveRadiance;
      }
      #include <opaque_fragment>`);
  }
  const celify = (m, key) => { const prev = m.onBeforeCompile; m.onBeforeCompile = (s, r) => { prev.call(m, s, r); addCel(s); }; if (key) m.customProgramCacheKey = () => key + (PATCH[key] ? pkey(key) : ''); return m; };
  H.celify = celify; // eigen materialen in iso/*.js dezelfde cel-look geven (key = unieke naam)
  // ---------- Aanhaakpunten voor iso/*.js: shader-stukjes aanrijgen ----------
  // H.patchTerrain/patchWall/patchRoof(naam, (shader, materiaal) => …): draait na de eigen aanpassingen en vóór de cel-shading.
  // Laat de #include-regels die je vervangt staan (andere stukjes haken er ook op in). Zelfde naam opnieuw = vervangen.
  // Wall/roof = alleen de gewone panden (niet de opgelichte plekken).
  const PATCH = { terrain: [], wall: [], roof: [] };
  const pkey = k => PATCH[k].map(p => p.name).join(',');
  const runPatch = (k, s, m) => { for (const p of PATCH[k]) p.fn(s, m); };
  function addPatch(k, name, fn) {
    PATCH[k] = PATCH[k].filter(p => p.name !== name).concat({ name, fn });
    const mats = k === 'terrain' ? [ground?.material, ...[...H.chunks.values()].map(c => c.terrain.material)] : [MAT[k]];
    for (const m of mats) if (m) m.needsUpdate = true;
    redraw();
  }
  H.patchTerrain = (name, fn) => addPatch('terrain', name, fn);
  H.patchWall = (name, fn) => addPatch('wall', name, fn);
  H.patchRoof = (name, fn) => addPatch('roof', name, fn);
  // kleur per pand (aSeed) i.p.v. neutraal grijs, in alle modussen; dimmen = grotendeels ontkleuren
  const isoPal = (s, roof) => {
    Object.assign(s.uniforms, { uPalR: U.uPalR, uPalW: U.uPalW, uDim: U.uDim });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSeed; varying float vS;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvS = aSeed;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vS; uniform vec3 uPalR[8]; uniform vec3 uPalW[8]; uniform float uDim;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 p = ${roof ? 'uPalR[int(fract(vS * 7.31) * 7.999)]' : 'uPalW[int(vS * 7.999)]'};
        diffuseColor.rgb = mix(p, vec3(dot(p, vec3(0.3, 0.59, 0.11)) * 1.1), 0.7 * uDim);
      }`);
  };
  // kaart op het terrein (+ ondergrond): in iso iets voller/zachter (= canvasfilter saturate 1.25 · contrast 0.85 · brightness 1.06 uit het ontwerp)
  function terrMat(m) {
    m.customProgramCacheKey = () => 'terr' + pkey('terrain');
    m.onBeforeCompile = s => {
      s.uniforms.uIso = U.uIso;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uIso;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        if (uIso > 0.5) {
          vec3 c = pow(max(diffuseColor.rgb, 0.0), vec3(1.0 / 2.2));
          c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.25);
          c = ((c - 0.5) * 0.85 + 0.5) * 1.06;
          diffuseColor.rgb = pow(clamp(c, 0.0, 1.0), vec3(2.2));
        }`);
      runPatch('terrain', s, m);
    };
    return m;
  }
  MAT.roof.onBeforeCompile = s => { isoPal(s, true); runPatch('roof', s, MAT.roof); };
  celify(MAT.roof, 'roof');
  MAT.wall.onBeforeCompile = s => { // ramen: raster per verdieping (3,1 m) op de muur, ±20% brandt; ver weg vervaagd tot gemiddelde gloed
    s.uniforms.uNight = U.uNight; s.uniforms.uEye = U.uEye;
    isoPal(s, false);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; uniform float uNight; uniform vec3 uEye;\nfloat h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (uNight > 0.0) {
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
        float u = abs(n.x) > abs(n.z) ? vW.z : vW.x, fy = (vW.y - 1.0) / 3.1;
        vec2 f = vec2(fract(u / 3.2), fract(fy));
        float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.8);
        float lit = step(0.8, h21(vec2(floor(u / 3.2), floor(fy)) + floor(vW.xz / 40.0)));
        float fade = smoothstep(700.0, 2200.0, length(vW - uEye));
        gl_FragColor.rgb += vec3(1.0, 0.72, 0.38) * mix(win * lit, 0.05, fade) * step(abs(n.y), 0.5) * uNight * 0.6;
      }`);
    runPatch('wall', s, MAT.wall);
  };
  celify(MAT.wall, 'wall');
  const C = (...a) => a.map(h => new THREE.Color(h));
  const SKYC = C('#d3e6f2', '#e2b79a', '#1c2640'), SUNC = C('#ffecc8', '#ffb27a', '#aebfff');
  const ZEN = C('#5b9ee6', '#6a6aa8', '#070d22'), ZEN_ISO = C('#78b4ea', '#6a6aa8', '#070d22'); // lucht bovenin (verloop naar de horizon = mistkleur)
  const skyCv = document.createElement('canvas'); skyCv.width = 2; skyCv.height = 128;
  const skyTex = new THREE.CanvasTexture(skyCv); skyTex.colorSpace = THREE.SRGBColorSpace;
  const skyH = new THREE.Color(), skyZ = new THREE.Color();
  function paintSky() {
    const x = skyCv.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#' + skyZ.getHexString()); g.addColorStop(0.55, '#' + skyH.getHexString()); g.addColorStop(1, '#' + skyH.getHexString());
    x.fillStyle = g; x.fillRect(0, 0, 2, 128); skyTex.needsUpdate = true;
  }
  const HEMI = C('#ffffff', '#7f8fb8'), HEMIG = C('#8d8577', '#2a2630');
  const SKYC_ISO = C('#e2f0f4', '#e2b79a', '#1c2640'), SUNC_ISO = C('#ffecc8', '#ffb27a', '#aebfff'), HEMIG_ISO = C('#b9b0a0', '#2a2630');
  const lerp3 = (a, n, out) => n < 0.5 ? out.lerpColors(a[0], a[1], n * 2) : out.lerpColors(a[1], a[2], n * 2 - 2 + 1);
  let lightMode = 'dag';
  try { lightMode = ['dag', 'avond', 'nu'].includes(localStorage.getItem('h3d.light')) ? localStorage.getItem('h3d.light') : 'dag'; } catch {}
  function sunElev(d = new Date()) { // zonshoogte in graden boven Heerlen (benadering, ±1°)
    const doy = (d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5, rad = Math.PI / 180;
    const decl = -23.44 * rad * Math.cos(2 * Math.PI * (doy + 10) / 365), lat = 50.89 * rad;
    const ha = ((d.getUTCHours() + d.getUTCMinutes() / 60 + 5.98 / 15) - 12) * 15 * rad;
    return Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)) / rad;
  }
  const goalFor = m => m === 'dag' ? 0 : m === 'avond' ? 1 : Math.min(1, Math.max(0, (4 - sunElev()) / 10)); // 4° boven → 6° onder de horizon
  function applyNight() {
    if (!scene) return;
    const n = night, w = THREE.MathUtils.smoothstep(n, 0.35, 0.9);
    const hg = iso ? HEMIG_ISO : HEMIG, h0 = iso ? 1.3 : 1.6, s0 = iso ? 2.6 : 2.2; // iso: cel-licht uit het ontwerp
    lerp3(iso ? SKYC_ISO : SKYC, n, skyH); lerp3(iso ? ZEN_ISO : ZEN, n, skyZ); scene.fog.color.copy(skyH);
    paintSky(); scene.background = skyTex;
    hemi.color.lerpColors(HEMI[0], HEMI[1], n); hemi.groundColor.lerpColors(hg[0], hg[1], n); hemi.intensity = h0 - (h0 - 0.45) * n;
    lerp3(iso ? SUNC_ISO : SUNC, n, sun.color); sun.intensity = s0 - (s0 - 0.35) * n;
    U.uLvl.value = (hemi.intensity + sun.intensity) / 3.9;
    U.uNight.value = w;
    for (const m of hlMat.values()) m.emissiveIntensity = HL_GLOW * (1 + 1.6 * w);
    document.body.classList.toggle('night', n > 0.6);
    applyDim();
  }
  H.setLight = m => { lightMode = m; nightGoal = goalFor(m); try { localStorage.setItem('h3d.light', m); } catch {} redraw(); emit('light', m); };
  H.getLight = () => lightMode;
  nightGoal = night = goalFor(lightMode);
  // gedeeld met iso/*.js: uniforms (uIso, uLvl, uNight, uEye …), nachtwaarde 0–1, iso-palet (kleurtrio's = [dag, avond, nacht])
  H.U = U;
  H.night = () => night;
  H.isoColors = { sky: SKYC_ISO, zenith: ZEN_ISO, sun: SUNC_ISO, hemiGround: HEMIG_ISO, ink: new THREE.Color('#2a2420'), roofs: U.uPalR.value, walls: U.uPalW.value };

  // ---------- Eigen modellen: pand verbergen (driehoeken plat maken), ook als het vak nog moet laden ----------
  const hidden = new Set(), bagId = (c, b) => String(c.ids[b]).padStart(16, '0');
  const normId = id => String(id).replace(/^NL\.IMBAG\.Pand\./, '').padStart(16, '0');
  function setHidden(c, b, on) {
    const I = c.mesh.geometry.index.array, bak = c.hideBak ||= new Map();
    const runs = [[c.bR[b], b + 1 < c.bR.length ? c.bR[b + 1] : c.nr, 0], ...wallRuns(c, b).map(([f0, f1]) => [f0, f1, c.nr])];
    if (on && !bak.has(b)) { // alle driehoeken naar één hoekpunt → onzichtbaar en niet aanklikbaar
      const keep = [];
      for (const [f0, f1, o] of runs) { const a = (o + f0) * 3, v = I[a]; for (let k = a; k < (o + f1) * 3; k++) { keep.push(I[k]); I[k] = v; } }
      bak.set(b, keep);
    } else if (!on && bak.has(b)) {
      const keep = bak.get(b); let i = 0;
      for (const [f0, f1, o] of runs) for (let k = (o + f0) * 3; k < (o + f1) * 3; k++) I[k] = keep[i++];
      bak.delete(b);
    } else return;
    c.mesh.geometry.index.needsUpdate = true; shadowDirty = true; redraw();
  }
  function applyHidden(c) { if (hidden.size) for (let b = 0; b < c.ids.length; b++) if (hidden.has(bagId(c, b))) setHidden(c, b, true); }
  H.hideBuilding = (id, on = true) => { // BAG-pand-id (16 cijfers of 'NL.IMBAG.Pand.…'); geldt ook voor vakken die nog laden
    const k = normId(id); on ? hidden.add(k) : hidden.delete(k);
    for (const c of H.chunks.values()) for (let b = 0; b < c.ids.length; b++) if (bagId(c, b) === k) setHidden(c, b, on);
  };
  H.showBuilding = id => H.hideBuilding(id, false);
  H.findBuilding = id => { const k = normId(id); for (const c of H.chunks.values()) for (let b = 0; b < c.ids.length; b++) if (bagId(c, b) === k) return { c, b, info: buildingInfo(c, b) }; return null; };
  H.wallRuns = (c, b) => wallRuns(c, b); // muurreeksen van pand b [f0, f1) t.o.v. muurbegin (na A1 per richting gesorteerd)
  H.facesOf = (c, b) => facesOf(c, b, []); // hoekpunt-indices in c.mesh.geometry (dak + muur)
  setInterval(() => { if (lightMode === 'nu') { nightGoal = goalFor('nu'); redraw(); } }, 60000);

  // ---------- Plekken ↔ panden: het pand licht op in de kleur van de categorie ----------
  // Koppelen gebeurt hier (niet bij het bouwen): punt in dakvlak, anders dichtstbijzijnde pand ≤ LINK_MAX m.
  const LINK_MAX = 15, LINK_MARGIN = 150; // marge: pand hoort bij het vak van zijn midden, kan over de rand steken
  const marks = new Map();      // sleutel → { key, x, y, color, best: { d, c, b } }
  const byBuilding = new Map(); // 'i_j:b' → [sleutels], volgorde = voorrang
  const hlMat = new Map(), hlMeshes = [], HL_GLOW = 0.18; // gloed van opgelichte panden (palet Mijnstreek)
  const matFor = col => {
    let m = hlMat.get(col);
    if (!m) hlMat.set(col, m = celify(new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: HL_GLOW * (1 + 1.6 * U.uNight.value), flatShading: true, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }), 'hlroof'));
    return m;
  };
  // gevel van een bedrijfspand (keuze 1+2+4): band begane grond (pui + luifelrand, 's avonds etalage) + avondramen in categoriekleur.
  // Dak = matFor. aBase = voet van het pand (laagste muurpunt + 1 m). Bovengevel deelt de kleur van MAT.wall (volgt dimmen).
  const BAND = 4.0, BAND_GLOW = 0.32, wallMats = new Map();
  const matWall = col => {
    let m = wallMats.get(col); if (m) return m;
    const lin = new THREE.Color(col), s = lin.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    const u = { uCol: { value: lin }, uColS: { value: new THREE.Vector3(s.r, s.g, s.b) }, uBand: { value: BAND }, uGlow: { value: BAND_GLOW } };
    m = new THREE.MeshLambertMaterial({ flatShading: true, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 });
    m.color = MAT.wall.color;
    m.customProgramCacheKey = () => 'bizwall';
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u, { uNight: U.uNight, uEye: U.uEye });
      addCel(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBase; varying float vB; varying vec3 vW2;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvB = aBase; vW2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying float vB; varying vec3 vW2; uniform vec3 uCol; uniform vec3 uColS; uniform float uBand, uGlow, uNight; uniform vec3 uEye;
        float h22(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        float hb = vW2.y - vB, inB = step(hb, uBand), lip = inB * step(uBand - 0.35, hb); // band + luifelrand
        diffuseColor.rgb = mix(diffuseColor.rgb, uCol * (1.0 - 0.45 * lip), inB);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance = mix(totalEmissiveRadiance, uCol * (1.0 - lip) * uGlow * (1.0 + 1.6 * uNight), inB);`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uNight > 0.0) {
          vec3 n = normalize(cross(dFdx(vW2), dFdy(vW2)));
          float side = step(abs(n.y), 0.5), u = abs(n.x) > abs(n.z) ? vW2.z : vW2.x;
          float fade = smoothstep(700.0, 2200.0, length(vW2 - uEye));
          float fx = fract(u / 4.0);
          float shop = inB * (1.0 - lip) * step(0.06, fx) * step(fx, 0.94) * step(0.35, hb) * step(hb, uBand - 0.55); // etalage
          float fy = (hb - uBand) / 3.1; vec2 g = vec2(fract(u / 3.2), fract(fy));
          float win = (1.0 - inB) * step(0.22, g.x) * step(g.x, 0.78) * step(0.28, g.y) * step(g.y, 0.82);
          float lit = step(0.25, h22(vec2(floor(u / 3.2), floor(fy)) + floor(vW2.xz / 40.0))); // ±75% brandt
          vec3 glowC = mix(uColS * 1.9, vec3(1.0, 0.86, 0.62), 0.3);
          gl_FragColor.rgb += side * uNight * glowC * (mix(shop, 0.15 * inB, fade) * 0.9 + mix(win * lit, 0.12 * (1.0 - inB), fade) * 0.85);
        }`);
    };
    wallMats.set(col, m); return m;
  };
  function copyFaces(c, b, a) { // driehoeken van pand b los kopiëren naar a.roof / a.wall (+ a.base = voet per muurhoekpunt)
    const P = c.mesh.geometry.attributes.position.array, I = c.mesh.geometry.index.array;
    const r0 = c.bR[b], r1 = b + 1 < c.bR.length ? c.bR[b + 1] : c.nr, runs = wallRuns(c, b).map(([f0, f1]) => [(c.nr + f0) * 3, (c.nr + f1) * 3]);
    for (let k = r0 * 3; k < r1 * 3; k++) { const v = I[k] * 3; a.roof.push(P[v], P[v + 1], P[v + 2]); }
    let lo = Infinity;
    for (const [w0, w1] of runs) for (let k = w0; k < w1; k++) lo = Math.min(lo, P[I[k] * 3 + 1]);
    for (const [w0, w1] of runs) for (let k = w0; k < w1; k++) { const v = I[k] * 3; a.wall.push(P[v], P[v + 1], P[v + 2]); a.base.push(lo + 1); }
  }
  function prep(c) { // per pand: omhullende in wereld-xz + hoogste dakpunt
    if (c.bb) return;
    const n = c.ids.length, P = c.mesh.geometry.attributes.position.array, I = c.mesh.geometry.index.array, bb = c.bb = new Float32Array(n * 5);
    for (let b = 0; b < n; b++) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, t = -Infinity;
      const e = (b + 1 < n ? c.bR[b + 1] : c.nr) * 3;
      for (let k = c.bR[b] * 3; k < e; k++) {
        const v = I[k] * 3, x = P[v], y = P[v + 1], z = P[v + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y > t) t = y;
      }
      bb[b * 5] = x0; bb[b * 5 + 1] = z0; bb[b * 5 + 2] = x1; bb[b * 5 + 3] = z1; bb[b * 5 + 4] = t;
    }
  }
  function inRoof(c, b, px, pz) {
    const P = c.mesh.geometry.attributes.position.array, I = c.mesh.geometry.index.array, e = (b + 1 < c.bR.length ? c.bR[b + 1] : c.nr) * 3;
    for (let k = c.bR[b] * 3; k < e; k += 3) {
      const a = I[k] * 3, q = I[k + 1] * 3, r = I[k + 2] * 3;
      const d1 = (px - P[q]) * (P[a + 2] - P[q + 2]) - (P[a] - P[q]) * (pz - P[q + 2]);
      const d2 = (px - P[r]) * (P[q + 2] - P[r + 2]) - (P[q] - P[r]) * (pz - P[r + 2]);
      const d3 = (px - P[a]) * (P[r + 2] - P[a + 2]) - (P[r] - P[a]) * (pz - P[a + 2]);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  }
  function linkIn(c, m) { // beste pand voor plek m in vak c; d = −1 binnen het dak, anders afstand tot de omhullende
    if (m.best.d < 0) return;
    prep(c);
    const px = m.x - O[0], pz = -(m.y - O[1]), bb = c.bb, n = c.ids.length;
    for (let b = 0; b < n; b++) {
      const o = b * 5, dx = Math.max(bb[o] - px, 0, px - bb[o + 2]), dz = Math.max(bb[o + 1] - pz, 0, pz - bb[o + 3]);
      if (dx > LINK_MAX || dz > LINK_MAX) continue;
      let d = Math.hypot(dx, dz);
      if (d === 0) d = inRoof(c, b, px, pz) ? -1 : 0.5;
      if (d < m.best.d) { m.best = { d, c, b }; if (d < 0) return; }
    }
  }
  const near = (c, m) => m.x > c.x0 - LINK_MARGIN && m.x < c.x0 + area.km + LINK_MARGIN && m.y > c.y0 - LINK_MARGIN && m.y < c.y0 + area.km + LINK_MARGIN;
  function chunkMarks(c) { let hit = false; for (const m of marks.values()) if (near(c, m)) { linkIn(c, m); hit = true; } if (hit) rebuildHighlights(); }
  // lijst [{ key, x, y, color }] — eerste in de lijst wint als meerdere plekken in één pand zitten
  H.setMarks = list => {
    const old = marks, next = new Map();
    for (const it of list) {
      const p = old.get(it.key);
      const m = p && p.x === it.x && p.y === it.y ? Object.assign(p, { color: it.color }) : { key: it.key, x: it.x, y: it.y, color: it.color, best: { d: Infinity } };
      if (m !== p) for (const c of H.chunks.values()) if (near(c, m)) linkIn(c, m);
      next.set(it.key, m);
    }
    marks.clear(); for (const [k, m] of next) marks.set(k, m);
    rebuildHighlights();
  };
  let hlT = 0;
  function rebuildHighlights() { // gebundeld: hooguit één keer per beeld
    if (hlT) return;
    hlT = requestAnimationFrame(() => {
      hlT = 0;
      if (!scene) return;
      for (const me of hlMeshes) { scene.remove(me); me.geometry.dispose(); }
      hlMeshes.length = 0; byBuilding.clear();
      for (const m of marks.values()) {
        if (!(m.best.d <= LINK_MAX)) continue;
        const k = m.best.c.i + '_' + m.best.c.j + ':' + m.best.b;
        (byBuilding.get(k) || byBuilding.set(k, []).get(k)).push(m.key);
      }
      // één dak- en één muurmesh per kleur over alle vakken (was per vak × kleur: honderden draw calls)
      const groups = new Map(); // kleur → { roof, wall, base }
      for (const keys of byBuilding.values()) {
        const m = marks.get(keys[0]);
        let a = groups.get(m.color); if (!a) groups.set(m.color, a = { roof: [], wall: [], base: [] });
        copyFaces(m.best.c, m.best.b, a);
      }
      for (const [col, a] of groups) for (const part of ['roof', 'wall']) {
        if (!a[part].length) continue;
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(a[part], 3));
        if (part === 'wall') geo.setAttribute('aBase', new THREE.Float32BufferAttribute(a.base, 1));
        geo.computeBoundingSphere();
        const me = new THREE.Mesh(geo, part === 'roof' ? matFor(col) : matWall(col)); me.receiveShadow = true;
        scene.add(me); hlMeshes.push(me);
      }
      if (selKey && !selMesh) H.selectMark(selKey); // vak van de gekozen plek kwam later binnen
      shadowDirty = true; emit('marks'); redraw();
    });
  }
  // waar staat plek `key`? { w: wereldpunt (dakmidden of grond), linked } — null als het vak nog niet geladen is
  H.markAt = key => {
    const m = marks.get(key); if (!m) return null;
    if (m.best.d <= LINK_MAX) {
      const bb = m.best.c.bb, o = m.best.b * 5;
      return { linked: true, w: new THREE.Vector3((bb[o] + bb[o + 2]) / 2, bb[o + 4], (bb[o + 1] + bb[o + 3]) / 2) };
    }
    if (!H.chunks.has(Math.floor(m.x / area.km) + '_' + Math.floor(m.y / area.km))) return null;
    return { linked: false, w: toWorld(m.x, m.y) };
  };
  // pand van plek `key` selecteren (knippert)
  H.selectMark = key => { selKey = key; const m = marks.get(key); if (m && m.best.d <= LINK_MAX) select(m.best.c, m.best.b, true); else select(null); };

  // ---------- Camera ----------
  let fly = null;
  // iso: dist = afstand bij de gewone lens (→ zichtbare halve hoogte), of `half` direct; kijkhoek vast, richting op een kwartslag
  H.flyTo = (x, y, { dist = 320, polar, azim, ms = 1100, half, arc = true } = {}) => { // arc false = zonder boog (zoomstap)
    const t1 = toWorld(x, y), off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.radius = dist; if (polar !== undefined) sph.phi = polar; if (azim !== undefined) sph.theta = azim;
    sph.phi = Math.min(sph.phi, controls.maxPolarAngle);
    if (camera === ortho) { sph.phi = ISO_POLAR; sph.theta = snapAz(sph.theta); }
    fly = { t0: performance.now(), ms, a: controls.target.clone(), b: t1, sa: new THREE.Spherical().setFromVector3(off), sb: sph };
    if (camera === ortho) { fly.ha = isoHalf(); fly.hb = snapHalf(half ?? dist * TAN21); }
    fly.arc = arc;
    // kortste draairichting
    let d = fly.sb.theta - fly.sa.theta; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; fly.sb.theta = fly.sa.theta + d;
    redraw();
  };
  H.view = name => {
    const [x, y] = toRD(controls.target), sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if (name === 'boven') H.flyTo(x, y, { dist: sph.radius, polar: 0.05 });
    else if (name === 'schuin') H.flyTo(x, y, { dist: sph.radius, polar: 0.95 });
    else if (name === 'noord') H.flyTo(x, y, { dist: sph.radius, azim: 0, ms: 600 });
    else if (name === 'thuis') H.flyTo(O[0], O[1], { dist: 1400, polar: 0.9, azim: 0.35 });
  };
  // ---------- Modussen: plat (kaart van boven), 3d (vrij), rond (rustig rond een punt draaien) ----------
  let mode = 'iso', idleT = 0; // iso = hoofdmodus en start altijd zo; plat/3d/rond bevroren (menu "Oud", geen nieuwe functies)
  const FOV = { plat: 12, '3d': 42, rond: 42, iso: 42 };
  const visHalf = () => camera === ortho ? isoHalf() : camera.position.distanceTo(controls.target) * Math.tan(persp.fov * Math.PI / 360);
  function useCam(cam) { // wisselen tussen perspectief en ortho met dezelfde zichtbare halve hoogte en kijkrichting
    if (camera === cam) return;
    const dir = camera.position.clone().sub(controls.target).normalize(), h = visHalf();
    if (cam === ortho) { ortho.zoom = ISO_H0 / h; ortho.updateProjectionMatrix(); cam.position.copy(controls.target).addScaledVector(dir, isoD()); }
    else cam.position.copy(controls.target).addScaledVector(dir, h / Math.tan(persp.fov * Math.PI / 360));
    camera = cam; controls.object = cam; cam.lookAt(controls.target);
  }
  function setLook(on) { // iso-look aan/uit (cel-shading, kleur per pand, kaartfilter, licht, omlijning in draw)
    iso = on; U.uIso.value = on ? 1 : 0; document.body.classList.toggle('iso', on); applyNight(); shadowDirty = true;
  }
  function applyMode(m, animate = true) {
    useCam(m === 'iso' ? ortho : persp); setLook(m === 'iso'); ribbonsForMode();
    const [x, y] = toRD(controls.target), r = camera.position.distanceTo(controls.target);
    const vis = visHalf(); // zichtbare halve hoogte gelijk houden bij andere lens
    const fov = FOV[m], far = animate ? vis / Math.tan(fov * Math.PI / 360) : r; // bij opstarten is de afstand al goed bewaard
    controls.autoRotate = false; clearTimeout(idleT);
    if (m === 'iso') {
      // slepen = schuiven (links én rechts), scrollen = zoomen; draaien alleen per kwartslag (Q/E, H.isoTurn)
      controls.enableRotate = false; controls.zoomToCursor = true; controls.dampingFactor = 0.12;
      controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      controls.minPolarAngle = controls.maxPolarAngle = ISO_POLAR;
      controls.minDistance = 0; controls.maxDistance = Infinity;
      controls.minZoom = ISO_H0 / ISO_LEVELS[ISO_LEVELS.length - 1]; controls.maxZoom = ISO_H0 / ISO_LEVELS[0];
      const h = !animate && savedZoom ? ISO_H0 / savedZoom : isoHalf();
      H.flyTo(x, y, { half: Math.min(ISO_H0 / controls.minZoom, Math.max(ISO_H0 / controls.maxZoom, h)), ms: animate ? 700 : 1 });
      redraw(); return;
    }
    camera.fov = fov; camera.far = m === 'plat' ? 150000 : 40000; camera.updateProjectionMatrix();
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.enableRotate = true; controls.zoomToCursor = true; controls.rotateSpeed = 1; controls.dampingFactor = 0.12;
    controls.minPolarAngle = 0; controls.maxPolarAngle = 1.45;
    controls.minDistance = m === 'plat' ? 120 : 25; controls.maxDistance = m === 'plat' ? 60000 : 15000;
    if (m === 'plat') {
      controls.enableRotate = false; controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
      controls.maxPolarAngle = 0.002;
      H.flyTo(x, y, { dist: far, polar: 0.001, azim: 0, ms: animate ? 700 : 1 });
    } else if (m === 'rond') {
      // links slepen = draaien (traag), rechts = schuiven; zoomen naar het midden, kijkhoek binnen rustige grenzen
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      controls.zoomToCursor = false; controls.rotateSpeed = 0.35; controls.dampingFactor = 0.05;
      controls.minPolarAngle = 0.5; controls.maxPolarAngle = 1.25; controls.autoRotateSpeed = 0.5;
      H.flyTo(x, y, { dist: Math.min(far, 900), polar: 0.95, ms: animate ? 900 : 1 });
      idleT = setTimeout(() => { if (mode === 'rond') controls.autoRotate = true; }, animate ? 1000 : 10);
    } else H.flyTo(x, y, { dist: far, polar: animate ? 0.9 : undefined, ms: animate ? 700 : 1 });
    redraw();
  }
  H.setMode = m => { if (!FOV[m]) return; mode = m; try { localStorage.setItem('h3d.mode', m); } catch {} applyMode(m); emit('mode', m); };
  H.getMode = () => mode;
  H.spin = on => { clearTimeout(idleT); controls.autoRotate = !!on; redraw(); }; // rondleiding
  H.target = () => toRD(controls.target);
  H.azimuth = () => controls.getAzimuthalAngle();
  H.camera = () => camera;
  H.isoTurn = dir => { // iso: kwartslag draaien (dir −1 / +1)
    if (camera !== ortho) return;
    const [x, y] = toRD(fly ? fly.b : controls.target), th = fly ? fly.sb.theta : controls.getAzimuthalAngle();
    H.flyTo(x, y, { half: fly?.hb ?? isoHalf(), azim: snapAz(th) + dir * Math.PI / 2, ms: 450 });
    emit('turn', H.isoQuarter());
  };
  // kwartslag 0–3 (doel van een lopende draai telt al); 0 = camera zuidoost, kijkt naar noordwest
  H.isoQuarter = () => { const th = fly ? fly.sb.theta : controls.getAzimuthalAngle(); return ((Math.round((snapAz(th) - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4; };
  H.cameraDistance = () => camera.position.distanceTo(controls.target);

  function restoreView() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem('h3d.view') || 'null'); } catch {}
    const [x, y] = v ? [v.x, v.y] : O;
    controls.target.copy(toWorld(x, y, 120));
    const sph = new THREE.Spherical(v?.d || 1400, v?.p ?? 0.9, v?.a ?? 0.35);
    savedZoom = v?.z;
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    controls.update();
  }
  let saveT = 0, savedZoom;
  function saveView() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const [x, y] = toRD(controls.target), s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const o = camera === ortho, v = { x: Math.round(x), y: Math.round(y), d: Math.round(o ? isoHalf() / TAN21 : s.radius), p: +s.phi.toFixed(3), a: +s.theta.toFixed(3) };
      if (o) v.z = +ortho.zoom.toFixed(4); // iso: zoom; d = afstand bij de gewone lens
      try { localStorage.setItem('h3d.view', JSON.stringify(v)); } catch {}
    }, 500);
  }

  // ---------- Iso-nabewerking: omlijning uit normaal + diepte (2e render met NRM), dan op het scherm ----------
  let useMRT = false, rtC, rtN, RTS = {}, rtS = new THREE.Vector2(4, 4), NRM, post, postScene, postCam, pq, rtA, rtB, rtD, rtDN;
  // H.addDynamic(obj): bewegend object (voertuigen, ballon …) op laag 1. Wordt los getekend (kleur + NRM) en in de omlijning op diepte over het
  // bewaarde scènebeeld gelegd → animatie kan 'post' teruggeven (geen hele scène-render). Alleen iso; werpt geen schaduw, niet aanklikbaar.
  const dyn = new Set();
  H.addDynamic = o => {
    if (!dyn.size) scene.traverse(x => { if (x.isLight) x.layers.enable(1); });
    o.traverse(x => x.layers.set(1)); scene.add(o); dyn.add(o); redraw(); return o;
  };
  // H.addPost({ material, order, enabled }): extra beeldstap na de omlijning (alleen iso). material = THREE.ShaderMaterial met uniform tIn (vorig beeld, lineair);
  // vult indien aanwezig ook tN (RG32F: r = gepakte normaal → nrmUnpack uit H.NRM_GLSL, g = diepte; 0 = leeg), uRes (Vector2, px), uTime (s), uHalf (zichtbare halve hoogte, m).
  // before() (optioneel) = vlak vóór de stap aanroepen (bv. camera-uniforms bijwerken, ook bij beelden zonder animate-tik).
  // De laatste stap tekent op het scherm → fragment shader altijd eindigen met #include <colorspace_fragment>. enabled = false → overgeslagen.
  const posts = [];
  H.addPost = p => { posts.push(p); posts.sort((a, b) => (a.order || 0) - (b.order || 0)); redraw(); return p; };
  const dbs = new THREE.Vector2(), clr = new THREE.Color();
  // kleur (half-float RGBA) + normaal/diepte (RG32F, zie NRM_GLSL); NearestFilter: gepakte normaal mag niet geïnterpoleerd worden
  function makeTargets() {
    const nOpt = { type: THREE.FloatType, format: THREE.RGFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
    if (useMRT) { const c = new THREE.WebGLMultipleRenderTargets(4, 4, 2, { type: THREE.HalfFloatType }), t = c.texture[1]; Object.assign(t, nOpt); delete t.depthBuffer; return { c, n: { texture: t, setSize() {} } }; }
    return { c: new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }), n: new THREE.WebGLRenderTarget(4, 4, nOpt) };
  }
  function draw() {
    if (camera !== ortho) { renderer.render(scene, camera); return; }
    if (!rtC) {
      // geen MSAA: omlijning dekt de randen (stap 9). Diepte heeft float32 nodig (half-float gaf streepruis); blenden op float32 vraagt EXT_float_blend
      useMRT = renderer.capabilities.isWebGL2 && !!renderer.getContext().getExtension('EXT_float_blend');
      RTS.f = makeTargets(); ({ c: rtC, n: rtN } = RTS.f);
      NRM =new THREE.ShaderMaterial({ // normaal (uit de afgeleiden) + diepte; bomen via instanceMatrix
        vertexShader: `varying vec3 vV; void main() { vec4 p = vec4(position, 1.0);
          #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          #endif
          vec4 mv = modelViewMatrix * p; vV = mv.xyz; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: 'varying vec3 vV;' + NRM_GLSL + 'void main() { gl_FragColor = vec4(nrmPack(normalize(cross(dFdx(vV), dFdy(vV))), -vV.z), 0.0, 1.0); }',
      });
      post = new THREE.ShaderMaterial({
        uniforms: { tC: { value: useMRT ? rtC.texture[0] : rtC.texture }, tN: { value: rtN.texture }, tSky: { value: skyTex }, uMrt: { value: useMRT ? 1 : 0 }, tD: { value: null }, tDN: { value: null }, uDyn: { value: 0 }, uRes: { value: new THREE.Vector2() }, uW: { value: 2 }, uK: { value: 0.85 }, uInk: { value: H.isoColors.ink } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `varying vec2 vUv; uniform sampler2D tC, tN, tD, tDN, tSky; uniform vec2 uRes; uniform float uW, uK, uDyn, uMrt; uniform vec3 uInk;
          ${NRM_GLSL}
          vec4 N(vec2 o) { vec2 u = vUv + o / uRes, s = texture2D(tN, u).xy; // xyz = normaal, w = diepte
            if (uDyn > 0.5) { vec2 d = texture2D(tDN, u).xy; if (d.y > 0.0 && (s.y <= 0.0 || d.y < s.y)) s = d; }
            return vec4(nrmUnpack(s.x), s.y); }
          void main() {
            vec4 c = texture2D(tC, vUv);
            if (uMrt > 0.5 && c.a < 1.0) { c.rgb += texture2D(tSky, vUv).rgb * (1.0 - c.a); c.a = 1.0; } // MRT: lucht pas hier (achtergrond zou uitvoer 1 vullen)
            if (uDyn > 0.5) { vec2 s = texture2D(tN, vUv).xy, d = texture2D(tDN, vUv).xy; if (d.y > 0.0 && (s.y <= 0.0 || d.y < s.y)) { vec4 dc = texture2D(tD, vUv); c.rgb = mix(c.rgb, dc.rgb, dc.a); } }
            vec4 n0 = N(vec2(0.0)), a = N(vec2(uW, 0.0)), b = N(vec2(-uW, 0.0)), d = N(vec2(0.0, uW)), e = N(vec2(0.0, -uW));
            float nd = 4.0 - dot(n0.xyz, a.xyz) - dot(n0.xyz, b.xyz) - dot(n0.xyz, d.xyz) - dot(n0.xyz, e.xyz);
            float dd = abs(a.w + b.w - 2.0 * n0.w) + abs(d.w + e.w - 2.0 * n0.w);
            float k = max(smoothstep(0.42, 0.52, nd), smoothstep(1.7, 2.1, dd)); // smalle overgang = strakke lijn i.p.v. vlekkerige rand
            c.rgb = mix(c.rgb, uInk, k * uK);
            gl_FragColor = c;
            #include <colorspace_fragment>
          }`,
        depthTest: false, depthWrite: false,
      });
      postScene = new THREE.Scene(); postCam = new THREE.Camera();
      pq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); pq.frustumCulled = false; postScene.add(pq);
    }
    renderer.getDrawingBufferSize(dbs);
    // tijdens bewegen de scène kleiner tekenen in eigen, bewaarde doelen (canvas blijft gelijk → geen herallocatie); omlijning schaalt op
    const low = false, sc = 1; // kleiner tekenen tijdens bewegen gaf strepen (omlijning/diepte opgeschaald met factor 1,5) → uit; mechaniek blijft voor later
    ({ c: rtC, n: rtN } = RTS[low ? 'l' : 'f'] || (RTS[low ? 'l' : 'f'] = makeTargets()));
    rtS.set(Math.round(dbs.x * sc), Math.round(dbs.y * sc));
    if (rtC.width !== rtS.x || rtC.height !== rtS.y) { rtC.setSize(rtS.x, rtS.y); rtN.setSize(rtS.x, rtS.y); }
    post.uniforms.tC.value = useMRT ? rtC.texture[0] : rtC.texture; post.uniforms.tN.value = rtN.texture;
    if (useMRT) { // één render: kleur (uitvoer 0, zonder lucht, leeg = alfa 0) + normaal/diepte (uitvoer 1)
      const bg = scene.background; scene.background = null;
      renderer.getClearColor(clr); const ca = renderer.getClearAlpha(); renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(rtC); renderer.render(scene, camera);
      renderer.setClearColor(clr, ca); scene.background = bg; renderer.setRenderTarget(null);
      runPosts(); return;
    }
    renderer.setRenderTarget(rtC); renderer.render(scene, camera);
    // normaal/diepte: zonder lucht, lijnen en de (doorzichtige) selectie
    const bg = scene.background, hid = [outline, selMesh].filter(o => o && o.visible);
    for (const o of hid) o.visible = false;
    scene.background = null; scene.overrideMaterial = NRM;
    renderer.getClearColor(clr); const ca = renderer.getClearAlpha(); renderer.setClearColor(0x000000, 0);
    mq('normaal'); renderer.setRenderTarget(rtN); renderer.render(scene, camera);
    renderer.setClearColor(clr, ca); scene.background = bg; scene.overrideMaterial = null;
    for (const o of hid) o.visible = true;
    renderer.setRenderTarget(null);
    runPosts();
  }
  // nabewerking los: ook zonder nieuwe scène-render (rtC/rtN hergebruiken) als alleen een post-animatie (wolken) verandert
  function runPosts() {
    // bewegende laag (laag 1): klein, dus goedkoop; alleen als er iets zichtbaar is
    let dynOn = false; for (const o of dyn) if (o.visible) { dynOn = true; break; }
    if (dynOn) {
      mq('bewegend');
      if (!rtD) {
        ({ c: rtD, n: rtDN } = makeTargets());
      }
      if (rtD.width !== dbs.x || rtD.height !== dbs.y) { rtD.setSize(dbs.x, dbs.y); rtDN.setSize(dbs.x, dbs.y); }
      const bg = scene.background, sm = renderer.shadowMap.needsUpdate; renderer.shadowMap.needsUpdate = false;
      renderer.getClearColor(clr); const ca = renderer.getClearAlpha();
      scene.background = null; renderer.setClearColor(0x000000, 0); camera.layers.set(1);
      renderer.setRenderTarget(rtD); renderer.render(scene, camera);
      if (!useMRT) { scene.overrideMaterial = NRM; renderer.setRenderTarget(rtDN); renderer.render(scene, camera); scene.overrideMaterial = null; }
      camera.layers.set(0); renderer.setClearColor(clr, ca); scene.background = bg; renderer.shadowMap.needsUpdate = sm;
      renderer.setRenderTarget(null);
      post.uniforms.tD.value = useMRT ? rtD.texture[0] : rtD.texture; post.uniforms.tDN.value = rtDN.texture;
    }
    post.uniforms.uDyn.value = dynOn ? 1 : 0;
    // lijndikte/-sterkte naar zoom (pixels per meter): ver uit dun en zachter (kleine panden verdrinken anders in inkt), middenin 2 px, dichtbij weer fijn
    const ppm = dbs.y / (2 * isoHalf());
    // uW altijd 1: symmetrisch bemonsterd → lijn ±2 px; uW 2 gaf ±4 px (te dik bij startzoom)
    post.uniforms.uRes.value.copy(rtS); post.uniforms.uW.value = 1; // uRes = maat van rtN (kleiner tijdens bewegen)
    post.uniforms.uK.value = 0.85 * Math.min(1, 0.4 + ppm * 0.3);
    const on = posts.filter(p => p.enabled !== false); for (const p of on) p.before?.();
    const steps = [post, ...on.map(p => p.material)];
    if (steps.length > 1) {
      if (!rtA) { rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }); rtB = rtA.clone(); }
      if (rtA.width !== dbs.x || rtA.height !== dbs.y) { rtA.setSize(dbs.x, dbs.y); rtB.setSize(dbs.x, dbs.y); }
    }
    let src = null, dst = rtA;
    steps.forEach((m, i) => {
      mq(i ? 'post ' + (m.name || i) : 'omlijning');
      if (i) { const u = m.uniforms; if (u.tIn) u.tIn.value = src.texture; if (u.tN) u.tN.value = rtN.texture; if (u.uRes) u.uRes.value.copy(dbs); if (u.uTime) u.uTime.value = performance.now() / 1000; if (u.uHalf) u.uHalf.value = isoHalf(); if (u.uMove) u.uMove.value = moveNow ? 1 : 0; }
      pq.material = m; renderer.setRenderTarget(i === steps.length - 1 ? null : dst); renderer.render(postScene, postCam);
      src = dst; dst = dst === rtA ? rtB : rtA;
    });
    pq.material = post; renderer.setRenderTarget(null);
  }

  // ---------- Prestatiemeter (toets P; Shift+P = continu tekenen voor een eerlijke fps-meting) ----------
  // Telt per getekend beeld: draw calls/driehoeken (alle passes incl. schaduw/NRM/posts), CPU-tijd (tekenen + rest van de tik), GPU-tijd (WebGL2 timer-query, Chrome).
  const M = { on: false, stress: false, el: null, raf: 0, full: 0, post: 0, shadow: 0, cpu: 0, cpuMax: 0, tick: 0, gpu: {}, gpuF: new Set(), calls: 0, tris: 0, t0: 0, tick0: 0, last: 0, q: [], cur: null, fr: 0, ext: null };
  // GPU-tijd per pass: mq('naam') sluit de lopende meting en start een nieuwe (timer-queries kunnen niet nesten)
  function mq(label) {
    if (!M.on || !M.ext) return;
    const gl = renderer.getContext();
    if (M.cur) { gl.endQuery(M.ext.TIME_ELAPSED_EXT); M.cur = null; }
    if (!label) return;
    const q = gl.createQuery(); gl.beginQuery(M.ext.TIME_ELAPSED_EXT, q); M.q.push([label, q, M.fr]); M.cur = q;
  }
  function meterKey(e) {
    if ((e.key !== 'p' && e.key !== 'P') || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
    if (e.shiftKey) { M.stress = !M.stress; if (M.stress) M.on = true; } else { M.on = !M.on; if (!M.on) M.stress = false; }
    if (M.on && !M.el) {
      M.el = document.createElement('pre');
      M.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:8px 10px;background:rgba(20,18,16,.82);color:#f3ead8;font:12px/1.35 ui-monospace,monospace;border-radius:6px;pointer-events:none;white-space:pre';
      document.body.appendChild(M.el);
      const gl = renderer.getContext(); M.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    }
    if (M.el) M.el.style.display = M.on ? '' : 'none';
    if (!M.on) renderer.info.autoReset = true;
    M.last = 0; redraw();
  }
  function mBegin(full) {
    if (!M.on) return;
    renderer.info.autoReset = false; renderer.info.reset();
    if (full && renderer.shadowMap.needsUpdate) M.shadow++;
    M.fr++; if (full) mq(renderer.shadowMap.needsUpdate ? 'kleur+schaduw' : 'kleur');
    M.t0 = performance.now();
  }
  function mEnd(full) {
    if (!M.on) return;
    const t = performance.now(), d = t - M.t0;
    mq(null);
    M.cpu += d; M.cpuMax = Math.max(M.cpuMax, d); M.tick += t - M.tick0;
    if (full) { M.full++; M.calls = renderer.info.render.calls; M.tris = renderer.info.render.triangles; } else M.post++;
  }
  function meterShow(now) {
    if (M.ext) { // klaar zijnde GPU-metingen ophalen (komen 1–3 beelden later binnen)
      const gl = renderer.getContext(), bad = gl.getParameter(M.ext.GPU_DISJOINT_EXT);
      while (M.q.length) {
        const [lb, q, fr] = M.q[0]; if (q === M.cur || !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        if (!bad) { M.gpu[lb] = (M.gpu[lb] || 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; M.gpuF.add(fr); }
        gl.deleteQuery(q); M.q.shift();
      }
    }
    if (!M.last) { M.last = now; return; }
    const sec = (now - M.last) / 1000; if (sec < 0.5) return;
    const n = M.full + M.post, f = v => v.toFixed(1), ri = renderer.info, sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const gn = M.gpuF.size, ge = Object.entries(M.gpu), gpu = gn ? ge.reduce((a, [, v]) => a + v, 0) / gn : null;
    let dn = 0; for (const o of dyn) if (o.visible) dn++;
    M.el.textContent = [
      `fps scherm ${f(M.raf / sec)} · getekend ${f(M.full / sec)}/s + alleen-post ${f(M.post / sec)}/s${M.stress ? '  [continu]' : ''}`,
      `CPU beeld (incl. labels) ${n ? f(M.cpu / n) : '–'} ms (max ${f(M.cpuMax)}) · hele tik ${n ? f(M.tick / n) : '–'} ms`,
      `GPU ${gpu == null ? (M.ext ? '–' : 'n.v.t. (geen timer-query)') : f(gpu) + ' ms/beeld: ' + ge.map(([k, v]) => k + ' ' + f(v / gn)).join(' · ')}`,
      `draw calls ${M.calls} · driehoeken ${(M.tris / 1e6).toFixed(2)} M · schaduwkaart ${M.shadow}× ververst`,
      `modus ${camera === ortho ? 'iso (' + (sz.y / (2 * isoHalf())).toFixed(2) + ' px/m)' : 'persp'} · ${sz.x}×${sz.y} px (pr ${renderer.getPixelRatio()}) · posts ${posts.filter(p => p.enabled !== false).length} · bewegend ${dn} · animaties ${anims.size}`,
      `shaders ${ri.programs.length} · geometrieën ${ri.memory.geometries} · texturen ${ri.memory.textures}`,
      'P = sluiten · Shift+P = continu tekenen aan/uit',
    ].join('\n');
    Object.assign(M, { last: now, raf: 0, full: 0, post: 0, shadow: 0, cpu: 0, cpuMax: 0, tick: 0, gpu: {} }); M.gpuF.clear();
  }
  addEventListener('keydown', meterKey);

  // ---------- Renderlus (alleen tekenen als er iets veranderde) ----------
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  let lastT = 0, moveT = 0, shadowDirty = true, shadowKey = '', moveNow = false, lastZ = 0;
  const lastCP = new THREE.Vector3(), lastCT = new THREE.Vector3();
  H.moving = () => moveNow; // slepen/zoomen/vliegen bezig (tot 250 ms erna); bij stilstand emit('still')
  const PR = Math.min(devicePixelRatio, 2), PR_MOVE = Math.min(devicePixelRatio, 1);
  // H.animate((now, dt) => …): elke ±33 ms aanroepen zolang er iets beweegt (niet als de tab verborgen is); return false = stoppen.
  // Return 'post' = alleen de nabewerking veranderde (scène niet opnieuw renderen, alleen iso), 'none' = deze tik niets.
  // Geeft een stop-functie terug. Bewegende dingen werpen geen schaduw (schaduwkaart staat stil); H.shadowDirty() = schaduw één keer verversen.
  const anims = new Set(); let animT = 0, postDirty = false;
  H.animate = fn => { anims.add(fn); redraw(); return () => anims.delete(fn); };
  H.shadowDirty = () => { shadowDirty = true; redraw(); };
  const IDLE_MS = 120000; let inputT = performance.now();
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) addEventListener(ev, () => { const was = performance.now() - inputT > IDLE_MS; inputT = performance.now(); if (was) redraw(); }, { passive: true });
  // iso: scrollen = één zoomstand verder (vloeiend, punt onder de muis blijft staan); trackpad: kleine stapjes optellen
  let wAcc = 0, wT = 0, wLock = 0;
  function isoWheel(e) {
    if (camera !== ortho || !controls.enabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const now = performance.now(); inputT = now;
    if (now - wT > 250) wAcc = 0;
    wT = now; wAcc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wAcc) < 40 || now < wLock) return;
    const dir = Math.sign(wAcc); wAcc = 0;
    H.isoZoom(dir, e.clientX, e.clientY);
  }
  H.isoZoom = (dir, cx, cy) => { // dir +1 = verder uit, −1 = dichterbij; cx/cy = schermpunt dat blijft staan (anders midden)
    if (camera !== ortho) return;
    const h0 = isoHalf(), k = Math.max(0, Math.min(ISO_LEVELS.length - 1, levelOf(fly?.hb ?? h0) + dir)), h1 = ISO_LEVELS[k];
    if (Math.abs(h1 - (fly?.hb ?? h0)) / h1 < 0.01) return;
    wLock = performance.now() + 260;
    let T = controls.target.clone();
    if (cx !== undefined) { // ortho = affien: doel schaalt t.o.v. het punt onder de muis
      const r = renderer.domElement.getBoundingClientRect(), P = new THREE.Vector3();
      ndc.set((cx - r.left) / r.width * 2 - 1, -(cy - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -T.y), P)) T = P.add(T.sub(P).multiplyScalar(h1 / h0));
    }
    const [x, y] = toRD(T); H.flyTo(x, y, { half: h1, ms: 380, arc: false }); emit('interact');
  };
  function loop(now) {
    requestAnimationFrame(loop);
    if (M.on) { M.raf++; M.tick0 = performance.now(); meterShow(now); if (M.stress) dirty = true; }
    const dt = Math.min(100, now - (lastT || now)); lastT = now;
    if (night !== nightGoal) { // licht rustig laten overgaan (±2 s)
      night += Math.sign(nightGoal - night) * Math.min(Math.abs(nightGoal - night), dt / 2000);
      applyNight(); dirty = true;
    }
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.ms), e = ease(t);
      controls.target.lerpVectors(fly.a, fly.b, e);
      const s = new THREE.Spherical(fly.sa.radius + (fly.sb.radius - fly.sa.radius) * e, fly.sa.phi + (fly.sb.phi - fly.sa.phi) * e, fly.sa.theta + (fly.sb.theta - fly.sa.theta) * e);
      // boog: halverwege iets hoger als het ver is
      const far = fly.arc ? fly.a.distanceTo(fly.b) : 0; s.radius += Math.sin(Math.PI * e) * Math.min(far * 0.5, 2500);
      if (camera === ortho) { // iso: zoom i.p.v. afstand (zelfde boog: halverwege verder uit)
        const h = fly.ha + (fly.hb - fly.ha) * e + Math.sin(Math.PI * e) * Math.min(far * 0.5, 2500) * TAN21;
        ortho.zoom = ISO_H0 / h; ortho.updateProjectionMatrix(); s.radius = isoD(h);
      }
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
      camera.lookAt(controls.target);
      if (t >= 1) fly = null;
      dirty = true;
    }
    const ctl = controls.update();
    // OrbitControls meldt bij ortho (iso) élke update als veranderd (zoomChanged) → zelf vergelijken, anders tekent iso eindeloos en is nooit 'stil'
    const moved = ctl && (camera.position.distanceToSquared(lastCP) > 1e-8 || controls.target.distanceToSquared(lastCT) > 1e-8 || camera.zoom !== lastZ);
    lastCP.copy(camera.position); lastCT.copy(controls.target); lastZ = camera.zoom;
    if (moved) dirty = true;
    if ((moved && !controls.autoRotate) || fly) moveT = now; // slepen/zoomen/vliegen (rustig ronddraaien telt niet)
    const moving = now - moveT < 250;
    if (moving !== moveNow) { moveNow = moving; dirty = true; if (!moving) { lastLod = 0; emit('still'); } } // stilstand: scherp + detail/tegels/grond bijwerken
    // iso: canvas blijft op max 1,5 (omlijning + nabewerking zijn per pixel); kleiner tekenen tijdens bewegen gebeurt in draw() → geen canvas-herallocatie
    const prW = camera === ortho ? Math.min(PR, 1.5) : moving ? PR_MOVE : PR;
    if (renderer.getPixelRatio() !== prW) { renderer.setPixelRatio(prW); dirty = true; }
    if (!area) return;
    // doel volgt het terrein (anders draai je om een punt in de lucht of onder de grond)
    if (!fly) {
      const [x, y] = toRD(controls.target), gh = heightAt(x, y), d = gh - controls.target.y;
      if (Math.abs(d) > 0.3) { controls.target.y += d * 0.25; camera.position.y += d * 0.25; dirty = true; }
    }
    updateTextures(now);
    if (selMesh) { // knipperen: 3 s, daarna rustig
      const t = (now - pulseT0) / 1000;
      const o = t < 3 ? 0.15 + 0.4 * (0.5 + 0.5 * Math.sin(t * 7)) : 0.3;
      if (Math.abs(o - MAT.sel.opacity) > 0.005) { MAT.sel.opacity = o; dirty = true; }
    }
    if (anims.size && !document.hidden && now - inputT < IDLE_MS && now - animT >= 33) { // na 2 min zonder invoer: wolken/ballon/verkeer pauzeren
      const adt = Math.min(200, now - (animT || now)); animT = now;
      for (const f of anims) {
        const r = f(now, adt);
        if (r === false) anims.delete(f); else if (r === 'post') postDirty = true; else if (r !== 'none') dirty = true;
      }
    }
    if (!dirty) {
      if (postDirty && camera === ortho && rtC) { postDirty = false; mBegin(false); runPosts(); mEnd(false); } // ±1 schermvullende pass per stap i.p.v. 2 scène-renders
      return;
    }
    dirty = false; postDirty = false;
    const dist = camera.position.distanceTo(controls.target);
    if (camera === ortho) { // camera ver genoeg achter het doel dat de onderrand + panden binnen near vallen
      const h = isoHalf(), D = isoD(h);
      if (Math.abs(dist - D) > 1) camera.position.sub(controls.target).setLength(D).add(controls.target);
      camera.near = Math.max(1, D - 2.5 * h - 800); camera.far = D + 6 * h + 8000; camera.updateProjectionMatrix();
      U.uEye.value.copy(camera.position).sub(controls.target).setLength(h / TAN21).add(controls.target);
    } else {
      camera.near = Math.max(1, Math.min(40, dist / 150)); camera.updateProjectionMatrix();
      U.uEye.value.copy(camera.position);
    }
    // zon + schaduwkader rond het doel, grootte naar zoom
    const S = shadowExt(), sc = sun.shadow.camera;
    const key = Math.round(controls.target.x / 20) + ',' + Math.round(controls.target.z / 20) + ',' + Math.round(S / 50);
    if (!moving && (shadowDirty || key !== shadowKey)) { // tijdens bewegen blijft de schaduwkaart staan
      shadowDirty = false; shadowKey = key; renderer.shadowMap.needsUpdate = true;
      sun.target.position.copy(controls.target);
      sun.position.copy(controls.target).add(new THREE.Vector3(-0.55, 0.75, 0.35).multiplyScalar(3000));
      sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 100; sc.far = 6000; sc.updateProjectionMatrix();
    } else if (moving) dirty = true; // blijven tekenen tot stilstand, dan één keer met verse schaduw
    if (iso) { scene.fog.near = 1e7; scene.fog.far = 2e7; }
    else { scene.fog.near = Math.max(4000, dist * 2.5); scene.fog.far = scene.fog.near + 12000; }
    mBegin(true);
    draw();
    saveView();
    emit('frame');
    mEnd(true);
  }

  // ---------- Lagen (data/layers.js): water, spoor, snelwegen als linten op het terrein; labels/bekende gebouwen in labels.js/ui.js ----------
  const layerOn = { straten: 1, wijken: 1, water: 1, spoor: 1, wegen: 1, bomen: 1, gebouwen: 1 };
  try { Object.assign(layerOn, JSON.parse(localStorage.getItem('h3d.layers') || '{}')); } catch {}
  const layerObjs = {}; // laag → [meshes]
  let layersBuilt = false, allIn = false;
  H.layerOn = k => !!layerOn[k];
  H.setLayer = (k, on) => {
    layerOn[k] = on ? 1 : 0; try { localStorage.setItem('h3d.layers', JSON.stringify(layerOn)); } catch {}
    for (const o of layerObjs[k] || []) o.visible = layerVis(k, o);
    shadowDirty = true; emit('layer', k, !!on); redraw();
  };
  // linten (wegen/spoor/water als 3D-strook) niet in iso: daar schildert iso/ground.js ze in dezelfde stijl op de grond (±6,5 ms GPU)
  function layerVis(k, o) { return !!layerOn[k] && !(o.userData.ribbon && camera === ortho); }
  function ribbonsForMode() { for (const k in layerObjs) for (const o of layerObjs[k]) if (o.userData.ribbon) o.visible = layerVis(k, o); }
  H.layers = d => { H.layerData = d; emit('layers', d); buildLayers(); };
  // hoogte alleen waar een vak geladen is (anders null → lint daar onderbreken)
  const hAt = (x, y) => H.chunks.get(Math.floor(x / area.km) + '_' + Math.floor(y / area.km))?.dem ? heightAt(x, y) : null;
  // lijnen [{ xy, w, bridge }] → één geometrie. uv: u dwars (0..1), v langs in meters. Brug: hoogte lineair tussen de eindpunten.
  // skirt > 0: zijkanten tot `skirt` m onder het wegdek (verhoogde weg met rand; normaal naar buiten → schaduwkant)
  // → één geometrie per km-vak (stukken op het midden van elk segment ingedeeld), zodat frustum culling werkt; was één mesh voor heel Heerlen (±6 ms GPU in iso)
  function ribbonGeo(lines, lift, skirt = 0) {
    const per = skirt ? 4 : 2, B = new Map(), km = area.km;
    const bucket = (x, y) => { const k = Math.floor(x / km) + '_' + Math.floor(y / km); let b = B.get(k); if (!b) B.set(k, b = { P: [], N: [], UV: [], I: [], q: -2, at: 0 }); return b; };
    for (const { xy, w, bridge } of lines) {
      const pts = [];
      for (let k = 0; k + 3 < xy.length; k += 2) {
        const x0 = xy[k], y0 = xy[k + 1], x1 = xy[k + 2], y1 = xy[k + 3], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
        for (let s = 0; s < n; s++) pts.push(x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n);
      }
      pts.push(xy[xy.length - 2], xy[xy.length - 1]);
      const m = pts.length / 2, cum = [0];
      for (let q = 1; q < m; q++) cum[q] = cum[q - 1] + Math.hypot(pts[2 * q] - pts[2 * q - 2], pts[2 * q + 1] - pts[2 * q - 1]);
      let hA = 0, hB = 0;
      if (bridge) { hA = hAt(pts[0], pts[1]); hB = hAt(pts[2 * m - 2], pts[2 * m - 1]); if (hA == null || hB == null) continue; }
      let pv = null; // vorig punt: { q, v: [P, N, UV] }
      const put = (b, V, q) => { b.at = b.P.length / 3; b.P.push(...V[0]); b.N.push(...V[1]); b.UV.push(...V[2]); b.q = q; };
      for (let q = 0; q < m; q++) {
        const x = pts[2 * q], y = pts[2 * q + 1];
        const h = bridge ? hA + (hB - hA) * cum[q] / (cum[m - 1] || 1) : hAt(x, y);
        if (h == null) { pv = null; continue; }
        const a = Math.max(0, q - 1), b = Math.min(m - 1, q + 1);
        let dx = pts[2 * b] - pts[2 * a], dy = pts[2 * b + 1] - pts[2 * a + 1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const nx = -dy * w / 2, ny = dx * w / 2, top = h + lift;
        const V = skirt ? [[x + nx - O[0], top - skirt, -(y + ny - O[1]), x + nx - O[0], top, -(y + ny - O[1]), x - nx - O[0], top, -(y - ny - O[1]), x - nx - O[0], top - skirt, -(y - ny - O[1])],
          [-dy, 0.4, -dx, 0, 1, 0, 0, 1, 0, dy, 0.4, dx], [0, cum[q], 0, cum[q], 1, cum[q], 1, cum[q]]]
          : [[x + nx - O[0], top, -(y + ny - O[1]), x - nx - O[0], top, -(y - ny - O[1])], [0, 1, 0, 0, 1, 0], [0, cum[q], 1, cum[q]]];
        if (pv) {
          const bk = bucket((x + pts[2 * pv.q]) / 2, (y + pts[2 * pv.q + 1]) / 2);
          if (bk.q !== pv.q || bk.line !== xy) put(bk, pv.v, pv.q); // vorig punt staat nog niet in dit vak → kopiëren
          const prev = bk.at; put(bk, V, q); bk.line = xy; const base = bk.at;
          if (skirt) for (let e = 0; e < 3; e++) bk.I.push(prev + e, prev + e + 1, base + e, prev + e + 1, base + e + 1, base + e);
          else bk.I.push(prev, prev + 1, base, prev + 1, base + 1, base);
        }
        pv = { q, v: V };
      }
    }
    return [...B.values()].map(b => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.UV, 2));
      g.setIndex(b.I); g.computeBoundingSphere();
      return g;
    });
  }
  // patroon langs het lint: canvas (dwars × langs), herhaald elke `period` meter
  function stripTex(wpx, hpx, period, draw) {
    const cv = document.createElement('canvas'); cv.width = wpx; cv.height = hpx;
    draw(cv.getContext('2d'), wpx, hpx);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1 / period);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  const ribbonMat = (opt, off) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off, ...opt });
  const railTex = () => stripTex(64, 32, 0.65, (x, w, h) => { // ballast, dwarsliggers, twee spoorstaven
    x.fillStyle = '#a49c90'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#6e5a48'; x.fillRect(w * 0.27, 0, w * 0.46, h * 0.42);
    x.fillStyle = '#4d4f55'; x.fillRect(w * 0.37, 0, 2, h); x.fillRect(w * 0.62, 0, 2, h);
  });
  const laneTex = n => stripTex(32 * n + 24, 64, 12, (x, w, h) => { // donker asfalt, lichte berm, brede doorgetrokken randen, streep 3 m / gat 9 m
    x.fillStyle = '#c9c4ba'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3d3f45'; x.fillRect(4, 0, w - 8, h);
    x.fillStyle = '#fbfaf5'; x.fillRect(7, 0, 3, h); x.fillRect(w - 10, 0, 3, h);
    for (let k = 1; k < n; k++) x.fillRect(12 + 32 * k - 1, 0, 2, h * 0.25);
  });
  const streetTex = (fill, edge) => stripTex(32, 8, 50, (x, w, h) => { // gewone straat: grijs wegdek, lichtere stoeprand
    x.fillStyle = edge; x.fillRect(0, 0, w, h);
    x.fillStyle = fill; x.fillRect(3, 0, w - 6, h);
  });
  // gewone straten (OSM highway) → breedte in m; voetgangersgebied/woonerf lichter
  const STREET_W = { primary: 10, secondary: 8.5, tertiary: 7, unclassified: 5.5, residential: 5.5, living_street: 4.5, pedestrian: 4.5 };
  function buildLayers() {
    const d = H.layerData;
    if (layersBuilt || !d || !allIn || !scene) return;
    layersBuilt = true;
    const add = (k, mesh, ribbon) => { mesh.receiveShadow = true; mesh.userData.ribbon = !!ribbon; mesh.visible = layerVis(k, mesh); scene.add(mesh); (layerObjs[k] ||= []).push(mesh); };
    const addR = (k, geos, mat) => { for (const g of geos) add(k, new THREE.Mesh(g, mat), true); };
    // water: beken als lint (4–8 m), vijvers plat op de laagste oeverhoogte
    const waterMat = ribbonMat({ color: '#7eaed3' }, -2);
    addR('water', ribbonGeo(d.water.map(([, ww, xy]) => ({ xy, w: ww === 'river' ? 12 : ww === 'canal' ? 10 : 5 })), 0.4), waterMat);
    const PP = [], PI = [];
    for (const [, xy] of d.ponds) {
      let lo = Infinity, ok = true; const ring = [];
      for (let k = 0; k + 1 < xy.length; k += 2) { const h = hAt(xy[k], xy[k + 1]); if (h == null) { ok = false; break; } lo = Math.min(lo, h); ring.push(new THREE.Vector2(xy[k], xy[k + 1])); }
      if (!ok || ring.length < 4) continue;
      ring.pop(); // laatste = eerste
      const base = PP.length / 3;
      for (const v of ring) PP.push(v.x - O[0], lo + 0.3, -(v.y - O[1]));
      for (const t of THREE.ShapeUtils.triangulateShape(ring, [])) PI.push(base + t[0], base + t[1], base + t[2]);
    }
    if (PI.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(PP, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(PP.length).map((_, k) => k % 3 === 1 ? 1 : 0), 3));
      g.setIndex(PI); g.computeBoundingSphere();
      add('water', new THREE.Mesh(g, waterMat), true);
    }
    // spoor: 6 m met dwarsliggers
    addR('spoor', ribbonGeo(d.rail.map(([bridge, xy]) => ({ xy, w: 6, bridge })), 0.9), ribbonMat({ map: railTex() }, -3));
    // gewone straten: grijs, iets verhoogd met rand; per breedte één mesh
    const byW = new Map();
    for (const [, type, xy] of d.streets) { const w = STREET_W[type]; if (w) (byW.get(w) || byW.set(w, []).get(w)).push({ xy, w }); }
    const stMat = ribbonMat({ map: streetTex('#8f9196', '#c4c1bb') }, -3), stMatSoft = ribbonMat({ map: streetTex('#b3aea6', '#d6d2ca') }, -3);
    for (const [w, lines] of byW) addR('wegen', ribbonGeo(lines, 0.7, 1.2), w < 5 ? stMatSoft : stMat);
    // rotondes: standaardvorm i.p.v. de OSM-lijn: ronde rijbaan (iets boven de straten, dekt de aansluitingen) + groen middeneiland
    if (d.rounds?.length) {
      const ring = [], isle = [], RS = 40;
      for (const [type, cx, cy, r0] of d.rounds) {
        const big = /^(motorway|trunk|primary|secondary)/.test(type), w = big ? 8 : 6.5, R = Math.min(34, Math.max(w / 2 + 6, Math.round(r0 / 2) * 2));
        const xy = [];
        for (let k = 0; k <= RS + 1; k++) { const a = k / RS * Math.PI * 2; xy.push(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
        ring.push({ xy, w });
        const h = hAt(cx, cy); if (h != null) isle.push([cx, cy, R - w / 2 - 0.3, h]);
      }
      addR('wegen', ribbonGeo(ring, 0.8, 1.3), ribbonMat({ map: streetTex('#8a8c91', '#e2dfd8') }, -4));
      const ig = new THREE.CylinderGeometry(1, 1, 1, 32).translate(0, -0.5, 0), im = new THREE.InstancedMesh(ig, new THREE.MeshLambertMaterial({ color: '#8cc46c' }), isle.length);
      const m4 = new THREE.Matrix4();
      isle.forEach(([x, y, r, h], i) => im.setMatrixAt(i, m4.makeScale(r, 3, r).setPosition(x - O[0], h + 1.1, -(y - O[1]))));
      im.computeBoundingSphere(); add('wegen', im);
    }
    // snelwegen: overal dezelfde breedte (OSM-rijstroken wisselen per stuk → rafelig): rijbaan 2 stroken, afrit 1; hoger dan straten
    const lanes1 = [], lanes2 = [];
    for (const [type, , bridge, xy] of d.roads) (type.endsWith('+') ? lanes1 : lanes2).push({ xy, w: type.endsWith('+') ? 6 : 10.5, bridge });
    addR('wegen', ribbonGeo(lanes2, 1.4, 2), ribbonMat({ map: laneTex(2) }, -4));
    addR('wegen', ribbonGeo(lanes1, 1.3, 2), ribbonMat({ map: laneTex(1) }, -4));
    if (d.woods) buildTrees(d.woods);
    shadowDirty = true; redraw();
  }

  // ---------- Bossen: bomen per vak als InstancedMesh; ver weg minder bomen (willekeurige volgorde → eerste n = gelijkmatige uitdunning) ----------
  const TREE_SP = 10; // m tussen bomen (raster met verspringing)
  // lo = ver weg / klein in beeld (< TREE_LO_PPM px per m): alleen kroon, octaëder/5-kant (8 of 5 driehoeken i.p.v. 30/17). Onderkanten open (nooit zichtbaar).
  const TREE_LO_PPM = 1.5;
  H.treeLo = d => dbs.y / (2 * d * TAN21) < TREE_LO_PPM; // iso/props.js: zelfde grens voor straatbomen
  function treeGeo(conifer, lo) { // boom van 1 m hoog: stam (donker) + kroon (wit, gekleurd per boom via instanceColor)
    const crown = conifer ? new THREE.ConeGeometry(0.22, 0.85, lo ? 5 : 7, 1, true).translate(0, 0.55, 0)
      : (lo ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, 0)).scale(0.32, 0.4, 0.32).translate(0, 0.58, 0);
    const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5, 1, true).translate(0, 0.15, 0);
    const flat = g => g.index ? g.toNonIndexed() : g, parts = [...(lo ? [] : [[flat(trunk), [0.42, 0.36, 0.3]]]), [flat(crown), [1, 1, 1]]];
    const n = parts.reduce((t, [g]) => t + g.attributes.position.count, 0), P = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    for (const [g, col] of parts) { const a = g.attributes.position.array; P.set(a, o * 3); for (let k = 0; k < a.length / 3; k++) C.set(col, (o + k) * 3); o += a.length / 3; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    return g;
  }
  function buildTrees(woods) {
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const per = new Map(); // vak → [x, y, h, naald]
    for (const [needle, a] of woods) {
      let y0 = Infinity, y1 = -Infinity;
      for (let k = 1; k < a.length; k += 2) { y0 = Math.min(y0, a[k]); y1 = Math.max(y1, a[k]); }
      for (let y = Math.ceil(y0 / TREE_SP) * TREE_SP; y < y1; y += TREE_SP) { // scanlijn: snijpunten van de rij met de rand → binnenstukken
        const xs = [];
        for (let k = 0; k + 3 < a.length; k += 2) { const ya = a[k + 1], yb = a[k + 3]; if ((ya <= y) !== (yb <= y)) xs.push(a[k] + (y - ya) / (yb - ya) * (a[k + 2] - a[k])); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] / TREE_SP) * TREE_SP + ((y / TREE_SP) & 1) * TREE_SP / 2; x < xs[k + 1]; x += TREE_SP) {
          const px = x + (rnd() - 0.5) * TREE_SP * 0.8, py = y + (rnd() - 0.5) * TREE_SP * 0.8;
          const c = H.chunks.get(Math.floor(px / area.km) + '_' + Math.floor(py / area.km)); if (!c) continue;
          let L = per.get(c); if (!L) per.set(c, L = []);
          L.push(px, py, heightAt(px, py), needle || rnd() < 0.15 ? 1 : 0);
        }
      }
    }
    const geo = [treeGeo(false), treeGeo(true)], geoLo = [treeGeo(false, true), treeGeo(true, true)], mat = celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'tree');
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [c, L] of per) {
      const n = L.length / 4, ord = Array.from({ length: n }, (_, k) => k);
      for (let k = n - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [ord[k], ord[j]] = [ord[j], ord[k]]; }
      c.trees = [];
      for (const kind of [0, 1]) {
        const idx = ord.filter(k => L[k * 4 + 3] === kind); if (!idx.length) continue;
        const im = new THREE.InstancedMesh(geo[kind], mat, idx.length);
        idx.forEach((k, i) => {
          const h = (kind ? 13 : 11) + rnd() * 9, w = 0.85 + rnd() * 0.35;
          ps.set(L[k * 4] - O[0], L[k * 4 + 2] - 0.4, -(L[k * 4 + 1] - O[1])); q.setFromAxisAngle(up, rnd() * 6.28); sc.set(h * w, h, h * w);
          im.setMatrixAt(i, m4.compose(ps, q, sc));
          const t = rnd(); im.setColorAt(i, kind ? col.setHSL(0.36 + rnd() * 0.04, 0.38, 0.22 + rnd() * 0.06) : t < 0.12 ? col.setHSL(0.06 + rnd() * 0.07, 0.6, 0.42 + rnd() * 0.08) : col.setHSL(0.22 + rnd() * 0.08, 0.46 + rnd() * 0.14, 0.3 + rnd() * 0.1)); // ±12% herfst
        });
        im.computeBoundingSphere(); im.receiveShadow = true; im.full = idx.length; im.geoHi = geo[kind]; im.geoLo = geoLo[kind];
        im.visible = !!layerOn.bomen; scene.add(im); (layerObjs.bomen ||= []).push(im); c.trees.push(im);
      }
    }
    lastLod = 0; // dichtheid meteen naar afstand zetten
  }

  // ---------- Plekken (OSM) ----------
  H.places = [];
  H.pois = d => {
    H.places = d.rows.map((r, k) => { const o = { k }; d.fields.forEach((f, i) => { o[f] = r[i]; }); return o; });
    emit('pois', H.places);
  };

  document.addEventListener('DOMContentLoaded', init);
  return H;
})();
