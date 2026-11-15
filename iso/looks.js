// iso/looks.js — gekozen looks uit design/23_looks.html (vast, alleen iso):
//  · tik: U.uLkT (wolkenzee, padlichtjes), alleen nabewerking ('post')
//  · mijnlaag (laag 'mijn', standaard uit): mijnterreinen/terrils/mijnspoor als arcering op het terrein (canvas-masker, terreinpatch 'looks-mijn') + namen (DOM)
//  · wegen c: abri's bij bushaltes (data/transit.js stops, richting uit de dichtstbijzijnde busroute)
//  · rand c: wolkenzee onder het diorama (bewegende laag, vlak op laagste terrein − 60 m)
//  · wandelpaden buiten de stad (data/paden.js) als lichtlint met lichtjes die over het pad lopen; aan/uit = laag 'paden' (menu Lagen, H.layerOn)
(() => {
  if (typeof H3D === 'undefined' || !H3D.on || !H3D.U?.uLkT) return;
  const H = H3D, U = H.U, D = window.H3D_DATA || {};
  const O = H.toRD(new THREE.Vector3(0, 0, 0)); // area.origin (RD)
  const iso = () => H.getMode?.() === 'iso';
  const padOn = () => H.layerOn?.('paden') !== false, mijnOn = () => !!H.layerOn?.('mijn');
  const hRel = (x, y) => H.heightAt(x + O[0], y + O[1]); // hoogte op m t.o.v. origin (noord +y)
  const chunkOf = c => c.i + '_' + c.j;

  // ---------- tik ----------
  let t0 = performance.now();
  H.animate(now => {
    if (!iso()) return 'none';
    U.uLkT.value = (now - t0) / 1000;
    return 'post';
  }, 'looks');

  // ---------- mijnlaag ----------
  const M = D.mijn, MU = { tLkM: { value: null }, uLkMB: { value: new THREE.Vector4(0, 0, 1, 1) }, uLkMOn: { value: 0 } };
  if (M) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const ext = a => { for (let i = 0; i < a.length; i += 2) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); y0 = Math.min(y0, a[i + 1]); y1 = Math.max(y1, a[i + 1]); } };
    for (const a of M.areas) ext(a[1]); for (const h of M.heaps) ext(h[1]); for (const r of M.rail) ext(r);
    if (x1 > x0) {
      x0 -= 50; y0 -= 50; x1 += 50; y1 += 50;
      const N = 2048, sc = N / Math.max(x1 - x0, y1 - y0), cv = document.createElement('canvas'); cv.width = cv.height = N;
      const g = cv.getContext('2d'), P = (a, i) => [(a[i] - x0) * sc, N - (a[i + 1] - y0) * sc];
      const path = (a, close) => { g.beginPath(); for (let i = 0; i < a.length; i += 2) { const [px, py] = P(a, i); i ? g.lineTo(px, py) : g.moveTo(px, py); } if (close) g.closePath(); };
      g.fillStyle = 'rgb(140,0,0)'; for (const a of M.areas) { path(a[1], true); g.fill(); }   // terrein: r 0,55
      g.fillStyle = 'rgb(255,0,0)'; for (const h of M.heaps) { path(h[1], true); g.fill(); }   // terril: r 1
      g.strokeStyle = 'rgb(0,255,0)'; g.lineWidth = Math.max(1.5, 5 * sc); g.lineCap = 'round'; for (const r of M.rail) { path(r, false); g.stroke(); } // spoor: g
      const tx = new THREE.CanvasTexture(cv); tx.flipY = true; tx.colorSpace = THREE.NoColorSpace;
      MU.tLkM.value = tx; MU.uLkMB.value.set(x0, y0, N / sc, N / sc);
      H.patchTerrain('looks-mijn', s => {
        Object.assign(s.uniforms, MU);
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLkMW;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvLkMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tLkM; uniform vec4 uLkMB; uniform float uLkMOn; varying vec3 vLkMW;')
          .replace('#include <alphamap_fragment>', `if (uLkMOn > 0.5) { // mijn c: koolzwarte arcering (terril dicht, terrein open), mijnspoor als donkere band
            vec2 mu = (vec2(vLkMW.x, -vLkMW.z) - uLkMB.xy) / uLkMB.zw;
            if (mu.x > 0.0 && mu.y > 0.0 && mu.x < 1.0 && mu.y < 1.0) {
              vec4 m = texture2D(tLkM, mu); float h = (vLkMW.x + vLkMW.z) / 4.0, hl = abs(fract(h) - 0.5) / max(fwidth(h), 1e-4);
              float hatch = 1.0 - smoothstep(0.6, 1.6, hl);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.12, 0.12), m.r * (0.18 + 0.55 * hatch * smoothstep(0.5, 1.0, m.r) + 0.3 * hatch));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.15), m.g * 0.7);
            }
          }
          #include <alphamap_fragment>`);
      });
    }
  }
  // namen (DOM): schachten/monumenten klein met ⛏, mijnwerkerswijken groot cursief
  const mWrap = document.createElement('div'); mWrap.className = 'lk-mijn'; mWrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;display:none';
  const mLab = [];
  if (M) {
    const lab = (x, y, txt, big) => {
      const el = document.createElement('div'); el.textContent = txt;
      el.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;transform-origin:50% 100%;font:${big ? 'italic 600 15px' : '600 11px'} system-ui,sans-serif;` +
        `color:${big ? '#2b2522' : '#1d1a18'};text-shadow:0 0 3px #f4efe6,0 0 3px #f4efe6,0 0 6px #f4efe6;letter-spacing:${big ? '0.06em' : '0'}`;
      mWrap.appendChild(el); mLab.push({ el, x, y, big, v: new THREE.Vector3() });
    };
    for (const s of M.shafts) if (s[2]) lab(s[0], s[1], (s[3] === 1 ? '◆ ' : '⛏ ') + s[2], false);
    for (const k of M.kol) lab(k[1], k[2], k[0], true);
    document.body.appendChild(mWrap);
  }
  function placeMijn() {
    const on = mijnOn() && iso() && mLab.length;
    mWrap.style.display = on ? '' : 'none'; if (!on) return;
    const cam = H.camera(), W = innerWidth, Hh = innerHeight, half = H.isoHalf?.() || 800;
    for (const l of mLab) {
      l.v.set(l.x, hRel(l.x, l.y) + 4, -l.y).project(cam);
      const vis = Math.abs(l.v.x) < 1.05 && Math.abs(l.v.y) < 1.05 && (l.big ? half < 6000 : half < 1800);
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = `translate(${((l.v.x + 1) / 2 * W).toFixed(1)}px,${((1 - l.v.y) / 2 * Hh).toFixed(1)}px) translate(-50%,-100%)`;
    }
  }

  // ---------- abri's (wegen c) ----------
  const T = D.transit, abri = { im: null, list: [], byChunk: new Map() };
  if (T?.stops?.length) {
    // richting: dichtstbijzijnde stuk busroute (raster 100 m); abri 3 m rechts van de rijrichting, rug naar de weg
    const busShape = new Set(); for (const p of T.pats || []) if (T.routes[p[0]]?.[0] === 'bus') busShape.add(p[1]);
    const G = new Map(), gk = (x, y) => Math.floor(x / 100) + ',' + Math.floor(y / 100);
    (T.shapes || []).forEach((s, si) => { if (busShape.size && !busShape.has(si)) return; for (let i = 0; i + 3 < s.length; i += 2) { const k = gk(s[i], s[i + 1]); if (!G.has(k)) G.set(k, []); G.get(k).push([s[i], s[i + 1], s[i + 2], s[i + 3]]); } });
    for (const st of T.stops) {
      if (T.groups?.[st[2]]?.[3] === 1) continue; // trein
      const [x, y] = st; let best = null, bd = 40;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const sg of G.get((Math.floor(x / 100) + i) + ',' + (Math.floor(y / 100) + j)) || []) {
        const dx = sg[2] - sg[0], dy = sg[3] - sg[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - sg[0]) * dx + (y - sg[1]) * dy) / L2));
        const d = Math.hypot(x - sg[0] - dx * t, y - sg[1] - dy * t); if (d < bd) { bd = d; best = [dx, dy, sg[0] + dx * t, sg[1] + dy * t]; }
      }
      if (!best) continue;
      const l = Math.hypot(best[0], best[1]) || 1, ux = best[0] / l, uy = best[1] / l;
      const ax = best[2] + uy * 3.2, ay = best[3] - ux * 3.2; // rechts van de rijrichting (noord +y)
      const k = Math.floor((ax + O[0]) / 1000) + '_' + Math.floor((ay + O[1]) / 1000);
      const a = { x: ax, y: ay, ang: Math.atan2(-uy, ux), k, i: abri.list.length };
      abri.list.push(a); if (!abri.byChunk.has(k)) abri.byChunk.set(k, []); abri.byChunk.get(k).push(a);
    }
    // model: dak, achterwand (glas), zijwand, twee palen; vertexkleur
    const parts = [], box = (w, h, d, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); const n = g.attributes.position.count, C = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++) cc.toArray(C, i * 3); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); parts.push(g); };
    box(3.4, 0.14, 1.6, 0, 2.45, 0, '#3c4b57');           // dak
    box(3.2, 1.9, 0.06, 0, 1.3, -0.7, '#a9c7d6');         // achterwand glas
    box(0.06, 1.9, 1.3, -1.6, 1.3, -0.05, '#a9c7d6');     // zijwand
    box(3.2, 0.25, 0.08, 0, 2.2, -0.7, '#e5ebee');        // reclamebalk
    for (const px of [-1.62, 1.62]) box(0.09, 2.4, 0.09, px, 1.2, -0.72, '#2f3438');
    box(1.6, 0.08, 0.4, 0.4, 0.5, -0.45, '#6b5848');      // bankje
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const mat = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'prop-abri');
    abri.im = new THREE.InstancedMesh(geo, mat, abri.list.length); abri.im.frustumCulled = false; abri.im.visible = false; abri.im.castShadow = true;
    const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < abri.list.length; i++) abri.im.setMatrixAt(i, z); // pas zichtbaar als het vak (hoogte) er is
    H.scene.add(abri.im);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), p3 = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
  function abriChunk(c) {
    const L2 = abri.byChunk.get(chunkOf(c)); if (!L2 || !abri.im) return;
    for (const a of L2) { p3.set(a.x, hRel(a.x, a.y) - 0.05, -a.y); q.setFromAxisAngle(UP, a.ang); abri.im.setMatrixAt(a.i, m4.compose(p3, q, s1)); }
    abri.im.instanceMatrix.needsUpdate = true;
  }

  // ---------- wolkenzee ----------
  let minH = Infinity;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { uLkT: U.uLkT, uNight: U.uNight || { value: 0 } },
    vertexShader: '#include <common>\nvarying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition; vMrtV = mvPosition.xyz; vMrtV.z += mrtOff(); }',
    fragmentShader: `#include <common>
      uniform float uLkT, uNight; varying vec3 vW;
      float h(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 p = vW.xz / 420.0 + vec2(uLkT * 0.012, uLkT * 0.007);
        float f = n(p) * 0.5 + n(p * 2.1 + 3.1) * 0.3 + n(p * 4.7 - 1.7) * 0.2;
        float top = smoothstep(0.35, 0.75, f), band = floor(top * 3.0) / 3.0; // anime: 3 tinten met harde rand
        vec3 c = mix(vec3(0.74, 0.8, 0.9), vec3(1.0, 0.99, 0.96), band);
        c = mix(c, c * vec3(0.32, 0.36, 0.52), uNight);
        gl_FragColor = vec4(c, 1.0);
        #ifdef gl_FragColor
        gNrm = vec4(nrmPack(normalize(cross(dFdx(vMrtV), dFdy(vMrtV))), mrtOff() - vMrtV.z), 0.0, 1.0); // MRT: 2e uitvoer (normaal + diepte), anders tekent de bewegende laag niets
        #endif
        #include <colorspace_fragment>
      }` }));
  sea.visible = false; sea.frustumCulled = false; sea.renderOrder = -1;
  H.addDynamic(sea);
  function minOf(c) { for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const h = H.heightAt(c.x0 + i * 124, c.y0 + j * 124); if (h < minH) minH = h; } sea.position.y = minH - 60; }

  // ---------- wandelpaden (laag 'paden') ----------
  const PD = D.paden?.byChunk, padMeshes = new Map(), PU = { uLkT: U.uLkT, uMpp: { value: 1 }, uNight: U.uNight || { value: 0 } };
  const padMat = new THREE.ShaderMaterial({
    uniforms: PU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `#include <common>
      attribute vec2 aN; attribute vec3 aS; uniform float uMpp; varying vec3 vS;
      void main() { // aS = (dwars −1..1, afstand m, soort); breedte ≥ 3 px, zodat het ver uitgezoomd zichtbaar blijft
        float w = max(aS.z > 0.5 ? 3.6 : 3.2, 4.0 * uMpp); // halve breedte incl. gloed (kern ±0,3 daarvan), minstens ±8 px breed
        vec3 p = position + vec3(aN.x, 0.0, aN.y) * aS.x * w; vS = aS;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition; vMrtV = mvPosition.xyz; vMrtV.z += mrtOff();
      }`,
    fragmentShader: `#include <common>
      uniform float uLkT, uNight; varying vec3 vS;
      void main() {
        float a = abs(vS.x), core = 1.0 - smoothstep(0.14, 0.34, a), glow = 1.0 - smoothstep(0.25, 1.0, a);
        vec3 c = mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.78, 0.32), core); // lineair: fel amber met gele kern; veldweg roder
        if (vS.z > 0.5) c = mix(vec3(0.95, 0.12, 0.02), vec3(1.0, 0.62, 0.3), core);
        float al = max(core, glow * 0.8);
        { float d = fract((vS.y - uLkT * 4.0) / 30.0); float b = smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.05, 0.16, d)); c = mix(c, vec3(1.0), b * 0.9); al = max(al, b * glow); } // lichtjes lopen mee (4 m/s)
        c *= 1.0 + uNight * 0.6;
        gl_FragColor = vec4(c, al);
        #ifdef gl_FragColor
        gNrm = vec4(nrmPack(normalize(cross(dFdx(vMrtV), dFdy(vMrtV))), mrtOff() - vMrtV.z - 25.0), 0.0, 1.0); // 25 m naar voren: schijnt door boomkruinen heen // MRT: 2e uitvoer (normaal + diepte), anders tekent de bewegende laag niets
        #endif
        #include <colorspace_fragment>
      }` });
  function padChunk(c) {
    const k = chunkOf(c), L2 = PD?.[k]; if (!L2 || padMeshes.has(k)) return;
    const P = [], N = [], S = [], I = [];
    for (const ln of L2) {
      const kind = ln[0], pts = [];
      for (let i = 1; i + 1 < ln.length; i += 2) pts.push([ln[i] / 2, ln[i + 1] / 2]);
      // elke ≤ 5 m een punt, zodat het lint het terrein volgt
      const R = []; for (let i = 0; i < pts.length; i++) { if (i) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.ceil(Math.hypot(bx - ax, by - ay) / 5); for (let s = 1; s < n; s++) R.push([ax + (bx - ax) * s / n, ay + (by - ay) * s / n]); } R.push(pts[i]); }
      if (R.length < 2) continue;
      let u = 0;
      for (let i = 0; i < R.length; i++) {
        const a = R[Math.max(0, i - 1)], b = R[Math.min(R.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        if (i) u += Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]);
        const y = hRel(R[i][0], R[i][1]) + 0.45, v = P.length / 3;
        for (const sd of [-1, 1]) { P.push(R[i][0], y, -R[i][1]); N.push(-dy / l, -dx / l); S.push(sd, u, kind); } // normaal in wereld-xz (z = −y)
        if (i) I.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    }
    if (!I.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(N, 2)); g.setAttribute('aS', new THREE.Float32BufferAttribute(S, 3)); g.setIndex(I);
    const m = new THREE.Mesh(g, padMat); m.frustumCulled = false; m.visible = padOn() && iso();
    padMeshes.set(k, m); H.addDynamic(m);
  }

  // ---------- aan/uit ----------
  function apply() {
    const on = iso();
    MU.uLkMOn.value = mijnOn() ? 1 : 0;
    if (abri.im) abri.im.visible = on;
    sea.visible = on && isFinite(minH);
    for (const m of padMeshes.values()) m.visible = on && padOn();
    placeMijn(); H.shadowDirty?.(); H.redraw?.();
  }
  H.on('chunk', c => { if (!c.dem) return; abriChunk(c); minOf(c); padChunk(c); apply(); });
  if (H.chunks) for (const c of H.chunks.values()) if (c.dem) { abriChunk(c); minOf(c); padChunk(c); }
  H.on('layer', k => { if (k === 'paden' || k === 'mijn') apply(); }); H.on('mode', apply);
  H.on('frame', () => { placeMijn(); PU.uMpp.value = iso() ? 2 * (H.isoHalf?.() || 800) / Math.max(1, innerHeight) : 1; });
  apply();
})();
