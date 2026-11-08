// iso/traffic.js — stroom F, verkeer: treinen over de spoorroutes, bussen over de buslijnen (data/traffic.js, OSM route-relaties), rustig tempo.
// Snelheid: alle bussen = één InstancedMesh, alle wagons = één InstancedMesh (2 draw calls + 2 in de lijnen-pass), op de bewegende laag
// (H.addDynamic) → per stap alleen nabewerking ('post'), geen hele scène-render. ±20 stappen/s; ver uitgezoomd of buiten iso: stil en verborgen.
(() => {
  const T = window.H3D_DATA?.traffic;
  const H = typeof H3D !== 'undefined' ? H3D : null; // H3D = const in app.js (geen window-eigenschap)
  if (!T || !H?.on || !H.addDynamic) return;

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
    H.animate(tick);
  }

  // ---------- beweging ----------
  const m4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), HID = new THREE.Matrix4().makeScale(0, 0, 0);
  function place(mesh, i, R, s, L, lift, off) { // voertuig met midden op s, lengte L; off = zijwaarts (rechts +)
    if (s - L / 2 < 0 || s + L / 2 > R.len) { mesh.setMatrixAt(i, HID); return; }
    at(R, s + L / 2, _a); at(R, s - L / 2, _b);
    m4.lookAt(_a, _b, UP); // z-as = voor − achter = rijrichting
    if (off) { side.set(-(_a.z - _b.z), 0, _a.x - _b.x).normalize().multiplyScalar(off); _a.add(side); _b.add(side); }
    m4.setPosition((_a.x + _b.x) / 2, (_a.y + _b.y) / 2 + lift, (_a.z + _b.z) / 2);
    mesh.setMatrixAt(i, m4);
  }
  const half = () => { const c = H.camera(); return c && c.isOrthographicCamera ? (c.top - c.bottom) / (2 * c.zoom) : Infinity; };
  let last = 0, shown = false;
  function show(on) { if (on === shown) return false; shown = on; if (busMesh) busMesh.visible = on; if (carMesh) carMesh.visible = on; return true; }
  function tick(now) {
    const vis = half() < HIDE_HALF;
    if (!vis) return show(false) ? 'post' : 'none';
    const dt = last ? Math.min(0.2, (now - last) / 1000) : 0;
    if (now - last < 50 && shown) return 'none';
    last = now; show(true);
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

  H.on('loaded', build);
  H.traffic = { buses: () => buses, trains: () => trains };
})();
