// iso/groen.js — water en groen (keuze design/24b: groen c, d, e, f; alleen iso). Per vak gebouwd zodra het terrein er is (timer 0,7 s, dichtbij eerst).
//  Geleenbeek: bed 5,2 m + rietkraag + knotwilgen om de ±11 m buiten de bebouwing (masker: iso/ground.js H.waterNear rekent de beek ook 5,2 m breed)
//  vijvers: rietkraag op ±40% van de oever, waterlelies langs de rand (bloei zomer), eenden, fontein in grote vijvers
//  boomgaarden (OSM landuse=orchard): rijen 9 × 6 m, bloesem/fruit/kaal per seizoen · bladtapijt onder echte loofbomen (alleen herfst)
// Regel gebruiker: waar water is staan geen bomen → knotwilgen/fruitbomen via H.treesDry, bladtapijt niet op water.
// Alles in RD-meters; wereld = (x − O0, h, −(y − O1)). Riet/eenden/bomen ×1,3–2 groter dan echt (anders < 1 px in iso).
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null;
  if (!H?.on || !H.celify) return;
  let O = null, KM = 1000;
  const iso = () => H.getMode?.() === 'iso';
  const ckey = (x, y) => Math.floor(x / KM) + '_' + Math.floor(y / KM);
  const hAt = (x, y) => H.chunks.get(ckey(x, y))?.dem ? H.heightAt(x, y) : null;
  const rng = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const season = () => H.getSeason?.() || 'zomer';
  const dry = im => { H.treesDry?.(im); return im; };

  // ---------- materialen ----------
  let MAT, FLAT, WATER;
  function mats() {
    if (MAT) return;
    MAT = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'groen');
    FLAT = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, side: THREE.DoubleSide }), 'groenflat');
    WATER = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, side: THREE.DoubleSide }), 'groenwater');
    WATER.onBeforeCompile = s => { // plat, stil (water c, design/23): lichte glinstering op wereldpositie, geen tijd
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW;').replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW; float wH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
        .replace('#include <color_fragment>', `#include <color_fragment>
          { vec2 q = floor(vWW.xz * 0.7); float g = wH(q) * wH(q + 17.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.94, 0.97), step(0.86, g) * 0.6); }`);
    };
  }

  // ---------- geometrie (vertexkleur, geen normals: flatShading) ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), UPV = V3(0, 1, 0);
  function part(g, c, o = {}) {
    if (g.index) g = g.toNonIndexed();
    const q = o.q || new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r || [0, 0, 0])));
    g.applyMatrix4(new THREE.Matrix4().compose(V3(...(o.p || [0, 0, 0])), q, V3(...(o.s || [1, 1, 1]))));
    return { g, c: new THREE.Color(c) };
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const cyl = (r0, r1, h, s = 8) => new THREE.CylinderGeometry(r1, r0, h, s).translate(0, h / 2, 0);
  function rod(a, b, r, c, s = 4) {
    const A = V3(...a), B = V3(...b), d = B.clone().sub(A), L = d.length();
    return part(new THREE.CylinderGeometry(r, r, L, s), c, { p: A.add(B).multiplyScalar(0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(UPV, d.normalize()) });
  }
  function merge(parts) {
    const n = parts.reduce((t, p) => t + p.g.attributes.position.count, 0);
    const P = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    for (const p of parts) {
      const a = p.g.attributes.position.array, m = a.length / 3; P.set(a, o * 3);
      for (let k = 0; k < m; k++) { C[(o + k) * 3] = p.c.r; C[(o + k) * 3 + 1] = p.c.g; C[(o + k) * 3 + 2] = p.c.b; }
      o += m; p.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.computeBoundingSphere(); return g;
  }
  function triGeo(P, C) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere(); return g; }
  const col3 = c => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; };
  function inst(geo, mat, list, shadow) { // list: [{m: Matrix4, c: Color?}]
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.count = list.length; im.full = list.length;
    list.forEach((it, k) => { im.setMatrixAt(k, it.m); if (it.c) im.setColorAt(k, it.c); });
    im.castShadow = !!shadow; im.receiveShadow = true; im.computeBoundingSphere?.(); return im;
  }
  const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const mtx = (x, y, h, ang, sc, sy = sc) => new THREE.Matrix4().compose(_p.set(x - O[0], h, -(y - O[1])), _q.setFromAxisAngle(UPV, ang), _s.set(sc, sy, sc));

  // ---------- 2D-hulpjes ----------
  const nrm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const pip = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const bboxOf = r => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let k = 0; k < r.length; k += 2) { a = Math.min(a, r[k]); b = Math.min(b, r[k + 1]); c = Math.max(c, r[k]); d = Math.max(d, r[k + 1]); } return [a, b, c, d]; };
  const areaOf = r => { let s = 0; for (let k = 0; k < r.length - 2; k += 2) s += r[k] * r[k + 3] - r[k + 2] * r[k + 1]; return Math.abs(s / 2); };

  // ---------- data ----------
  let LN = null, PONDS = null, ORCH = null, BUILTUP = null, TREES = null;
  function prep() {
    if (LN) return true;
    const L = H.layerData; if (!L?.water) return false;
    LN = [];
    for (const [name, , r] of L.water) { // alleen de Geleenbeek, 4 m herbemonsterd
      if (!/^Geleenbeek$/.test(name)) continue;
      const p = [], cum = []; let s = 0;
      for (let k = 0; k + 3 < r.length; k += 2) { const ax = r[k], ay = r[k + 1], bx = r[k + 2], by = r[k + 3], d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 4));
        for (let t = 0; t < n; t++) { p.push(ax + (bx - ax) * t / n, ay + (by - ay) * t / n); cum.push(s + d * t / n); } s += d; }
      p.push(r[r.length - 2], r[r.length - 1]); cum.push(s);
      LN.push({ p, cum, bb: bboxOf(p) });
    }
    PONDS = (L.ponds || []).map(([, r]) => ({ r, a: areaOf(r), bb: bboxOf(r) })).filter(p => p.a > 120 && p.a < 60000);
    ORCH = (L.land || []).filter(l => l[0] === 'boomgaard').map(l => ({ r: l[1], bb: bboxOf(l[1]) }));
    BUILTUP = (L.land || []).filter(l => /^(wonen|industrie|werk|winkel|bouw|erf)$/.test(l[0])).map(l => ({ r: l[1], bb: bboxOf(l[1]) }));
    const T = window.H3D_DATA?.props?.trees || []; TREES = []; for (let k = 0; k < T.length; k += 4) if (!T[k + 2]) TREES.push([T[k], T[k + 1], T[k + 3] || 9]);
    return true;
  }
  const inBuilt = (x, y) => BUILTUP.some(b => x >= b.bb[0] && x <= b.bb[2] && y >= b.bb[1] && y <= b.bb[3] && pip(x, y, b.r));
  const chunkBox = key => { const [i, j] = key.split('_').map(Number); return [i * KM, j * KM, (i + 1) * KM, (j + 1) * KM]; };
  const hit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  const inC = (x, y, B) => x >= B[0] && x < B[2] && y >= B[1] && y < B[3];
  function sideAt(ln, k) { const p = ln.p, n = p.length / 2, a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1); const d = nrm([p[b * 2] - p[a * 2], p[b * 2 + 1] - p[a * 2 + 1]]); return [d[1], -d[0], d[0], d[1]]; } // normaal (rechts) + richting

  // ---------- modelletjes (voet op 0) ----------
  let GEO = null;
  function geos() {
    if (GEO) return GEO;
    const blades = []; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, l = 0.25 + (k % 3) * 0.08; blades.push(part(new THREE.ConeGeometry(0.07, 1.5 + (k % 2) * 0.5, 3).translate(0, 0.8, 0), '#ffffff', { p: [Math.cos(a) * l * 0.4, 0, Math.sin(a) * l * 0.4], r: [Math.sin(a) * 0.22, 0, Math.cos(a) * 0.22] })); }
    const pad = part(new THREE.CylinderGeometry(1, 1, 0.06, 9, 1, false, 0.35, Math.PI * 2 - 0.7), '#ffffff');
    GEO = {
      reed: merge(blades),
      pad: merge([pad]), flower: merge([part(new THREE.OctahedronGeometry(0.28), '#ffffff', { p: [0.2, 0.15, 0.1] })]),
      duck: merge([part(box(0.42, 0.2, 0.22), '#ffffff'), part(box(0.16, 0.16, 0.14), '#2f5d3a', { p: [0.2, 0.18, 0] }), part(box(0.1, 0.04, 0.07), '#e3a03a', { p: [0.31, 0.24, 0] }), part(box(0.12, 0.08, 0.2), '#ffffff', { p: [-0.2, 0.18, 0] })]),
      fountain: merge([part(cyl(1.4, 1.4, 0.35, 12), '#d8d2c4'), part(new THREE.ConeGeometry(0.35, 3.2, 8).translate(0, 1.6, 0), '#eef6fa', { p: [0, 0.3, 0] }),
        ...[0, 1, 2, 3, 4, 5].map(k => part(new THREE.ConeGeometry(0.18, 1.6, 5).translate(0, 0.8, 0), '#e2eef4', { p: [Math.cos(k) * 0.7, 0.3, Math.sin(k) * 0.7], r: [Math.sin(k) * 0.5, 0, -Math.cos(k) * 0.5] }))]),
      wilgStam: merge([part(cyl(0.42, 0.36, 1.9, 7), '#5e5246'), part(new THREE.SphereGeometry(0.55, 7, 5), '#5e5246', { p: [0, 1.9, 0], s: [1, 0.6, 1] }),
        ...[0, 1, 2, 3, 4, 5, 6].map(k => rod([0, 2, 0], [Math.cos(k * 0.9) * 0.9, 3.3 + (k % 3) * 0.3, Math.sin(k * 0.9) * 0.9], 0.05, '#7d6a52', 3))]),
      wilgKroon: merge([part(new THREE.IcosahedronGeometry(1.5, 0), '#ffffff', { p: [0, 3.1, 0], s: [1, 0.85, 1] })]),
      fruitStam: merge([part(cyl(0.16, 0.12, 1.4, 5), '#5a4a3c'), ...[0, 1, 2, 3].map(k => rod([0, 1.3, 0], [Math.cos(k * 1.6) * 1.0, 2.3, Math.sin(k * 1.6) * 1.0], 0.06, '#5a4a3c', 3))]),
      fruitKroon: merge([part(new THREE.IcosahedronGeometry(1.35, 0), '#ffffff', { p: [0, 2.35, 0], s: [1, 0.78, 1] })]),
      fruitStip: merge([0, 1, 2, 3, 4, 5, 6].map(k => part(new THREE.OctahedronGeometry(0.2), '#ffffff', { p: [Math.cos(k * 2.4) * 1.15, 2.2 + Math.sin(k * 1.7) * 0.6, Math.sin(k * 2.4) * 1.15] }))),
      leaf: (() => { const P = [], C = []; for (let k = 0; k < 14; k++) { const a0 = k / 14 * Math.PI * 2, a1 = (k + 1) / 14 * Math.PI * 2, r0 = 0.75 + 0.25 * Math.sin(k * 2.3), r1 = 0.75 + 0.25 * Math.sin((k + 1) * 2.3); P.push(0, 0, 0, Math.cos(a1) * r1, 0, -Math.sin(a1) * r1, Math.cos(a0) * r0, 0, -Math.sin(a0) * r0); for (let t = 0; t < 3; t++) C.push(1, 1, 1); } return triGeo(P, C); })(),
    };
    return GEO;
  }
  const SEASON_COL = { // per seizoen [riet, -, wilgkroon, fruitkroon, fruitstip|null, lelie]
    zomer: ['#6f9a45', '', '#8fa66f', '#5f9a48', null, '#4c7c3a'],
    herfst: ['#b9a45e', '', '#b3a65a', '#9aa345', '#c8322a', '#7a7a3a'],
    winter: ['#bfae86', '', null, null, null, null],
    lente: ['#8fb35a', '', '#b5cc7e', '#f3eef0', '#f2b6c8', '#5f9046'],
  };
  const jitter = (hex, r, a = 0.08) => { const c = new THREE.Color(hex); c.offsetHSL((r() - 0.5) * a * 0.5, 0, (r() - 0.5) * a); return c; };

  // ---------- per vak bouwen ----------
  const BUILD = {
    beek(key, B) { // Geleenbeek: bed 5,2 m + rietkraag 3 m + knotwilgen om de ±11 m buiten de bebouwing
      const P = [], C = [], WP = [], WC = [], stam = [], kroon = [], reeds = [], r = rng(B[0] * 7 + B[1]);
      const bank = col3('#6f9150'), rk = col3('#8aa25b'), wat = col3('#4f8fb8');
      for (const ln of LN) { if (!hit(ln.bb, B)) continue;
        const n = ln.p.length / 2;
        for (let k = 0; k < n - 1; k++) {
          const x = ln.p[k * 2], y = ln.p[k * 2 + 1]; if (!inC(x, y, B)) continue;
          const x2 = ln.p[k * 2 + 2], y2 = ln.p[k * 2 + 3], s1 = sideAt(ln, k), s2 = sideAt(ln, k + 1), h1 = hAt(x, y); if (h1 == null) continue; const h2 = hAt(x2, y2) ?? h1;
          const q = (xx, yy, s, d, h, up) => [xx + s[0] * d - O[0], h + up, -(yy + s[1] * d - O[1])];
          { const a = q(x, y, s1, -2.6, h1, 0.32), b = q(x, y, s1, 2.6, h1, 0.32), c = q(x2, y2, s2, 2.6, h2, 0.32), e = q(x2, y2, s2, -2.6, h2, 0.32); WP.push(...a, ...b, ...c, ...a, ...c, ...e); for (let t = 0; t < 6; t++) WC.push(...wat); }
          for (const sd of [1, -1]) for (const [d0, d1, cc] of [[2.6, 3.4, bank], [3.4, 6.8, rk]]) {
            const a = q(x, y, s1, d0 * sd, h1, 0.27), b = q(x, y, s1, d1 * sd, h1, 0.27), c = q(x2, y2, s2, d1 * sd, h2, 0.27), e = q(x2, y2, s2, d0 * sd, h2, 0.27);
            P.push(...a, ...b, ...c, ...a, ...c, ...e); for (let t = 0; t < 6; t++) C.push(...cc);
            if (r() < 0.8) { const d = (3.2 + r() * 3.2) * sd; reeds.push({ m: mtx(x + s1[0] * d, y + s1[1] * d, h1, r() * 6.3, 1.3 * (0.8 + r() * 0.5)), c: new THREE.Color(1, 1, 1).offsetHSL(0, 0, (r() - 0.5) * 0.2) }); }
          }
          const sc = Math.round(ln.cum[k] / 11);
          if (Math.round(ln.cum[k + 1] / 11) !== sc) { const sd = sc % 2 ? 1 : -1, d = 8.2 * sd, wx = x + s1[0] * d, wy = y + s1[1] * d;
            if (!inBuilt(wx, wy)) { const hh = hAt(wx, wy) ?? h1, m = mtx(wx, wy, hh, r() * 6.3, 1.35 * (0.85 + r() * 0.3)); stam.push({ m }); kroon.push({ m, c: new THREE.Color(1, 1, 1).offsetHSL(0, 0, (r() - 0.5) * 0.12) }); } }
        }
      }
      if (!WP.length) return null;
      const grp = new THREE.Group(), w = new THREE.Mesh(triGeo(WP, WC), WATER), f = new THREE.Mesh(triGeo(P, C), FLAT); w.receiveShadow = f.receiveShadow = true; grp.add(w, f);
      const seas = [];
      if (reeds.length) { const im = inst(GEO.reed, MAT, reeds); grp.add(im); seas.push({ im, slot: 0 }); }
      if (stam.length) { grp.add(dry(inst(GEO.wilgStam, MAT, stam, true))); const im = dry(inst(GEO.wilgKroon, MAT, kroon, true)); grp.add(im); seas.push({ im, slot: 2 }); }
      return { grp, seas };
    },
    vijver(key, B) { // vijvers: rietkraag op ±40% van de oever, waterlelies langs de rand, eenden, fontein in grote vijvers
      const reeds = [], pads = [], flowers = [], ducks = [], fount = [], r = rng(B[0] + B[1] * 3);
      for (const pd of PONDS) {
        const cx = (pd.bb[0] + pd.bb[2]) / 2, cy = (pd.bb[1] + pd.bb[3]) / 2; if (!inC(cx, cy, B)) continue;
        const R = pd.r, n = R.length / 2; let hs = 1e9; for (let k = 0; k < R.length; k += 2) { const h = hAt(R[k], R[k + 1]); if (h != null) hs = Math.min(hs, h); } if (hs > 1e8) continue;
        let per = 0; const seg = []; for (let k = 0; k < n - 1; k++) { const d = Math.hypot(R[k * 2 + 2] - R[k * 2], R[k * 2 + 3] - R[k * 2 + 1]); seg.push([per, d]); per += d; }
        const st = r() * per, ln = per * 0.4;
        for (let s = 0; s < per; s += 1.6) {
          if (((s - st + per) % per) >= ln) continue;
          let k = 0; while (k < seg.length - 1 && seg[k][0] + seg[k][1] < s) k++;
          const t = (s - seg[k][0]) / (seg[k][1] || 1), x = R[k * 2] + (R[k * 2 + 2] - R[k * 2]) * t, y = R[k * 2 + 1] + (R[k * 2 + 3] - R[k * 2 + 1]) * t;
          const nx = R[k * 2 + 3] - R[k * 2 + 1], ny = -(R[k * 2 + 2] - R[k * 2]), nl = Math.hypot(nx, ny) || 1, inw = pip(x + nx / nl, y + ny / nl, R) ? 1 : -1, d = (r() - 0.3) * 1.6 * inw;
          reeds.push({ m: mtx(x + nx / nl * d, y + ny / nl * d, hs, r() * 6.3, 1.25 * (0.7 + r() * 0.5)), c: new THREE.Color(1, 1, 1).offsetHSL(0, 0, (r() - 0.5) * 0.2) });
        }
        const np = Math.min(36, Math.floor(pd.a / 70));
        for (let t = 0, tries = 0; t < np && tries < np * 12; tries++) {
          const x = pd.bb[0] + r() * (pd.bb[2] - pd.bb[0]), y = pd.bb[1] + r() * (pd.bb[3] - pd.bb[1]); if (!pip(x, y, R)) continue;
          let dm = 1e9; for (let k = 0; k < n - 1; k++) { const ax = R[k * 2], ay = R[k * 2 + 1], bx = R[k * 2 + 2], by = R[k * 2 + 3], L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)); dm = Math.min(dm, Math.hypot(ax + (bx - ax) * u - x, ay + (by - ay) * u - y)); }
          if (dm < 1.2 || dm > 7) continue;
          const sc = 0.7 + r() * 0.6; pads.push({ m: mtx(x, y, hs + 0.32, r() * 6.3, sc * 1.4, 1), c: new THREE.Color(1, 1, 1).offsetHSL(0, 0, (r() - 0.5) * 0.15) });
          if (r() < 0.35) flowers.push({ m: mtx(x, y, hs + 0.32, r() * 6.3, 1.5), c: new THREE.Color(r() < 0.6 ? '#fbf6ee' : '#f2a6c0') }); t++;
        }
        if (pd.a > 350) for (let t = 0, tries = 0; t < Math.min(6, 2 + pd.a / 600) && tries < 40; tries++) {
          const x = pd.bb[0] + r() * (pd.bb[2] - pd.bb[0]), y = pd.bb[1] + r() * (pd.bb[3] - pd.bb[1]); if (!pip(x, y, R)) continue;
          ducks.push({ m: mtx(x, y, hs + 0.3, r() * 6.3, 2), c: new THREE.Color(r() < 0.5 ? '#8a6a4a' : '#f4f1ea') }); t++;
        }
        if (pd.a > 1800) { let sx = 0, sy = 0; for (let k = 0; k < R.length; k += 2) { sx += R[k]; sy += R[k + 1]; } sx /= n; sy /= n; if (pip(sx, sy, R)) fount.push({ m: mtx(sx, sy, hs + 0.2, 0, 1.4) }); }
      }
      if (!reeds.length && !pads.length) return null;
      const grp = new THREE.Group(), seas = [];
      if (reeds.length) { const im = inst(GEO.reed, MAT, reeds); grp.add(im); seas.push({ im, slot: 0 }); }
      if (pads.length) { const im = inst(GEO.pad, FLAT, pads); grp.add(im); seas.push({ im, slot: 5 }); }
      if (flowers.length) { const im = inst(GEO.flower, MAT, flowers); grp.add(im); seas.push({ im, slot: 5, keep: true }); }
      if (ducks.length) grp.add(inst(GEO.duck, MAT, ducks, true));
      if (fount.length) grp.add(inst(GEO.fountain, MAT, fount, true));
      return { grp, seas };
    },
    gaard(key, B) { // boomgaarden: rijen langs de langste zijde, 9 × 6 m (echte boomgaard, posities verzonnen)
      const stam = [], kroon = [], stip = [], r = rng(B[0] * 13 + B[1]);
      for (const o of ORCH) { if (!hit(o.bb, B)) continue;
        const R = o.r; let best = 0, ang = 0; for (let k = 0; k + 3 < R.length; k += 2) { const d = Math.hypot(R[k + 2] - R[k], R[k + 3] - R[k + 1]); if (d > best) { best = d; ang = Math.atan2(R[k + 3] - R[k + 1], R[k + 2] - R[k]); } }
        const c = Math.cos(ang), s = Math.sin(ang), cx = (o.bb[0] + o.bb[2]) / 2, cy = (o.bb[1] + o.bb[3]) / 2, ext = Math.hypot(o.bb[2] - o.bb[0], o.bb[3] - o.bb[1]) / 2;
        for (let v = -ext; v <= ext; v += 9) for (let u = -ext; u <= ext; u += 6) {
          const x = cx + u * c - v * s + (r() - 0.5) * 0.8, y = cy + u * s + v * c + (r() - 0.5) * 0.8;
          if (!inC(x, y, B) || !pip(x, y, R)) continue; let e = false; for (let k = 0; k + 1 < R.length && !e; k += 2) e = Math.hypot(R[k] - x, R[k + 1] - y) < 3; if (e) continue;
          const h = hAt(x, y); if (h == null) continue;
          const m = mtx(x, y, h, r() * 6.3, 1.3 * (0.8 + r() * 0.35)), cc = new THREE.Color(1, 1, 1).offsetHSL(0, 0, (r() - 0.5) * 0.14);
          stam.push({ m }); kroon.push({ m, c: cc }); stip.push({ m, c: cc });
        }
      }
      if (!stam.length) return null;
      const grp = new THREE.Group(), seas = [];
      grp.add(dry(inst(GEO.fruitStam, MAT, stam, true)));
      const k1 = dry(inst(GEO.fruitKroon, MAT, kroon, true)); grp.add(k1); seas.push({ im: k1, slot: 3 });
      const k2 = dry(inst(GEO.fruitStip, MAT, stip)); grp.add(k2); seas.push({ im: k2, slot: 4 });
      return { grp, seas };
    },
    blad(key, B) { // bladtapijt onder echte loofbomen (OSM/props), alleen herfst; niet op water
      const L = [], r = rng(B[0] + 5 * B[1]), PAL = ['#a8471f', '#c46a1c', '#d9a02a', '#8e3a1c', '#b7822a', '#c9b04a'];
      for (const [x, y, th] of TREES) { if (!inC(x, y, B) || H.waterNear?.(x, y)) continue; const h = hAt(x, y); if (h == null) continue;
        L.push({ m: mtx(x + (r() - 0.5) * 1.2, y + (r() - 0.5) * 1.2, h + 0.22, r() * 6.3, Math.min(5, 2 + th * 0.17) * (0.85 + r() * 0.3), 1), c: jitter(PAL[Math.floor(r() * PAL.length)], r, 0.1) }); }
      if (!L.length) return null;
      const grp = new THREE.Group(), im = inst(GEO.leaf, FLAT, L); grp.add(im);
      return { grp, seas: [{ im, slot: 6 }] };
    },
  };
  function seasonApply(e) { // kleuren per seizoen (instanceColor × vaste basiskleur): riet, wilg, fruit, lelies; bladtapijt alleen herfst
    const sz = season(), T = SEASON_COL[sz] || SEASON_COL.zomer;
    for (const s of e.seas) {
      if (s.slot === 6) { s.im.visible = sz === 'herfst'; continue; }
      if (s.keep) { s.im.visible = sz === 'zomer'; continue; } // waterlelies bloeien in de zomer
      const hex = T[s.slot];
      if (!hex) { s.im.visible = false; continue; }
      s.im.visible = true;
      if (!s.base) s.base = new Float32Array(s.im.instanceColor ? s.im.instanceColor.array : 0);
      if (s.im.instanceColor) { const c = new THREE.Color(hex), A = s.im.instanceColor.array, Bs = s.base; for (let k = 0; k < A.length; k += 3) { A[k] = Bs[k] * c.r; A[k + 1] = Bs[k + 1] * c.g; A[k + 2] = Bs[k + 2] * c.b; } s.im.instanceColor.needsUpdate = true; }
    }
  }

  // ---------- besturing: bouwen/zichtbaarheid op een timer (0,7 s), max 8 vakken per keer ----------
  const CH = { beek: new Map(), vijver: new Map(), gaard: new Map(), blad: new Map() }; // soort → vak → {grp, seas} | null
  let ROOT = null, seasonK = '', shown = null;
  function scan() {
    if (!O) { O = H.areaInfo?.origin; KM = H.areaInfo?.km || 1000; if (!O) return; }
    const want = iso(); let dirty = false;
    if (ROOT && shown !== want) { shown = ROOT.visible = want; dirty = true; }
    if (want && prep()) {
      mats(); geos();
      if (!ROOT) { ROOT = new THREE.Group(); ROOT.name = 'groen'; H.scene.add(ROOT); shown = true; }
      const [tx, ty] = H.target(); let built = 0;
      const todo = [...H.chunks].filter(([key, c]) => c.dem && !CH.blad.has(key)).map(([key]) => { const B = chunkBox(key); return [key, B, Math.hypot((B[0] + B[2]) / 2 - tx, (B[1] + B[3]) / 2 - ty)]; }).sort((a, b) => a[2] - b[2]);
      for (const [key, B] of todo) {
        if (built >= 8) break;
        for (const k in CH) { if (CH[k].has(key)) continue; const e = BUILD[k](key, B); CH[k].set(key, e); if (e) { ROOT.add(e.grp); seasonApply(e); dirty = true; } }
        built++;
      }
      const sz = season(); if (sz !== seasonK) { seasonK = sz; for (const k in CH) for (const e of CH[k].values()) if (e) seasonApply(e); dirty = true; }
    }
    if (dirty) { H.shadowDirty?.(); H.redraw(); }
  }
  setInterval(scan, 700);
})();
