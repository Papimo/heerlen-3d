// iso/props.js — straatmeubilair (stroom E, keuze uit design/6_props.html): modelstijl 2 Facet · lichtpoel B Cel-ringen ·
// aanvullen B (OSM + verzonnen lantaarns/toestellen, staat al in data/props.js) · grootte echt.
// Per km-vak: InstancedMesh per soort (bomen loof/naald, lantaarn woonstraat/hoofdweg, bank/picknicktafel, 7 speeltoestellen)
// + één lichtpoel-mesh (schijven die het terrein volgen, additief, alleen 's avonds). Haakt in via H3D.on('chunk'|'detail'|'light'|'frame').
(() => {
  const P = window.H3D_DATA?.props;
  if (!P || typeof H3D === 'undefined' || !H3D.on) return; // H3D = const in app.js (geen window-eigenschap)
  const H = H3D;

  // ---------- bouwstenen: samengevoegde geometrie met vertex-kleur, aTint (1 = kleur per exemplaar) en aGlow ('s avonds gloeien) ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), UP = V3(0, 1, 0);
  const flat = g => g.index ? g.toNonIndexed() : g;
  function part(g, c, o = {}) {
    g = flat(g);
    const q = o.q || new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r || [0, 0, 0])));
    g.applyMatrix4(new THREE.Matrix4().compose(V3(...(o.p || [0, 0, 0])), q, V3(...(o.s || [1, 1, 1]))));
    return { g, c: new THREE.Color(c), tint: o.tint ? 1 : 0, glow: o.glow || 0 };
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);   // voet op 0
  const boxc = (w, h, d) => new THREE.BoxGeometry(w, h, d);                          // midden op 0
  const cyl = (r0, r1, h, s = 6) => new THREE.CylinderGeometry(r1, r0, h, s).translate(0, h / 2, 0);
  const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s).translate(0, h / 2, 0);
  const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
  function rod(a, b, r, c, s = 5, o = {}) { // staaf van punt a naar b
    const A = V3(...a), B = V3(...b), d = B.clone().sub(A), L = d.length();
    return part(new THREE.CylinderGeometry(r, r, L, s), c, { ...o, p: A.add(B).multiplyScalar(0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()) });
  }
  function merge(parts) {
    const n = parts.reduce((t, p) => t + p.g.attributes.position.count, 0);
    const Pp = new Float32Array(n * 3), C = new Float32Array(n * 3), T = new Float32Array(n), G = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      const a = p.g.attributes.position.array, m = a.length / 3; Pp.set(a, o * 3);
      for (let k = 0; k < m; k++) { C[(o + k) * 3] = p.c.r; C[(o + k) * 3 + 1] = p.c.g; C[(o + k) * 3 + 2] = p.c.b; T[o + k] = p.tint; G[o + k] = p.glow; }
      o += m;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(T, 1)); g.setAttribute('aGlow', new THREE.BufferAttribute(G, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  // ---------- stijl Facet (= optie 2 in design/6_props.html) ----------
  // gear[k] volgt P.kinds: swing, slide, climbingframe, sandpit, seesaw, springy, roundabout
  function gearSet(p) {
    const F = p.frame, legs = x => [rod([x, 0, -0.8], [x, 2.3, 0], 0.05, F), rod([x, 0, 0.8], [x, 2.3, 0], 0.05, F)];
    const swing = [...legs(-1.4), ...legs(1.4), rod([-1.5, 2.3, 0], [1.5, 2.3, 0], 0.06, F)];
    for (const x of [-0.55, 0.55]) swing.push(part(box(0.45, 0.05, 0.22), p.a, { p: [x, 0.42, 0] }), rod([x, 0.45, 0], [x, 2.3, 0], 0.02, '#555', 3));
    const slide = [part(box(1, 0.08, 1), p.wood, { p: [0, 1.5, 0] }), part(boxc(0.5, 0.06, 3.22), p.b, { p: [0, 0.82, 1.95], r: [0.45, 0, 0] })];
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) slide.push(part(box(0.08, 1.5, 0.08), F, { p: [x, 0, z] }));
    const climb = [];
    for (const [a, b] of [[[-1, 0, -1], [-1, 2, -1]], [[1, 0, -1], [1, 2, -1]], [[-1, 0, 1], [-1, 2, 1]], [[1, 0, 1], [1, 2, 1]], [[-1, 2, -1], [1, 2, -1]], [[-1, 2, 1], [1, 2, 1]], [[-1, 2, -1], [-1, 2, 1]], [[1, 2, -1], [1, 2, 1]]]) climb.push(rod(a, b, 0.05, p.c));
    const sand = [part(box(2.8, 0.12, 2.8), p.sand)];
    for (const [x, z, w, dd] of [[0, -1.45, 3, 0.15], [0, 1.45, 3, 0.15], [-1.45, 0, 0.15, 3], [1.45, 0, 0.15, 3]]) sand.push(part(box(w, 0.3, dd), p.wood, { p: [x, 0, z] }));
    const saw = [part(box(0.25, 0.5, 0.25), F), part(boxc(3, 0.08, 0.3), p.a, { p: [0, 0.58, 0], r: [0, 0, 0.16] })];
    const spring = [part(cyl(0.08, 0.08, 0.45, 6), '#3d3f45'), part(ico(0.3, 0), p.b, { p: [0, 0.68, 0], s: [1.4, 0.8, 0.6] }), part(ico(0.16, 0), p.b, { p: [0.38, 0.95, 0] })];
    const round = [part(cyl(1, 1, 0.1, 8), p.a, { p: [0, 0.12, 0] }), part(cyl(0.06, 0.06, 0.9, 6), F, { p: [0, 0.2, 0] })];
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; round.push(rod([0, 1.05, 0], [Math.cos(a) * 0.9, 0.7, Math.sin(a) * 0.9], 0.03, F, 4)); }
    return [swing, slide, climb, sand, saw, spring, round].map(merge);
  }
  function benchGeo(seat, frame) { // latjesbank + picknicktafel
    const B = [];
    for (let k = 0; k < 4; k++) B.push(part(box(1.8, 0.04, 0.1), seat, { p: [0, 0.42, -0.18 + k * 0.12] }));
    for (let k = 0; k < 3; k++) B.push(part(box(1.8, 0.09, 0.03), seat, { p: [0, 0.55 + k * 0.13, -0.26], r: [-0.18, 0, 0] }));
    for (const x of [-0.75, 0.75]) B.push(part(box(0.07, 0.42, 0.45), frame, { p: [x, 0, 0] }));
    const T = [part(box(1.8, 0.07, 0.75), seat, { p: [0, 0.72, 0] })];
    for (const z of [-0.6, 0.6]) T.push(part(box(1.8, 0.05, 0.28), seat, { p: [0, 0.44, z] }));
    for (const x of [-0.7, 0.7]) T.push(part(boxc(0.08, 0.06, 1.5), frame, { p: [x, 0.3, 0] }), rod([x, 0, -0.55], [x, 0.72, 0], 0.04, frame, 4), rod([x, 0, 0.55], [x, 0.72, 0], 0.04, frame, 4));
    return [merge(B), merge(T)];
  }
  const TRUNK = '#6b5444', GLASS = '#f4efe2';
  let ST = null; // pas bij het eerste vak bouwen (THREE + H3D zijn er dan zeker)
  const style = () => ST ||= {
    tree: [merge([part(cyl(0.05, 0.035, 0.3, 5), TRUNK), part(ico(1, 0), '#fff', { p: [0, 0.58, 0], s: [0.32, 0.4, 0.32], tint: 1 })]),
           merge([part(cyl(0.05, 0.035, 0.3, 5), TRUNK), part(cone(0.22, 0.85, 7), '#fff', { p: [0, 0.13, 0], tint: 1 })])],
    lamp: [merge([part(cyl(0.08, 0.06, 4.8, 6), '#4a4d55'), part(cyl(0.34, 0.12, 0.32, 4), '#4a4d55', { p: [0, 4.9, 0], r: [0, Math.PI / 4, 0] }), part(box(0.42, 0.06, 0.42), GLASS, { p: [0, 4.85, 0], tint: 1, glow: 1 })]),
           merge([part(cyl(0.12, 0.07, 8, 6), '#8a9098'), rod([0, 7.8, 0], [1.6, 8.1, 0], 0.05, '#8a9098', 5), part(box(0.8, 0.12, 0.3), '#8a9098', { p: [1.8, 8.0, 0] }), part(box(0.7, 0.04, 0.24), GLASS, { p: [1.8, 7.97, 0], tint: 1, glow: 1 })])],
    bench: benchGeo('#b08055', '#3d3f45'),
    gear: gearSet({ a: '#c0563f', b: '#4f7fa8', c: '#a87a52', frame: '#a87a52', wood: '#a87a52', sand: '#ead7a4' }),
  };
  const treeCol = (r, n) => n ? [0.36 + r() * 0.04, 0.38, 0.22 + r() * 0.06] : (r() < 0.12 ? [0.06 + r() * 0.07, 0.6, 0.42 + r() * 0.08] : [0.22 + r() * 0.08, 0.46 + r() * 0.14, 0.3 + r() * 0.1]);

  // ---------- materialen ----------
  // props: kleur per exemplaar alleen waar aTint = 1, aGlow gloeit 's avonds; daarna cel-look van de app (celify na de eigen patch)
  let PMAT = null, POOL = null;
  function mats() {
    if (PMAT) return;
    PMAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    PMAT.onBeforeCompile = s => {
      s.uniforms.uNight = H.U.uNight;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTint; attribute float aGlow; varying float vGlow;')
        .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
        vColor.rgb = mix(color, vColor.rgb, aTint);
        #endif
        vGlow = aGlow;`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * uNight * 1.8;');
    };
    H.celify(PMAT, 'prop');
    // lichtpoel B: twee harde ringen (binnen 0,55, buiten 0,26), additief over het terrein
    POOL = new THREE.ShaderMaterial({
      uniforms: { uNight: H.U.uNight },
      vertexShader: 'attribute vec2 aQ; varying vec2 vQ; void main() { vQ = aQ; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vQ; uniform float uNight;
        #ifdef gl_FragColor
        layout(location = 1) out highp vec4 gNrm; // MRT van de app: niets aan normaal/diepte veranderen (additief + 0)
        #endif
        void main() {
          #ifdef gl_FragColor
          gNrm = vec4(0.0);
          #endif
          float r = length(vQ), a = r < 0.42 ? 0.55 : r < 0.82 ? 0.26 : 0.0;
          gl_FragColor = vec4(vec3(1.0, 0.749, 0.451) * a * uNight, 1.0);
        }`,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
  }

  // ---------- data per vak indelen (één keer) ----------
  let BY = null;
  function bucket() {
    const km = H.areaInfo.km, out = new Map();
    const add = (key, arr, k, n) => { const i = Math.floor(arr[k] / km), j = Math.floor(arr[k + 1] / km), id = i + '_' + j; let b = out.get(id); if (!b) out.set(id, b = { trees: [], lamps: [], benches: [], gear: [] }); b[key].push(arr.slice(k, k + n)); };
    for (let k = 0; k < P.trees.length; k += 4) add('trees', P.trees, k, 4);
    for (let k = 0; k < P.lamps.length; k += 5) add('lamps', P.lamps, k, 5);
    for (let k = 0; k < P.benches.length; k += 4) add('benches', P.benches, k, 4);
    for (let k = 0; k < P.gear.length; k += 4) add('gear', P.gear, k, 4);
    return out;
  }

  // ---------- vak opbouwen ----------
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const WARM = new THREE.Color('#ffbf73');
  const rad = d => (90 - d) * Math.PI / 180; // richting° (0 = noord, met de klok mee) → draaiing om y
  const VAK = []; // { c, group, trees: [im], small: [im], pool }

  function build(c) {
    if (c.props) return;
    BY ||= bucket();
    const b = BY.get(c.i + '_' + c.j); c.props = true;
    if (!b) return;
    mats(); const st = style(), O = H.areaInfo.origin, km = H.areaInfo.km;
    let seed = (c.i * 73856093 ^ c.j * 19349663) & 0x7fffffff || 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // hoogte binnen het eigen vak (buurvak kan nog ontbreken → heightAt gaf dan de ondergrond)
    const hAt = (x, y) => H.heightAt(Math.min(c.x0 + km - 0.01, Math.max(c.x0, x)), Math.min(c.y0 + km - 0.01, Math.max(c.y0, y)));
    const at = (x, y, h, ang, s) => { ps.set(x - O[0], hAt(x, y) + h, -(y - O[1])); qq.setFromAxisAngle(UP, ang); sc.setScalar(s); };
    const group = new THREE.Group(), v = { c, group, trees: [], small: [], pool: null };
    const inst = (geo, list, place, color) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, PMAT, list.length);
      list.forEach((it, i) => { place(it); im.setMatrixAt(i, m4.compose(ps, qq, sc)); im.setColorAt(i, color ? color(it) : col.set('#ffffff')); });
      im.full = list.length; im.computeBoundingSphere(); group.add(im);
      return im;
    };
    // bomen: willekeurige volgorde → count verlagen = gelijkmatig uitdunnen (zoals de bossen)
    for (const kind of [0, 1]) {
      const L = b.trees.filter(t => t[2] === kind);
      for (let k = L.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [L[k], L[r]] = [L[r], L[k]]; }
      const im = inst(st.tree[kind], L, t => {
        const h = t[3] || (kind ? 9 : 7) + rnd() * 6;
        at(t[0], t[1], -0.2, rnd() * 6.28, 1); sc.set(h * (0.85 + rnd() * 0.3), h, h * (0.85 + rnd() * 0.3));
      }, () => col.setHSL(...treeCol(rnd, kind)));
      if (im) v.trees.push(im);
    }
    for (const kind of [0, 1]) { // lantaarns werpen geen schaduw (dun, en veel)
      const im = inst(st.lamp[kind], b.lamps.filter(l => l[2] === kind), l => at(l[0], l[1], 0, rad(l[4]), 1), () => col.copy(WARM));
      if (im) v.small.push(im);
    }
    for (const kind of [0, 1]) { const im = inst(st.bench[kind], b.benches.filter(x => x[2] === kind), x => at(x[0], x[1], 0, rad(x[3]), 1)); if (im) v.small.push(im); }
    for (let kind = 0; kind < st.gear.length; kind++) { const im = inst(st.gear[kind], b.gear.filter(g => g[2] === kind), g => at(g[0], g[1], 0, rad(g[3]), 1)); if (im) v.small.push(im); }
    // lichtpoel: per lamp een schijf (midden + 2 ringen × 16) op het terrein, onder de kap (arm richting straat)
    if (b.lamps.length) {
      const Pp = [], Q = [], I = [], seg = 16;
      for (const l of b.lamps) {
        const R0 = l[2] ? 15 : 11, th = rad(l[4]), arm = l[2] ? 1.5 : 0.6, base = Pp.length / 3;
        const cx = l[0] + Math.cos(th) * arm, cy = l[1] + Math.sin(th) * arm;
        Pp.push(cx - O[0], hAt(cx, cy) + 0.15, -(cy - O[1])); Q.push(0, 0);
        for (const f of [0.5, 1]) for (let k = 0; k < seg; k++) {
          const a = k / seg * 6.283, x = cx + Math.cos(a) * R0 * f, y = cy + Math.sin(a) * R0 * f;
          Pp.push(x - O[0], hAt(x, y) + 0.15, -(y - O[1])); Q.push(Math.cos(a) * f, Math.sin(a) * f);
        }
        for (let k = 0; k < seg; k++) { const a = base + 1 + k, bb = base + 1 + (k + 1) % seg; I.push(base, bb, a, a, bb, a + seg, bb, bb + seg, a + seg); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3)); g.setAttribute('aQ', new THREE.Float32BufferAttribute(Q, 2)); g.setIndex(I);
      g.computeBoundingSphere();
      const pm = new THREE.Mesh(g, POOL); pm.renderOrder = 2; pm.visible = lit;
      // niet meetekenen in de normaal/diepte-pass (scene.overrideMaterial = NRM), anders krijgt elke poel een omlijning
      pm.onBeforeRender = (r, s, cam, geo, mat) => { if (mat !== POOL) geo.setDrawRange(0, 0); };
      pm.onAfterRender = (r, s, cam, geo) => geo.setDrawRange(0, Infinity);
      group.add(pm); v.pool = pm;
    }
    H.scene.add(group); VAK.push(v);
    detail(v); H.shadowDirty();
  }

  // ---------- uitdunnen naar afstand (gelijkwaardige afstand = chunkDist × lens, zoals bossen) ----------
  function detail(v) {
    const d = H.chunkDist(v.c) * H.lens();
    const f = d < 1800 ? 1 : d < 4000 ? 1 / 3 : 0, cast = d < 1800; let ch = false;
    for (const im of v.trees) {
      const n = Math.round(im.full * f);
      if (im.count !== n) { im.count = n; ch = true; }
      if (im.castShadow !== cast) { im.castShadow = cast; ch = true; }
    }
    const near = d < 2200; // lantaarns, banken, toestellen: klein → ver weg weg
    for (const im of v.small) {
      if (im.visible !== near) { im.visible = near; ch = true; }
      const cs = cast && im.geometry !== ST.lamp[0] && im.geometry !== ST.lamp[1];
      if (im.castShadow !== cs) { im.castShadow = cs; ch = true; }
    }
    v.group.visible = d < 6000; // poelen blijven langer staan: straten als kralensnoeren
    return ch;
  }
  H.on('detail', () => { let ch = false; for (const v of VAK) ch = detail(v) || ch; if (ch) H.shadowDirty(); });

  // ---------- lichtpoel alleen als het (een beetje) donker is; uNight loopt geleidelijk mee ----------
  let lit = false;
  const checkLit = () => {
    const on = H.U.uNight.value > 0.001;
    if (on === lit) return; lit = on;
    for (const v of VAK) if (v.pool) v.pool.visible = on;
  };
  H.on('light', checkLit); H.on('frame', checkLit);

  H.on('chunk', build);
  if (H.chunks) for (const c of H.chunks.values()) if (c.dem) build(c); // vakken die er al waren
})();
