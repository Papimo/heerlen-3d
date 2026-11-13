// iso/bridges.js — bruggen in 3D (alleen iso). Leest de brug-lijnen (bridge === 1) uit H3D_DATA.ground.line, bouwt per km-vak één mesh:
// dek (dikte 0,8 m, betonzijkanten, asfalttop) + borstwering 0,9 m + pijlers om de ±20 m waar het terrein >2,5 m onder het dek ligt.
// Dekhoogte lineair (naar booglengte) tussen terreinhoogte aan de eindpunten (H.heightAt, zoals ribbonGeo in app.js). Bouwt pas als alle vakken van de brug terrein hebben.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null, GD = window.H3D_DATA?.ground;
  if (!H || !H.on || !GD?.line) return;
  // ground.js prep() leegt GD.line → nu al kopiëren (alleen de ruwe records; decoderen pas bij bouwen)
  const RAW = GD.line.filter(l => l[2] === 1 && l[0] !== 'beek' && l[0] !== 'zand').map(l => ({ c: l[0], w: l[1] / 10, d: l[3] }));
  if (!RAW.length) return;
  // wat er ónder de bruggen ligt (weg, spoor, pad, beek): stukken in een raster van 50 m, alleen rond de bruggen → pijlers niet op de weg (?pilold = oud)
  const UC = 50, UNDER = new Map(), PILOLD = new URLSearchParams(location.search).has('pilold');
  if (!PILOLD) {
    const near = new Set(), qq = GD.q, cell = v => Math.floor(v / UC);
    for (const r of RAW) { // vakjes langs elke brug (+1 rondom)
      let x = 0, y = 0, px = 0, py = 0;
      for (let k = 0; k < r.d.length; k += 2) {
        x += r.d[k] * qq; y += r.d[k + 1] * qq;
        const m = k ? Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 25)) : 1;
        for (let j = 1; j <= m; j++) { const gx = cell(px + (x - px) * j / m), gy = cell(py + (y - py) * j / m); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) near.add((gx + a) + ',' + (gy + b)); }
        px = x; py = y;
      }
    }
    for (const l of GD.line) {
      if (l[2] || l[0] === 'zand') continue;
      const d = l[3], hw = Math.max(l[1] / 20, /spoor|tram/.test(l[0]) ? 2 : 1); let x = 0, y = 0, px = 0, py = 0;
      for (let k = 0; k < d.length; k += 2) {
        x += d[k] * qq; y += d[k + 1] * qq;
        if (k) {
          const x0 = cell(Math.min(x, px)), x1 = cell(Math.max(x, px)), y0 = cell(Math.min(y, py)), y1 = cell(Math.max(y, py)); let sg = null;
          for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const kk = gx + ',' + gy; if (!near.has(kk)) continue; sg ||= [px, py, x, y, hw]; (UNDER.get(kk) || UNDER.set(kk, []).get(kk)).push(sg); }
        }
        px = x; py = y;
      }
    }
  }
  // pijler op (rx, ry) (m t.o.v. origin) met brugrichting (ux, uy): staat hij op iets wat eronderdoor loopt? Stukken die (bijna) meelopen met de brug tellen niet (stoep/fietsstrook óp de brug)
  function blocked(rx, ry, ux, uy) {
    const gx = Math.floor(rx / UC), gy = Math.floor(ry / UC);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const g of UNDER.get((gx + a) + ',' + (gy + b)) || []) {
      const dx = g[2] - g[0], dy = g[3] - g[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((rx - g[0]) * dx + (ry - g[1]) * dy) / L2));
      if (Math.hypot(rx - g[0] - dx * t, ry - g[1] - dy * t) > g[4] + 1.8) continue; // 1,8 m = halve kolom + marge
      if (Math.abs(dx * ux + dy * uy) / Math.sqrt(L2) > 0.94) continue;
      return true;
    }
    return false;
  }
  const q = GD.q, DECK = 0.8, RAIL = 0.9, STEP = 20, MINGAP = 2.5, TOP = 0.08, RAMP = 8; // TOP: dek ligt iets boven het terrein aan de uiteinden; RAMP: borstwering/dekdikte lopen over zoveel m af
  const COL = { beton: new THREE.Color('#8d8a84'), top: new THREE.Color('#4a4b50'), rail: new THREE.Color('#a9a59d'), spoor: new THREE.Color('#5a5650') };
  // dektop in de asfaltkleur van de weg (= iso/ground.js ST.hw / ST.road.asp), zodat weg en brug in elkaar overlopen
  const TOPC = { snelweg: new THREE.Color('#35383d'), autoweg: new THREE.Color('#45484d') }, STREET = new THREE.Color('#56595f');
  const topOf = c => c === 'spoor' ? COL.spoor : TOPC[c] || (/^(hoofd|weg|straat|erfweg|voet|dienst)$/.test(c) ? STREET : COL.top);
  let O, km, mat, group, BR = null;
  const VAK = new Map(); // vaksleutel → { mesh, n } ; n = aantal gebouwde bruggen
  const key = (x, y) => Math.floor(x / km) + '_' + Math.floor(y / km);
  const hasDem = (x, y) => !!H.chunks.get(key(x, y))?.dem;

  // OSM knipt bruggen in stukken (per overspanning): aaneengesloten stukken van dezelfde soort samenvoegen → één hoogteverloop,
  // anders zakt het dek op elke naad naar het terrein eronder (knik) en staat er midden op de brug een eindkap
  function chain(L) {
    const k = p => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2), ends = new Map();
    L.forEach((b, i) => { for (const p of [b.a[0], b.a[b.a.length - 1]]) { const kk = k(p); (ends.get(kk) || ends.set(kk, []).get(kk)).push(i); } });
    const used = new Set(), out = [];
    const nextAt = (p, cur) => { const l = ends.get(k(p)); if (!l || l.length !== 2) return -1; const j = l[0] === cur ? l[1] : l[0]; return j !== cur && !used.has(j) && L[j].c === L[cur].c ? j : -1; };
    for (let i = 0; i < L.length; i++) {
      if (used.has(i)) continue; used.add(i);
      let a = L[i].a.slice(), w = L[i].w;
      for (const front of [false, true]) {
        let cur = i;
        for (;;) {
          const p = front ? a[0] : a[a.length - 1], j = nextAt(p, cur); if (j < 0) break;
          used.add(j); const b = L[j].a.slice();
          if (front) { if (k(b[0]) === k(p)) b.reverse(); a = b.concat(a.slice(1)); } else { if (k(b[b.length - 1]) === k(p)) b.reverse(); a = a.concat(b.slice(1)); }
          w = Math.max(w, L[j].w); cur = j;
        }
      }
      out.push({ c: L[i].c, w, a });
    }
    return out;
  }
  function prep() { // decoderen naar absolute RD + vaksleutels
    O = H.areaInfo.origin; km = H.areaInfo.km || 1000;
    BR = chain(RAW.map(r => {
      const a = []; let x = 0, y = 0;
      for (let k = 0; k < r.d.length; k += 2) { x += r.d[k]; y += r.d[k + 1]; a.push([O[0] + x * q, O[1] + y * q]); }
      return { c: r.c, w: r.w, a };
    }).filter(b => b.a.length >= 2)).map(b => {
      const ks = new Set(b.a.map(p => key(p[0], p[1]))); // alle vakken die de brug raakt (ook tussenpunten)
      return { ...b, ks: [...ks], v: key(b.a[0][0], b.a[0][1]), done: false };
    });
  }
  // dekhoogte op een punt (RD) voor iso/drive.js: raster 25 m met de stukken van gebouwde bruggen
  const DG = new Map(), DC = 25;
  function deckIndex(b, S, L, hA, hB, hw) {
    for (let i = 0; i + 1 < b.a.length; i++) {
      const [x0, y0] = b.a[i], [x1, y1] = b.a[i + 1], e = { b, i, S, L, hA, hB, hw };
      for (let gx = Math.floor((Math.min(x0, x1) - hw) / DC); gx <= Math.floor((Math.max(x0, x1) + hw) / DC); gx++)
        for (let gy = Math.floor((Math.min(y0, y1) - hw) / DC); gy <= Math.floor((Math.max(y0, y1) + hw) / DC); gy++) { const kk = gx + ',' + gy; (DG.get(kk) || DG.set(kk, []).get(kk)).push(e); }
    }
  }
  function deckAt(x, y) { // → hoogte dektop (scène-y) of null
    let best = null;
    for (const e of DG.get(Math.floor(x / DC) + ',' + Math.floor(y / DC)) || []) {
      const [x0, y0] = e.b.a[e.i], [x1, y1] = e.b.a[e.i + 1], dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
      if (Math.hypot(x0 + dx * t - x, y0 + dy * t - y) > e.hw) continue;
      const h = e.hA + (e.hB - e.hA) * (e.S[e.i] + t * Math.sqrt(l2)) / e.L; if (best === null || h > best) best = h;
    }
    return best;
  }

  function sweep(b) { // → { pos[], col[] } losse driehoeken (wereldruimte, y = scène-hoogte)
    const P = b.a, n = P.length, S = [0];
    for (let i = 1; i < n; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = S[n - 1]; if (L < 3) return null;
    const hA = H.heightAt(P[0][0], P[0][1]) + TOP, hB = H.heightAt(P[n - 1][0], P[n - 1][1]) + TOP;
    const hw = Math.max(1.2, b.w / 2 + 0.25), ri = topOf(b.c), RM = Math.min(RAMP, L / 3);
    deckIndex(b, S, L, hA, hB, hw - 0.25);
    // dwarsprofiel (zijwaarts, hoogte t.o.v. dektop, kleur) als gesloten ring
    const pr = [[-hw, -DECK, COL.beton], [-hw, RAIL, COL.rail], [-hw + 0.25, RAIL, COL.rail], [-hw + 0.25, 0, ri], [hw - 0.25, 0, ri], [hw - 0.25, RAIL, COL.rail], [hw, RAIL, COL.rail], [hw, -DECK, COL.beton]];
    // ring i: pr[i] → pr[i+1]; de laatste (onderkant) sluit terug naar pr[0]
    const ring = [], pos = [], col = [];
    for (let i = 0; i < n; i++) { // zijwaartse richting (gemiddelde van aangrenzende stukken)
      const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(n - 1, i + 1)];
      let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const y = hA + (hB - hA) * S[i] / L, X = P[i][0] - O[0], Z = -(P[i][1] - O[1]);
      // rechts in RD = (dy, -dx); scène z = -y_RD → rechts in scène = (dy, +dx)·(x,z)
      const fr = Math.min(1, S[i] / RM, (L - S[i]) / RM); // aan de uiteinden: borstwering zakt weg, dek wordt dun → loopt in de weg over
      ring.push(pr.map(([s, h]) => [X + dy * s, y + h * (h > 0 ? fr : Math.max(0.12, fr)), Z + dx * s]));
    }
    const tri = (A, B, C, c) => { pos.push(...A, ...B, ...C); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); };
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < pr.length; k++) {
      const k2 = (k + 1) % pr.length, c = pr[k][2];
      tri(ring[i][k], ring[i + 1][k], ring[i + 1][k2], c); tri(ring[i][k], ring[i + 1][k2], ring[i][k2], c);
    }
    // eindkappen (dicht maken): waaier over het profiel
    for (const i of [0, n - 1]) for (let k = 1; k < pr.length - 1; k++) tri(ring[i][0], ring[i][k], ring[i][k + 1], COL.beton);
    // pijlers
    let pil = 0;
    const at = s => { // punt op booglengte s → [x, y, ux, uy]
      let i = 1; while (i < n - 1 && S[i] < s) i++;
      const t = (s - S[i - 1]) / ((S[i] - S[i - 1]) || 1), dx = P[i][0] - P[i - 1][0], dy = P[i][1] - P[i - 1][1], l = Math.hypot(dx, dy) || 1;
      return [P[i - 1][0] + dx * t, P[i - 1][1] + dy * t, dx / l, dy / l];
    };
    for (let s0 = STEP / 2; s0 < L; s0 += STEP) {
      let s = s0, A = at(s0);
      if (!PILOLD && blocked(A[0] - O[0], A[1] - O[1], A[2], A[3])) { // op een weg/spoor eronder: langs de brug opschuiven (berm/middenberm), anders weglaten
        A = null;
        for (const o of [-4, 4, -8, 8]) { const s2 = s0 + o; if (s2 < 1 || s2 > L - 1) continue; const B = at(s2); if (!blocked(B[0] - O[0], B[1] - O[1], B[2], B[3])) { A = B; s = s2; break; } }
        if (!A) continue;
      }
      const [x, yy, ux, uy] = A;
      if (!hasDem(x, yy)) continue;
      const g = H.heightAt(x, yy), top = hA + (hB - hA) * s / L - DECK;
      if (top - g <= MINGAP) continue;
      const cx = x - O[0], cz = -(yy - O[1]), bot = g - 0.3, hs = Math.min(hw, 3) * 0.6, ht = 0.5; // kolom 1×(2·hs) + dwarsbalk onder het dek
      const box = (hl, hwd, y0, y1, c) => { // doos, lengte-as langs de brug
        const e = [[-hl, -hwd], [hl, -hwd], [hl, hwd], [-hl, hwd]].map(([a, bb]) => [cx + ux * a + uy * bb, cz - uy * a + ux * bb]); // (a = langs, bb = zijwaarts)
        const Q = (i0, i1, ya, yb) => { const A = [e[i0][0], ya, e[i0][1]], B = [e[i1][0], ya, e[i1][1]], C = [e[i1][0], yb, e[i1][1]], D = [e[i0][0], yb, e[i0][1]]; tri(A, B, C, c); tri(A, C, D, c); };
        for (let j = 0; j < 4; j++) Q(j, (j + 1) % 4, y0, y1);
        tri([e[0][0], y1, e[0][1]], [e[1][0], y1, e[1][1]], [e[2][0], y1, e[2][1]], c); tri([e[0][0], y1, e[0][1]], [e[2][0], y1, e[2][1]], [e[3][0], y1, e[3][1]], c);
      };
      box(0.5, hs * 0.5 + 0.2, bot, top - ht, COL.beton);
      box(0.8, hw * 0.9, top - ht, top, COL.beton);
      pil++;
    }
    return { pos, col, pil };
  }

  const stat = { bruggen: 0, pijlers: 0 };
  function rebuild(v) { // vak opnieuw: alle klare bruggen van dit vak samenvoegen tot één mesh
    const pos = [], col = []; let n = 0, pil = 0;
    for (const b of BR) if (b.v === v && b.done && b.geo) { for (const x of b.geo.pos) pos.push(x); for (const x of b.geo.col) col.push(x); n++; pil += b.geo.pil; }
    const old = VAK.get(v); if (old) { group.remove(old); old.geometry.dispose(); }
    if (!pos.length) { VAK.delete(v); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.name = 'brug ' + v;
    group.add(m); VAK.set(v, m);
  }

  let timer = 0;
  function work() {
    timer = 0;
    if (!H.areaInfo) return;
    if (!BR) prep();
    if (!group) {
      mat = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), 'brug');
      group = new THREE.Group(); group.name = 'bruggen'; group.visible = H.getMode?.() === 'iso'; H.scene.add(group);
    }
    const touched = new Set();
    for (const b of BR) {
      if (b.done || !b.ks.every(k => H.chunks.get(k)?.dem)) continue;
      b.done = true; b.geo = sweep(b); touched.add(b.v);
      if (b.geo) { stat.bruggen++; stat.pijlers += b.geo.pil; }
    }
    for (const v of touched) rebuild(v);
    if (touched.size) H.shadowDirty?.();
  }
  const later = () => { if (!timer) timer = setTimeout(work, 60); }; // bundelen: veel 'terrain'-events achter elkaar
  const show = () => { if (group) { group.visible = H.getMode?.() === 'iso'; H.shadowDirty?.(); H.redraw?.(); } };

  H.on('terrain', later);
  H.on('loaded', later);
  H.on('mode', show);
  H.bridges = { stat: () => ({ ...stat }), count: () => RAW.length, deckAt };
})();
