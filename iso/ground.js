// iso/ground.js — stroom B: eigen grond in iso i.p.v. kaarttegels (keuze design/3_grond.html: Grond 1 Speelgoedmat · Water 2 Schuimrand).
// Data: window.H3D_DATA.ground (tools/build-ground.cjs). Per vak een canvas (RD-meters, noord boven) → textuur via H3D.patchTerrain;
// UV = (RD − vakhoek) / km uit de wereldpositie, dus los van de tegel-UV's. Resolutie naar beeldschaal (256…2048 px/km).
// Water: masker per vak (R = water, G = smalle vervaging → schuimrand, B = brede vervaging → geen schuim op smalle beken).
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null, GD = window.H3D_DATA?.ground; // H3D = top-level const in app.js (niet op window)
  if (!H || !GD) return;

  // ---------- stijl Speelgoedmat ----------
  const ST = {
    base: '#e7dfcc',
    land: { akker: ['#e8d58a', '#d9df8c', '#efc987', '#dfe39a'], erf: '#e3d3b4', weide: '#a9d585', gras: '#9fd27e', park: '#8fca72', boomgaard: '#a2cf7d',
      tuin: '#b3d98c', sport: '#a6d482', speel: '#e8cf9a', kerkhof: '#9cc788', wonen: '#ece3d0', werk: '#e2dbe6', winkel: '#efd9cf', industrie: '#d9d6df', bouw: '#dccaa6',
      heide: '#c9aecb', struik: '#a7cd85', bos: '#6fae5f', spoorterrein: '#cfc6b8' },
    area: { plein: '#e6d7bb', asfalt: '#9a9ea5', fietsvlak: '#c9786a', parkeren: '#aeb0b4', water: '#5aa9d6', zwembad: '#59c3e0', baan: '#c8664b', perron: '#c9c3b8' },
    line: { snelweg: '#80858e', hoofd: '#8b9098', weg: '#979ba2', straat: '#a4a7ad', erfweg: '#bcb5a8', dienst: '#b0b2b6', voet: '#ddd0b6', pad: '#e0d3b9',
      stoep: '#d0c9bd', fiets: '#c46f62', zand: '#d9c08f', beek: '#5aa9d6', spoor: '#9a8f84', tram: '#a59c92' },
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
  function prep() {
    if (BY) return;
    const A = H.areaInfo, O = A.origin, q = GD.q; KM = A.km; BY = new Map();
    const dec = d => { const a = new Float64Array(d.length); let x = 0, y = 0; for (let k = 0; k < d.length; k += 2) { x += d[k]; y += d[k + 1]; a[k] = O[0] + x * q; a[k + 1] = O[1] + y * q; } return a; };
    const bbOf = rs => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const a of rs) for (let k = 0; k < a.length; k += 2) { if (a[k] < x0) x0 = a[k]; if (a[k] > x1) x1 = a[k]; if (a[k + 1] < y0) y0 = a[k + 1]; if (a[k + 1] > y1) y1 = a[k + 1]; } return [x0, y0, x1, y1]; };
    const put = (kind, f) => {
      const [x0, y0, x1, y1] = f.bb;
      for (let i = Math.floor((x0 - M) / KM); i <= Math.floor((x1 + M) / KM); i++) for (let j = Math.floor((y0 - M) / KM); j <= Math.floor((y1 + M) / KM); j++) {
        const k = i + '_' + j; let b = BY.get(k); if (!b) BY.set(k, b = { land: [], area: [], pitch: [], line: [], cross: [], jn: [], isl: [], wat: false });
        b[kind].push(f); if (f.c === 'water' || f.c === 'zwembad' || f.c === 'beek') b.wat = true;
      }
    };
    GD.land.forEach(([c, rs], n) => { const r = rs.map(dec); put('land', { c, rs: r, bb: bbOf(r), n }); });
    GD.area.forEach(([c, rs]) => { const r = rs.map(dec); put('area', { c, rs: r, bb: bbOf(r) }); });
    GD.pitch.forEach(([c, rs, surf, box]) => { const r = rs.map(dec); put('pitch', { c, rs: r, bb: bbOf(r), surf, box }); });
    const S = [];
    GD.line.forEach(([c, w, br, d, fl = 0]) => { const a = dec(d), f = { c, w: w / 10, br, a, bb: bbOf([a]), sw: fl & 3, ring: !!(fl & 4) }; put('line', f); if (RANK[c] != null && !br) S.push(f); });
    (GD.cross || []).forEach(([k, bike, d]) => { const a = dec(d); put('cross', { k, bike, a, bb: bbOf([a]) }); });
    junctions(S).forEach(n => put('jn', n));
    islands(S).forEach(I => put('isl', I));
    // ruwe data niet meer nodig
    GD.land = GD.area = GD.pitch = GD.line = GD.cross = [];
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
  const EMPTY = { land: [], area: [], pitch: [], line: [], cross: [], jn: [], isl: [], wat: false };
  const feats = c => (prep(), BY.get(c.i + '_' + c.j) || EMPTY);

  // ---------- schilderen (zelfde als design/3_grond.html paint(), stijl Speelgoedmat) ----------
  let X0 = 0, Y0 = 0;
  const path = (x, rs) => { x.beginPath(); for (const a of rs) { x.moveTo(a[0] - X0, a[1] - Y0); for (let k = 2; k < a.length; k += 2) x.lineTo(a[k] - X0, a[k + 1] - Y0); x.closePath(); } };
  const pick = (v, n) => Array.isArray(v) ? v[(n * 7919) % v.length] : v;
  const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = v => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`; };
  function stripes(x, f, ang, sp, col, lw) { // evenwijdige lijnen binnen het vlak
    x.save(); path(x, f.rs); x.clip('evenodd');
    const [a, b, c2, d] = f.bb, cx = (a + c2) / 2 - X0, cy = (b + d) / 2 - Y0, R2 = Math.hypot(c2 - a, d - b) / 2 + 2, co = Math.cos(ang), si = Math.sin(ang);
    x.beginPath();
    for (let t = -R2; t <= R2; t += sp) { const px = cx - si * t, py = cy + co * t; x.moveTo(px - co * R2, py - si * R2); x.lineTo(px + co * R2, py + si * R2); }
    x.strokeStyle = col; x.lineWidth = lw; x.stroke(); x.restore();
  }
  // grasvlakken minder leeg: zachte vlekken licht/donker (maaipatroon, droge plekken), dichtbij grasplukjes en in weides/parken wat bloemetjes
  const GRASSY = { gras: 1, weide: 1, park: 1, sport: 1, kerkhof: 1, tuin: 1, boomgaard: 1, struik: 1 };
  const FLOWERS = { weide: 1, park: 1, tuin: 1 };
  function grassy(x, f, col, fine) {
    const [a, b, c2, d] = f.bb, W = c2 - a, Hh = d - b, A = W * Hh; if (A < 60) return;
    let sd = (f.n * 2654435761 ^ Math.round(a * 7 + b * 13)) >>> 0; const r = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
    x.save(); path(x, f.rs); x.clip('evenodd');
    const dark = shade(col, 0.88), light = shade(col, 1.07), dry = shade(col, 1.12).replace('rgb', 'rgba').replace(')', ',.55)');
    x.globalAlpha = 0.45;
    for (let k = 0, n = Math.min(500, A / 260); k < n; k++) { // vlekken 4–16 m
      const cx = a + r() * W - X0, cy = b + r() * Hh - Y0, rx = 4 + r() * 12, ry = rx * (0.5 + r() * 0.5);
      x.beginPath(); x.ellipse(cx, cy, rx, ry, r() * Math.PI, 0, 7); x.fillStyle = r() < 0.55 ? dark : r() < 0.7 ? dry : light; x.fill();
    }
    x.globalAlpha = 1;
    if (fine) {
      x.beginPath(); // plukjes: korte streepjes, donkerder
      for (let k = 0, n = Math.min(4000, A / 18); k < n; k++) { const px0 = a + r() * W - X0, py0 = b + r() * Hh - Y0, l = 0.5 + r() * 0.5; x.moveTo(px0, py0); x.lineTo(px0 + (r() - 0.5) * 0.4, py0 + l); }
      x.strokeStyle = shade(col, 0.8); x.lineWidth = 0.18; x.stroke();
      if (FLOWERS[f.c]) for (let k = 0, n = Math.min(900, A / 120); k < n; k++) { // bloemetjes in groepjes
        const gx = a + r() * W - X0, gy = b + r() * Hh - Y0; x.fillStyle = r() < 0.5 ? '#fffaf0' : r() < 0.6 ? '#ffd84a' : '#e98bb0';
        for (let m = 0; m < 4; m++) { x.beginPath(); x.arc(gx + (r() - 0.5) * 2.4, gy + (r() - 0.5) * 2.4, 0.22, 0, 7); x.fill(); }
      }
    }
    x.restore();
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
  function islands2D(x, F, ink, fine) {
    for (const I of F.isl) {
      const ri = I.r - 7.6 / 2 - 0.2;
      x.fillStyle = ST.road.isle; path(x, [scaleRing(I, ri)]); x.fill(); x.strokeStyle = ST.rib.ink; x.lineWidth = ink * 1.6; x.stroke();
      if (fine) { const a = scaleRing(I, I.r - 7.6 / 2 + 0.55); x.beginPath(); x.moveTo(a[0] - X0, a[1] - Y0); for (let k = 2; k < a.length; k += 2) x.lineTo(a[k] - X0, a[k + 1] - Y0); x.lineWidth = 0.15; x.strokeStyle = ST.road.paint; x.stroke(); }
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
  function paint(c, res) {
    const F = feats(c), s = res / KM, px = 1 / s;
    const cv = c.gCv && c.gCv.width === res ? c.gCv : (c.gCv = Object.assign(document.createElement('canvas'), { width: res, height: res }));
    const x = cv.getContext('2d');
    X0 = c.x0; Y0 = c.y0;
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = ST.base; x.fillRect(0, 0, res, res);
    x.setTransform(s, 0, 0, -s, 0, res); x.lineJoin = x.lineCap = 'round';
    for (const f of F.land) { const col = pick(ST.land[f.c] || ST.base, f.n); x.fillStyle = col; path(x, f.rs); x.fill('evenodd'); if (GRASSY[f.c]) grassy(x, f, col, px <= 1.01); }
    for (const f of F.area) {
      if (isWat(f)) continue;
      x.fillStyle = ST.area[f.c] || ST.base; path(x, f.rs); x.fill('evenodd');
      if (f.c === 'baan') { x.strokeStyle = ST.chalk; x.lineWidth = 0.3; x.stroke(); }
    }
    for (const f of F.pitch) {
      const col = pitchSurf(f); x.fillStyle = col; path(x, f.rs); x.fill('evenodd');
      if (/gras/.test(f.surf || 'gras') && f.box && !/tennis|equestrian|boules|basketball|skateboard|chess/.test(f.c)) stripes(x, f, f.box[4] + Math.PI / 2, 5, shade(col, 1 + ST.mow), 2.5);
      pitchLines(x, f);
    }
    for (const f of F.area) if (isWat(f)) { x.fillStyle = ST.area[f.c]; path(x, f.rs); x.fill('evenodd'); }
    // lijnen: beken, wegen, spoor, rotondes; bruggen als laatste (met donkere rand)
    // wegen/spoor/rotondes in de stijl van de oude linten (app.js streetTex/laneTex/railTex): stoeprand, donker asfalt met witte randen, ballast + dwarsliggers
    const stroke = (f, w, col) => { const a = f.a; x.beginPath(); x.moveTo(a[0] - X0, a[1] - Y0); for (let k = 2; k < a.length; k += 2) x.lineTo(a[k] - X0, a[k + 1] - Y0); x.lineWidth = w; x.strokeStyle = col; x.stroke(); };
    const offset = (a, d) => { // polylijn d m opzij (links +), hoeken via gemiddelde normaal
      const o = [], n = a.length / 2;
      for (let k = 0; k < n; k++) {
        const p = Math.max(0, k - 1), q = Math.min(n - 1, k + 1);
        let dx = a[q * 2] - a[p * 2], dy = a[q * 2 + 1] - a[p * 2 + 1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
        o.push(a[k * 2] - dy * d, a[k * 2 + 1] + dx * d);
      }
      return { a: o };
    };
    const RT = ST.rib, RD = ST.road, ink = Math.max(0.3, 0.6 * px); // inktrand: de linten lagen hoger en kregen een omlijning van de nabewerking
    const fine = px <= 1.01; // strepen, haaientanden, zebra's pas vanaf 1024 px/km (anders pap; ver weg rustiger)
    const wOf = f => Math.max(f.w + RT.extra, 1.6 * px), aw = f => wOf(f) * RT.kerb, asp = f => RANK[f.c] >= 1 ? RD.asp : RD.aspSoft;
    for (const br of [0, 1]) {
      const L = F.line.filter(f => f.br === br);
      if (br) for (const f of L) if (f.c !== 'beek') stroke(f, (RT.street[f.c] || f.c === 'snelweg' ? f.w + RT.extra : f.w) + 2.2, ST.bridge);
      for (const f of L) if (f.c === 'beek') stroke(f, Math.max(f.w, 1.6 * px), ST.line.beek);
      // overige paden e.d. (hadden geen lint): oude grondstijl
      for (const f of L) { if (/^(beek|spoor|tram|snelweg|fiets|stoep)$/.test(f.c) || RT.street[f.c]) continue; stroke(f, Math.max(f.w, 1.2 * px), ST.line[f.c] || ST.line.pad); }
      // stoepen "Volgens OSM": losse stoeplijnen + stoep langs straten met sidewalk=left/right/both; verder asfalt tot de tuin
      for (const f of L) if (f.c === 'stoep') { stroke(f, Math.max(f.w, 1.8) + 0.35, RD.walkEdge); stroke(f, Math.max(f.w, 1.8), RD.walk); }
      const S = L.filter(f => RT.street[f.c]);
      for (const f of S) if (f.sw) {
        const d = (f.w + RT.extra) / 2 + 0.9;
        for (const [bit, o] of [[1, d], [2, -d]]) if (f.sw & bit) { const g = offset(f.a, o); stroke(g, 2.15, RD.walkEdge); stroke(g, 1.8, RD.walk); }
      }
      // fietspaden "Zacht terracotta": gedempt rood, iets smaller, geen rand
      for (const f of L) if (f.c === 'fiets') stroke(f, Math.max(f.w, 1.2 * px) * 0.85, RD.bike);
      // straten "Belijnd asfalt": inkt, stoeprand, donker asfalt (eerst alle randen, dan alle wegdekken → kruisingen lopen in elkaar over)
      for (const f of S) stroke(f, wOf(f) + 2 * ink, RT.ink);
      for (const f of S) stroke(f, wOf(f), RT.street[f.c][1]);
      for (const f of S) stroke(f, aw(f), asp(f));
      // markering: kantstrepen + middenstreep op doorgaande wegen (rang ≥ 3), strepen stoppen op de kruising, haaientanden waar een lagere weg aansluit
      const J = br ? [] : F.jn;
      if (fine) {
        for (const f of S) if (RANK[f.c] >= 3 && aw(f) >= 5) { stroke(f, aw(f) - 0.7, RD.paint); stroke(f, aw(f) - 0.98, asp(f)); }
        x.lineCap = 'butt'; x.setLineDash([3, 6]); for (const f of S) if (RANK[f.c] >= 3) stroke(f, 0.15, RD.paint); x.setLineDash([]); x.lineCap = 'round';
        for (const n of J) { x.beginPath(); x.arc(n.x - X0, n.y - Y0, Math.max(0, n.maxW * RT.kerb / 2 - 0.1), 0, Math.PI * 2); x.fillStyle = asp(n.arms.find(a => RANK[a.f.c] === n.maxR).f); x.fill(); }
        for (const n of J) if (n.maxR >= 3 && !n.ring) for (const a of n.arms) { const r = RANK[a.f.c]; if (r < n.maxR && r >= 1) { const d = n.maxW / 2 + 1; teeth(x, n.x + a.dx * d, n.y + a.dy * d, a.dx, a.dy, aw(a.f) - 0.6); } }
      }
      // snelwegen: lichte berm, donker asfalt, witte kantstrepen, middenstreep 3 m / gat 9 m (alleen ≥ 2 stroken)
      const M = L.filter(f => f.c === 'snelweg');
      for (const f of M) stroke(f, f.w + 2 * ink, RT.ink);
      for (const f of M) stroke(f, f.w, RT.berm);
      for (const f of M) stroke(f, f.w - 0.96, RT.asphalt);
      for (const f of M) { stroke(f, f.w - 2.04, RT.paint); stroke(f, f.w - 2.76, RT.asphalt); }
      x.lineCap = 'butt'; x.setLineDash([3, 9]); for (const f of M) if (f.w >= 7) stroke(f, 0.24, RT.paint); x.setLineDash([]); x.lineCap = 'round';
      // spoor: ballast 6 m, dwarsliggers (2,8 m breed, om de 0,65 m), twee spoorstaven 1,5 m uit elkaar; tram blijft oude stijl
      for (const f of L) if (f.c === 'tram') {
        stroke(f, f.w, ST.line.tram); x.setLineDash([0.3, 0.55]); stroke(f, 2.6, shade(ST.line.tram, 0.7)); x.setLineDash([]);
        x.lineCap = 'butt'; stroke(f, 1.75, ST.rails); stroke(f, 1.2, ST.line.tram); x.lineCap = 'round';
      }
      const R = L.filter(f => f.c === 'spoor');
      for (const f of R) stroke(f, RT.railW + 2 * ink, RT.ink);
      for (const f of R) stroke(f, RT.railW, RT.ballast);
      x.lineCap = 'butt'; x.setLineDash([0.27, 0.38]); for (const f of R) stroke(f, RT.railW * 0.46, RT.sleeper); x.setLineDash([]);
      for (const f of R) for (const d of [-0.75, 0.75]) stroke(offset(f.a, d), Math.max(0.19, 0.8 * px), RT.rail);
      x.lineCap = 'round';
      if (!br) { islands2D(x, F, ink, fine); if (fine) zebras(x, F); }
    }
    if (!c.gTex || c.gTex.image !== cv) {
      c.gTex?.dispose(); c.gTex = new THREE.CanvasTexture(cv); c.gTex.colorSpace = THREE.SRGBColorSpace; c.gTex.anisotropy = 8; // three kapt af op het maximum
    }
    c.gTex.needsUpdate = true; c.gRes = res; H.freeAfterUpload(c.gTex); // canvas na upload vrij (2048² = 16 MB); volgende keer nieuw canvas
  }
  // watermasker per vak (±1 px/m)
  function waterMask(c) {
    const F = feats(c), res = 1024, s = res / KM;
    const W = F.area.filter(isWat), B = F.line.filter(f => f.c === 'beek');
    c.gMDone = true; if (!W.length && !B.length) return;
    const mk = () => Object.assign(document.createElement('canvas'), { width: res, height: res });
    const a = mk(), x = a.getContext('2d', { willReadFrequently: true });
    X0 = c.x0; Y0 = c.y0; x.fillStyle = '#000'; x.fillRect(0, 0, res, res);
    x.setTransform(s, 0, 0, -s, 0, res); x.fillStyle = x.strokeStyle = '#fff'; x.lineCap = x.lineJoin = 'round';
    for (const f of W) { path(x, f.rs); x.fill('evenodd'); }
    for (const f of B) { const p = f.a; x.beginPath(); x.moveTo(p[0] - X0, p[1] - Y0); for (let k = 2; k < p.length; k += 2) x.lineTo(p[k] - X0, p[k + 1] - Y0); x.lineWidth = Math.max(f.w, 1.5); x.stroke(); }
    const blur = r => { const b = mk(), y = b.getContext('2d', { willReadFrequently: true }); y.fillStyle = '#000'; y.fillRect(0, 0, res, res); y.filter = `blur(${r}px)`; y.drawImage(a, 0, 0); return y.getImageData(0, 0, res, res).data; };
    const d0 = x.getImageData(0, 0, res, res).data, d1 = blur(2.5), d2 = blur(9), out = new Uint8Array(res * res * 4), row = res * 4;
    for (let r = 0; r < res; r++) { // DataTexture: rij 0 = onderkant → canvas (rij 0 = noord) omdraaien
      const si = r * row, di = (res - 1 - r) * row;
      for (let k = 0; k < row; k += 4) { out[di + k] = d0[si + k]; out[di + k + 1] = d1[si + k]; out[di + k + 2] = d2[si + k]; out[di + k + 3] = 255; }
    }
    c.mTex = new THREE.DataTexture(out, res, res); c.mTex.magFilter = c.mTex.minFilter = THREE.LinearFilter; c.mTex.needsUpdate = true; H.freeAfterUpload(c.mTex);
  }

  // ---------- shader (terrein + ondergrond; alleen in iso) ----------
  const tex1 = hex => { const n = parseInt(hex.slice(1), 16), t = new THREE.DataTexture(new Uint8Array([n >> 16, n >> 8 & 255, n & 255, 255]), 1, 1); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  const BASE = tex1(ST.base), BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true;
  const GU = { uGrT: { value: 0 } };
  H.patchTerrain('ground', (s, m) => {
    const c = m.userData.groundChunk, O = H.areaInfo.origin;
    Object.assign(s.uniforms, GU, {
      tGr: { get value() { return c?.gTex || BASE; } }, tGrM: { get value() { return c?.mTex || BLACK; } },
      uGrC0: { value: new THREE.Vector2(c ? c.x0 - O[0] : 0, c ? c.y0 - O[1] : 0) }, uGrKm: { value: H.areaInfo?.km || 1000 },
    });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGrW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGrW; uniform sampler2D tGr, tGrM; uniform vec2 uGrC0; uniform float uGrT, uGrKm;
      float grH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float grN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(grH(i), grH(i + vec2(1, 0)), f.x), mix(grH(i + vec2(0, 1)), grH(i + vec2(1, 1)), f.x), f.y); }`)
      // na color_fragment én na het iso-kaartfilter van terrMat (anders kleurt dat filter de grond mee)
      .replace('#include <alphamap_fragment>', `vec4 grM = vec4(0.0); float grW = 0.0;
      if (uIso > 0.5) {
        vec2 grUv = (vec2(vGrW.x, -vGrW.z) - uGrC0) / uGrKm;
        diffuseColor.rgb = texture2D(tGr, grUv).rgb;
        grM = texture2D(tGrM, grUv); grW = smoothstep(0.35, 0.65, grM.r);
      }
      #include <alphamap_fragment>`)
      .replace('#include <opaque_fragment>', `if (grW > 0.0) { // schuimrand: smal, ademend, met wat ruis; niet op smalle beken (brede vervaging B blijft laag)
        float lit = dot(outgoingLight, vec3(0.3, 0.59, 0.11)) / max(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)), 0.001);
        float wid = 0.3 + 0.08 * sin(uGrT * 1.4 + grN(vGrW.xz / 6.0) * 6.0);
        float k = (1.0 - smoothstep(wid * 0.75, wid, grM.g - 0.5)) * smoothstep(0.28, 0.42, grM.b) * 0.92;
        outgoingLight = mix(outgoingLight, vec3(0.97, 0.99, 1.0) * clamp(lit, 0.3, 1.1), k * grW);
      }
      #include <opaque_fragment>`);
  });

  // ---------- resolutie naar beeldschaal + schilderwachtrij (één vak per tik, dichtbij eerst) ----------
  const iso = () => H.getMode?.() === 'iso';
  const Q = new Map(); let busy = false, refT = 0;
  function want(c) {
    const [tx, ty] = H.target(), vd = Math.max(H.viewDist(), 1);
    const dx = Math.max(c.x0 - tx, 0, tx - c.x0 - KM), dy = Math.max(c.y0 - ty, 0, ty - c.y0 - KM), dt = Math.hypot(dx, dy);
    // iso: meters per schermpixel ≈ 0,77 · viewDist / schermhoogte (px) → texels per km die nodig zijn
    let need = 1300 * innerHeight * Math.min(devicePixelRatio || 1, 2) / vd;
    if (dt > vd * 0.9 + 300) need /= 4; // buiten beeld
    // vakken onder/naast het midden mogen 4096 px/km (strepen 0,15 m, zebra's 0,5 m); dat zijn er hooguit ±4 (64 MB elk op de GPU)
    const max = dt < 120 && (H.renderer?.capabilities.maxTextureSize || 0) >= 4096 ? 4096 : 2048;
    let r = 256; while (r < max && r < need * 0.8) r *= 2;
    c.gDt = dt;
    return r;
  }
  function refresh() {
    refT = 0; if (!iso()) return;
    // tijdens zoomen/schuiven alleen nog-kale vakken (grond gaat voor, mooi laden onthult pas ná het schilderen); fijner pas bij stilstand ('still')
    const mv = H.moving?.() && !H.intro?.();
    for (const c of H.chunks.values()) {
      if (!c.terrain || !c.gOn || (mv && c.gTex)) continue;
      const r = want(c), cur = c.gRes || 0;
      if (!cur || r > cur || r <= cur / 4 || (cur > 2048 && r <= 2048)) Q.set(c, r); // 4096 meteen terug als het vak niet meer in het midden ligt else Q.delete(c);
    }
    pump(); water();
  }
  const later = () => { if (!refT) refT = setTimeout(refresh, 150); };
  function pump() { if (!busy && Q.size) { busy = true; setTimeout(step, 0); } }
  function step() {
    busy = false; if (!iso() || !Q.size) return;
    const mv = H.moving?.() && !H.intro?.(); // midden in een beweging alleen kale vakken (grof); bijwerken pas bij stilstand
    let c = null; for (const k of Q.keys()) if ((!mv || !k.gTex) && (!c || (!k.gTex && c.gTex) || (!!k.gTex === !!c.gTex && k.gDt < c.gDt))) c = k;
    if (!c) return;
    let r = Q.get(c); Q.delete(c);
    const first = !c.gTex;
    if (first && r > 512) { Q.set(c, r); r = 512; } // mooi laden: eerst grof (snel), daarna de echte resolutie
    paint(c, r);
    if (r >= 1024 && !c.gMDone && feats(c).wat) { waterMask(c); water(); }
    if (first) H.emit?.('ground', c); // iso/laden.js: nu pas inkleuren; app.js: panden mogen komen
    H.redraw();
    if (mv) { if (!busy && Q.size) { busy = true; setTimeout(step, 30); } } else pump(); // tijdens bewegen wat lucht tussen de vakken
  }
  H.groundReady = c => !iso() || !!c.gTex; // app.js loadTick: panden pas na de grond

  // ---------- water: statisch schuimrandje (geen animatie = geen hele scène-render per stap; wens gebruiker: zo min mogelijk kosten aan water) ----------
  // uGrT blijft vast → breedte varieert alleen met de ruis langs de oever. Vroeger 'ademde' het (sin(uGrT)), dat kostte 6–30 hele beelden/s.
  function water() {}

  H.on('terrain', c => { c.gOn = true; c.terrain.material.userData.groundChunk = c; c.terrain.material.needsUpdate = true; if (iso()) { Q.set(c, 512); want(c); pump(); } later(); }); // meteen in de rij (niet wachten op refresh)
  H.on('detail', later);
  H.on('still', () => { later(); pump(); });
  H.on('mode', () => { later(); water(); });
  H.on('layers', () => { for (const c of H.chunks.values()) c.gRes = 0; later(); }); // rotondes komen uit layers.js: vakken die eerder geschilderd waren opnieuw
  H.on('turn', later);
})();
