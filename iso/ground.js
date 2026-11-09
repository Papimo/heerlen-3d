// iso/ground.js — stroom B: eigen grond in iso i.p.v. kaarttegels (keuze design/3_grond.html: Grond 1 Speelgoedmat · Water 2 Schuimrand).
// Data: window.H3D_DATA.ground (tools/build-ground.cjs). Vector i.p.v. plaatjes: de tekencode (paintAll, zelfde als design/3_grond.html paint())
// tekent op een vector-'canvas' (VCtx) dat driehoeken maakt → één mesh voor heel Heerlen (±tientallen MB i.p.v. ±21–85 MB per vak).
// Per beeld tekent de GPU die mesh van bovenaf in één doel ter grootte van het scherm (gPass, vóór de scène); het terrein leest daar zijn kleur
// op wereldpositie (uGrVP). Altijd scherp, geheugen vast. Patronen (gras, maaistrepen, bloemetjes, streepjeslijnen) rekent de shader uit.
// Water: kleur-sleutel in het doel + schuimrand uit buur-monsters (grWat), geen masker per vak meer.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null, GD = window.H3D_DATA?.ground; // H3D = top-level const in app.js (niet op window)
  if (!H || !GD) return;
  if (window.H3D_DATA.bgt) GD.bgt = window.H3D_DATA.bgt.land; // BGT-vlakken (tools/build-bgt.cjs): wat de grond echt is; OSM-land blijft eronder (wonen/werk onder erf en panden)

  // ---------- stijl Speelgoedmat ----------
  const ST = {
    base: '#e7dfcc',
    land: { akker: ['#e8d58a', '#d9df8c', '#efc987', '#dfe39a'], erf: '#e3d3b4', weide: '#a9d585', gras: '#9fd27e', park: '#8fca72', boomgaard: '#a2cf7d',
      tuin: '#b3d98c', sport: '#a6d482', speel: '#e8cf9a', kerkhof: '#9fa38b', wonen: '#ece3d0', werk: '#e2dbe6', winkel: '#efd9cf', industrie: '#d9d6df', bouw: '#dccaa6',
      heide: '#c9aecb', struik: '#a7cd85', bos: '#6fae5f', spoorterrein: '#cfc6b8' },
    area: { plein: '#e6d7bb', asfalt: '#9a9ea5', fietsvlak: '#c9786a', parkeren: '#aeb0b4', water: '#5aa9d6', zwembad: '#59c3e0', baan: '#c8664b', perron: '#c9c3b8' },
    line: { snelweg: '#80858e', hoofd: '#8b9098', weg: '#979ba2', straat: '#a4a7ad', erfweg: '#bcb5a8', dienst: '#b0b2b6', voet: '#ddd0b6', pad: '#e0d3b9',
      stoep: '#d0c9bd', fiets: '#c46f62', zand: '#d9c08f', beek: '#5aa9d6', spoor: '#9a8f84', tram: '#a59c92' },
    // BGT (tools/build-bgt.cjs): erf en rijbanen zitten er niet in (= OSM-land / OSM-linten)
    bgt: { tegels: '#ddd5c6', stenen: '#cac5bb', klinkers: '#c9a08a', asfalt: '#a4a7ad', grind: '#d8cdb2', zand: '#e6d3a3', gras: '#9fd27e', weide: '#a9d585',
      heesters: '#86bf6a', bos: '#6fae5f', akker: '#e8d58a', boomgaard: '#a2cf7d', heide: '#c9aecb', moeras: '#9cc59a', water: '#5aa9d6',
      tuin: '#b3d98c' }, // tuin = BGT-erf in een woonwijk (achter-/voortuinen)
    grind: '#d8cdb2', // grindpaden begraafplaats
    graveBlots: ['#8b8a6c', '#b2ae94', '#7e8a72', '#a49a7c'], gravePlot: '#8f957d', // kerkhof Verwilderd (design/12_begraafplaats.html)
    pitch: { gras: '#8cc96a', kunstgras: '#5fae5a', hard: '#6f93a8', gravel: '#c8653f', zand: '#e1c993', beton: '#c9c6c0' },
    chalk: '#ffffff', mow: 0.06, rails: '#5c544c', bridge: '#5f574e',
    // oude lint-look (app.js): [wegdek, stoeprand]; erf/voetgangers zachter. extra = lint was iets breder dan de OSM-breedte, kerb = deel binnen de stoeprand (26/32)
    rib: { street: { hoofd: ['#8f9196', '#c4c1bb'], weg: ['#8f9196', '#c4c1bb'], straat: ['#8f9196', '#c4c1bb'], erfweg: ['#b3aea6', '#d6d2ca'], voet: ['#b3aea6', '#d6d2ca'] },
      extra: 0.6, kerb: 26 / 32, berm: '#c9c4ba', asphalt: '#3d3f45', paint: '#fbfaf5',
      railW: 6, ballast: '#a49c90', sleeper: '#6e5a48', rail: '#4d4f55',
      round: ['#8a8c91', '#e2dfd8'], isle: '#8cc46c', ink: '#3a332e' },
    // wegen-ontwerp (design/10_wegen.html): Wegen 1 Belijnd asfalt · Fietspaden 4 Zacht terracotta · Rotondes 4 Grafisch wit · Stoepen 2 Volgens OSM · Zebrapaden 3 Per soort
    road: { asp: '#56595f', aspSoft: '#9a948b', walk: '#e2dcd1', walkEdge: '#9a9389', bike: '#d39a86', isle: '#f3eee4',
      bikeX: '#b8574a', paint: '#fbfaf5' },
  };
  const RANK = { hoofd: 4, weg: 3, straat: 2, erfweg: 1, voet: 0 }; // straatklassen (rest = paden/snelweg/spoor)

  // ---------- data → features per vak (absolute RD) ----------
  let KM = 1000, BY = null; // BY: 'i_j' → { land, area, pitch, line, wat }
  const M = 40; // marge rond het vak (lijnen/randen die erin steken)

  // ---------- data → één lijst voor heel het gebied (absolute RD) ----------
  let ALL = null;
  function prep() {
    if (ALL) return ALL;
    const A = H.areaInfo, O = A.origin, q = GD.q;
    ALL = { land: [], bgt: [], area: [], pitch: [], line: [], cross: [], jn: [], isl: [] };
    ALL.park = GD.park || []; ALL.grave = GD.grave || []; // vakindeling/begraafplaats-rijen: blijven in GD staan (iso/props.js zet er auto's/stenen op)
    const dec = d => { const a = new Float64Array(d.length); let x = 0, y = 0; for (let k = 0; k < d.length; k += 2) { x += d[k]; y += d[k + 1]; a[k] = O[0] + x * q; a[k + 1] = O[1] + y * q; } return a; };
    GD.land.forEach(([c, rs], n) => ALL.land.push({ c, rs: rs.map(dec), n }));
    (GD.bgt || []).forEach(([c, rs]) => ALL.bgt.push({ c, rs: rs.map(dec) }));
    GD.area.forEach(([c, rs]) => ALL.area.push({ c, rs: rs.map(dec) }));
    GD.pitch.forEach(([c, rs, surf, box]) => ALL.pitch.push({ c, rs: rs.map(dec), surf, box }));
    const S = [];
    GD.line.forEach(([c, w, br, d, fl = 0]) => { const f = { c, w: w / 10, br, a: dec(d), sw: fl & 3, ring: !!(fl & 4) }; ALL.line.push(f); if (RANK[c] != null && !br) S.push(f); });
    (GD.cross || []).forEach(([k, bike, d]) => ALL.cross.push({ k, bike, a: dec(d) }));
    ALL.jn = junctions(S); ALL.isl = islands(S);
    GD.land = GD.bgt = GD.area = GD.pitch = GD.line = GD.cross = []; // ruwe data niet meer nodig
    return ALL;
  }
  // kruisingen: knooppunten met ≥ 3 armen (gedeelde punten + eindpunt midden op een ander lijnstuk). Per knoop: hoogste rang/breedte, rotonde?
  function junctions(S) {
    const key = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2), NODES = new Map();
    const node = (x, y) => { const k = key(x, y); let n = NODES.get(k); if (!n) NODES.set(k, n = { x, y, arms: [] }); return n; };
    const arm = (n, f, x1, y1) => { const dx = x1 - n.x, dy = y1 - n.y, L = Math.hypot(dx, dy) || 1; n.arms.push({ f, dx: dx / L, dy: dy / L }); };
    const G = new Map(), gk = (x, y) => Math.floor(x / 20) + ',' + Math.floor(y / 20);
    for (const f of S) {
      const a = f.a, n = a.length / 2;
      for (let k = 0; k < n; k++) { const nd = node(a[2 * k], a[2 * k + 1]); if (k > 0) arm(nd, f, a[2 * k - 2], a[2 * k - 1]); if (k < n - 1) arm(nd, f, a[2 * k + 2], a[2 * k + 3]); }
      for (let k = 0; k < n - 1; k++) { const g = gk((a[2 * k] + a[2 * k + 2]) / 2, (a[2 * k + 1] + a[2 * k + 3]) / 2); if (!G.has(g)) G.set(g, []); G.get(g).push([f, k]); }
    }
    for (const f of S) for (const e of [0, f.a.length / 2 - 1]) {
      const x = f.a[2 * e], y = f.a[2 * e + 1], nd = NODES.get(key(x, y)); if (nd.arms.length !== 1) continue;
      const gx = Math.floor(x / 20), gy = Math.floor(y / 20);
      found: for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [g, k] of G.get((gx + i) + ',' + (gy + j)) || []) {
        if (g === f) continue;
        const ax = g.a[2 * k], ay = g.a[2 * k + 1], bx = g.a[2 * k + 2], by = g.a[2 * k + 3], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
        if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < 0.8) { arm(nd, g, ax, ay); arm(nd, g, bx, by); break found; }
      }
    }
    const out = [];
    for (const n of NODES.values()) if (n.arms.length >= 3) {
      n.maxR = Math.max(...n.arms.map(a => RANK[a.f.c])); n.maxW = Math.max(...n.arms.map(a => a.f.w + ST.rib.extra)); n.ring = n.arms.some(a => a.f.ring);
      n.bb = [n.x, n.y, n.x, n.y]; out.push(n);
    }
    return out;
  }
  // rotondes: OSM-stukken met junction=roundabout aan elkaar rijgen → gesloten ring (straal ≥ 6 m) = eiland in de echte vorm
  function islands(S) {
    const k1 = (x, y) => Math.round(x) + ',' + Math.round(y), left = S.filter(f => f.ring), out = [];
    while (left.length) {
      let ch = Array.from(left.shift().a), grown = true;
      while (grown && !(ch.length > 6 && k1(ch[0], ch[1]) === k1(ch.at(-2), ch.at(-1)))) {
        grown = false;
        const i = left.findIndex(p => k1(p.a[0], p.a[1]) === k1(ch.at(-2), ch.at(-1)));
        if (i >= 0) { ch = ch.concat(Array.from(left[i].a).slice(2)); left.splice(i, 1); grown = true; continue; }
        const j = left.findIndex(p => k1(p.a.at(-2), p.a.at(-1)) === k1(ch[0], ch[1]));
        if (j >= 0) { ch = Array.from(left[j].a).slice(0, -2).concat(ch); left.splice(j, 1); grown = true; }
      }
      if (ch.length < 8 || k1(ch[0], ch[1]) !== k1(ch.at(-2), ch.at(-1))) continue;
      const n = ch.length / 2 - 1; let cx = 0, cy = 0, r = 0;
      for (let k = 0; k < n; k++) { cx += ch[2 * k]; cy += ch[2 * k + 1]; } cx /= n; cy /= n;
      for (let k = 0; k < n; k++) r += Math.hypot(ch[2 * k] - cx, ch[2 * k + 1] - cy); r /= n;
      if (r >= 6) out.push({ a: ch, cx, cy, r, bb: [cx - r, cy - r, cx + r, cy + r] });
    }
    return out;
  }
  let X0 = 0, Y0 = 0;
  const path = (x, rs) => { x.beginPath(); for (const a of rs) { x.moveTo(a[0] - X0, a[1] - Y0); for (let k = 2; k < a.length; k += 2) x.lineTo(a[k] - X0, a[k + 1] - Y0); x.closePath(); } };
  const pick = (v, n) => Array.isArray(v) ? v[(n * 7919) % v.length] : v;
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`; };
  // grasvlakken minder leeg: zachte vlekken licht/donker (maaipatroon, droge plekken), dichtbij grasplukjes en in weides/parken wat bloemetjes
  const GRASSY = { gras: 1, weide: 1, park: 1, sport: 1, kerkhof: 1, tuin: 1, boomgaard: 1, struik: 1, heesters: 1 };
  const FLOWERS = { weide: 1, park: 1, tuin: 1 };
  // parkeervakken (witte U-lijnen, fijn) + grindpaden begraafplaats; data [cx2, cy2, hoek·1000, …] zie tools/build-ground.cjs layoutPark/layoutGrave
  function parkGrave(x, F) {
    const O = H.areaInfo.origin, q = GD.q;
    x.lineCap = 'butt';
    // kerkhof Verwilderd (design/12_begraafplaats.html): vlekken + grafvak achter elke steen. Kleuren vooraf gemengd (geen alfa nodig)
    const inR = (px, py, r) => { let o = false; for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) if ((r[a + 1] > py) !== (r[b + 1] > py) && px < (r[b] - r[a]) * (py - r[a + 1]) / (r[b + 1] - r[a + 1]) + r[a]) o = !o; return o; };
    const edR = (px, py, r) => { let m = Infinity; for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) { const ax = r[b], ay = r[b + 1], dx = r[a] - ax, dy = r[a + 1] - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(px - ax - t * dx, py - ay - t * dy)); } return m; };
    const mixH = (h1, h2, t) => { const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16), f = s => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t); return `rgb(${f(16)},${f(8)},${f(0)})`; };
    const KHs = [], seen = new Set();
    for (const f of F.land) if (f.c === 'kerkhof') { const r = f.rs[0], key = Math.round(r[0]) + ',' + Math.round(r[1]) + ',' + r.length; if (!seen.has(key)) { seen.add(key); KHs.push(f.rs); } }
    const inKH = (px, py, e) => KHs.some(rs => inR(px, py, rs[0]) && !rs.slice(1).some(h => inR(px, py, h)) && (!e || edR(px, py, rs[0]) >= e));
    let bs = 11; const br = () => ((bs = (bs * 16807) % 2147483647) / 2147483647);
    const ell = (px, py, rx, ry, rot) => { x.beginPath(); const c = Math.cos(rot), s = Math.sin(rot); for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, u = Math.cos(a) * rx, v = Math.sin(a) * ry; x.lineTo(px + u * c - v * s - X0, py + u * s + v * c - Y0); } x.closePath(); x.fill(); };
    x.kind = 1;
    for (const rs of KHs) {
      const r = rs[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); }
      const n = (x1 - x0) * (y1 - y0) / 100;
      for (let i = 0; i < n; i++) {
        const px = x0 + br() * (x1 - x0), py = y0 + br() * (y1 - y0), rad = 3 + br() * 11, sq = 0.6 + br() * 0.5, rot = br() * 3, bc = ST.graveBlots[i % ST.graveBlots.length];
        if (!inR(px, py, r) || edR(px, py, r) < rad * 0.8) continue;
        x.fillStyle = mixH(bc, ST.land.kerkhof, 0.5); ell(px, py, rad, rad * sq, rot);
        x.fillStyle = bc; ell(px, py, rad * 0.6, rad * 0.6 * sq, rot);
      }
    }
    // grafvakken: zelfde posities als iso/props.js stonesOf (dichtheid 2, tussenrij), vak 0,9 × 2 m achter de steen (+v)
    x.fillStyle = ST.gravePlot;
    for (const g of F.grave) {
      const an = g[2] / 1000, c = Math.cos(an), s = Math.sin(an), cx = O[0] + g[0] * q, cy = O[1] + g[1] * q, sp = g[3] / 10, R = g[4];
      const vs = [...new Set(R.filter((_, k) => k % 3 === 1))].sort((p, r2) => p - r2), has = new Set(vs); let D = Infinity;
      for (let k = 1; k < vs.length; k++) D = Math.min(D, vs[k] - vs[k - 1]);
      for (let k = 0; k + 2 < R.length; k += 3) {
        const rows = [[R[k + 1], 0]]; if (D >= 7 && has.has(R[k + 1] + D)) rows.push([R[k + 1] + D / 2, 1]);
        for (const [v2, tus] of rows) for (let i = 0; i <= (R[k + 2] - 1) * 2; i++) {
          const u = R[k] / 2 + i * sp / 2, v = v2 / 2, sx = cx + u * c - v * s, sy = cy + u * s + v * c;
          if (tus && !inKH(sx, sy, 2.5)) continue;
          x.beginPath();
          for (const [du, dv] of [[-0.45, 0.1], [0.45, 0.1], [0.45, 2.1], [-0.45, 2.1]]) x.lineTo(sx + du * c - dv * s - X0, sy + du * s + dv * c - Y0);
          x.closePath(); x.fill();
        }
      }
    }
    x.kind = 0;
    for (const g of F.grave) {
      const c = Math.cos(g[2] / 1000), s = Math.sin(g[2] / 1000), cx = O[0] + g[0] * q, cy = O[1] + g[1] * q, P = g[5];
      x.beginPath();
      for (let k = 0; k < P.length; k += 3) { const v = P[k] * q; [P[k + 1], P[k + 2]].forEach((u2, i) => { const u = u2 * q, px = cx + u * c - v * s - X0, py = cy + u * s + v * c - Y0; i ? x.lineTo(px, py) : x.moveTo(px, py); }); }
      x.lineWidth = 2; x.strokeStyle = ST.grind; x.stroke();
    }
    x.fine = 1; x.lineWidth = 0.12; x.strokeStyle = ST.road.paint; x.globalAlpha = 0.9;
    for (const g of F.park) {
      const c = Math.cos(g[2] / 1000), s = Math.sin(g[2] / 1000), cx = O[0] + g[0] * q, cy = O[1] + g[1] * q, R = g[3];
      const pt = (u, v, mv) => { const px = cx + u * c - v * s - X0, py = cy + u * s + v * c - Y0; mv ? x.moveTo(px, py) : x.lineTo(px, py); };
      x.beginPath();
      for (let k = 0; k < R.length; k += 3) {
        const u0 = R[k] / 2, vf = R[k + 1] / 2, n = Math.abs(R[k + 2]), vb = vf + Math.sign(R[k + 2]) * 5;
        pt(u0, vf, 1); pt(u0, vb); pt(u0 + n * 2.5, vb); pt(u0 + n * 2.5, vf);
        for (let i = 1; i < n; i++) { pt(u0 + i * 2.5, vf, 1); pt(u0 + i * 2.5, vb); }
      }
      x.stroke();
    }
    x.fine = 0; x.globalAlpha = 1; x.lineCap = 'round';
  }
  function pitchLines(x, f) {
    const r = f.box; if (!r) return;
    const O = H.areaInfo.origin, [cx, cy, L, W, ang] = r, sp = f.c;
    x.save(); x.translate(O[0] + cx - X0, O[1] + cy - Y0); x.rotate(ang);
    x.strokeStyle = ST.chalk; x.lineWidth = 0.55; x.globalAlpha = 0.9;
    const box = (u, v, w, h) => x.strokeRect(u - w / 2, v - h / 2, w, h);
    const line = (u0, v0, u1, v1) => { x.beginPath(); x.moveTo(u0, v0); x.lineTo(u1, v1); x.stroke(); };
    const circ = (u, v, rr, a0 = 0, a1 = Math.PI * 2) => { x.beginPath(); x.arc(u, v, rr, a0, a1); x.stroke(); };
    if (sp === 'soccer' && L > 25) {
      const m = Math.min(3, L * 0.03), l = L - 2 * m, w = W - 2 * m, kl = Math.min(1, l / 100), kw = Math.min(1, w / 64);
      box(0, 0, l, w); line(0, -w / 2, 0, w / 2); circ(0, 0, 9.15 * Math.min(kl, kw));
      for (const sd of [-1, 1]) {
        const e = sd * l / 2;
        box(e - sd * 16.5 * kl / 2, 0, 16.5 * kl, Math.min(w, 40.3 * kw)); box(e - sd * 5.5 * kl / 2, 0, 5.5 * kl, 18.3 * kw);
        x.lineWidth = 1.2; line(e + sd * 0.8, -3.66 * kw, e + sd * 0.8, 3.66 * kw); x.lineWidth = 0.55;
      }
    } else if (sp === 'tennis') {
      const n = Math.max(1, Math.round(W / 17)), k = Math.min(1.1, (L - 4) / 23.77, (W / n - 3) / 10.97);
      for (let c = 0; c < n; c++) {
        x.save(); x.translate(0, (c - (n - 1) / 2) * W / n); x.scale(k, k);
        box(0, 0, 23.77, 10.97); line(-11.885, -4.115, 11.885, -4.115); line(-11.885, 4.115, 11.885, 4.115);
        line(-6.4, -4.115, -6.4, 4.115); line(6.4, -4.115, 6.4, 4.115); line(-6.4, 0, 6.4, 0);
        x.strokeStyle = '#3a3530'; x.lineWidth = 0.4; line(0, -6, 0, 6); x.restore();
      }
    } else if (sp === 'basketball') {
      const k = Math.min(1, L / 28, W / 15); x.scale(k, k);
      box(0, 0, 28, 15); line(0, -7.5, 0, 7.5); circ(0, 0, 1.8);
      for (const sd of [-1, 1]) { box(sd * (14 - 2.9), 0, 5.8, 4.9); circ(sd * 12.4, 0, 6.75, sd > 0 ? Math.PI * 0.6 : -Math.PI * 0.4, sd > 0 ? Math.PI * 1.4 : Math.PI * 0.4); }
    } else if (sp === 'field_hockey') {
      const m = 2, l = L - 2 * m, w = W - 2 * m;
      box(0, 0, l, w); line(0, -w / 2, 0, w / 2); line(-l / 4, -w / 2, -l / 4, w / 2); line(l / 4, -w / 2, l / 4, w / 2);
      circ(-l / 2, 0, Math.min(14.6, w / 3), -Math.PI / 2, Math.PI / 2); circ(l / 2, 0, Math.min(14.6, w / 3), Math.PI / 2, Math.PI * 1.5);
    } else if (!/equestrian|boules|skateboard|chess/.test(sp)) box(0, 0, L - 2, W - 2);
    x.restore();
  }
  function pitchSurf(f) {
    const s = f.surf, P = ST.pitch;
    if (s && P[s]) return P[s];
    if (f.c === 'tennis') return P.gravel; if (f.c === 'equestrian') return P.zand; if (/boules/.test(f.c)) return P.zand;
    if (/skateboard|basketball|chess/.test(f.c)) return P.beton; if (f.c === 'field_hockey') return P.kunstgras;
    return P.gras;
  }
  const isWat = f => f.c === 'water' || f.c === 'zwembad';
  // vormpjes voor markering (RD-m, canvas al geschaald)
  const quad = (x, p, col) => { x.beginPath(); x.moveTo(p[0] - X0, p[1] - Y0); for (let k = 2; k < p.length; k += 2) x.lineTo(p[k] - X0, p[k + 1] - Y0); x.closePath(); x.fillStyle = col; x.fill(); };
  const rect = (x, cx, cy, ux, uy, lu, ln, col) => { const nx = -uy, ny = ux, a = lu / 2, b = ln / 2; quad(x, [cx - ux * a - nx * b, cy - uy * a - ny * b, cx + ux * a - nx * b, cy + uy * a - ny * b, cx + ux * a + nx * b, cy + uy * a + ny * b, cx - ux * a + nx * b, cy - uy * a + ny * b], col); };
  // haaientanden over breedte wid; punt (dx,dy) wijst naar wie voorrang moet geven
  function teeth(x, cx, cy, dx, dy, wid) {
    const nx = -dy, ny = dx, n = Math.max(1, Math.floor(wid / 0.75));
    for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 0.75, bx = cx + nx * o, by = cy + ny * o; quad(x, [bx - nx * 0.25, by - ny * 0.25, bx + nx * 0.25, by + ny * 0.25, bx + dx * 0.6, by + dy * 0.6], ST.road.paint); }
  }
  const scaleRing = (I, rr) => { const o = [], k = rr / I.r; for (let i = 0; i < I.a.length; i += 2) o.push(I.cx + (I.a[i] - I.cx) * k, I.cy + (I.a[i + 1] - I.cy) * k); return o; };
  // rotondes "Grafisch wit": echte vorm uit OSM, licht eiland met inktrand + witte binnenstreep. Rijbaan = de ringstraten zelf.
  function islands2D(x, F) {
    for (const I of F.isl) {
      const ri = I.r - 7.6 / 2 - 0.2;
      x.fillStyle = ST.road.isle; path(x, [scaleRing(I, ri)]); x.fill(); x.strokeStyle = ST.rib.ink; x.lineWidth = 0.48; x.stroke();
      x.fine = 1; const a = scaleRing(I, I.r - 7.6 / 2 + 0.55); x.beginPath(); x.moveTo(a[0] - X0, a[1] - Y0); for (let k = 2; k < a.length; k += 2) x.lineTo(a[k] - X0, a[k + 1] - Y0); x.lineWidth = 0.15; x.strokeStyle = ST.road.paint; x.stroke(); x.fine = 0;
    }
  }
  // oversteken "Per soort": zebra voor voetgangers (ook onbekend), rode fietsoversteek met blokken, met lichten = alleen blokjeslijnen, ongemarkeerd = niets
  function zebras(x, F) {
    const P = ST.road.paint;
    for (const c of F.cross) {
      const a = c.a, ax = a[0], ay = a[1], bx = a.at(-2), by = a.at(-1), len = Math.hypot(bx - ax, by - ay); if (len < 2) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
      if (c.bike) { rect(x, (ax + bx) / 2, (ay + by) / 2, ux, uy, len, 2.6, ST.road.bikeX); for (let t = 0.25; t < len; t += 1) for (const s of [-1.5, 1.5]) rect(x, ax + ux * t + nx * s, ay + uy * t + ny * s, ux, uy, 0.45, 0.45, P); }
      else if (c.k === 'l') { for (let t = 0.25; t < len; t += 0.8) for (const s of [-1.5, 1.5]) rect(x, ax + ux * t + nx * s, ay + uy * t + ny * s, ux, uy, 0.4, 0.4, P); }
      else if (c.k !== 'g') for (let t = 0.5; t < len - 0.2; t += 1) rect(x, ax + ux * t, ay + uy * t, ux, uy, 0.5, 3, P);
    }
  }

  // ---------- tekenen: alles in schilder-volgorde (zelfde als design/3_grond.html paint()) ----------
  // Breedtes die op het canvas van de resolutie afhingen (Math.max(w, 1,6 · px)) → minPx: de shader maakt de lijn ver weg minstens zoveel texels breed.
  // fine = 1 → pas vanaf ±1 texel/m (was: vanaf 1024 px/km). Generator: bouwt in stukjes (yield), zie startBuild.
  function* paintAll(x, F) {
    let w = 0; const Y = () => (++w & 31) === 0;
    x.lineJoin = x.lineCap = 'round';
    const B = F.bgt.length > 0; // met BGT: OSM-land alleen als onderlaag (geen gras-/bloempatroon) en kerkhof er weer bovenop
    for (const f of F.land) { x.fillStyle = pick(ST.land[f.c] || ST.base, f.n); x.kind = !B && GRASSY[f.c] ? (FLOWERS[f.c] ? 2 : 1) : 0; path(x, f.rs); x.fill('evenodd'); if (Y()) yield; }
    for (const f of F.bgt) { x.fillStyle = ST.bgt[f.c] || ST.base; x.kind = GRASSY[f.c] ? (FLOWERS[f.c] ? 2 : 1) : 0; path(x, f.rs); x.fill('evenodd'); if (Y()) yield; }
    if (B) for (const f of F.land) if (f.c === 'kerkhof') { x.fillStyle = ST.land.kerkhof; x.kind = 1; path(x, f.rs); x.fill('evenodd'); }
    x.kind = 0;
    for (const f of F.area) {
      if (isWat(f)) continue;
      x.fillStyle = ST.area[f.c] || ST.base; path(x, f.rs); x.fill('evenodd');
      if (f.c === 'baan') { x.strokeStyle = ST.chalk; x.lineWidth = 0.3; x.stroke(); }
      if (Y()) yield;
    }
    for (const f of F.pitch) {
      const mow = /gras/.test(f.surf || 'gras') && f.box && !/tennis|equestrian|boules|basketball|skateboard|chess/.test(f.c);
      x.fillStyle = pitchSurf(f); x.kind = mow ? 3 : 0; if (mow) { const a = f.box[4] + Math.PI / 2; x.dir = [Math.cos(a), Math.sin(a)]; }
      path(x, f.rs); x.fill('evenodd'); x.kind = 0;
      pitchLines(x, f); if (Y()) yield;
    }
    for (const f of F.area) if (isWat(f)) { x.fillStyle = ST.area[f.c]; path(x, f.rs); x.fill('evenodd'); }
    parkGrave(x, F); yield;
    // lijnen: beken, wegen, spoor, rotondes; bruggen als laatste (met donkere rand)
    const stroke = (f, wd, col, mp = 0) => { const a = f.a; x.beginPath(); x.moveTo(a[0] - X0, a[1] - Y0); for (let k = 2; k < a.length; k += 2) x.lineTo(a[k] - X0, a[k + 1] - Y0); x.lineWidth = wd; x.minPx = mp; x.strokeStyle = col; x.stroke(); x.minPx = 0; };
    const offset = (a, d) => { // polylijn d m opzij (links +), hoeken via gemiddelde normaal
      const o = [], n = a.length / 2;
      for (let k = 0; k < n; k++) {
        const p = Math.max(0, k - 1), q = Math.min(n - 1, k + 1);
        let dx = a[q * 2] - a[p * 2], dy = a[q * 2 + 1] - a[p * 2 + 1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        o.push(a[k * 2] - dy * d, a[k * 2 + 1] + dx * d);
      }
      return { a: o };
    };
    const RT = ST.rib, RD = ST.road, ink = 0.3, IK = 1.6 + 1.2; // inkt 0,3 m per kant; ver weg wegdek ≥ 1,6 texel + inkt ≥ 0,6 texel per kant
    const wOf = f => f.w + RT.extra, aw = f => wOf(f) * RT.kerb, asp = f => RANK[f.c] >= 1 ? RD.asp : RD.aspSoft;
    for (const br of [0, 1]) {
      const L = F.line.filter(f => f.br === br);
      if (br) for (const f of L) if (f.c !== 'beek') stroke(f, (RT.street[f.c] || f.c === 'snelweg' ? f.w + RT.extra : f.w) + 2.2, ST.bridge);
      for (const f of L) if (f.c === 'beek') stroke(f, f.w, ST.line.beek, 1.6);
      yield;
      for (const f of L) { if (/^(beek|spoor|tram|snelweg|fiets|stoep)$/.test(f.c) || RT.street[f.c]) continue; stroke(f, f.w, ST.line[f.c] || ST.line.pad, 1.2); if (Y()) yield; }
      for (const f of L) if (f.c === 'stoep') { const sw = Math.max(f.w, 1.8); stroke(f, sw + 0.35, RD.walkEdge); stroke(f, sw, RD.walk); }
      const S = L.filter(f => RT.street[f.c]);
      for (const f of S) if (f.sw) {
        const d = (f.w + RT.extra) / 2 + 0.9;
        for (const [bit, o] of [[1, d], [2, -d]]) if (f.sw & bit) { const g = offset(f.a, o); stroke(g, 2.15, RD.walkEdge); stroke(g, 1.8, RD.walk); }
      }
      yield;
      for (const f of L) if (f.c === 'fiets') stroke(f, f.w * 0.85, RD.bike, 1.02);
      // straten "Belijnd asfalt": eerst alle randen, dan alle wegdekken → kruisingen lopen in elkaar over
      for (const f of S) { stroke(f, wOf(f) + 2 * ink, RT.ink, IK); if (Y()) yield; }
      for (const f of S) { stroke(f, wOf(f), RT.street[f.c][1], 1.6); if (Y()) yield; }
      for (const f of S) { stroke(f, aw(f), asp(f), 1.6 * RT.kerb); if (Y()) yield; }
      // markering (fijn): kantstrepen + middenstreep op doorgaande wegen, kruisingsvlak, haaientanden waar een lagere weg aansluit
      const J = br ? [] : F.jn;
      x.fine = 1;
      for (const f of S) if (RANK[f.c] >= 3 && aw(f) >= 5) { stroke(f, aw(f) - 0.7, RD.paint); stroke(f, aw(f) - 0.98, asp(f)); }
      x.lineCap = 'butt'; x.setLineDash([3, 6]); for (const f of S) if (RANK[f.c] >= 3) stroke(f, 0.15, RD.paint); x.setLineDash([]); x.lineCap = 'round';
      for (const n of J) { x.beginPath(); x.arc(n.x - X0, n.y - Y0, Math.max(0, n.maxW * RT.kerb / 2 - 0.1), 0, Math.PI * 2); x.fillStyle = asp(n.arms.find(a => RANK[a.f.c] === n.maxR).f); x.fill(); }
      for (const n of J) if (n.maxR >= 3 && !n.ring) for (const a of n.arms) { const r = RANK[a.f.c]; if (r < n.maxR && r >= 1) { const d = n.maxW / 2 + 1; teeth(x, n.x + a.dx * d, n.y + a.dy * d, a.dx, a.dy, aw(a.f) - 0.6); } }
      x.fine = 0;
      yield;
      // snelwegen: lichte berm, donker asfalt, witte kantstrepen, middenstreep 3 m / gat 9 m (alleen ≥ 2 stroken)
      const M = L.filter(f => f.c === 'snelweg');
      for (const f of M) stroke(f, f.w + 2 * ink, RT.ink, IK);
      for (const f of M) stroke(f, f.w, RT.berm, 1.6);
      for (const f of M) stroke(f, f.w - 0.96, RT.asphalt);
      for (const f of M) { stroke(f, f.w - 2.04, RT.paint); stroke(f, f.w - 2.76, RT.asphalt); }
      x.lineCap = 'butt'; x.setLineDash([3, 9]); for (const f of M) if (f.w >= 7) stroke(f, 0.24, RT.paint); x.setLineDash([]); x.lineCap = 'round';
      // spoor: ballast 6 m, dwarsliggers (2,8 m breed, om de 0,65 m), twee spoorstaven 1,5 m uit elkaar; tram blijft oude stijl
      for (const f of L) if (f.c === 'tram') {
        stroke(f, f.w, ST.line.tram); x.setLineDash([0.3, 0.55]); stroke(f, 2.6, shade(ST.line.tram, 0.7)); x.setLineDash([]);
        x.lineCap = 'butt'; stroke(f, 1.75, ST.rails); stroke(f, 1.2, ST.line.tram); x.lineCap = 'round';
      }
      const R = L.filter(f => f.c === 'spoor');
      for (const f of R) stroke(f, RT.railW + 2 * ink, RT.ink, IK);
      for (const f of R) stroke(f, RT.railW, RT.ballast);
      x.lineCap = 'butt'; x.setLineDash([0.27, 0.38]); for (const f of R) stroke(f, RT.railW * 0.46, RT.sleeper); x.setLineDash([]);
      for (const f of R) for (const d of [-0.75, 0.75]) stroke(offset(f.a, d), 0.19, RT.rail, 0.8);
      x.lineCap = 'round';
      if (!br) { islands2D(x, F); x.fine = 1; zebras(x, F); x.fine = 0; }
      yield;
    }
  }

  // ---------- vector-'canvas': deel van CanvasRenderingContext2D, uitvoer = driehoeken in Buf ----------
  const DASH = { '3,6': [4, 9, 3], '3,9': [5, 12, 3], '0.3,0.55': [6, 0.85, 0.3], '0.27,0.38': [7, 0.65, 0.27] }; // [soort, periode, aan] (zelfde tabel in GMAT)
  const COL = new Map();
  function rgba(s, ga) {
    let c = COL.get(s);
    if (!c) {
      if (s[0] === '#') { const n = parseInt(s.slice(1), 16); c = [n >> 16, n >> 8 & 255, n & 255, 1]; }
      else { const m = s.match(/[\d.]+/g).map(Number); c = [m[0], m[1], m[2], m[3] ?? 1]; }
      COL.set(s, c);
    }
    return [c[0], c[1], c[2], Math.round(255 * c[3] * ga)];
  }
  // hoekpunt: xy (f32, m t.o.v. origin) · aC kleur sRGB + alfa · aK [soort, fijn, halve breedte dm, minPx·20] · aO richting (i8) · aU afstand langs de lijn (cm)
  function Buf() {
    let cap = 1 << 16, icap = 1 << 17, n = 0, ni = 0;
    let P = new Float32Array(cap * 2), C = new Uint8Array(cap * 4), K = new Uint8Array(cap * 4), O = new Int8Array(cap * 2), U = new Uint16Array(cap), I = new Uint32Array(icap);
    const g = (A, k, m) => { const b = new A.constructor(m * k); b.set(A); return b; };
    return {
      get n() { return n; },
      v(x, y, s, ox, oy, u) {
        if (n === cap) { cap *= 2; P = g(P, 2, cap); C = g(C, 4, cap); K = g(K, 4, cap); O = g(O, 2, cap); U = g(U, 1, cap); }
        P[2 * n] = x; P[2 * n + 1] = y; C.set(s.c, 4 * n);
        K[4 * n] = s.k; K[4 * n + 1] = s.f; K[4 * n + 2] = s.hw; K[4 * n + 3] = s.mp;
        O[2 * n] = Math.round(ox * 127); O[2 * n + 1] = Math.round(oy * 127); U[n] = u; return n++;
      },
      t(a, b, c) { if (ni + 3 > icap) { icap *= 2; I = g(I, 1, icap); } I[ni++] = a; I[ni++] = b; I[ni++] = c; },
      out: () => ({ P: P.slice(0, 2 * n), C: C.slice(0, 4 * n), K: K.slice(0, 4 * n), O: O.slice(0, 2 * n), U: U.slice(0, n), I: I.slice(0, ni), n, ni }),
    };
  }
  const pip = (px, py, a) => { let ins = false; for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) { const yi = a[i + 1], yj = a[j + 1]; if ((yi > py) !== (yj > py) && px < (a[j] - a[i]) * (py - yi) / (yj - yi) + a[i]) ins = !ins; } return ins; };
  const bbR = a => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let k = 0; k < a.length; k += 2) { if (a[k] < x0) x0 = a[k]; if (a[k] > x1) x1 = a[k]; if (a[k + 1] < y0) y0 = a[k + 1]; if (a[k + 1] > y1) y1 = a[k + 1]; } return [x0, y0, x1, y1]; };
  // even-oneven: ring binnen een oneven aantal andere ringen = gat in de ring die er direct omheen ligt
  function evenOdd(R) {
    if (R.length === 1) return [[R[0], []]];
    const bb = R.map(bbR), inside = (i, j) => { const a = bb[i], b = bb[j]; return a[0] >= b[0] && a[2] <= b[2] && a[1] >= b[1] && a[3] <= b[3] && pip(R[i][0], R[i][1], R[j]); };
    const d = R.map((_, i) => R.reduce((s, _b, j) => s + (j !== i && inside(i, j) ? 1 : 0), 0)), out = new Map();
    R.forEach((a, i) => { if (d[i] % 2 === 0) out.set(i, [a, []]); });
    R.forEach((a, i) => { if (d[i] % 2) for (let j = 0; j < R.length; j++) if (out.has(j) && d[j] === d[i] - 1 && inside(i, j)) { out.get(j)[1].push(a); break; } });
    return [...out.values()];
  }
  const V2 = a => { const o = []; for (let k = 0; k < a.length; k += 2) o.push(new THREE.Vector2(a[k], a[k + 1])); return o; };
  function VCtx(B) {
    let T = [1, 0, 0, 1, 0, 0], subs = [], cur = null; const stack = [];
    const KEYS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'globalAlpha', 'dash', 'fine', 'minPx', 'kind', 'dir'];
    const x = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'round', globalAlpha: 1, dash: null, fine: 0, minPx: 0, kind: 0, dir: [1, 0] };
    const pt = (px, py) => { const X = T[0] * px + T[2] * py + T[4], Y = T[1] * px + T[3] * py + T[5], a = cur.a, m = a.length; if (m && Math.abs(a[m - 2] - X) < 1e-4 && Math.abs(a[m - 1] - Y) < 1e-4) return; a.push(X, Y); };
    const sc = () => Math.sqrt(Math.abs(T[0] * T[3] - T[1] * T[2]));
    function fillRings(R) {
      if (!R.length) return;
      const s = { c: rgba(x.fillStyle, x.globalAlpha), k: x.kind, f: x.fine ? 1 : 0, hw: 0, mp: 0 }, [dx, dy] = x.kind === 3 ? x.dir : [0, 0];
      for (const [outer, holes] of evenOdd(R)) {
        const cont = V2(outer), hv = holes.map(V2);
        let tri; try { tri = THREE.ShapeUtils.triangulateShape(cont, hv); } catch (e) { continue; } // haalt dubbele eindpunten weg (in place)
        const b0 = B.n; for (const p of cont.concat(...hv)) B.v(p.x, p.y, s, dx, dy, 0);
        for (const t of tri) B.t(b0 + t[0], b0 + t[1], b0 + t[2]);
      }
    }
    // lint met ronde hoeken (taartpunten aan de buitenkant) en ronde/platte kappen; aO = eenheidsrichting vanaf de hartlijn → shader kan verbreden
    function ribbon(a, closed, hw) {
      const mp = x.minPx; if (hw <= 0 && !mp) return;
      let n = a.length / 2;
      if (n > 2 && Math.abs(a[0] - a[2 * n - 2]) < 1e-4 && Math.abs(a[1] - a[2 * n - 1]) < 1e-4) { n--; closed = true; }
      if (n < 2) return;
      const s = { c: rgba(x.strokeStyle, x.globalAlpha), k: x.dash ? x.dash[0] : 0, f: x.fine ? 1 : 0, hw: Math.min(255, Math.round(hw * 10)), mp: Math.min(255, Math.round(mp * 20)) };
      const per = x.dash ? x.dash[1] : 0, round = x.lineCap === 'round', m = closed ? n : n - 1;
      const ucm = (v, b) => Math.min(65535, Math.round((v - b) * 100));
      const fan = (cx, cy, a0, da, uu) => {
        const k = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 8))), c0 = B.v(cx, cy, s, 0, 0, uu); let prev = -1;
        for (let i = 0; i <= k; i++) { const an = a0 + da * i / k, ox = Math.cos(an), oy = Math.sin(an), v = B.v(cx + ox * hw, cy + oy * hw, s, ox, oy, uu); if (prev >= 0) B.t(c0, prev, v); prev = v; }
      };
      let u = 0, pdx = 0, pdy = 0, pb = 0, fdx = 0, fdy = 0, have = false;
      const join = (px, py, dx, dy, uu) => {
        const cr = pdx * dy - pdy * dx, an = Math.atan2(cr, pdx * dx + pdy * dy); if (Math.abs(an) < 1e-3) return;
        const a0 = cr > 0 ? Math.atan2(-pdx, pdy) : Math.atan2(pdx, -pdy); // buitenkant: rechts bij een bocht naar links en omgekeerd
        fan(px, py, a0, an, uu);
      };
      for (let i = 0; i < m; i++) {
        const q = (i + 1) % n, ax = a[2 * i], ay = a[2 * i + 1], bx = a[2 * q], by = a[2 * q + 1];
        let dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy); if (L < 1e-6) continue; dx /= L; dy /= L;
        const nx = -dy, ny = dx, base = per ? Math.floor(u / per) * per : 0;
        if (have) join(ax, ay, dx, dy, ucm(u, pb));
        else { fdx = dx; fdy = dy; if (round && !closed) fan(ax, ay, Math.atan2(ny, nx), Math.PI, 0); }
        const v0 = B.v(ax + nx * hw, ay + ny * hw, s, nx, ny, ucm(u, base)), v1 = B.v(ax - nx * hw, ay - ny * hw, s, -nx, -ny, ucm(u, base));
        const v2 = B.v(bx + nx * hw, by + ny * hw, s, nx, ny, ucm(u + L, base)), v3 = B.v(bx - nx * hw, by - ny * hw, s, -nx, -ny, ucm(u + L, base));
        B.t(v0, v1, v2); B.t(v2, v1, v3);
        u += L; pdx = dx; pdy = dy; pb = base; have = true;
        if (i === m - 1) {
          if (closed) join(a[0], a[1], fdx, fdy, ucm(u, pb));
          else if (round) fan(bx, by, Math.atan2(-ny, -nx), Math.PI, ucm(u, pb));
        }
      }
    }
    return Object.assign(x, {
      setTransform(a, b, c, d, e, f) { T = [a, b, c, d, e, f]; },
      translate(a, b) { T[4] += T[0] * a + T[2] * b; T[5] += T[1] * a + T[3] * b; },
      rotate(r) { const c = Math.cos(r), s = Math.sin(r), [a, b, cc, d] = T; T[0] = a * c + cc * s; T[1] = b * c + d * s; T[2] = cc * c - a * s; T[3] = d * c - b * s; },
      scale(a, b) { T[0] *= a; T[1] *= a; T[2] *= b; T[3] *= b; },
      save() { stack.push([T.slice(), KEYS.map(k => x[k])]); },
      restore() { const s = stack.pop(); if (s) { T = s[0]; KEYS.forEach((k, i) => { x[k] = s[1][i]; }); } },
      setLineDash(a) { x.dash = a.length ? DASH[a.join(',')] || null : null; },
      beginPath() { subs = []; cur = null; },
      moveTo(px, py) { cur = { a: [], closed: false }; subs.push(cur); pt(px, py); },
      lineTo(px, py) { if (!cur) x.moveTo(px, py); else pt(px, py); },
      closePath() { if (cur) { cur.closed = true; cur = null; } },
      arc(cx, cy, r, a0, a1) {
        const TAU = Math.PI * 2; let d = a1 - a0; d = d >= TAU - 1e-9 ? TAU : ((d % TAU) + TAU) % TAU;
        const rw = r * sc(), st = rw > 0.05 ? Math.min(Math.PI / 4, 2 * Math.acos(Math.max(-1, 1 - 0.03 / rw))) : Math.PI / 2, n = Math.max(2, Math.ceil(d / st));
        for (let i = 0; i <= n; i++) { const a = a0 + d * i / n, px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (!cur) x.moveTo(px, py); else pt(px, py); }
      },
      strokeRect(px, py, w, h) { x.beginPath(); x.moveTo(px, py); x.lineTo(px + w, py); x.lineTo(px + w, py + h); x.lineTo(px, py + h); x.closePath(); x.stroke(); },
      fill() { fillRings(subs.map(s => s.a).filter(a => a.length >= 6)); },
      stroke() { const w = x.lineWidth * sc(); for (const s of subs) if (s.a.length >= 4) ribbon(s.a, s.closed, w / 2); },
    });
  }

  // ---------- grond-pass: mesh van bovenaf in één schermgroot doel (alleen iso) ----------
  const hex3 = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(v => v.toFixed(4)).join(', '); };
  const W1 = hex3(ST.area.water), W2 = hex3(ST.area.zwembad), BASEV = hex3(ST.base);
  const GT = { uTpm: { value: 1 } };
  const GMAT = new THREE.ShaderMaterial({
    uniforms: GT, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `attribute vec4 aC, aK; attribute vec2 aO; attribute float aU; uniform float uTpm;
      varying vec4 vC; varying vec2 vP, vD; varying float vU, vKind, vFine;
      void main() {
        vec2 p = position.xy;
        if (aK.x < 2.5 || aK.x > 3.5) p += aO * max(0.0, 0.025 * aK.w / uTpm - 0.1 * aK.z); // minPx: ver weg niet dunner dan zoveel texels
        vP = p; vD = aO; vU = aU / 100.0; vC = aC; vKind = aK.x; vFine = aK.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
      }`,
    fragmentShader: `uniform float uTpm; varying vec4 vC; varying vec2 vP, vD; varying float vU, vKind, vFine;
      float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
      float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
      void main() {
        vec4 c = vC; float k = floor(vKind + 0.5), fk = smoothstep(0.8, 1.0, uTpm), aa = 0.5 / uTpm;
        if (vFine > 0.5) c.a *= fk;
        if (k > 3.5) { // streepjes (DASH in ground.js)
          float P = k < 4.5 ? 9.0 : k < 5.5 ? 12.0 : k < 6.5 ? 0.85 : 0.65, on = k < 5.5 ? 3.0 : k < 6.5 ? 0.3 : 0.27;
          if (mod(vU, P) > on) discard;
        } else if (k > 2.5) { // maaistrepen 5 m (2,5 m lichter)
          if (fract(dot(vP, vec2(-vD.y, vD.x)) / 5.0) < 0.5) c.rgb = min(c.rgb * 1.06, 1.0);
        } else if (k > 0.5) { // gras: vlekken licht/donker/droog, dichtbij plukjes (en bloemetjes)
          vec3 col = c.rgb; vec2 p = vP;
          float n = vn(p / 8.0 + 13.1) * 0.65 + vn(p / 3.1 - 4.2) * 0.35, m = vn(p / 12.0 + 71.0);
          c.rgb = mix(c.rgb, col * 0.88, 0.45 * smoothstep(0.42, 0.32, n));
          c.rgb = mix(c.rgb, min(col * 1.07, 1.0), 0.45 * smoothstep(0.64, 0.74, n));
          c.rgb = mix(c.rgb, min(col * 1.12, 1.0), 0.3 * smoothstep(0.7, 0.8, m));
          if (fk > 0.0) {
            vec2 g = floor(p / 4.2), o = g * 4.2 + vec2(h12(g), h12(g + 17.3)) * 4.2;
            float d = seg(p, o, o + vec2((h12(g + 5.7) - 0.5) * 0.4, 0.5 + 0.5 * h12(g + 3.1)));
            c.rgb = mix(c.rgb, col * 0.8, fk * smoothstep(0.09 + aa, 0.09 - aa, d));
            if (k > 1.5) {
              vec2 f = floor(p / 11.0), fc = f * 11.0 + 1.2 + vec2(h12(f + 2.2), h12(f + 9.4)) * 8.6;
              float r = h12(f + 4.4); vec3 fl = r < 0.5 ? vec3(1.0, 0.98, 0.94) : r < 0.8 ? vec3(1.0, 0.847, 0.29) : vec3(0.914, 0.545, 0.69);
              for (int i = 0; i < 4; i++) { vec2 dp = fc + (vec2(h12(f + float(i) * 3.1), h12(f + float(i) * 7.7 + 1.3)) - 0.5) * 2.4;
                c.rgb = mix(c.rgb, fl, fk * smoothstep(0.22 + aa, 0.22 - aa, length(p - dp))); }
            }
          }
        }
        if (c.a < 0.004) discard;
        gl_FragColor = c; // sRGB-waarden ongewijzigd; terrein decodeert (grLin)
      }`,
  });
  const gScene = new THREE.Scene(), top = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  const G = { mesh: null, ready: false, gen: null };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), fw = new THREE.Vector3(), pts = Array.from({ length: 8 }, () => new THREE.Vector3()), clr = new THREE.Color();
  let rtG = null, lastKey = '', gDirty = true;
  const boxOf = c => c.gBox || (c.gBox = new THREE.Box3().setFromObject(c.terrain));
  function foot(cam, h0, h1) { // schermhoeken → grond op hoogte h0 en h1
    let k = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      tmp.set(sx, sy, -1).unproject(cam);
      for (const h of [h0, h1]) pts[k++].copy(tmp).addScaledVector(dir, (h - tmp.y) / dir.y);
    }
  }
  function gPass(cam) {
    if (!iso() || !G.mesh || !cam.isOrthographicCamera) { GU.uGrOn.value = 0; return; }
    const r = H.renderer, gl = r.getContext(), W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
    cam.updateMatrixWorld();
    const key = cam.matrixWorld.elements.join() + '|' + cam.projectionMatrix.elements.join() + '|' + W + 'x' + Hh;
    if (!gDirty && key === lastKey) return;
    lastKey = key; gDirty = false;
    cam.getWorldDirection(dir); if (Math.abs(dir.y) < 0.05) { GU.uGrOn.value = 0; return; }
    // hoogtebereik: eerst alle vakken, dan alleen de vakken onder het beeld (kleiner gebied = meer texels per m)
    let h0 = Infinity, h1 = -Infinity;
    for (const c of H.chunks.values()) if (c.terrain) { const b = boxOf(c); h0 = Math.min(h0, b.min.y); h1 = Math.max(h1, b.max.y); }
    if (!(h1 >= h0)) { h0 = 0; h1 = 1; }
    foot(cam, h0, h1);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    let l0 = Infinity, l1 = -Infinity;
    for (const c of H.chunks.values()) if (c.terrain) { const b = boxOf(c); if (b.max.x < x0 || b.min.x > x1 || b.max.z < z0 || b.min.z > z1) continue; l0 = Math.min(l0, b.min.y); l1 = Math.max(l1, b.max.y); }
    if (l1 >= l0) foot(cam, l0 - 2, l1 + 2);
    // camera recht van boven; 'boven' in het doel = kijkrichting over de grond → doel ligt net als het scherm
    fw.set(dir.x, 0, dir.z).normalize();
    let cx = 0, cz = 0; for (const p of pts) { cx += p.x / 8; cz += p.z / 8; }
    top.position.set(cx, 10000, cz); top.up.copy(fw); top.lookAt(cx, 0, cz); top.updateMatrixWorld();
    let L = Infinity, R = -Infinity, B = Infinity, T = -Infinity;
    for (const p of pts) { tmp.copy(p).applyMatrix4(top.matrixWorldInverse); L = Math.min(L, tmp.x); R = Math.max(R, tmp.x); B = Math.min(B, tmp.y); T = Math.max(T, tmp.y); }
    L -= 2; R += 2; B -= 2; T += 2;
    Object.assign(top, { left: L, right: R, bottom: B, top: T }); top.updateProjectionMatrix();
    // doel: breedte = scherm, hoogte 1,5× (grond loopt naar achter langer door dan het scherm hoog is). Alleen groeien (bewegen tekent op pixelratio 1 →
    // anders bij elk begin/einde opnieuw aanmaken). MSAA 4× alleen bij pixelratio < 1,5 (bij 1600×900 × 1,5: zonder ±20 MB, met ±100 MB).
    const mx = Math.min(4096, r.capabilities.maxTextureSize);
    let w = Math.min(mx, W), h = Math.min(mx, Math.ceil(Hh * 1.5 / 16) * 16);
    if (!rtG) { rtG = new THREE.WebGLRenderTarget(w, h, { samples: r.capabilities.isWebGL2 && r.getPixelRatio() < 1.5 ? 4 : 0, depthBuffer: false }); GU.tGr.value = rtG.texture; }
    else if (w > rtG.width || h > rtG.height) rtG.setSize(Math.max(w, rtG.width), Math.max(h, rtG.height));
    w = rtG.width; h = rtG.height;
    const tpm = w / (R - L);
    GT.uTpm.value = tpm;
    r.getClearColor(clr); const ca = r.getClearAlpha(), at = r.getRenderTarget();
    r.setRenderTarget(rtG); r.setClearColor(0x000000, 0); r.clear(true, false, false); r.render(gScene, top);
    r.setClearColor(clr, ca); r.setRenderTarget(at);
    GU.uGrVP.value.multiplyMatrices(top.projectionMatrix, top.matrixWorldInverse);
    GU.uGrM.value.set(1 / (R - L), 1 / (T - B)); GU.uGrTpm.value = tpm; GU.uGrOn.value = 1;
  }
  H.addPreScene?.(gPass);
  H.groundMB = () => G.mb || 0;

  // ---------- opbouw in stukjes (±12 ms per tik) ----------
  // eerst in een worker (zelfde tekencode via toString, three.js via importScripts); lukt dat niet (file://, fout, >90 s) → hoofddraad in stukjes
  function startBuild() {
    if (G.gen || G.ready) return;
    const t0 = performance.now();
    X0 = H.areaInfo.origin[0]; Y0 = H.areaInfo.origin[1];
    G.gen = 'worker';
    buildInWorker().then(o => {
      GD.land = GD.bgt = GD.area = GD.pitch = GD.line = GD.cross = []; // ruwe data niet meer nodig (park/grave blijven voor iso/props.js)
      finish(o, t0, 'worker');
    }).catch(e => { console.info('heerlen-3d grond: worker lukt niet → hoofddraad', e?.message || e); buildMain(t0); });
  }
  function buildInWorker() {
    return new Promise((ok, no) => {
      if (typeof Worker === 'undefined' || location.protocol === 'file:') return no('geen worker / file://'); // importScripts van file:// mag niet vanuit een blob-worker
      const arrows = { path, pick, shade, isWat, quad, rect, scaleRing, V2, pip, bbR };
      const src = `importScripts(${JSON.stringify(new URL('vendor/three.js', document.baseURI).href)});
        const ST = ${JSON.stringify(ST)}, RANK = ${JSON.stringify(RANK)}, GRASSY = ${JSON.stringify(GRASSY)}, FLOWERS = ${JSON.stringify(FLOWERS)}, DASH = ${JSON.stringify(DASH)}, COL = new Map();
        let X0 = 0, Y0 = 0, ALL = null, GD = null, H = null;
        ${Object.entries(arrows).map(([k, f]) => `const ${k} = ${f};`).join('\n')}
        ${[prep, junctions, islands, parkGrave, pitchLines, pitchSurf, teeth, islands2D, zebras, paintAll, rgba, Buf, evenOdd, VCtx].map(f => f.toString()).join('\n')}
        onmessage = e => {
          GD = e.data.gd; H = { areaInfo: { origin: e.data.origin } }; X0 = e.data.origin[0]; Y0 = e.data.origin[1];
          try { const B = Buf(), x = VCtx(B), F = prep(); for (const _ of paintAll(x, F)); const o = B.out(); postMessage(o, [o.P.buffer, o.C.buffer, o.K.buffer, o.O.buffer, o.U.buffer, o.I.buffer]); }
          catch (err) { postMessage({ err: String(err && err.stack || err) }); }
        };`;
      let w, url;
      try { url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); w = new Worker(url); } catch (e) { return no(e); }
      const end = () => { clearTimeout(to); w.terminate(); URL.revokeObjectURL(url); };
      const to = setTimeout(() => { end(); no('time-out'); }, 90000);
      w.onerror = e => { e.preventDefault?.(); end(); no(e.message || 'worker-fout'); };
      w.onmessage = e => { end(); e.data.err ? no(e.data.err) : ok(e.data); };
      const { q, land, bgt, area, pitch, line, cross, park, grave } = GD;
      w.postMessage({ origin: H.areaInfo.origin, gd: { q, land, bgt, area, pitch, line, cross, park, grave } });
    });
  }
  function buildMain(t0) {
    const B = Buf(), x = VCtx(B), F = prep();
    G.gen = paintAll(x, F);
    const tick = () => {
      const t = performance.now();
      try { while (performance.now() - t < 12) if (G.gen.next().done) return finish(B.out(), t0, 'hoofddraad'); }
      catch (e) { console.error('heerlen-3d grond:', e); return; }
      setTimeout(tick, 0);
    };
    tick();
  }
  function finish(o, t0, how) {
    const g = new THREE.BufferGeometry();
    const at = (a, k, nm) => new THREE.BufferAttribute(a, k, nm).onUpload(function () { this.array = null; }); // JS-kopie weg na upload
    g.setAttribute('position', at(o.P, 2)); g.setAttribute('aC', at(o.C, 4, true)); g.setAttribute('aK', at(o.K, 4, false));
    g.setAttribute('aO', at(o.O, 2, true)); g.setAttribute('aU', at(o.U, 1, false)); g.setIndex(at(o.I, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const m = new THREE.Mesh(g, GMAT); m.rotation.x = -Math.PI / 2; m.frustumCulled = false; gScene.add(m); // (x, y) → wereld (x, 0, −y)
    G.mesh = m; G.ready = true; gDirty = true;
    G.mb = (o.P.byteLength + o.C.byteLength + o.K.byteLength + o.O.byteLength + o.U.byteLength + o.I.byteLength) / 1048576;
    console.info(`heerlen-3d grond: ${o.n} hoekpunten, ${o.ni / 3} driehoeken, ${G.mb.toFixed(1)} MB, ${Math.round(performance.now() - t0)} ms (${how})`);
    for (const c of H.chunks.values()) if (c.gOn) H.emit?.('ground', c); // iso/laden.js: inkleuren; app.js: panden mogen komen
    H.redraw();
  }

  // ---------- shader terrein (alleen iso): kleur uit het grond-doel op wereldpositie ----------
  const GU = { tGr: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uGrVP: { value: new THREE.Matrix4() }, uGrM: { value: new THREE.Vector2(1, 1) },
    uGrTpm: { value: 1 }, uGrOn: { value: 0 }, uGrT: { value: 0 } };
  GU.tGr.value.needsUpdate = true;
  H.patchTerrain('ground', s => {
    Object.assign(s.uniforms, GU); H.seasonize?.(s, '');
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGrW; uniform sampler2D tGr; uniform mat4 uGrVP; uniform vec2 uGrM; uniform float uGrT, uGrTpm, uGrOn;
      const vec3 GR_BASE = vec3(${BASEV});
      float grH(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float grN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(grH(i), grH(i + vec2(1, 0)), f.x), mix(grH(i + vec2(0, 1)), grH(i + vec2(1, 1)), f.x), f.y); }
      vec3 grAt(vec2 uv) { if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return GR_BASE; vec4 t = texture2D(tGr, uv); return t.rgb + GR_BASE * (1.0 - t.a); }
      vec3 grLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      float grWat(vec3 c) { vec3 a = c - vec3(${W1}), b = c - vec3(${W2}); return 1.0 - smoothstep(0.03, 0.08, sqrt(min(dot(a, a), dot(b, b)))); }`)
      // na color_fragment én na het iso-kaartfilter van terrMat (anders kleurt dat filter de grond mee)
      .replace('#include <alphamap_fragment>', `float grK = 0.0;
      if (uIso > 0.5) {
        vec2 grUv = (uGrVP * vec4(vGrW, 1.0)).xy * 0.5 + 0.5;
        vec3 grC = uGrOn > 0.5 ? grAt(grUv) : GR_BASE;
        diffuseColor.rgb = grLin(grC);
        float grW = grWat(grC) * smoothstep(0.8, 1.0, uGrTpm) * uGrOn;
        ${H.seasonize ? 'diffuseColor.rgb = seasonGround(diffuseColor.rgb, grWat(grC));' : ''}
        if (grW > 0.0) { // schuimrand: aandeel water binnen 1,6 m (smal) en 8 m (geen schuim op smalle beken)
          float s1 = 0.0, s2 = 0.0;
          for (int i = 0; i < 8; i++) { float a = float(i) * 0.7853982; vec2 d = vec2(cos(a), sin(a)) * uGrM;
            s1 += grWat(grAt(grUv + d * 1.6)); s2 += grWat(grAt(grUv + d * 8.0)); }
          float wid = 0.3 + 0.08 * sin(uGrT * 1.4 + grN(vGrW.xz / 6.0) * 6.0);
          grK = (1.0 - smoothstep(wid * 0.75, wid, s1 / 16.0)) * smoothstep(0.28, 0.42, s2 / 8.0) * 0.92 * grW;
        }
      }
      #include <alphamap_fragment>`)
      .replace('#include <opaque_fragment>', `if (grK > 0.0) {
        float lit = dot(outgoingLight, vec3(0.3, 0.59, 0.11)) / max(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), 0.001);
        outgoingLight = mix(outgoingLight, vec3(0.97, 0.99, 1.0) * clamp(lit, 0.3, 1.1), grK);
      }
      #include <opaque_fragment>`);
  });

  const iso = () => H.getMode?.() === 'iso';
  H.groundReady = c => !iso() || G.ready; // app.js loadTick: panden pas na de grond
  H.on('terrain', c => { c.gOn = true; if (iso()) { startBuild(); if (G.ready) setTimeout(() => H.emit?.('ground', c), 0); } });
  H.on('mode', () => { if (iso()) startBuild(); gDirty = true; H.redraw(); });
})();
