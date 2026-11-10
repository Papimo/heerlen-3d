// iso/traffic.js — stroom F, verkeer: treinen over de spoorroutes, bussen over de buslijnen (data/traffic.js, OSM route-relaties), rustig tempo.
// Snelheid: alle bussen = één InstancedMesh, alle wagons = één InstancedMesh (2 draw calls + 2 in de lijnen-pass), op de bewegende laag
// (H.addDynamic) → per stap alleen nabewerking ('post'), geen hele scène-render. ±20 stappen/s; ver uitgezoomd of buiten iso: stil en verborgen.
(() => {
// Met data/transit.js (tools/build-gtfs.cjs, OVapi GTFS): bussen en treinen op dienstregeling (H.now = klok van app.js), haltes/stations
// aanklikbaar (H.clickStop → pick 'halte' → vertrekbord in ui.js). Zonder transit.js: oude stand (OSM-routes, willekeurig).
  const T = window.H3D_DATA?.traffic, TR = window.H3D_DATA?.transit;
  const H = typeof H3D !== 'undefined' ? H3D : null; // H3D = const in app.js (geen window-eigenschap)
  if ((!T && !TR) || !H?.on || !H.addDynamic) return;

  const STEP = 5;                                   // m tussen routepunten (hoogte volgt het terrein)
  const BUS = { len: 12, speed: 8, side: 1.8, per: 3500, max: 0, lift: 0.15 };     // per = m route per bus; max 0 = bussen voorlopig uit (gebruiker), was 50
  const TRAIN = { car: 26, gap: 1.2, cars: 3, speed: 14, max: 10, lift: 1.0 };
  const HIDE_HALF = 3500;                           // zichtbare halve hoogte (m) waarboven alles stil en weg is
  const BUS_COL = ['#e9e2d0', '#e9e2d0', '#b5543c', '#c9a04a', '#4f6f52', '#5f7f9e'].map(c => new THREE.Color(c));
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- routes → gelijkmatige punten (x, y, z wereld) ----------
  let O, km;
  const hAt = (x, y) => H.chunks.get(Math.floor(x / km) + '_' + Math.floor(y / km))?.dem ? H.heightAt(x, y) : null;
  function sample(r) {
    const xy = r.xy, br = r.br || null, n = xy.length / 2, X = [], Y = [], Z = [], B = [];
    for (let k = 0; k + 1 < n; k++) {
      const x0 = xy[2 * k], y0 = xy[2 * k + 1], x1 = xy[2 * k + 2], y1 = xy[2 * k + 3], m = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / STEP));
      for (let s = 0; s < m; s++) { X.push(x0 + (x1 - x0) * s / m); Y.push(y0 + (y1 - y0) * s / m); B.push(br ? br[k + 1] : 0); } // segment k→k+1 hoort bij het wegstuk van punt k+1
    }
    X.push(xy[2 * n - 2]); Y.push(xy[2 * n - 1]); B.push(0);
    const m = X.length, P = new Float32Array(m * 3);
    let last = null;
    for (let i = 0; i < m; i++) {
      const h = B[i] ? null : hAt(O[0] + X[i], O[1] + Y[i]);
      P[i * 3] = X[i]; P[i * 3 + 2] = -Y[i]; P[i * 3 + 1] = h == null ? NaN : h;
      if (h != null) last = h;
    }
    if (last == null) return null;
    // gaten (bruggen, niet-geladen vakken) lineair tussen bekende hoogtes
    for (let i = 0; i < m; i++) {
      if (!isNaN(P[i * 3 + 1])) continue;
      let a = i - 1; while (a >= 0 && isNaN(P[a * 3 + 1])) a--;
      let b = i + 1; while (b < m && isNaN(P[b * 3 + 1])) b++;
      const ha = a >= 0 ? P[a * 3 + 1] : null, hb = b < m ? P[b * 3 + 1] : null;
      for (let j = i; j < b; j++) P[j * 3 + 1] = ha == null ? hb : hb == null ? ha : ha + (hb - ha) * (j - a) / (b - a);
      i = b - 1;
    }
    return { P, n: m, len: (m - 1) * STEP };
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function at(R, s, out) { // punt op afstand s (m) langs de route
    const f = Math.max(0, Math.min(R.n - 1.001, s / STEP)), k = Math.floor(f), t = f - k, P = R.P, o = k * 3;
    return out.set(P[o] + (P[o + 3] - P[o]) * t, P[o + 1] + (P[o + 4] - P[o + 1]) * t, P[o + 2] + (P[o + 5] - P[o + 2]) * t);
  }

  // ---------- modellen (lange as = +z = rijrichting, voet op 0) ----------
  function boxes(list) { // [[w, h, l, y, z, kleur]] → één geometrie met vertex-kleur
    const parts = list.map(([w, h, l, y, z, c]) => {
      const g = new THREE.BoxGeometry(w, h, l).toNonIndexed(); g.translate(0, y + h / 2, z || 0);
      const col = new THREE.Color(c), C = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < C.length; k += 3) { C[k] = col.r; C[k + 1] = col.g; C[k + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.deleteAttribute('uv'); return g;
    });
    const n = parts.reduce((t, g) => t + g.attributes.position.count, 0), P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o); N.set(g.attributes.normal.array, o); C.set(g.attributes.color.array, o); o += g.attributes.position.array.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    return g;
  }
  // bus: wit (krijgt lijnkleur via instanceColor), donkere ruitband, lichter dak, zwarte voorruit
  const busGeo = () => boxes([[2.55, 2.75, BUS.len, 0.35, 0, '#ffffff'], [2.6, 0.95, BUS.len - 1.2, 1.55, -0.2, '#3a4048'], [2.6, 1.2, 0.1, 1.4, BUS.len / 2, '#3a4048'],
    [2.2, 0.25, BUS.len * 0.6, 3.1, -1, '#d6d2c8'], [2.62, 0.35, BUS.len - 0.4, 0.35, 0, '#55504a']]);
  // wagon: crème, rode band, ruitband, grijs dak (instanceColor wit = ongewijzigd)
  const carGeo = () => boxes([[2.9, 3.4, TRAIN.car, 0.8, 0, '#efe6cf'], [2.95, 0.5, TRAIN.car - 0.6, 1.2, 0, '#b4442f'], [2.95, 0.9, TRAIN.car - 2.5, 2.25, 0, '#2f3640'],
    [2.5, 0.35, TRAIN.car - 1, 4.2, 0, '#9aa0a6'], [2.4, 0.6, TRAIN.car - 4, 0.2, 0, '#3b3733']]);

  // ---------- opbouw ----------
  let buses = [], trains = [], busMesh = null, carMesh = null, built = false;
  function build() {
    if (built) return; built = true;
    O = H.areaInfo.origin; km = H.areaInfo.km || 1000;
    if (TR) return buildTransit();
    const busR = [], trainR = [];
    for (const r of T.routes) { const R = sample(r); if (R && R.len > 300) (r.k === 'train' ? trainR : busR).push(R); }
    // bussen: naar routelengte verdeeld, max BUS.max
    for (const R of busR) { const k = Math.max(1, Math.min(3, Math.round(R.len / BUS.per))); for (let i = 0; i < k; i++) buses.push({ R, s: R.len * (i + Math.random() * 0.5) / k, wait: 0, c: BUS_COL[Math.floor(Math.random() * BUS_COL.length)] }); }
    buses.sort(() => Math.random() - 0.5); buses = buses.slice(0, BUS.max);
    trainR.sort(() => Math.random() - 0.5);
    for (const R of trainR.slice(0, TRAIN.max)) trains.push({ R, s: rnd(0, R.len), wait: 0 });
    const mat = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'traffic');
    if (buses.length) {
      busMesh = new THREE.InstancedMesh(busGeo(), mat, buses.length); busMesh.frustumCulled = false;
      buses.forEach((b, i) => busMesh.setColorAt(i, b.c)); busMesh.instanceColor.needsUpdate = true;
      H.addDynamic(busMesh);
    }
    if (trains.length) { carMesh = new THREE.InstancedMesh(carGeo(), mat, trains.length * TRAIN.cars); carMesh.frustumCulled = false; H.addDynamic(carMesh); }
    H.animate(tick, 'verkeer');
  }

  // ---------- beweging ----------
  const m4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), HID = new THREE.Matrix4().makeScale(0, 0, 0);
  function place(mesh, i, R, s, L, lift, off) { // voertuig met midden op s, lengte L; off = zijwaarts (rechts +); true = staat in beeld (FR, per tik gezet)
    if (s - L / 2 < 0 || s + L / 2 > R.len) { mesh.setMatrixAt(i, HID); return false; }
    at(R, s + L / 2, _a); at(R, s - L / 2, _b);
    m4.lookAt(_a, _b, UP); // z-as = voor − achter = rijrichting
    if (off) { side.set(-(_a.z - _b.z), 0, _a.x - _b.x).normalize().multiplyScalar(off); _a.add(side); _b.add(side); }
    m4.setPosition((_a.x + _b.x) / 2, (_a.y + _b.y) / 2 + lift, (_a.z + _b.z) / 2);
    mesh.setMatrixAt(i, m4);
    return FR.intersectsSphere(VS.set(_c.setFromMatrixPosition(m4), L));
  }
  // in beeld? camera-frustum één keer per tik; geen voertuig in beeld (nu én vorige tik) = geen nabewerking
  const FR = new THREE.Frustum(), FM = new THREE.Matrix4(), VS = new THREE.Sphere(), _c = new THREE.Vector3();
  function frustum() { const c = H.camera(); c.updateMatrixWorld(); FR.setFromProjectionMatrix(FM.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse)); }
  // ver uitgezoomd bewegen voertuigen < 1 px per tik → minder vaak bijwerken (halve hoogte > 600 m: om de 2 tikken, > 1500 m: om de 3)
  let tk = 0, seenT = true;
  const skip = () => ++tk % (half() > 1500 ? 3 : half() > 600 ? 2 : 1) !== 0;
  const half = () => { const c = H.camera(); return c && c.isOrthographicCamera ? (c.top - c.bottom) / (2 * c.zoom) : H.driving?.() ? 50 : Infinity; }; // rijden: als dichtbij ingezoomd
  let last = 0, shown = false;
  function show(on) { if (on === shown) return false; shown = on; if (busMesh) busMesh.visible = on; if (carMesh) carMesh.visible = on; return true; }
  function tick(now) {
    const vis = half() < HIDE_HALF && H.fxOn('verkeer');
    if (!vis) return show(false) ? 'post' : 'none';
    const dt = last ? Math.min(0.2, (now - last) / 1000) : 0;
    last = now; show(true); frustum();
    buses.forEach((b, i) => {
      if (b.wait > 0) b.wait -= dt; else b.s += BUS.speed * dt;
      if (b.s > b.R.len + BUS.len) { b.s = -BUS.len / 2; b.wait = rnd(5, 25); }
      place(busMesh, i, b.R, b.s, BUS.len, BUS.lift, BUS.side);
    });
    if (busMesh) busMesh.instanceMatrix.needsUpdate = true;
    const step = TRAIN.car + TRAIN.gap, TL = step * TRAIN.cars;
    trains.forEach((t, j) => {
      if (t.wait > 0) t.wait -= dt; else t.s += TRAIN.speed * dt;
      if (t.s - TL > t.R.len) { t.s = 0; t.wait = rnd(20, 60); }
      for (let c = 0; c < TRAIN.cars; c++) place(carMesh, j * TRAIN.cars + c, t.R, t.s - step * (c + 0.5), TRAIN.car, TRAIN.lift, 0);
    });
    if (carMesh) carMesh.instanceMatrix.needsUpdate = true;
    return 'post';
  }

  // ================= dienstregeling (data/transit.js) =================
  const DW = { bus: 12, train: 40 };                // s stilstaan bij een halte als de dienstregeling aankomst = vertrek zegt
  const CAP = { bus: 260, train: 40 };              // max tegelijk (InstancedMesh-plaatsen)
  const STOP_PICK = 18;                             // px klikstraal halte/station
  let RT = [], TRIPS = [], GSTOPS = [], groups = [], stopMesh = null, active = [], activeAt = -1e9;
  const dayMask = d => { const w = d.getDay(); return w === 0 ? 4 : w === 6 ? 2 : 1; };
  const secOf = d => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
  const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const ease = u => u * u * (3 - 2 * u);            // optrekken en afremmen
  const carsOf = r => /intercity|\bic\b|re\s?\d|eurocity/i.test(r[1] + ' ' + r[2]) ? 4 : 2;

  function buildTransit() {
    const D = TR;
    RT = D.routes.map(r => ({ k: r[0], ref: r[1], name: r[2], c: r[3] ? new THREE.Color(r[3]) : BUS_COL[hash(r[1]) % BUS_COL.length], cars: r[0] === 'train' ? carsOf(r) : 0 }));
    groups = D.groups.map(([name, x, y, k]) => ({ name, x, y, k, h: hAt(O[0] + x, O[1] + y), dep: [] })); // h null = buiten de geladen vakken: geen bord, niet aanklikbaar
    // shapes → routepunten met hoogte; afstand in de data = langs de vereenvoudigde lijn → schalen naar onze bemonstering
    const SH = D.shapes.map(xy => {
      const R = xy.length >= 4 ? sample({ xy }) : null; if (!R) return null;
      let L = 0; for (let k = 2; k < xy.length; k += 2) L += Math.hypot(xy[k] - xy[k - 2], xy[k + 1] - xy[k - 1]);
      R.f = L > 0 ? R.len / L : 1; return R;
    });
    for (const [pi, days, t0, d] of D.trips) {
      const [ri, si, head, st, dist] = D.pats[pi], R = SH[si], r = RT[ri]; if (!R || !r) continue;
      const n = st.length, A = new Float64Array(n), De = new Float64Array(n);
      A[0] = De[0] = t0; let t = t0;
      for (let i = 1; i < n; i++) { t += d[2 * i - 2]; A[i] = t; t += i < n - 1 ? d[2 * i - 1] : 0; De[i] = i < n - 1 ? t : A[i]; }
      const dw = DW[r.k] || 12, Ae = A.slice(); // Ae = aankomst om te tekenen (iets eerder, zodat het voertuig op tijd vertrekt)
      for (let i = 1; i < n - 1; i++) if (De[i] - A[i] < dw) Ae[i] = Math.min(A[i], De[i] - Math.min(dw, 0.35 * (A[i] - De[i - 1])));
      const S = Float64Array.from(dist, v => v * R.f);
      TRIPS.push({ r, R, head, days, A: Ae, D: De, S, a: t0 - dw, b: A[n - 1] + dw, dw, n, k: 0, g: st.map(x => D.stops[x]?.[2]) });
    }
    TRIPS.sort((p, q) => p.a - q.a); // op begintijd (refreshActive stopt vroeg)
    // per halte/station: [tripIndex, haltePositie, …] (laatste halte van een rit = geen vertrek)
    TRIPS.forEach((tr, ti) => { for (let i = 0; i < tr.n - 1; i++) groups[tr.g[i]]?.dep.push(ti, i); });
    const mat = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'traffic');
    busMesh = new THREE.InstancedMesh(busGeo(), mat, CAP.bus); busMesh.frustumCulled = false; busMesh.count = 0;
    busMesh.setColorAt(0, BUS_COL[0]); H.addDynamic(busMesh);
    carMesh = new THREE.InstancedMesh(carGeo(), mat, CAP.train * 4); carMesh.frustumCulled = false; carMesh.count = 0; H.addDynamic(carMesh);
    buildStops(mat);
    H.animate(tickTransit, 'verkeer');
  }

  // haltepalen (per stoppunt) en stationsborden (per station): statisch in de scène, alleen iso + ingezoomd
  const poleGeo = () => boxes([[0.12, 2.6, 0.12, 0, 0, '#3b3f45'], [0.08, 0.7, 0.62, 2.0, 0, '#f2c230'], [0.1, 0.25, 0.64, 2.75, 0, '#2c5d8f']]);
  const signGeo = () => boxes([[0.25, 5.5, 0.25, 0, 0, '#3b3f45'], [0.3, 1.6, 1.6, 4.6, 0, '#2c5d8f'], [0.34, 0.9, 0.9, 4.95, 0, '#f2f0e8']]);
  function buildStops(mat) {
    const D = TR, poles = D.stops.filter(s => groups[s[2]]?.k === 0 && groups[s[2]].h != null && hAt(O[0] + s[0], O[1] + s[1]) != null), st = groups.filter(g => g.k === 1 && g.h != null);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
    const pm = new THREE.InstancedMesh(poleGeo(), mat, Math.max(1, poles.length)), sm = new THREE.InstancedMesh(signGeo(), mat, Math.max(1, st.length));
    poles.forEach(([x, y, gi], i) => { const g = groups[gi]; q.setFromAxisAngle(V.set(0, 1, 0), Math.atan2(x - g.x, -(y - g.y)) || 0); m.compose(V.set(x, hAt(O[0] + x, O[1] + y), -y), q, S1); pm.setMatrixAt(i, m); });
    st.forEach((g, i) => { m.compose(V.set(g.x, g.h, -g.y), q.identity(), S1); sm.setMatrixAt(i, m); });
    pm.count = poles.length; sm.count = st.length;
    stopMesh = new THREE.Group(); stopMesh.add(pm, sm); stopMesh.visible = false; H.scene.add(stopMesh);
  }

  function refreshActive(now) { // ritten die nu (vandaag of nog van gisteren, na middernacht) onderweg zijn
    const t = secOf(now), m = dayMask(now), y = dayMask(new Date(now - 864e5));
    active = [];
    for (const tr of TRIPS) {
      if (tr.a > t + 86400) break;
      if ((tr.days & m) && tr.a <= t && tr.b >= t) active.push([tr, 0]);
      else if ((tr.days & y) && tr.a <= t + 86400 && tr.b >= t + 86400) active.push([tr, 86400]);
    }
  }
  function posOf(tr, t) { // afstand langs de shape op tijd t (s)
    const { A, D, S, n } = tr;
    if (t <= D[0]) return S[0];
    let i = tr.k; if (i >= n || D[i] > t) i = 0;
    while (i < n - 1 && A[i + 1] <= t) i++;
    tr.k = i;
    if (i >= n - 1 || t <= D[i]) return S[i];
    return S[i] + (S[i + 1] - S[i]) * ease(Math.min(1, (t - D[i]) / Math.max(1, A[i + 1] - D[i])));
  }
  let shownT = false;
  function tickTransit() {
    const vis = half() < HIDE_HALF && H.fxOn('verkeer');
    if (!vis) { if (!shownT) return 'none'; shownT = false; busMesh.visible = carMesh.visible = stopMesh.visible = false; return 'post'; }
    if (!shownT) { shownT = true; seenT = true; busMesh.visible = carMesh.visible = stopMesh.visible = true; }
    else if (skip()) return 'none';
    const now = H.now(), real = performance.now();
    if (real - activeAt > 500) { activeAt = real; refreshActive(now); }
    const t = secOf(now);
    let nb = 0, nc = 0, seen = false; const step = TRAIN.car + TRAIN.gap;
    frustum();
    for (const [tr, off] of active) {
      const tt = t + off; if (tt < tr.a || tt > tr.b) continue;
      const L = tr.r.k === 'train' ? step * tr.r.cars : BUS.len, s = Math.max(L, Math.min(tr.R.len, posOf(tr, tt))); // s = voorkant; heel voertuig op de lijn
      if (tr.r.k === 'train') {
        if (nc + tr.r.cars > CAP.train * 4) continue;
        for (let c = 0; c < tr.r.cars; c++) if (place(carMesh, nc++, tr.R, s - step * (c + 0.5), TRAIN.car, TRAIN.lift, 0)) seen = true;
      } else if (nb < CAP.bus) { if (place(busMesh, nb, tr.R, s - BUS.len / 2 - 0.01, BUS.len, BUS.lift, BUS.side)) seen = true; busMesh.setColorAt(nb++, tr.r.c); }
    }
    busMesh.count = nb; carMesh.count = nc;
    busMesh.instanceMatrix.needsUpdate = true; carMesh.instanceMatrix.needsUpdate = true;
    if (busMesh.instanceColor) busMesh.instanceColor.needsUpdate = true;
    const was = seenT; seenT = seen;
    return seen || was ? 'post' : 'none'; // laatste keer nog wel: voertuig dat net uit beeld reed weghalen
  }

  // ---------- haltes aanklikken + vertrekbord ----------
  const _p = new THREE.Vector3();
  H.clickStop = (cx, cy) => {
    if (!TR || !groups.length || !shownT) return false;
    const cam = H.camera(), el = document.querySelector('#view canvas'); if (!cam || !el) return false;
    const r = el.getBoundingClientRect(); let best = null, bd = STOP_PICK;
    for (const g of groups) {
      if (g.h == null) continue;
      _p.set(g.x, g.h + (g.k ? 5 : 2.4), -g.y).project(cam); if (_p.z > 1) continue;
      const d = Math.hypot(r.left + (_p.x + 1) / 2 * r.width - cx, r.top + (1 - _p.y) / 2 * r.height - cy);
      if (d < bd) { bd = d; best = g; }
    }
    if (!best) return false;
    H.clearSelection?.(); H.emit('pick', { type: 'halte', g: groups.indexOf(best), name: best.name, k: best.k, x: O[0] + best.x, y: O[1] + best.y });
    return true;
  };
  // vertrekken vanaf halte/station gi na 'now' (Date), max n, binnen 'span' s; tijden over middernacht heen (gisteren/morgen)
  function departures(gi, now = H.now(), n = 10, span = 4 * 3600) {
    const g = groups[gi]; if (!g) return [];
    const t = secOf(now), days = [[dayMask(new Date(now - 864e5)), -86400], [dayMask(now), 0], [dayMask(new Date(+now + 864e5)), 86400]], out = [];
    for (let k = 0; k < g.dep.length; k += 2) {
      const tr = TRIPS[g.dep[k]], i = g.dep[k + 1];
      for (const [m, off] of days) if (tr.days & m) { const w = tr.D[i] + off - t; if (w >= -30 && w <= span) out.push({ w, at: tr.D[i] + off, ref: tr.r.ref, name: tr.r.name, k: tr.r.k, col: '#' + tr.r.c.getHexString(), head: tr.head }); }
    }
    return out.sort((a, b) => a.w - b.w).slice(0, n);
  }

  H.on('loaded', build);
  if (window.H3D_LOADED) build(); // module laadt na 'loaded' (index.html uitgesteld laden)
  H.traffic = { buses: () => buses, trains: () => trains };
  H.transit = TR ? { departures, groups: () => groups, active: () => active.length, src: TR.src } : null;
})();
