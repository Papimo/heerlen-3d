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
  };

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
        const k = i + '_' + j; let b = BY.get(k); if (!b) BY.set(k, b = { land: [], area: [], pitch: [], line: [], wat: false });
        b[kind].push(f); if (f.c === 'water' || f.c === 'zwembad' || f.c === 'beek') b.wat = true;
      }
    };
    GD.land.forEach(([c, rs], n) => { const r = rs.map(dec); put('land', { c, rs: r, bb: bbOf(r), n }); });
    GD.area.forEach(([c, rs]) => { const r = rs.map(dec); put('area', { c, rs: r, bb: bbOf(r) }); });
    GD.pitch.forEach(([c, rs, surf, box]) => { const r = rs.map(dec); put('pitch', { c, rs: r, bb: bbOf(r), surf, box }); });
    GD.line.forEach(([c, w, br, d]) => { const a = dec(d); put('line', { c, w: w / 10, br, a, bb: bbOf([a]) }); });
    // ruwe data niet meer nodig
    GD.land = GD.area = GD.pitch = GD.line = [];
  }
  const EMPTY = { land: [], area: [], pitch: [], line: [], wat: false };
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
  // rotondes als standaardvorm (zoals de oude linten in app.js buildLayers): ronde rijbaan met lichte rand; middeneiland = 3D-cilinder van de app (blijft in iso)
  function rounds(x, c, ink) {
    const d = H.layerData?.rounds; if (!d) return;
    for (const [type, cx, cy, r0] of d) {
      const big = /^(motorway|trunk|primary|secondary)/.test(type), w = big ? 8 : 6.5, R = Math.min(34, Math.max(w / 2 + 6, Math.round(r0 / 2) * 2));
      if (cx + R + w < c.x0 || cx - R - w > c.x0 + KM || cy + R + w < c.y0 || cy - R - w > c.y0 + KM) continue;
      x.beginPath(); x.arc(cx - X0, cy - Y0, R, 0, Math.PI * 2);
      x.lineWidth = w + 2 * ink; x.strokeStyle = ST.rib.ink; x.stroke();
      x.lineWidth = w; x.strokeStyle = ST.rib.round[1]; x.stroke();
      x.lineWidth = w * ST.rib.kerb; x.strokeStyle = ST.rib.round[0]; x.stroke();
      x.beginPath(); x.arc(cx - X0, cy - Y0, Math.max(0, R - w / 2 - 0.3), 0, Math.PI * 2); x.fillStyle = ST.rib.isle; x.fill();
    }
  }
  function paint(c, res) {
    const F = feats(c), s = res / KM, px = 1 / s;
    const cv = c.gCv && c.gCv.width === res ? c.gCv : (c.gCv = Object.assign(document.createElement('canvas'), { width: res, height: res }));
    const x = cv.getContext('2d');
    X0 = c.x0; Y0 = c.y0;
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = ST.base; x.fillRect(0, 0, res, res);
    x.setTransform(s, 0, 0, -s, 0, res); x.lineJoin = x.lineCap = 'round';
    for (const f of F.land) { x.fillStyle = pick(ST.land[f.c] || ST.base, f.n); path(x, f.rs); x.fill('evenodd'); }
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
    const RT = ST.rib, ink = Math.max(0.3, 0.6 * px); // inktrand: de linten lagen hoger en kregen een omlijning van de nabewerking
    for (const br of [0, 1]) {
      const L = F.line.filter(f => f.br === br);
      if (br) for (const f of L) if (f.c !== 'beek') stroke(f, (RT.street[f.c] || f.c === 'snelweg' ? f.w + RT.extra : f.w) + 2.2, ST.bridge);
      for (const f of L) if (f.c === 'beek') stroke(f, Math.max(f.w, 1.6 * px), ST.line.beek);
      // overige paden/fietspaden e.d. (hadden geen lint): oude grondstijl
      for (const f of L) { if (f.c === 'beek' || f.c === 'spoor' || f.c === 'tram' || f.c === 'snelweg' || RT.street[f.c]) continue; stroke(f, Math.max(f.w, 1.2 * px), ST.line[f.c] || ST.line.pad); }
      // straten: eerst alle stoepranden, dan alle wegdekken → kruisingen lopen in elkaar over
      const S = L.filter(f => RT.street[f.c]), wOf = f => Math.max(f.w + RT.extra, 1.6 * px);
      for (const f of S) stroke(f, wOf(f) + 2 * ink, RT.ink);
      for (const f of S) stroke(f, wOf(f), RT.street[f.c][1]);
      for (const f of S) stroke(f, wOf(f) * RT.kerb, RT.street[f.c][0]);
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
      if (!br) rounds(x, c, ink);
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
    let r = 256; while (r < 2048 && r < need * 0.8) r *= 2;
    c.gDt = dt;
    return r;
  }
  function refresh() {
    refT = 0; if (!iso() || H.moving?.()) return; // zoomen/schuiven: pas bij stilstand ('still')
    for (const c of H.chunks.values()) {
      if (!c.terrain || !c.gOn) continue;
      const r = want(c), cur = c.gRes || 0;
      if (!cur || r > cur || r <= cur / 4) Q.set(c, r); else Q.delete(c);
    }
    pump(); water();
  }
  const later = () => { if (!refT) refT = setTimeout(refresh, 150); };
  function pump() { if (!busy && Q.size) { busy = true; setTimeout(step, 0); } }
  function step() {
    busy = false; if (!iso() || !Q.size || H.moving?.()) return; // niet schilderen/uploaden midden in een beweging
    let c = null; for (const k of Q.keys()) if (!c || (!k.gTex && c.gTex) || (!!k.gTex === !!c.gTex && k.gDt < c.gDt)) c = k;
    const r = Q.get(c); Q.delete(c);
    paint(c, r);
    if (r >= 1024 && !c.gMDone && feats(c).wat) { waterMask(c); water(); }
    H.redraw(); pump();
  }

  // ---------- water laten ademen: alleen in iso en als er water met masker in beeld is ----------
  let stopAnim = null;
  function water() {
    const vd = H.viewDist(), on = iso() && [...H.chunks.values()].some(c => c.mTex && c.gDt !== undefined && c.gDt < vd * 0.9 + 300);
    if (on && !stopAnim) stopAnim = H.animate(now => { GU.uGrT.value = now / 1000; });
    else if (!on && stopAnim) { stopAnim(); stopAnim = null; }
  }

  H.on('chunk', c => { c.gOn = true; c.terrain.material.userData.groundChunk = c; c.terrain.material.needsUpdate = true; later(); });
  H.on('detail', later);
  H.on('still', () => { later(); pump(); });
  H.on('mode', () => { later(); water(); });
  H.on('layers', () => { for (const c of H.chunks.values()) c.gRes = 0; later(); }); // rotondes komen uit layers.js: vakken die eerder geschilderd waren opnieuw
  H.on('turn', later);
})();
