// iso/farm.js — aankleding van landbouwpercelen (BRP-gewassen uit data/ground.js → G.crop): boomgaard, wijngaard, kerstbomen,
// houtwallen, koeien/schapen op grasland, ronde balen op graan (herfst) + gestapelde ingepakte balen (herfst/winter).
// Stijl en techniek als iso/props.js (merge-helpers, vertexkleur + aTint, InstancedMesh per soort per km-vak, LoD via H3D.on('detail'),
// seizoen via H3D.on('season')). Ontbreekt G.crop (oude ground.js) → doet niets.
(() => {
  const GD = window.H3D_DATA?.ground;
  if (!GD?.crop || typeof H3D === 'undefined' || !H3D.on) return; // H3D = const in app.js (geen window-eigenschap)
  const H = H3D;
  const CROPS = ['grasland', 'graan', 'mais', 'bieten', 'aardappel', 'akker', 'fruit', 'wijn', 'kerst', 'natuur', 'heg', 'houtwal', 'graft', 'water'];
  const CI = Object.fromEntries(CROPS.map((n, i) => [n, i]));
  const MAXN = 3000;   // max instanties per soort per km-vak
  const MAXHERD = 60;  // max kuddes per vak

  // ---------- bouwstenen (zoals props.js) ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const flat = g => g.index ? g.toNonIndexed() : g;
  function part(g, c, o = {}) {
    g = flat(g);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r || [0, 0, 0])));
    g.applyMatrix4(new THREE.Matrix4().compose(V3(...(o.p || [0, 0, 0])), q, V3(...(o.s || [1, 1, 1]))));
    return { g, c: new THREE.Color(c), tint: o.tint === true ? 1 : (o.tint || 0) };
  }
  const bx0 = (w, h, d) => { const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), I = Array.from(g.index.array); I.splice(18, 6); g.setIndex(I); return g; }; // voet op 0, zonder onderkant
  const cyl = (r0, r1, h, s = 6) => new THREE.CylinderGeometry(r1, r0, h, s).translate(0, h / 2, 0);
  const cone = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s).translate(0, h / 2, 0);
  const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
  function merge(parts) {
    const n = parts.reduce((t, p) => t + p.g.attributes.position.count, 0);
    const Pp = new Float32Array(n * 3), C = new Float32Array(n * 3), T = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      const a = p.g.attributes.position.array, m = a.length / 3; Pp.set(a, o * 3);
      for (let k = 0; k < m; k++) { C[(o + k) * 3] = p.c.r; C[(o + k) * 3 + 1] = p.c.g; C[(o + k) * 3 + 2] = p.c.b; T[o + k] = p.tint; }
      o += m;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(T, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  // ---------- modellen (eenheidsgrootte; schaal per exemplaar) ----------
  let GEO = null;
  function geos() {
    if (GEO) return GEO;
    const W = '#fff', T = { tint: true };
    const treeHi = (cr, tr, ty) => merge([part(cyl(0.05, 0.04, tr, 5), '#5b4330'), part(ico(cr, 0), W, { p: [0, ty, 0], s: [1, 0.9, 1], tint: true })]); // hoogte ±1
    const treeLo = (cr, ty) => merge([part(cone(cr * 1.1, ty + cr, 5), W, { tint: true })]);
    // dieren: lengte ±1,5 m langs +x, voorkant +x
    const cow = (body, spot, head) => {
      const P = [part(bx0(1.5, 0.7, 0.62), body, { p: [0, 0.55, 0] }), part(bx0(0.5, 0.42, 0.42), head, { p: [0.95, 0.9, 0] }), part(bx0(0.14, 0.1, 0.5), '#e8c9b8', { p: [1.18, 0.9, 0] })];
      for (const [x, z] of [[-0.6, -0.22], [-0.6, 0.22], [0.55, -0.22], [0.55, 0.22]]) P.push(part(bx0(0.14, 0.58, 0.14), '#3a3330', { p: [x, 0, z] }));
      if (spot) P.push(part(bx0(0.5, 0.05, 0.5), spot, { p: [-0.25, 1.24, 0.08] }), part(bx0(0.4, 0.05, 0.45), spot, { p: [0.35, 1.24, -0.1] }), part(bx0(0.3, 0.3, 0.64), spot, { p: [-0.7, 0.8, 0] }));
      return merge(P);
    };
    const sheep = merge([part(ico(0.4, 0), '#efeae0', { p: [0, 0.62, 0], s: [1.25, 0.95, 0.9] }), part(bx0(0.22, 0.24, 0.2), '#3d352f', { p: [0.55, 0.55, 0] }),
      ...[[-0.25, -0.15], [-0.25, 0.15], [0.25, -0.15], [0.25, 0.15]].map(([x, z]) => part(bx0(0.08, 0.3, 0.08), '#3d352f', { p: [x, 0, z] }))]);
    const bale = merge([part(cyl(0.75, 0.75, 1.2, 8).rotateZ(Math.PI / 2).translate(0.6, 0.75, 0), W, { tint: true })]); // Ø1,5 op zijn kant, as langs x
    const wrapG = cyl(0.75, 0.75, 1.2, 8).rotateZ(Math.PI / 2).translate(0.6, 0, 0);
    const stack = []; // 3 + 2 ingepakte balen (witte folie), één mesh
    for (const [z, y] of [[-1.6, 0.75], [0, 0.75], [1.6, 0.75], [-0.8, 2.0], [0.8, 2.0]]) stack.push(part(wrapG.clone(), '#e4edf2', { p: [0, y, z] }));
    const vine = merge([part(bx0(1, 1, 1), W, { tint: true })]); // schaal (lengte, 1,4, 0,5)
    GEO = {
      fruitHi: treeHi(0.45, 0.3, 0.62), fruitLo: treeLo(0.45, 0.4),
      wood: merge([part(cyl(0.05, 0.04, 0.4, 5), '#5b4330'), part(ico(0.34, 0), W, { p: [0, 0.68, 0], s: [1, 1.15, 1], tint: true })]), woodLo: treeLo(0.34, 0.5),
      xmas: merge([part(cone(0.3, 1, 5), W, { tint: true })]),
      vine, cowZ: cow('#f2efe8', '#1f1d1d', '#1f1d1d'), cowR: cow('#8c3d22', '#f2efe8', '#f2efe8'), sheep, bale, stack: merge(stack)
    };
    return GEO;
  }

  // ---------- materiaal (kleur per exemplaar alleen waar aTint = 1) ----------
  let FMAT = null;
  function mats() {
    if (FMAT) return;
    FMAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    FMAT.onBeforeCompile = s => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTint;')
        .replace('#include <color_vertex>', `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
        vColor.rgb = mix(color, vColor.rgb, aTint);
        #endif`);
      H.seasonize?.(s, 'leaf'); // blad kleurt mee met het seizoen (alleen waar groen domineert)
    };
    H.celify(FMAT, 'farm');
  }

  // ---------- percelen: eenmalig uit G.crop decoderen ----------
  let PERC = null;
  function percelen() {
    if (PERC) return PERC;
    const O = H.areaInfo.origin, q = GD.q || 0.5; PERC = [];
    GD.crop.forEach((e, idx) => {
      const [cls, rings, ang] = e; if (!rings?.length) return;
      const R = rings.map(a => { const r = new Float64Array(a.length); let x = 0, y = 0; for (let k = 0; k + 1 < a.length; k += 2) { x += a[k]; y += a[k + 1]; r[k] = O[0] + x * q; r[k + 1] = O[1] + y * q; } return r; });
      const o = R[0]; let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12, A = 0, n = o.length / 2;
      for (let k = 0; k < n; k++) { const x = o[k * 2], y = o[k * 2 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); const j = (k + 1) % n; A += x * o[j * 2 + 1] - o[j * 2] * y; }
      PERC.push({ idx, cls, R, ang: (ang || 0) / 1000, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, area: Math.abs(A) / 2 });
    });
    return PERC;
  }
  function inside(p, x, y) { // even-odd over alle ringen
    let c = false;
    for (const r of p.R) for (let a = 0, b = r.length / 2 - 1, n = r.length / 2; a < n; b = a++) {
      const xa = r[a * 2], ya = r[a * 2 + 1], xb = r[b * 2], yb = r[b * 2 + 1];
      if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) c = !c;
    }
    return c;
  }
  const inset = (p, x, y, m) => inside(p, x, y) && inside(p, x + m, y) && inside(p, x - m, y) && inside(p, x, y + m) && inside(p, x, y - m);

  // ---------- seizoen ----------
  const sOK = (kind, s) => kind === 'dier' ? s !== 'winter' : kind === 'bal' ? s === 'herfst' : kind === 'wrap' ? (s === 'herfst' || s === 'winter') : true;

  // ---------- per vak ----------
  const VAK = []; // { c, group, trees: [im], small: [im] }
  H.farmVak = VAK;
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color(), UP = V3(0, 1, 0);

  function build(c) {
    if (c.farm) return; c.farm = true;
    const km = H.areaInfo.km, O = H.areaInfo.origin;
    const mine = percelen().filter(p => p.cx >= c.x0 && p.cx < c.x0 + km && p.cy >= c.y0 && p.cy < c.y0 + km);
    if (!mine.length) return;
    mats(); const G = geos(), season = H.getSeason?.() || 'zomer';
    const hAt = (x, y) => H.heightAt(Math.min(c.x0 + km - 0.01, Math.max(c.x0, x)), Math.min(c.y0 + km - 0.01, Math.max(c.y0, y)));
    const L = { fruit: [], wood: [], xmas: [], vine: [], cowZ: [], cowR: [], sheep: [], bale: [], stack: [] }; // item = [x, y, hoek, schaalx, schaaly, schaalz, kleurHSL|null]
    const cnt = k => L[k].length;
    const greenFruit = r => [0.24 + r() * 0.07, 0.4 + r() * 0.15, 0.3 + r() * 0.1];
    const greenWood = r => [0.22 + r() * 0.09, 0.42 + r() * 0.14, 0.27 + r() * 0.1];
    const greenXmas = r => [0.36 + r() * 0.04, 0.45, 0.17 + r() * 0.05];
    let herds = 0;

    for (const p of mine) {
      let s = ((p.idx + 1) * 2654435761 ^ Math.floor(p.cx * 7)) >>> 0 || 1; // deterministisch per perceel
      const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const cu = Math.cos(p.ang), su = Math.sin(p.ang);
      // frame (u langs lange as, v dwars) over de bbox van de buitenring
      let u0 = 1e12, u1 = -1e12, v0 = 1e12, v1 = -1e12; const o = p.R[0];
      for (let k = 0; k < o.length; k += 2) { const u = o[k] * cu + o[k + 1] * su, v = -o[k] * su + o[k + 1] * cu; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const xy = (u, v) => [u * cu - v * su, u * su + v * cu];
      const grid = (du, dv, m, fn) => { // punten in rijen langs u (rij om de dv, in de rij om de du)
        for (let v = v0 + m + r() * dv; v < v1 - m; v += dv) for (let u = u0 + m + r() * du; u < u1 - m; u += du) { const [x, y] = xy(u, v); if (inset(p, x, y, m)) fn(x, y, u, v); }
      };
      const cls = p.cls;
      if (cls === CI.fruit && cnt('fruit') < MAXN) {
        grid(4, 6, 1, (x, y) => { if (cnt('fruit') >= MAXN) return; const h = 2.9 + r() * 0.9; L.fruit.push([x, y, r() * 6.28, h * (0.9 + r() * 0.2), h, h * (0.9 + r() * 0.2), greenFruit(r)]); });
      } else if (cls === CI.kerst && cnt('xmas') < MAXN) {
        grid(2.6, 2.6, 0.8, (x, y) => { if (cnt('xmas') >= MAXN || r() < 0.12) return; const h = 1 + r() * 1.5; L.xmas.push([x, y, r() * 6.28, h, h, h, greenXmas(r)]); });
      } else if (cls === CI.wijn && cnt('vine') < MAXN) {
        for (let v = v0 + 1 + r() * 1.2; v < v1 - 1; v += 2.5) { // rij ranken: aaneengesloten stukken binnen het perceel, max 6 m per blok
          let run = null;
          const flush = () => { if (run && run[1] - run[0] > 0.8 && cnt('vine') < MAXN) { const um = (run[0] + run[1]) / 2, [x, y] = xy(um, v); L.vine.push([x, y, -p.ang, run[1] - run[0], 1.4, 0.5, [0.25 + r() * 0.05, 0.42 + r() * 0.1, 0.3 + r() * 0.06]]); } run = null; };
          for (let u = u0; u <= u1; u += 1) {
            const [x, y] = xy(u, v);
            if (inset(p, x, y, 0.8)) { if (!run) run = [u, u]; run[1] = u; if (run[1] - run[0] >= 6) flush(); } else flush();
          }
          flush();
        }
      } else if (cls === CI.houtwal && cnt('wood') < MAXN) {
        // langs de rand van de buitenring, ±1,5 m naar binnen, om de ±7 m
        const n = o.length / 2; let carry = r() * 7;
        for (let k = 0; k < n && cnt('wood') < MAXN; k++) {
          const j = (k + 1) % n, ax = o[k * 2], ay = o[k * 2 + 1], bx = o[j * 2], by = o[j * 2 + 1], len = Math.hypot(bx - ax, by - ay); if (len < 0.5) continue;
          const dx = (bx - ax) / len, dy = (by - ay) / len;
          for (let t = carry; t < len; t += 7 + r() * 1.5) {
            const px = ax + dx * t, py = ay + dy * t; let ok = null;
            for (const sd of [1.5, -1.5]) { const x = px - dy * sd, y = py + dx * sd; if (inside(p, x, y)) { ok = [x, y]; break; } }
            if (!ok || r() < 0.08) continue;
            const h = 8 + r() * 4;
            L.wood.push([ok[0] + (r() - 0.5), ok[1] + (r() - 0.5), r() * 6.28, h * (0.85 + r() * 0.3), h, h * (0.85 + r() * 0.3), greenWood(r)]);
            carry = t + 7 - len;
          }
          carry = Math.max(0, carry);
        }
      } else if (cls === CI.grasland && p.area > 5000 && herds < MAXHERD && r() < 0.4) {
        let tries = 0, cx = 0, cy = 0, ok = false;
        while (tries++ < 20 && !ok) { cx = p.x0 + r() * (p.x1 - p.x0); cy = p.y0 + r() * (p.y1 - p.y0); ok = inset(p, cx, cy, 6); }
        if (ok) {
          herds++;
          const kind = r() < 0.7 ? (r() < 0.6 ? 'cowZ' : 'cowR') : 'sheep', mix = kind !== 'sheep' && r() < 0.25, n = 4 + Math.floor(r() * 9), rad = kind === 'sheep' ? 6 : 9;
          for (let k = 0; k < n; k++) {
            const a = r() * 6.28, d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
            if (!inset(p, x, y, 1.5)) continue;
            const kk = mix && k % 3 === 0 ? (kind === 'cowZ' ? 'cowR' : 'cowZ') : kind, z = 0.9 + r() * 0.2;
            if (cnt(kk) < MAXN) L[kk].push([x, y, r() * 6.28, z, z, z, null]);
          }
        }
        // een paar stapels ingepakte balen aan de rand (herfst/winter)
        if (p.area > 8000 && r() < 0.25 && cnt('stack') < MAXN) { const [x, y] = xy(u0 + 6, v0 + (v1 - v0) * (0.2 + r() * 0.6)); if (inset(p, x, y, 4)) L.stack.push([x, y, -p.ang + (r() - 0.5) * 0.3, 1, 1, 1, null]); }
      } else if (cls === CI.graan && p.area > 4000) {
        // ronde balen: rijen langs u, om de ±14 m, niet overal
        let n = 0;
        for (let v = v0 + 6 + r() * 6; v < v1 - 6 && n < 60; v += 20 + r() * 8) for (let u = u0 + 8 + r() * 8; u < u1 - 8 && n < 60; u += 12 + r() * 6) {
          if (r() < 0.4) continue; const [x, y] = xy(u, v);
          if (inset(p, x, y, 2) && cnt('bale') < MAXN) { n++; L.bale.push([x, y, -p.ang + (r() - 0.5) * 0.15, 1, 1, 1, null]); }
        }
        if (p.area > 8000 && r() < 0.2 && cnt('stack') < MAXN) { const [x, y] = xy(u0 + 6, v0 + (v1 - v0) * (0.2 + r() * 0.6)); if (inset(p, x, y, 4)) L.stack.push([x, y, -p.ang, 1, 1, 1, null]); }
      }
    }

    if (H.roadNear) for (const k of ['fruit', 'wood', 'xmas']) L[k] = L[k].filter(t => !H.roadNear(t[0], t[1], 0.5, true)); // niet midden op een weg (perceelrand over een weg heen)
    // bomen/ranken: willekeurige volgorde → count verlagen = gelijkmatig uitdunnen
    let seed = (c.i * 73856093 ^ c.j * 19349663) & 0x7fffffff || 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (const k of ['fruit', 'wood', 'xmas', 'vine']) { const a = L[k]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

    const group = new THREE.Group(), v = { c, group, trees: [], small: [] };
    const inst = (geo, list, y0) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, FMAT, list.length);
      list.forEach((it, i) => {
        ps.set(it[0] - O[0], hAt(it[0], it[1]) + y0, -(it[1] - O[1])); qq.setFromAxisAngle(UP, it[2]); sc.set(it[3], it[4], it[5]);
        im.setMatrixAt(i, m4.compose(ps, qq, sc));
        if (it[6]) col.setHSL(...it[6]); else col.set('#ffffff'); im.setColorAt(i, col);
      });
      im.full = list.length; im.computeBoundingSphere(); group.add(im);
      return im;
    };
    // hoek: model-x langs RD-hoek a → om y draaien = −a (z = −noord)
    const tree = (geoHi, geoLo, list) => { const im = inst(geoHi, list, -0.15); if (im) { im.geoHi = geoHi; im.geoLo = geoLo; v.trees.push(im); } };
    tree(G.fruitHi, G.fruitLo, L.fruit); tree(G.wood, G.woodLo, L.wood);
    const xm = inst(G.xmas, L.xmas, -0.05); if (xm) { xm.geoHi = xm.geoLo = G.xmas; v.trees.push(xm); }
    const vi = inst(G.vine, L.vine, -0.05); if (vi) { vi.geoHi = vi.geoLo = G.vine; v.trees.push(vi); }
    for (const [k, kind, y0] of [['cowZ', 'dier', 0], ['cowR', 'dier', 0], ['sheep', 'dier', 0], ['bale', 'bal', 0], ['stack', 'wrap', 0]]) {
      const im = inst(G[k], L[k], y0 - 0.05); if (im) { im.userData.kind = kind; im.userData.sOK = sOK(kind, season); v.small.push(im); }
    }
    if (!v.trees.length && !v.small.length) return;
    H.scene.add(H.freeze ? H.freeze(group) : group); VAK.push(v);
    detail(v); H.shadowDirty();
  }

  // ---------- uitdunnen naar afstand (zoals props.js) ----------
  function detail(v) {
    const d = H.chunkDist(v.c) * H.lens();
    const f = d < 1800 ? 1 : d < 4000 ? 1 / 3 : 0, cast = d < 1100, lo = !!H.treeLo?.(d); let ch = false;
    for (const im of v.trees) {
      const g = lo ? im.geoLo : im.geoHi; if (im.geometry !== g) { im.geometry = g; ch = true; }
      const n = Math.round(im.full * f); if (im.count !== n) { im.count = n; ch = true; }
      if (im.castShadow !== cast) { im.castShadow = cast; ch = true; }
    }
    const near = d < 2200 && !lo; // dieren en balen: klein → ver weg (laag-model-zoom) verborgen
    for (const im of v.small) {
      const vis = near && im.userData.sOK !== false; if (im.visible !== vis) { im.visible = vis; ch = true; }
      if (im.castShadow) { im.castShadow = false; ch = true; } // dieren/balen: te klein voor schaduw (scheelt schaduwpass)
    }
    v.group.visible = d < 6000 && (H.fxOn?.('props') ?? true);
    return ch;
  }
  H.on('detail', () => { let ch = false; for (const v of VAK) ch = detail(v) || ch; if (ch) H.shadowDirty(); });
  H.on('fx', k => { if (k !== 'props') return; for (const v of VAK) detail(v); H.shadowDirty(); });
  H.on('season', k => {
    for (const v of VAK) for (const im of v.small) im.userData.sOK = sOK(im.userData.kind, k);
    for (const v of VAK) detail(v);
    H.shadowDirty();
  });

  H.on('chunk', build);
  if (H.chunks) for (const c of H.chunks.values()) if (c.dem) build(c); // vakken die er al waren
})();
