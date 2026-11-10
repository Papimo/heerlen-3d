// iso/drive.js — Rijden: auto als een pin op een weg neerzetten en zelf besturen, first person binnen de iso-look.
// app.js levert de haakjes: H.setDriveCam (eigen perspectief-camera door de iso-pijplijn: grond, omlijning, bewegende laag), H.addFrame, H.poke.
// Wereld: x = RD-x − origin, z = −(RD-y − origin); auto kijkt langs −z in eigen assen (yaw = rotatie om y).
// Toetsen (e.code, dus ook op AZERTY): W/↑ gas · S/↓ rem/achteruit · A/D/←/→ sturen · spatie handrem · Shift harder · Esc uitstappen. Slepen = rondkijken.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !window.THREE) return; // H3D = const in app.js (geen window-eigenschap)
  const SW = { primary: 10, secondary: 8.5, tertiary: 7, unclassified: 5.5, residential: 5.5, living_street: 4.5, pedestrian: 4.5, track: 3 }; // = app.js STREET_W + track
  const CAR = {
    len: 4.2, wid: 1.8, wb: 2.6,          // m; wielbasis voor de draaicirkel
    eye: [-0.36, 1.26, 0.27],             // bestuurder links (rechts rijden); hoogte gekozen door gebruiker (tussen 1,18 en 1,34)
    vMax: 22, vBoost: 33, vRev: 5, vOff: 8, // m/s (80 / 120 km/u; buiten de weg 29 km/u)
    acc: 4.5, brake: 9, hand: 12, drag: 0.35, offDrag: 3, steerMax: 0.6, grav: 4.9,
  };
  const CELL = 50; // m, raster voor wegstukken
  let car = null, cam = null, on = false, drop = false;
  const S = { x: 0, z: 0, y: 0, yaw: 0, v: 0, steer: 0, pitch: 0, roll: 0, lookY: 0, lookP: 0, street: '', off: false };
  const keys = new Set();

  // ---------- wegen: wegstukken in een raster (eenmalig uit H.layerData) ----------
  let segs = null, grid = null;
  function buildRoads() {
    const d = H.layerData, A = H.areaInfo; if (!d || !A) return false;
    const O = A.origin; segs = []; grid = new Map();
    const add = (xy, w, name) => {
      for (let k = 0; k + 3 < xy.length; k += 2) {
        const s = { ax: xy[k] - O[0], az: -(xy[k + 1] - O[1]), bx: xy[k + 2] - O[0], bz: -(xy[k + 3] - O[1]), w, name };
        const i = segs.push(s) - 1;
        const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
        const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
        for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const key = gx + ',' + gz; (grid.get(key) || grid.set(key, []).get(key)).push(i); }
      }
    };
    for (const [name, type, xy] of d.streets || []) if (SW[type]) add(xy, SW[type], name);
    for (const [type, , , xy] of d.roads || []) add(xy, type.endsWith('+') ? 6 : 10.5, type.startsWith('motorway') ? 'snelweg' : '');
    return true;
  }
  function nearest(x, z, r) { // dichtstbijzijnde wegstuk binnen r m → { s, d, px, pz, t }
    if (!segs && !buildRoads()) return null;
    let best = null;
    const g0 = Math.floor((x - r) / CELL), g1 = Math.floor((x + r) / CELL), h0 = Math.floor((z - r) / CELL), h1 = Math.floor((z + r) / CELL);
    for (let gx = g0; gx <= g1; gx++) for (let gz = h0; gz <= h1; gz++) for (const i of grid.get(gx + ',' + gz) || []) {
      const s = segs[i], dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2)), px = s.ax + dx * t, pz = s.az + dz * t;
      const dd = Math.hypot(x - px, z - pz) - s.w / 2; // afstand tot de wegrand (negatief = op de weg)
      if (dd < r && (!best || dd < best.d)) best = { s, d: dd, px, pz, t };
    }
    return best;
  }

  // ---------- botsen: muren van de panden per vak in een raster van 1 m (lui opgebouwd) ----------
  function wallGrid(c) {
    if (c._drvMesh === c.mesh && c._drvGrid) return c._drvGrid;
    const km = H.areaInfo.km, O = H.areaInfo.origin, g = new Uint8Array(km * km);
    const geo = c.mesh.geometry, P = geo.attributes.position.array, I = geo.index.array;
    const ox = c.x0 - O[0], oz = -(c.y0 + km - O[1]); // wereld-x van kolom 0, wereld-z van rij 0 (noordrand)
    const mark = (x, z) => { const gx = Math.floor(x - ox), gz = Math.floor(z - oz); if (gx >= 0 && gz >= 0 && gx < km && gz < km) g[gz * km + gx] = 1; };
    for (let t = c.nr * 3, e = (c.nr + c.nw) * 3; t < e; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
      const ya = P[a + 1], yb = P[b + 1], yd = P[d + 1];
      if (Math.max(ya, yb, yd) - Math.min(ya, yb, yd) < 0.8) continue; // geen lage randjes
      // muur staat rechtop → langste rand in xz = de muurstrook
      let p = a, q = b, L = (P[a] - P[b]) ** 2 + (P[a + 2] - P[b + 2]) ** 2;
      const L2 = (P[b] - P[d]) ** 2 + (P[b + 2] - P[d + 2]) ** 2, L3 = (P[a] - P[d]) ** 2 + (P[a + 2] - P[d + 2]) ** 2;
      if (L2 > L) { p = b; q = d; L = L2; } if (L3 > L) { p = a; q = d; L = L3; }
      const n = Math.max(1, Math.ceil(Math.sqrt(L) / 0.5));
      for (let k = 0; k <= n; k++) mark(P[p] + (P[q] - P[p]) * k / n, P[p + 2] + (P[q + 2] - P[p + 2]) * k / n);
    }
    c._drvMesh = c.mesh; c._drvGrid = g;
    return g;
  }
  function hit(x, z) { // muur (of buiten het gebied) op wereldpunt?
    const A = H.areaInfo, km = A.km, rx = x + A.origin[0], ry = A.origin[1] - z;
    const c = H.chunks.get(Math.floor(rx / km) + '_' + Math.floor(ry / km));
    if (!c) return true; // buiten de geladen vakken: niet verder
    if (!c.mesh) return false; // panden nog niet gebouwd
    const g = wallGrid(c), gx = Math.floor(rx - c.x0), gz = Math.floor(c.y0 + km - ry);
    return gx >= 0 && gz >= 0 && gx < km && gz < km && g[gz * km + gx] === 1;
  }
  function carHits(x, z, yaw) { // hoeken + midden voor/achter
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx, hl = CAR.len / 2 - 0.15, hw = CAR.wid / 2 - 0.1;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]])
      if (hit(x + fx * a + rx * b, z + fz * a + rz * b)) return true;
    return false;
  }

  // ---------- auto: speelgoedauto (van buiten = geparkeerd in iso) met dashboard + stuur voor de bestuurder ----------
  let wheel = null, needle = null, wheels = [];
  function makeCar() {
    const g = new THREE.Group(), M = c => { const m = new THREE.MeshLambertMaterial({ color: c }); H.celify?.(m, 'car'); return m; }; // zelfde cel-look als de rest
    const red = M(0xd9564a), dark = M(0x2f323a), dash = M(0x454a55), tyre = M(0x1e1f23), white = M(0xf3efe6), chrome = M(0xc9ccd2);
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
    box(1.8, 0.5, 1.45, 0, 0.62, -1.38, red);    // motorkap
    box(1.8, 0.5, 0.95, 0, 0.62, 1.62, red);     // kofferbak
    box(0.1, 0.5, 2.0, 0.85, 0.62, 0.15, red);   // deuren (alleen dorpel/rand: van binnen zie je erlangs)
    box(0.1, 0.5, 2.0, -0.85, 0.62, 0.15, red);
    box(1.72, 0.2, 0.42, 0, 0.92, -0.5, dash);   // dashboard
    box(1.6, 0.05, 0.9, 0, 1.5, 0.35, red);      // dak
    const pil = (x0, y0, z0, x1, y1, z1) => { // stijl tussen twee punten
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), L = a.distanceTo(b);
      const o = new THREE.Mesh(new THREE.BoxGeometry(0.07, L, 0.07), red); o.position.copy(a).add(b).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(o);
    };
    pil(0.82, 0.87, -0.72, 0.76, 1.48, -0.08); pil(-0.82, 0.87, -0.72, -0.76, 1.48, -0.08); // A-stijlen
    pil(0.8, 0.87, 0.95, 0.76, 1.48, 0.78); pil(-0.8, 0.87, 0.95, -0.76, 1.48, 0.78);       // C-stijlen
    for (const [x, z] of [[0.82, -1.35], [-0.82, -1.35], [0.82, 1.3], [-0.82, 1.3]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14), tyre); w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w); wheels.push(w);
    }
    // stuur: kantelt naar de bestuurder, draait om eigen as
    const piv = new THREE.Group(); piv.position.set(CAR.eye[0], 1.0, -0.17); piv.rotation.x = 0.45; g.add(piv);
    wheel = new THREE.Group(); piv.add(wheel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 28), dark); wheel.add(ring);
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.02), dark); s.position.set(Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); s.rotation.z = a; wheel.add(s); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12), chrome); hub.rotation.x = Math.PI / 2; wheel.add(hub);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), dark); col.rotation.x = Math.PI / 2; col.position.z = -0.15; piv.add(col);
    // teller achter het stuur
    const dial = new THREE.Group(); dial.position.set(CAR.eye[0], 1.04, -0.52); dial.rotation.x = -0.35; g.add(dial);
    dial.add(new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), white));
    needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.07, 0.004), red); needle.geometry.translate(0, 0.03, 0.003); dial.add(needle);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData.car = true; } });
    g.visible = false;
    H.scene.add(g);
    return g;
  }

  // ---------- camera + HUD ----------
  let hud = null;
  function makeHud() {
    hud = document.createElement('div'); hud.id = 'drivehud';
    let ticks = '';
    for (let k = 0; k <= 140; k += 10) { // 0–140 km/u over 240°
      const a = (-120 + k / 140 * 240) * Math.PI / 180, big = k % 20 === 0, r1 = big ? 40 : 43;
      ticks += `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * 47).toFixed(1)}" y2="${(-Math.cos(a) * 47).toFixed(1)}"${big ? ' class="big"' : ''}/>`;
      if (big) ticks += `<text x="${(Math.sin(a) * 32).toFixed(1)}" y="${(-Math.cos(a) * 32 + 3).toFixed(1)}">${k}</text>`;
    }
    hud.innerHTML = '<svg class="dgauge" viewBox="-52 -52 104 104"><circle r="50" class="face"/>' + ticks
      + '<line class="ndl" x1="0" y1="6" x2="0" y2="-41"/><circle r="4" class="hubc"/><text class="dnum" y="24">0</text><text class="dunit" y="33">km/u</text></svg>'
      + '<div class="dstreet"></div>'
      + '<button type="button" class="dexit">Uitstappen <kbd>Esc</kbd></button>'
      + '<div class="dhelp"><kbd>W</kbd><kbd>↑</kbd> gas · <kbd>S</kbd><kbd>↓</kbd> rem / achteruit · <kbd>A</kbd><kbd>D</kbd> sturen · <kbd>spatie</kbd> handrem · <kbd>Shift</kbd> harder · slepen = rondkijken</div>';
    document.body.appendChild(hud);
    hud.querySelector('.dexit').addEventListener('click', () => stop());
    const hint = document.createElement('div'); hint.id = 'drophint'; hint.textContent = 'Klik op een weg om de auto neer te zetten · Esc = annuleren';
    document.body.appendChild(hint);
  }
  function fitCam() { const el = H.renderer.domElement; cam.aspect = el.clientWidth / Math.max(1, el.clientHeight); cam.updateProjectionMatrix(); }

  // ---------- neerzetten ----------
  function setDrop(v) {
    drop = v; document.body.classList.toggle('drop', v);
    document.getElementById('drivebtn')?.classList.toggle('on', v || on);
  }
  function groundAt(cx, cy) { // schermpunt → grondpunt onder de iso-camera (straal tegen het terrein, paar keer bijstellen)
    const c = H.camera(), el = H.renderer.domElement, r = el.getBoundingClientRect();
    const v = new THREE.Vector3(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1, -1).unproject(c);
    const dir = new THREE.Vector3(); c.getWorldDirection(dir);
    if (c.isPerspectiveCamera) dir.copy(v).sub(c.position).normalize();
    const A = H.areaInfo, p = new THREE.Vector3();
    let h = H.heightAt(...H.toRD(H.controls.target)); // startschatting: hoogte onder het midden van het beeld
    for (let k = 0; k < 6; k++) { p.copy(v).addScaledVector(dir, (h - v.y) / dir.y); h = H.heightAt(p.x + A.origin[0], A.origin[1] - p.z); }
    return p;
  }
  function place(p) {
    const n = nearest(p.x, p.z, 80);
    let x = p.x, z = p.z, yaw = 0;
    const view = new THREE.Vector3(); H.camera().getWorldDirection(view);
    if (n) {
      const s = n.s, dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1;
      let fx = dx / L, fz = dz / L;
      if (fx * view.x + fz * view.z < 0) { fx = -fx; fz = -fz; } // rijrichting zoals je naar het scherm kijkt
      const off = s.w < 6 ? 0 : s.w / 4; // rechterhelft van de weg
      x = n.px - fz * off; z = n.pz + fx * off; yaw = Math.atan2(-fx, -fz);
      S.street = s.name || '';
    } else { yaw = Math.atan2(-view.x, -view.z); S.street = ''; }
    if (carHits(x, z, yaw)) { // in een pand geklikt: kleine stapjes langs de weg zoeken
      let ok = false;
      for (let r = 2; r <= 30 && !ok; r += 2) for (const s of [1, -1]) { const tx = x - Math.sin(yaw) * r * s, tz = z - Math.cos(yaw) * r * s; if (!carHits(tx, tz, yaw)) { x = tx; z = tz; ok = true; break; } }
    }
    Object.assign(S, { x, z, yaw, v: 0, steer: 0, lookY: 0, lookP: 0 });
    S.y = H.heightAt(x + H.areaInfo.origin[0], H.areaInfo.origin[1] - z);
    start();
  }
  function start() {
    car ||= makeCar(); cam ||= new THREE.PerspectiveCamera(70, 1, 0.15, H.DRV_FAR || 650); // verder = mist (app.js), niet getekend
    fitCam(); car.visible = true; on = true; setDrop(false); keys.clear();
    pose(0); H.setDriveCam(cam);
  }
  function stop() {
    if (!on) return;
    on = false; keys.clear(); H.setDriveCam(null); setDrop(false);
    const A = H.areaInfo; // auto blijft geparkeerd staan; iso vliegt erheen
    H.flyTo(S.x + A.origin[0], A.origin[1] - S.z, { half: 60, ms: 900 });
  }

  // ---------- rijden ----------
  const hAt = (x, z) => H.heightAt(x + H.areaInfo.origin[0], H.areaInfo.origin[1] - z);
  let gridT = 0;
  function step(dt) {
    const k = c => keys.has(c);
    const thr = k('KeyW') || k('ArrowUp'), brk = k('KeyS') || k('ArrowDown'), hand = k('Space'), boost = k('ShiftLeft') || k('ShiftRight');
    const st = (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0);
    const n = nearest(S.x, S.z, 12); S.off = !n || n.d > 1.5; if (n && n.d < 3 && n.s.name) S.street = n.s.name;
    let v = S.v;
    if (thr) v += (v < -0.1 ? CAR.brake : CAR.acc) * dt;
    if (brk) v -= (v > 0.1 ? CAR.brake : CAR.acc * 0.7) * dt;
    if (hand) v -= Math.sign(v) * Math.min(Math.abs(v), CAR.hand * dt);
    v -= Math.sign(v) * Math.min(Math.abs(v), (CAR.drag + (S.off ? CAR.offDrag : 0) + 0.003 * v * v) * dt);
    v -= CAR.grav * Math.sin(S.pitch) * dt; // heuvel op = trager, af = sneller (Heerlen!)
    const vmax = S.off ? CAR.vOff : boost ? CAR.vBoost : CAR.vMax;
    if (v > vmax) v = Math.max(vmax, v - CAR.brake * dt);
    if (v < -CAR.vRev) v = -CAR.vRev;
    if (!thr && !brk && Math.abs(v) < 0.05) v = 0;
    const target = st * CAR.steerMax / (1 + Math.abs(v) / 10); // hard rijden = minder stuuruitslag
    S.steer += (target - S.steer) * Math.min(1, dt * 5);
    const yaw = S.yaw + v / CAR.wb * Math.tan(S.steer) * dt;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), nx = S.x + fx * v * dt, nz = S.z + fz * v * dt;
    if (!carHits(nx, nz, yaw)) { S.x = nx; S.z = nz; S.yaw = yaw; }
    else if (!carHits(nx, S.z, yaw)) { S.x = nx; S.yaw = yaw; v *= 0.6; } // langs de muur schuren
    else if (!carHits(S.x, nz, yaw)) { S.z = nz; S.yaw = yaw; v *= 0.6; }
    else if (!carHits(S.x, S.z, yaw)) { S.yaw = yaw; v = -v * 0.25; }
    else v = -v * 0.25; // botsing: terugveren
    S.v = v;
    // hoogte, kanteling uit het terrein onder de wielen
    const f = -Math.sin(S.yaw), g = -Math.cos(S.yaw), hb = CAR.wb / 2;
    const hF = hAt(S.x + f * hb, S.z + g * hb), hB = hAt(S.x - f * hb, S.z - g * hb), hL = hAt(S.x + g * 0.8, S.z - f * 0.8), hR = hAt(S.x - g * 0.8, S.z + f * 0.8);
    const a = Math.min(1, dt * 8);
    S.y += ((hF + hB) / 2 - S.y) * a;
    S.pitch += (Math.atan2(hF - hB, CAR.wb) - S.pitch) * a;
    S.roll += (Math.atan2(hL - hR, 1.6) - S.roll) * a;
    // rondkijken veert terug als je niet sleept
    if (!look) { const b = Math.exp(-dt * 2.5); S.lookY *= b; S.lookP *= b; }
    // muurraster van de vakken rondom alvast opbouwen (één per 0,3 s, niet tijdens een botsing)
    if ((gridT += dt) > 0.3) {
      gridT = 0; const A = H.areaInfo, km = A.km, rx = S.x + A.origin[0], ry = A.origin[1] - S.z;
      for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = H.chunks.get((Math.floor(rx / km) + di) + '_' + (Math.floor(ry / km) + dj));
        if (c?.mesh && !(c._drvMesh === c.mesh && c._drvGrid)) { wallGrid(c); break; }
      }
    }
  }
  const e3 = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion(), eye = new THREE.Vector3();
  function pose(dt) {
    car.position.set(S.x, S.y, S.z);
    car.rotation.set(0, 0, 0); car.quaternion.setFromEuler(e3.set(S.pitch, S.yaw, S.roll, 'YXZ'));
    car.updateMatrixWorld(true);
    eye.set(...CAR.eye); car.localToWorld(eye);
    cam.position.copy(eye);
    q.setFromEuler(e3.set(S.lookP - 0.04, S.lookY, 0, 'YXZ'));
    cam.quaternion.copy(car.quaternion).multiply(q);
    cam.updateMatrixWorld();
    if (wheel) wheel.rotation.z = S.steer * 3.2;
    if (needle) needle.rotation.z = 2.2 - Math.min(1, Math.abs(S.v) * 3.6 / 140) * 4.4;
    for (const w of wheels) w.rotation.x -= S.v * dt / 0.33;
    // laden + schaduwkader volgen een punt vóór de auto
    const t = H.controls; if (t) t.target.set(S.x - Math.sin(S.yaw) * 120, S.y, S.z - Math.cos(S.yaw) * 120);
    if (hud) {
      const kmh = Math.abs(S.v) * 3.6;
      hud.querySelector('.dnum').textContent = Math.round(kmh);
      hud.querySelector('.ndl').setAttribute('transform', `rotate(${(-120 + Math.min(1.03, kmh / 140) * 240).toFixed(1)})`);
      hud.querySelector('.dstreet').textContent = S.street + (S.off ? ' · buiten de weg' : '');
    }
  }
  // zuinig: max beelden/s tijdens rijden (standaard 30, ?fps=60 om te vergelijken; Zuinig-stand 24) en niets tekenen als de auto stilstaat
  const FPS = +new URLSearchParams(location.search).get('fps') || 30;
  let acc = 0, still = false;
  H.addFrame((now, dtMs) => {
    if (!on) return false;
    acc += dtMs;
    if (acc < 1000 / (H.fxOn?.('zuinig') ? Math.min(24, FPS) : FPS) - 3) return false; // −3: rAF-jitter
    const dt = Math.min(0.05, acc / 1000); acc = 0;
    const idle = S.v === 0 && !keys.size && !look && Math.abs(S.steer) < 1e-3 && Math.abs(S.lookY) < 1e-3 && Math.abs(S.lookP) < 1e-3;
    if (idle && still) return false; // stilstand: laatste beeld laten staan
    still = idle;
    if (dt > 0) step(dt);
    pose(dt);
    if (keys.size) H.poke?.();
    return true;
  });

  // ---------- invoer (capture op window: komt vóór OrbitControls, aanklikken en de sneltoetsen) ----------
  const typing = e => e.target.closest?.('input,textarea,select');
  addEventListener('keydown', e => {
    if (!on && !drop) return;
    if (typing(e)) return;
    if (e.code === 'Escape') { if (on) stop(); else setDrop(false); e.preventDefault(); e.stopPropagation(); return; }
    if (!on) return;
    keys.add(e.code); e.preventDefault(); e.stopPropagation();
  }, true);
  addEventListener('keyup', e => { if (on) { keys.delete(e.code); e.stopPropagation(); } }, true);
  addEventListener('blur', () => keys.clear());
  let look = null;
  const onCanvas = e => e.target === H.renderer?.domElement;
  addEventListener('pointerdown', e => {
    if (drop && onCanvas(e)) { e.stopPropagation(); e.preventDefault(); place(groundAt(e.clientX, e.clientY)); return; }
    if (on && onCanvas(e)) { e.stopPropagation(); look = { x: e.clientX, y: e.clientY, ly: S.lookY, lp: S.lookP }; }
  }, true);
  addEventListener('pointermove', e => {
    if (!look) return;
    S.lookY = Math.max(-2.4, Math.min(2.4, look.ly - (e.clientX - look.x) * 0.006));
    S.lookP = Math.max(-0.6, Math.min(0.5, look.lp - (e.clientY - look.y) * 0.004));
    e.stopPropagation();
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, e => { if (look) { look = null; e.stopPropagation(); } else if (drop && onCanvas(e)) e.stopPropagation(); }, true);
  for (const ev of ['click', 'dblclick', 'wheel', 'contextmenu']) addEventListener(ev, e => { if ((on || drop) && onCanvas(e)) { e.stopPropagation(); e.preventDefault(); } }, { capture: true, passive: false });
  addEventListener('resize', () => { if (cam) { fitCam(); still = false; } });

  // ---------- knop ----------
  function init() {
    makeHud();
    const b = document.getElementById('drivebtn');
    b?.addEventListener('click', () => { if (on) stop(); else setDrop(!drop); });
    H.on?.('mode', () => { if (on) stop(); });
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init); else init();
  H.drive = { start: place, stop, state: () => ({ ...S, on }) }; // console/tests: H3D.drive.state()
})();
