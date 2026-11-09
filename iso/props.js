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
    treeLo: [merge([part(new THREE.OctahedronGeometry(1, 0), '#fff', { p: [0, 0.58, 0], s: [0.32, 0.4, 0.32], tint: 1 })]), // ver weg: alleen kroon (zoals bossen)
             merge([part(cone(0.22, 0.85, 5), '#fff', { p: [0, 0.13, 0], tint: 1 })])],
    lamp: [merge([part(cyl(0.08, 0.06, 4.8, 6), '#4a4d55'), part(cyl(0.34, 0.12, 0.32, 4), '#4a4d55', { p: [0, 4.9, 0], r: [0, Math.PI / 4, 0] }), part(box(0.42, 0.06, 0.42), GLASS, { p: [0, 4.85, 0], tint: 1, glow: 1 })]),
           merge([part(cyl(0.12, 0.07, 8, 6), '#8a9098'), rod([0, 7.8, 0], [1.6, 8.1, 0], 0.05, '#8a9098', 5), part(box(0.8, 0.12, 0.3), '#8a9098', { p: [1.8, 8.0, 0] }), part(box(0.7, 0.04, 0.24), GLASS, { p: [1.8, 7.97, 0], tint: 1, glow: 1 })])],
    bench: benchGeo('#b08055', '#3d3f45'),
    gear: gearSet({ a: '#c0563f', b: '#4f7fa8', c: '#a87a52', frame: '#a87a52', wood: '#a87a52', sand: '#ead7a4' }),
    // auto (lengte langs x, 4,3 × 1,8 m): carrosserie in kleur per exemplaar, ruiten/wielen vast
    car: merge([part(box(4.3, 0.75, 1.8), '#fff', { p: [0, 0.3, 0], tint: 1 }), part(box(2.2, 0.55, 1.6), '#fff', { p: [-0.25, 1.05, 0], tint: 1 }),
      part(box(2.26, 0.4, 1.5), '#3b4552', { p: [-0.25, 1.1, 0] }), part(box(0.5, 0.36, 1.84), '#24262b', { p: [1.35, 0.1, 0] }), part(box(0.5, 0.36, 1.84), '#24262b', { p: [-1.35, 0.1, 0] })]),
    stone: merge([part(box(0.6, 0.85, 0.14), '#fff', { tint: 1 }), part(box(0.7, 0.08, 0.3), '#9a978f')]),
    hedge: merge([part(boxc(1, 1, 1), '#fff', { p: [0, 0.5, 0], tint: 1 })]),
    // doelen (breedte langs z): voetbal, hockey, basketbal (paal + bord), tennisnet
    goal: [
      merge([rod([0, 0, -3.66], [0, 2.44, -3.66], 0.06, '#f4f4f0'), rod([0, 0, 3.66], [0, 2.44, 3.66], 0.06, '#f4f4f0'), rod([0, 2.44, -3.66], [0, 2.44, 3.66], 0.06, '#f4f4f0'),
        rod([0, 2.44, -3.66], [-1.5, 0, -3.66], 0.03, '#d8d8d2'), rod([0, 2.44, 3.66], [-1.5, 0, 3.66], 0.03, '#d8d8d2'), rod([-1.5, 0, -3.66], [-1.5, 0, 3.66], 0.03, '#d8d8d2')]),
      merge([rod([0, 0, -1.83], [0, 2.14, -1.83], 0.05, '#f4f4f0'), rod([0, 0, 1.83], [0, 2.14, 1.83], 0.05, '#f4f4f0'), rod([0, 2.14, -1.83], [0, 2.14, 1.83], 0.05, '#f4f4f0'),
        part(box(1.2, 0.46, 3.66), '#2d3a4a', { p: [-0.6, 0, 0] })]),
      merge([rod([-1.2, 0, 0], [-1.2, 3.05, 0], 0.08, '#4a4d55'), rod([-1.2, 3.05, 0], [0, 3.05, 0], 0.06, '#4a4d55'), part(boxc(0.06, 1.05, 1.8), '#f4f4f0', { p: [0, 3.4, 0] }),
        rod([0.03, 3.05, -0.23], [0.45, 3.05, 0], 0.02, '#e0642f'), rod([0.03, 3.05, 0.23], [0.45, 3.05, 0], 0.02, '#e0642f')]),
      merge([part(boxc(0.04, 0.9, 12.8), '#2b2d31', { p: [0, 0.45, 0] }), part(boxc(0.06, 0.06, 12.8), '#f4f4f0', { p: [0, 0.92, 0] }),
        part(cyl(0.05, 0.05, 1.07), '#4a4d55', { p: [0, 0, -6.4] }), part(cyl(0.05, 0.05, 1.07), '#4a4d55', { p: [0, 0, 6.4] })]),
    ],
  };
  const CARC = ['#e8e6e1', '#2e3036', '#8d9299', '#b8bcc2', '#a53a2e', '#2f4f78', '#55606b', '#d8cfb8', '#6b4a3a', '#c9a23a']; // geen groen: seizoen-shader zou dat als blad verkleuren
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
      H.seasonize?.(s, 'leaf'); // groen (kronen, hagen) kleurt mee met het seizoen
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
          float r = length(vQ), a = r < 0.42 ? 0.3 : r < 0.82 ? 0.13 : 0.0; // was 0,55/0,26: te fel
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
    // lantaarns buiten de gemeentegrens weg: hun lichtpoel (ShaderMaterial) wordt niet door de diorama-rand afgeknipt
    const R = H.areaInfo.outline, inside = (x, y) => { let c = false; for (let a = 0, b = R.length - 1; a < R.length; b = a++) { const [xa, ya] = R[a], [xb, yb] = R[b]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c; } return c; };
    for (let k = 0; k < P.lamps.length; k += 5) if (!R || inside(P.lamps[k], P.lamps[k + 1])) add('lamps', P.lamps, k, 5);
    for (let k = 0; k < P.benches.length; k += 4) add('benches', P.benches, k, 4);
    for (let k = 0; k < P.gear.length; k += 4) add('gear', P.gear, k, 4);
    // parkeerterreinen / begraafplaatsen (uit data/ground.js, hulpcoördinaten in halve m t.o.v. origin) + hagen + doelen
    const O = H.areaInfo.origin, GD = window.H3D_DATA?.ground, q = GD?.q || 0.5;
    const put = (key, x, y, it) => { const i = Math.floor(x / km), j = Math.floor(y / km), id = i + '_' + j; let b = out.get(id); if (!b) out.set(id, b = { trees: [], lamps: [], benches: [], gear: [] }); (b[key] ||= []).push(it); };
    for (const g of GD?.park || []) put('park', O[0] + g[0] * q, O[1] + g[1] * q, g);
    for (const g of GD?.grave || []) put('grave', O[0] + g[0] * q, O[1] + g[1] * q, g);
    for (const h of P.hedges || []) { // [hoogte dm, delta-xy halve m t.o.v. origin]
      const xy = []; let x = 0, y = 0; for (let k = 1; k + 1 < h.length; k += 2) { x += h[k]; y += h[k + 1]; xy.push(O[0] + x / 2, O[1] + y / 2); }
      if (xy.length >= 4) put('hedge', xy[0], xy[1], [h[0] / 10, xy]);
    }
    const Gl = P.goals || []; for (let k = 0; k + 5 < Gl.length; k += 6) put('goal', Gl[k + 1], Gl[k + 2], Gl.slice(k, k + 6));
    return out;
  }

  // ---------- vak opbouwen ----------
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
  const WARM = new THREE.Color('#ffbf73');
  // [geo, matrix, kleur|null] → één geometrie; kleur per exemplaar vooraf in 'color' gebakken (× vertexkleur) waar aTint = 1 (zoals de shader bij instancing doet)
  function bake(list) {
    let n = 0; for (const [g] of list) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), T = new Float32Array(n), G = new Float32Array(n);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0;
    for (const [g, M, c] of list) {
      const a = g.attributes, m = a.position.count; nm.getNormalMatrix(M);
      for (let k = 0; k < m; k++) {
        const i = o + k, t = a.aTint.array[k];
        v.fromBufferAttribute(a.position, k).applyMatrix4(M); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
        v.fromBufferAttribute(a.normal, k).applyMatrix3(nm).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z;
        const r = a.color.array[k * 3], gg = a.color.array[k * 3 + 1], bb = a.color.array[k * 3 + 2];
        const w = c && t; C[i * 3] = w ? r * c.r : r; C[i * 3 + 1] = w ? gg * c.g : gg; C[i * 3 + 2] = w ? bb * c.b : bb;
        T[i] = t; G[i] = a.aGlow.array[k];
      }
      o += m;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(T, 1)); g.setAttribute('aGlow', new THREE.BufferAttribute(G, 1));
    g.computeBoundingSphere();
    return g;
  }
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
      if (im) { im.geoHi = st.tree[kind]; im.geoLo = st.treeLo[kind]; v.trees.push(im); }
    }
    // klein spul: per vak samengebakken tot 2 gewone meshes (lantaarns zonder schaduw / banken + toestellen) i.p.v. tot 11 InstancedMeshes
    const lampB = [], restB = [];
    for (const l of b.lamps) { at(l[0], l[1], 0, rad(l[4]), 1); lampB.push([st.lamp[l[2]], m4.compose(ps, qq, sc).clone(), WARM]); }
    for (const x of b.benches) { at(x[0], x[1], 0, rad(x[3]), 1); restB.push([st.bench[x[2]], m4.compose(ps, qq, sc).clone(), null]); }
    for (const g of b.gear) { at(g[0], g[1], 0, rad(g[3]), 1); restB.push([st.gear[g[2]], m4.compose(ps, qq, sc).clone(), null]); }
    // doelen: aan beide korte kanten (voetbal/hockey/basketbal), tennisnet in het midden; ang = RD-hoek → om y = ang (z = −noord)
    for (const [k, x, y, L, W, ang] of b.goal || []) {
      const c = Math.cos(ang), s = Math.sin(ang);
      if (k === 3) { at(x, y, 0, ang, 1); restB.push([st.goal[3], m4.compose(ps, qq, sc).clone(), null]); continue; }
      for (const e of [-1, 1]) {
        const d = L / 2 - (k === 2 ? 1.2 : 0), gx = x + c * d * e, gy = y + s * d * e;
        at(gx, gy, 0, ang + (e > 0 ? Math.PI : 0), 1); restB.push([st.goal[k], m4.compose(ps, qq, sc).clone(), null]);
      }
    }
    // hagen: per stuk lijn een blok (lengte × hoogte × 0,9 m), kleur licht gevarieerd
    const HC = new THREE.Color();
    for (const [h, xy] of b.hedge || []) for (let k = 0; k + 3 < xy.length; k += 2) {
      const x0 = xy[k], y0 = xy[k + 1], x1 = xy[k + 2], y1 = xy[k + 3], L = Math.hypot(x1 - x0, y1 - y0); if (L < 0.3) continue;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      ps.set(mx - O[0], Math.min(hAt(x0, y0), hAt(x1, y1), hAt(mx, my)) - 0.1, -(my - O[1])); qq.setFromAxisAngle(UP, Math.atan2(y1 - y0, x1 - x0)); sc.set(L + 0.6, h + 0.1, 0.9);
      restB.push([st.hedge, m4.compose(ps, qq, sc).clone(), HC.setHSL(0.27 + rnd() * 0.04, 0.38, 0.3 + rnd() * 0.05).clone()]);
    }
    // grafstenen: rijen langs u op afstand sp, voorkant naar −v
    const stones = [];
    for (const g of b.grave || []) {
      const c = Math.cos(g[2] / 1000), s = Math.sin(g[2] / 1000), cx = O[0] + g[0] * 0.5, cy = O[1] + g[1] * 0.5, sp = g[3] / 10, R = g[4];
      for (let k = 0; k + 2 < R.length; k += 3) for (let i = 0; i < R[k + 2]; i++) {
        const u = R[k] / 2 + i * sp, v = R[k + 1] / 2; stones.push([cx + u * c - v * s, cy + u * s + v * c, g[2] / 1000]);
      }
    }
    const sIm = inst(st.stone, stones, t => { at(t[0], t[1], -0.05, t[2] + (rnd() - 0.5) * 0.08, 1); sc.set(0.8 + rnd() * 0.5, 0.7 + rnd() * 0.6, 1); },
      () => col.setHSL(0.08 + rnd() * 0.05, 0.05 + rnd() * 0.06, 0.45 + rnd() * 0.3));
    if (sIm) v.small.push(sIm);
    // auto's: ±60 % van de vakken bezet, kleur uit CARC, neus naar de rijbaan (−d)
    const cars = [];
    for (const g of b.park || []) {
      const c = Math.cos(g[2] / 1000), s = Math.sin(g[2] / 1000), cx = O[0] + g[0] * 0.5, cy = O[1] + g[1] * 0.5, R = g[3];
      for (let k = 0; k + 2 < R.length; k += 3) {
        const n = Math.abs(R[k + 2]), d = Math.sign(R[k + 2]), vm = R[k + 1] / 2 + d * 2.5;
        for (let i = 0; i < n; i++) {
          if (rnd() > 0.6) continue;
          const u = R[k] / 2 + (i + 0.5) * 2.5; cars.push([cx + u * c - vm * s, cy + u * s + vm * c, g[2] / 1000 + Math.PI / 2 + (d > 0 ? Math.PI : 0)]);
        }
      }
    }
    const cIm = inst(st.car, cars, t => { at(t[0], t[1], 0, t[2] + (rnd() - 0.5) * 0.06, 1); }, () => col.set(CARC[Math.floor(rnd() * CARC.length)]));
    if (cIm) v.small.push(cIm);
    for (const [L, noShadow] of [[lampB, true], [restB, false]]) {
      if (!L.length) continue;
      const m = new THREE.Mesh(bake(L), PMAT); m.userData.noShadow = noShadow; group.add(m); v.small.push(m);
    }
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
        for (let k = 0; k < seg; k++) { const a = base + 1 + k, bb = base + 1 + (k + 1) % seg; I.push(base, a, bb, a, a + seg, bb, bb, a + seg, bb + seg); } // tegen de klok in van boven gezien (anders achterkant boven → weggeknipt)
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
    const f = d < 1800 ? 1 : d < 4000 ? 1 / 3 : 0, cast = d < 1800, lo = !!H.treeLo?.(d); let ch = false;
    for (const im of v.trees) {
      const g = lo ? im.geoLo : im.geoHi; if (im.geometry !== g) { im.geometry = g; ch = true; }
      const n = Math.round(im.full * f);
      if (im.count !== n) { im.count = n; ch = true; }
      if (im.castShadow !== cast) { im.castShadow = cast; ch = true; }
    }
    const near = d < 2200; // lantaarns, banken, toestellen: klein → ver weg weg
    for (const im of v.small) {
      if (im.visible !== near) { im.visible = near; ch = true; }
      const cs = cast && !im.userData.noShadow;
      if (im.castShadow !== cs) { im.castShadow = cs; ch = true; }
    }
    v.group.visible = d < 6000 && H.fxOn('props'); // poelen blijven langer staan: straten als kralensnoeren
    return ch;
  }
  H.on('detail', () => { let ch = false; for (const v of VAK) ch = detail(v) || ch; if (ch) H.shadowDirty(); });
  H.on('fx', k => { if (k !== 'props') return; for (const v of VAK) detail(v); H.shadowDirty(); });

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
