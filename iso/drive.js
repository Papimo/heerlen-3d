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
    vMax: 33.4, vBoost: 38.9, vRev: 5, vOff: 19.5, // m/s (120 / 140 km/u met Shift; buiten de weg 70 km/u)
    acc: 4.5, brake: 9, hand: 12, drag: 0.35, offDrag: 1, steerMax: 0.6, grav: 4.9,
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
  let wheel = null, needle = null, wheels = [], charm = null;
  function makeCar() {
    const g = new THREE.Group(), M = c => { const m = new THREE.MeshLambertMaterial({ color: c }); H.celify?.(m, 'car'); return m; }; // zelfde cel-look als de rest
    const red = M(0xd9564a), dark = M(0x2f323a), dash = M(0x3b302b), tyre = M(0x1e1f23), white = M(0xf3efe6), chrome = M(0xc9ccd2);
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
    // --- carrosserie: sedan jaren 70, opgebouwd uit doorsneden (loft) → afgeronde schouders, wielkasten, gewelfde kap/kofferbak/dak ---
    const body = M(0xd9564a); body.side = THREE.DoubleSide;
    const loft = (rows, m) => { // rows = doorsneden met evenveel punten [x,y,z]; vlakken tussen opeenvolgende doorsneden
      const pos = [], idx = [], n = rows[0].length;
      for (const r of rows) for (const p of r) pos.push(...p);
      for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k + 1 < n; k++) { const a = i * n + k, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      const o = new THREE.Mesh(geo, m); g.add(o); return o;
    };
    const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const W0 = 0.86, WH = [[-1.35, 0], [1.3, 0]]; // halve breedte; wielen (z)
    const wOf = z => W0 - 0.075 * sm(-1.75, -2.1, z) - 0.06 * sm(1.75, 2.1, z);                // hoeken rond in bovenaanzicht
    const topOf = z => 0.955 - 0.1 * sm(-1.0, -2.1, z) - 0.035 * sm(1.3, 2.1, z);             // schouderlijn: kap loopt naar voren af
    const botOf = z => { let y = 0.3; for (const [zc] of WH) { const d = Math.abs(z - zc); if (d < 0.43) y = Math.max(y, 0.33 + Math.sqrt(0.43 * 0.43 - d * d)); } return y; }; // wielkasten
    const PROF = [[-0.025, 0.3], [0, 0.42], [0.006, 0.6], [-0.008, 0.78], [-0.035, 0.9], [-0.08, 0.95], [-0.13, 0.955]]; // (x t.o.v. breedte, y) onder → schouder
    const Z = []; for (let z = -2.1; z <= 2.1001; z += 0.035) Z.push(+z.toFixed(4));
    for (const sd of [1, -1]) loft(Z.map(z => {
      const w = wOf(z), t = topOf(z), bo = botOf(z);
      return PROF.map(([dx, y]) => { const yy = y > 0.6 ? 0.6 + (y - 0.6) * (t - 0.6) / 0.355 : y; return [sd * (w + dx), Math.max(yy, bo), z]; });
    }), body);
    const deck = (z0, z1, crown) => loft(Z.filter(z => z >= z0 - 1e-6 && z <= z1 + 1e-6).map(z => { // kap/kofferbak: van schouder tot schouder, licht gewelfd
      const xe = wOf(z) - 0.13, t = topOf(z), r = [];
      for (let k = 0; k <= 10; k++) { const u = -1 + k / 5; r.push([u * xe, t + crown * (1 - u * u), z]); }
      return r;
    }), body);
    deck(-2.1, -0.735, 0.035); deck(1.015, 2.1, 0.025);
    // voor- en achterkant dicht, grille, koplampen, bumpers, achterlichten
    box(1.56, 0.56, 0.04, 0, 0.58, -2.085, body); box(1.6, 0.62, 0.04, 0, 0.61, 2.085, body);
    const ink2 = M(0x1d1e22), chromeX = M(0xd7dade), lampM = M(0xfff4d6), tail = M(0xb3262b), amber = M(0xe39a2c), glassM = M(0x9fb4c0), seat = M(0x6b4a33), vinyl = M(0xc9b48f), carpet = M(0x2e2a28);
    box(0.78, 0.17, 0.03, 0, 0.66, -2.11, ink2);
    for (const y of [0.75, 0.57]) box(0.82, 0.02, 0.035, 0, y, -2.112, chromeX);
    for (let k = -3; k <= 3; k++) box(0.012, 0.15, 0.035, k * 0.11, 0.66, -2.112, chromeX); // grille-spijlen
    for (const x of [-0.58, 0.58]) {
      const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 24), chromeX); hl.rotation.x = Math.PI / 2; hl.position.set(x, 0.66, -2.105); g.add(hl);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), lampM); lens.position.set(x, 0.66, -2.132); lens.rotation.y = Math.PI; g.add(lens);
      box(0.12, 0.05, 0.03, x * 1.27, 0.5, -2.1, amber);                              // knipperlicht
      box(0.32, 0.13, 0.03, x * 1.05, 0.7, 2.11, tail); box(0.1, 0.13, 0.031, x * 1.36, 0.7, 2.11, amber); // achterlichten
    }
    for (const z of [-2.17, 2.17]) { // chroombumper met rubber strip en hoeken naar achteren
      const bm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 1.62, 4, 12), chromeX); bm.rotation.z = Math.PI / 2; bm.position.set(0, 0.45, z); g.add(bm);
      box(1.5, 0.025, 0.02, 0, 0.45, z + Math.sign(z) * 0.055, ink2);
      for (const sx of [-1, 1]) { const c2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 4, 8), chromeX); c2.rotation.x = Math.PI / 2; c2.position.set(sx * 0.82, 0.45, z - Math.sign(z) * 0.1); g.add(c2); }
    }
    box(0.36, 0.11, 0.01, 0, 0.6, 2.108, M(0xf2c230)); // gele kentekenplaat
    // ruitstijlen + dak (glas zit er niet in: weerspiegeling + zonnestrook doet de HUD, zie .dglass)
    const pil = (x0, y0, z0, x1, y1, z1, t = 0.075, d = 0.06) => {
      const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), L = a.distanceTo(b);
      const o = new THREE.Mesh(new THREE.BoxGeometry(t, L, d), body); o.position.copy(a).add(b).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(o); return o;
    };
    const poly = (pts, m) => { const geo = new THREE.BufferGeometry(), pos = []; for (let k = 1; k + 1 < pts.length; k++) pos.push(...pts[0], ...pts[k], ...pts[k + 1]); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); const o = new THREE.Mesh(geo, m); g.add(o); return o; };
    for (const sd of [1, -1]) {
      pil(sd * 0.8, 0.95, -0.735, sd * 0.69, 1.46, -0.12);                               // A-stijl
      pil(sd * 0.83, 0.95, 0.38, sd * 0.71, 1.46, 0.31, 0.06, 0.09);                     // B-stijl
      poly([[sd * 0.835, 0.95, 0.84], [sd * 0.835, 0.95, 1.05], [sd * 0.69, 1.46, 0.85], [sd * 0.7, 1.46, 0.69]], body); // brede C-stijl
      pil(sd * 0.78, 0.955, -0.73, sd * 0.68, 1.45, -0.13, 0.02, 0.02).material = ink2;  // rubber ruitlijst
    }
    loft([-0.14, 0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.87].map(z => { const r = [], xe = 0.7 - 0.02 * sm(0.6, 0.87, z) - 0.015 * sm(0, -0.14, z); for (let k = 0; k <= 10; k++) { const u = -1 + k / 5; r.push([u * xe, 1.455 + 0.045 * (1 - u * u), z]); } return r; }), body);
    loft([-0.1, 0.2, 0.5, 0.82].map(z => { const r = []; for (let k = 0; k <= 10; k++) { const u = -1 + k / 5; r.push([u * 0.66, 1.43 + 0.04 * (1 - u * u), z]); } return r; }), vinyl); // hemel
    box(1.38, 0.05, 0.06, 0, 1.445, -0.13, body); // bovenrand voorruit
    for (const x of [-0.38, 0.38]) { const v = box(0.52, 0.012, 0.17, x, 1.41, -0.04, vinyl); v.rotation.x = 0.12; } // zonnekleppen
    // ruitenwissers in rust onderaan de voorruit
    for (const x of [-0.5, 0.06]) { const wp = box(0.52, 0.012, 0.014, x + 0.24, 1.04, -0.64, ink2); wp.rotation.z = 0.07; wp.rotation.x = -0.69; }
    // dashboard met gewatteerde bovenrand
    box(1.6, 0.2, 0.42, 0, 0.92, -0.5, dash);
    { const lip = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 1.48, 4, 12), dash); lip.rotation.z = Math.PI / 2; lip.position.set(0, 1.0, -0.64); g.add(lip); }
    // buitenspiegels (rond, chroom) op de deur bij de A-stijl
    for (const sd of [1, -1]) {
      box(0.1, 0.02, 0.03, sd * 0.89, 0.98, -0.62, chromeX);
      const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.045, 20), chromeX); hd.rotation.x = Math.PI / 2; hd.position.set(sd * 0.95, 1.03, -0.62); g.add(hd);
      const gl = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), glassM); gl.position.set(sd * 0.95, 1.03, -0.596); g.add(gl);
    }
    // binnen: vloer, deurpanelen met armsteun + raamslinger, stoelen, achterbank, hoedenplank
    box(1.6, 0.04, 2.1, 0, 0.3, 0.25, carpet);
    for (const sd of [1, -1]) {
      for (const [z0, z1] of [[-0.7, 0.37], [0.4, 1.0]]) {
        box(0.03, 0.5, z1 - z0, sd * 0.81, 0.69, (z0 + z1) / 2, vinyl);
        box(0.032, 0.012, z1 - z0 - 0.06, sd * 0.806, 0.82, (z0 + z1) / 2, chromeX);
        box(0.08, 0.05, 0.36, sd * 0.77, 0.72, z1 - 0.3, seat);                                           // armsteun
        const cr = box(0.012, 0.012, 0.09, sd * 0.79, 0.86, z0 + 0.2, chromeX); cr.rotation.x = 0.6;     // raamslinger
      }
    }
    for (const x of [-0.36, 0.36]) {
      box(0.52, 0.13, 0.5, x, 0.5, 0.33, seat);
      const bk = box(0.5, 0.62, 0.12, x, 0.86, 0.64, seat); bk.rotation.x = -0.17;
      box(0.26, 0.17, 0.1, x, 1.26, 0.71, seat);
      for (let k = -2; k <= 2; k++) box(0.012, 0.56, 0.005, x + k * 0.09, 0.86, 0.575, carpet).rotation.x = -0.17; // ribfluweel-naden
    }
    box(1.44, 0.13, 0.5, 0, 0.5, 1.05, seat); const rb = box(1.44, 0.5, 0.12, 0, 0.8, 1.32, seat); rb.rotation.x = -0.2;
    box(1.5, 0.03, 0.3, 0, 0.96, 1.25, carpet); // hoedenplank
    // wielen: band + wieldop (chroom) met naaf; groep draait om x (rollen), wieldop naar buiten
    for (const [x, z] of [[0.81, -1.35], [-0.81, -1.35], [0.81, 1.3], [-0.81, 1.3]]) {
      const w = new THREE.Group(); w.rotation.z = Math.PI / 2; w.position.set(x, 0.31, z); g.add(w); wheels.push(w);
      const out = x > 0 ? -1 : 1; // lokale y → wereld −x (rotatie z 90°)
      w.add(new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 28), tyre));
      const tr = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.04, 8, 28), tyre); tr.rotation.x = Math.PI / 2; tr.position.y = out * 0.09; w.add(tr);
      const hc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.03, 24), chromeX); hc.position.y = out * 0.1; w.add(hc);
      const nb = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.04, 12), ink2); nb.position.y = out * 0.12; w.add(nb);
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2, bt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.11), ink2); bt.position.set(Math.cos(a) * 0.12, out * 0.115, Math.sin(a) * 0.12); bt.rotation.y = -a; w.add(bt); }
    }
    // --- interieur retro jaren 70 (keuze B): dun groot stuur met claxonring, houten strook met chroomlijsten, twee chroomklokken onder een kap, radio, binnenspiegel met geurboompje ---
    const wood = M(0x8a5a2b), cream = M(0xefe6cf), green = M(0x3f8f4a), ink = M(0x26262b);
    const mk = (geo, m, par, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); par.add(o); return o; };
    const ZF = -0.285; // voorkant dashboard (naar de bestuurder)
    box(1.7, 0.085, 0.02, 0, 0.9, ZF, wood);
    box(1.7, 0.008, 0.026, 0, 0.947, ZF, chrome); box(1.7, 0.008, 0.026, 0, 0.853, ZF, chrome);
    box(0.025, 0.015, 1.75, 0.79, 0.958, 0.15, chrome); box(0.025, 0.015, 1.75, -0.79, 0.958, 0.15, chrome); // sierlijst raamonderkant
    box(0.03, 0.05, 0.14, 0, 0.9, -1.98, chrome); // motorkap-ornament
    // radio midden: kast, schaalvenster, wijzertje, twee draaiknoppen
    box(0.28, 0.07, 0.012, 0.08, 0.9, ZF + 0.012, ink); box(0.15, 0.028, 0.006, 0.08, 0.908, ZF + 0.02, cream); box(0.004, 0.028, 0.004, 0.11, 0.908, ZF + 0.024, red);
    for (const x of [-0.035, 0.195]) { const k = mk(new THREE.CylinderGeometry(0.017, 0.02, 0.03, 12), chrome, g, x, 0.9, ZF + 0.03); k.rotation.x = Math.PI / 2; }
    // handschoenkastje rechts
    box(0.3, 0.004, 0.004, 0.55, 0.925, ZF + 0.012, ink); box(0.05, 0.012, 0.012, 0.55, 0.905, ZF + 0.016, chrome);
    // stuur: kantelt naar de bestuurder, draait om eigen as
    const piv = new THREE.Group(); piv.position.set(CAR.eye[0], 1.0, -0.17); piv.rotation.x = 0.45; g.add(piv);
    wheel = new THREE.Group(); piv.add(wheel);
    mk(new THREE.TorusGeometry(0.205, 0.011, 8, 40), ink, wheel);
    mk(new THREE.TorusGeometry(0.105, 0.005, 6, 32, Math.PI), chrome, wheel).rotation.z = Math.PI; // claxonring (onderste helft)
    for (const a of [0, Math.PI]) { const sp = mk(new THREE.BoxGeometry(0.2, 0.022, 0.012), cream, wheel, Math.cos(a) * 0.1, 0, 0); sp.rotation.z = a; }
    mk(new THREE.BoxGeometry(0.02, 0.105, 0.008), chrome, wheel, 0, -0.052, 0);
    const hub = mk(new THREE.CylinderGeometry(0.04, 0.048, 0.035, 16), cream, wheel); hub.rotation.x = Math.PI / 2;
    const cap = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 12), chrome, wheel); cap.rotation.x = Math.PI / 2;
    const col = mk(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 8), ink, piv, 0, 0, -0.15); col.rotation.x = Math.PI / 2;
    // klokken achter het stuur: snelheid (links) + benzine (rechts), chroomrand, onder een kap
    const pod = new THREE.Group(); pod.position.set(CAR.eye[0], 1.045, -0.52); pod.rotation.x = -0.35; g.add(pod);
    mk(new THREE.BoxGeometry(0.4, 0.2, 0.02), ink, pod, 0, 0, -0.012);
    mk(new THREE.BoxGeometry(0.42, 0.02, 0.13), dash, pod, 0, 0.105, 0.05); // kap
    const clock = (x, n) => {
      const d = new THREE.Group(); d.position.set(x, 0, 0); pod.add(d);
      mk(new THREE.CircleGeometry(0.078, 28), cream, d); mk(new THREE.TorusGeometry(0.08, 0.007, 6, 28), chrome, d);
      for (let k = 0; k < n; k++) { const a = 2.2 - k / (n - 1) * 4.4, t = mk(new THREE.BoxGeometry(0.005, k % 2 ? 0.01 : 0.018, 0.002), ink, d, -Math.sin(a) * 0.062, Math.cos(a) * 0.062, 0.002); t.rotation.z = a; }
      const nd = mk(new THREE.BoxGeometry(0.006, 0.058, 0.004), red, d); nd.geometry.translate(0, 0.025, 0.005);
      mk(new THREE.CircleGeometry(0.01, 10), ink, d, 0, 0, 0.008);
      return nd;
    };
    needle = clock(-0.095, 15); clock(0.095, 5).rotation.z = -0.9; // benzine: driekwart vol
    // binnenspiegel + geurboompje (zwaait mee in pose)
    box(0.02, 0.06, 0.02, 0, 1.455, -0.2, ink); box(0.24, 0.065, 0.015, 0, 1.4, -0.19, ink); box(0.22, 0.05, 0.004, 0, 1.4, -0.181, chrome);
    charm = new THREE.Group(); charm.position.set(0, 1.365, -0.19); g.add(charm);
    mk(new THREE.BoxGeometry(0.003, 0.1, 0.003), ink, charm, 0, -0.05, 0);
    for (const [r, h, y] of [[0.022, 0.035, -0.105], [0.032, 0.04, -0.13], [0.042, 0.045, -0.158]]) mk(new THREE.ConeGeometry(r, h, 3), green, charm, 0, y, 0).scale.z = 0.12;
    mk(new THREE.BoxGeometry(0.012, 0.022, 0.004), wood, charm, 0, -0.19, 0);
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
    hud.innerHTML = '<div class="dglass"></div><svg class="dgauge" viewBox="-52 -52 104 104"><circle r="50" class="face"/>' + ticks
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
    { const rx = x + H.areaInfo.origin[0], ry = H.areaInfo.origin[1] - z, d = H.bridges?.deckAt?.(rx, ry); S.y = d ?? H.heightAt(rx, ry); } // neergezet op een brug = op het dek
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
  const hAt = (x, z) => { // terrein, of het brugdek als de auto daar al ongeveer op hoogte rijdt (eronderdoor blijft terrein)
    const rx = x + H.areaInfo.origin[0], ry = H.areaInfo.origin[1] - z, t = H.heightAt(rx, ry), d = H.bridges?.deckAt?.(rx, ry);
    return d != null && d > t && S.y > d - 1.6 ? d : t;
  };
  const BUMPY = new URLSearchParams(location.search).has('bumpy'); // ?bumpy = oude, hobbelige vering
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
    v -= Math.sign(v) * Math.min(Math.abs(v), (CAR.drag + (S.off ? CAR.offDrag : 0) + 0.002 * v * v) * dt);
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
    // gladgestreken (?bumpy = oud): hoogte = gewogen gemiddelde over ±6 m langs de rijrichting, kanteling over een lange basis (±5 m / ±2 m), kanteling trager dan hoogte
    if (BUMPY) {
      const hF = hAt(S.x + f * hb, S.z + g * hb), hB = hAt(S.x - f * hb, S.z - g * hb), hL = hAt(S.x + g * 0.8, S.z - f * 0.8), hR = hAt(S.x - g * 0.8, S.z + f * 0.8);
      const a = Math.min(1, dt * 8);
      S.y += ((hF + hB) / 2 - S.y) * a;
      S.pitch += (Math.atan2(hF - hB, CAR.wb) - S.pitch) * a;
      S.roll += (Math.atan2(hL - hR, 1.6) - S.roll) * a;
    } else {
      const along = d => hAt(S.x + f * d, S.z + g * d), side = d => (hAt(S.x + g * d + f * 2, S.z - f * d + g * 2) + hAt(S.x + g * d - f * 2, S.z - f * d - g * 2)) / 2;
      const h6 = along(6), h3 = along(3), h0 = along(0), b3 = along(-3), b6 = along(-6);
      const hm = (h6 + 2 * h3 + 3 * h0 + 2 * b3 + b6) / 9, hF = (h6 * 2 + h3 + along(9)) / 4, hB = (b6 * 2 + b3 + along(-9)) / 4; // voor/achter: zwaartepunt ±6 m
      S.y += (hm - S.y) * Math.min(1, dt * 10);
      S.pitch += (Math.atan2(hF - hB, 12) - S.pitch) * Math.min(1, dt * 4);
      S.roll += (Math.atan2(side(2) - side(-2), 4) * 0.6 - S.roll) * Math.min(1, dt * 3);
    }
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
    if (charm) charm.rotation.z += (Math.max(-0.6, Math.min(0.6, S.steer * S.v * 0.06)) + Math.sin(performance.now() / 420) * Math.min(0.05, Math.abs(S.v) * 0.004) - charm.rotation.z) * Math.min(1, dt * 4);
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
