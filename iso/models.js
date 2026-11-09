// iso/models.js — G eigen modellen (keuze design/8_modellen.html: Maquette · 1,3× hoger · bok + machinegebouw · glazen kap).
// Glaspaleis, Pancratiuskerk en thermen-overkapping vervangen hun BAG-pand (op de BAG-plattegrond geplaatst); schachtbok op een verzonnen open plek.
// Modellen staan gewoon in de scène (schaduw, omlijning, A2-bakken); de schachtwielen draaien op de bewegende laag (H.addDynamic, 'post').
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return;
  const BAG = { glas: '917100000047751', kerk: '917100000050176', therm: '917100000047163' };
  const SPOT_S = [196591, 321880], SHAFT_ANG = 30 * Math.PI / 180, POP = 1.3; // schoor wijst naar het noordoosten; alles 1,3× hoger
  const P = { stone: '#e2cd98', stoneD: '#cdb47e', roof: '#6c7782', spire: '#56616b', win: '#3b3f4a', glass: '#8fb9c2', slab: '#f3efe6', frame: '#e6e2da', steel: '#a34a35', steelD: '#7c382a', brick: '#a8573b', brickR: '#5d6873', ruin: '#cfa47c', ruinTop: '#e8d8b8', floor: '#ddd0b2', pool: '#9eb3ae', sand: '#e9dfc6', clock: '#f4efe2' };
  const WHEEL_SPEED = 0.9, WHEEL_HALF = 600; // rad/s; wielen alleen draaien als ingezoomd (zichtbare halve hoogte < 600 m)

  // ---------- materialen: vertexkleur + cel; aGlow gloeit 's avonds (ramen/glas) ----------
  let MODEL, GLASS;
  function mats() {
    MODEL = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    MODEL.onBeforeCompile = s => {
      s.uniforms.uNight = H.U.uNight;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vG;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvG = aGlow;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vG; uniform float uNight;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.78, 0.46), vG * uNight * 0.85);');
    };
    H.celify(MODEL, 'model');
    GLASS = new THREE.MeshLambertMaterial({ color: '#cfe6ea', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    GLASS.onBeforeCompile = s => {
      s.uniforms.uNight = H.U.uNight;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor = mix(gl_FragColor, vec4(1.0, 0.8, 0.5, 0.35), uNight * 0.7);');
    };
    GLASS.customProgramCacheKey = () => 'modelglass';
  }

  // ---------- bouwstenen (lokaal: x = oost, z = −noord; veelhoeken in (e, n)) ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z), UP = V3(0, 1, 0);
  function part(g, c, o = {}) {
    if (g.index) g = g.toNonIndexed();
    const q = o.q || new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.r || [0, 0, 0])));
    g.applyMatrix4(new THREE.Matrix4().compose(V3(...(o.p || [0, 0, 0])), q, V3(1, 1, 1)));
    return { g, c: new THREE.Color(c), glow: o.glow || 0 };
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const cyl = (r0, r1, h, s = 8) => new THREE.CylinderGeometry(r1, r0, h, s).translate(0, h / 2, 0);
  function rod(a, b, r, c, s = 4) {
    const A = V3(...a), B = V3(...b), d = B.clone().sub(A), L = d.length();
    return part(new THREE.CylinderGeometry(r, r, L, s), c, { p: A.add(B).multiplyScalar(0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()) });
  }
  function merge(parts) {
    const n = parts.reduce((t, p) => t + p.g.attributes.position.count, 0);
    const Pp = new Float32Array(n * 3), C = new Float32Array(n * 3), G = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      const a = p.g.attributes.position.array, m = a.length / 3; Pp.set(a, o * 3);
      for (let k = 0; k < m; k++) { C[(o + k) * 3] = p.c.r; C[(o + k) * 3 + 1] = p.c.g; C[(o + k) * 3 + 2] = p.c.b; G[o + k] = p.glow; }
      o += m; p.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aGlow', new THREE.BufferAttribute(G, 1));
    g.computeBoundingSphere();
    return g;
  }
  const mesh = parts => { const m = new THREE.Mesh(merge(parts), MODEL); m.castShadow = m.receiveShadow = true; return m; };
  const area2 = p => p.reduce((s, a, k) => { const b = p[(k + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
  const ccw = p => area2(p) < 0 ? p.slice().reverse() : p;
  const norm2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  function offset(p, d) { // convexe veelhoek (ccw) naar buiten (d > 0) of binnen
    p = ccw(p); const n = p.length;
    return p.map((b, k) => {
      const a = p[(k + n - 1) % n], c = p[(k + 1) % n];
      const n1 = norm2([b[1] - a[1], a[0] - b[0]]), n2 = norm2([c[1] - b[1], b[0] - c[0]]), m = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
      const s = d / Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
      return [b[0] + m[0] * s, b[1] + m[1] * s];
    });
  }
  function prism(p, y0, h, c, o = {}) { // veelhoek extruderen, voet op y0
    const sh = new THREE.Shape(ccw(p).map(([e, n]) => new THREE.Vector2(e, n)));
    return part(new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y0, 0), c, o);
  }
  const rect = (x0, z0, x1, z1) => [[x0, -z0], [x1, -z0], [x1, -z1], [x0, -z1]];
  function gable(len, wid, h, c, o = {}) { // zadeldak langs x, voet op y 0
    const sh = new THREE.Shape([new THREE.Vector2(-wid / 2, 0), new THREE.Vector2(wid / 2, 0), new THREE.Vector2(0, h)]);
    return part(new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(Math.PI / 2), c, o);
  }
  function leanTo(len, wid, h, c, o = {}) { // lessenaarsdak langs x, hoog aan -z
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(wid, 0), new THREE.Vector2(wid, h)]);
    return part(new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2).rotateY(Math.PI / 2), c, o);
  }
  function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

  // ---------- modellen ----------
  // Glaspaleis: glazen banden + witte vloeren op de echte plattegrond (omhullende), stijlen, terugliggende dakopbouw
  function glaspaleis(hull, H) {
    const p = [], nF = Math.max(5, Math.round((H - 3) / 4.4)), fh = (H - 3) / nF;
    p.push(prism(offset(hull, -0.3), -8, 8.2, P.slab));
    for (let f = 0; f < nF; f++) {
      const y = f * fh;
      p.push(prism(offset(hull, f === 0 ? -0.8 : -0.35), y, fh, P.glass, { glow: f === 0 ? 0.9 : 0.75 }));
      p.push(prism(offset(hull, 0.25), y + fh - 0.55, 0.55, P.slab));
    }
    const hp = offset(hull, -0.05);
    for (let k = 0; k < hp.length; k++) {
      const a = hp[k], b = hp[(k + 1) % hp.length], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4.8));
      for (let t = 0; t <= n; t++) p.push(part(box(0.3, nF * fh, 0.3), P.frame, { p: [a[0] + (b[0] - a[0]) * t / n, 0, -(a[1] + (b[1] - a[1]) * t / n)] }));
    }
    const top = nF * fh, inner = offset(hull, -4.5);
    p.push(prism(inner, top, 3, P.slab), prism(offset(inner, 0.4), top + 3, 0.4, P.slab));
    const c = inner.reduce((s, q) => [s[0] + q[0] / inner.length, s[1] + q[1] / inner.length], [0, 0]);
    p.push(part(box(5, 2.4, 4), P.slab, { p: [c[0], top + 3.4, -c[1]] }));
    return mesh(p);
  }
  // Pancratiuskerk (kruiskerk zoals de BAG): westtoren met laag tentdak, schip + zijbeuken, transept met vieringtoren (hoogste punt), koor met apsis.
  // Lokaal x = lengte, toren aan +x (west), viering in het midden.
  function kerk(w, l, H) {
    const p = [], L = w * 0.96, W = l * 0.9, x0 = -L / 2, x1 = L / 2;
    const T = 9, tx = x1 - T / 2, shaftH = H * 0.84, capH = H * 0.12;
    const nave = 11, aisle = Math.min(5.5, (W * 0.6 - nave) / 2), nH = 13.5, aH = 6, ridge = 7.5;
    const tw = 11, tW = Math.min(W, nave + 2 * aisle + 14);
    const nx0 = tw / 2 - 0.5, nx1 = x1 - T + 0.5, nl = nx1 - nx0, ncx = (nx0 + nx1) / 2;
    const cw = nave - 1, ar = cw / 2, cx0 = x0 + ar, cx1 = -tw / 2 + 0.5, cl = cx1 - cx0, ccx = (cx0 + cx1) / 2;
    p.push(part(box(L + 1, 4.2, nave + 2 * aisle + 1), P.stoneD, { p: [0, -4, 0] }), part(box(tw + 1, 4.2, tW + 1), P.stoneD, { p: [0, -4, 0] }));
    p.push(part(box(nl, nH, nave), P.stone, { p: [ncx, 0, 0] }), gable(nl, nave + 1, ridge, P.roof, { p: [ncx, nH, 0] }));
    if (aisle > 0) for (const s of [1, -1]) {
      p.push(part(box(nl, aH, aisle), P.stone, { p: [ncx, 0, s * (nave + aisle) / 2] }));
      p.push(leanTo(nl, aisle + 0.4, 3, P.roof, { p: [ncx, aH, s * (nave / 2 + aisle + 0.4)], r: [0, s > 0 ? 0 : Math.PI, 0] }));
    }
    p.push(part(box(tw, nH, tW), P.stone), gable(tW + 1, tw + 0.8, ridge, P.roof, { p: [0, nH, 0], r: [0, Math.PI / 2, 0] }));
    const fy = nH + ridge - 1;
    p.push(part(cyl(1.9, 1.9, 3, 8), P.spire, { p: [0, fy, 0] }), part(cyl(2.1, 2.1, 0.4, 8), P.stoneD, { p: [0, fy + 3, 0] }));
    p.push(part(new THREE.ConeGeometry(2, H - fy - 3.4, 8).translate(0, (H - fy - 3.4) / 2, 0), P.spire, { p: [0, fy + 3.4, 0] }));
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; p.push(part(box(0.5, 1.6, 0.5), P.win, { p: [Math.cos(a) * 1.85, fy + 0.8, Math.sin(a) * 1.85], glow: 0.5 })); }
    p.push(part(box(cl, nH - 1, cw), P.stone, { p: [ccx, 0, 0] }), gable(cl, cw + 0.8, ridge - 1, P.roof, { p: [ccx, nH - 1, 0] }));
    p.push(part(new THREE.CylinderGeometry(ar, ar, nH - 1, 7, 1, false, Math.PI, Math.PI).translate(0, (nH - 1) / 2, 0), P.stone, { p: [cx0, 0, 0] }));
    p.push(part(new THREE.ConeGeometry(ar + 0.4, ridge - 1, 7, 1, false, Math.PI, Math.PI).translate(0, (ridge - 1) / 2, 0), P.roof, { p: [cx0, nH - 1, 0] }));
    p.push(part(box(T, shaftH, T), P.stone, { p: [tx, 0, 0] }), part(box(T + 0.6, 0.6, T + 0.6), P.stoneD, { p: [tx, shaftH - 0.6, 0] }));
    p.push(part(new THREE.ConeGeometry(T * 0.74, capH, 4).translate(0, capH / 2, 0), P.spire, { p: [tx, shaftH, 0], r: [0, Math.PI / 4, 0] }));
    const gy = shaftH - 4.4; // galmgaten + uurwerk
    for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = T / 2 + 0.05, along = ux ? [0, 0, 1] : [1, 0, 0];
      for (let k = 0; k < 2; k++) { const off = (k - 0.5) * 2.6; p.push(part(box(ux ? 0.3 : 1.2, 2.8, ux ? 1.2 : 0.3), P.win, { p: [tx + ux * o + along[0] * off, gy, uz * o + along[2] * off] })); }
      p.push(part(new THREE.CylinderGeometry(1.3, 1.3, 0.2, 14).rotateX(Math.PI / 2).rotateY(ux ? Math.PI / 2 : 0), P.clock, { p: [tx + ux * (o + 0.05), gy - 3.6, uz * (o + 0.05)] }));
    }
    for (const [a0, a1, h0] of [[nx0, nx1 - 1, nH], [cx0 + 1, cx1, nH - 1]]) for (let x = a0 + 2; x < a1; x += 4) for (const s of [1, -1]) { // ramen, roosvensters
      p.push(part(box(1.1, 2.8, 0.3), P.win, { p: [x, h0 - 3.8, s * ((h0 === nH ? nave : cw) / 2 + 0.05)], glow: 0.7 }));
      if (aisle > 0 && h0 === nH) p.push(part(box(1.1, 2.6, 0.3), P.win, { p: [x, 1.6, s * (nave / 2 + aisle + 0.05)], glow: 0.7 }));
    }
    for (const s of [1, -1]) p.push(part(box(2.2, 5, 0.3), P.win, { p: [0, 2.5, s * (tW / 2 + 0.05)], glow: 0.7 }), part(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 12).rotateX(Math.PI / 2), P.win, { p: [0, nH + 2.2, s * (tW / 2 + 0.1)], glow: 0.8 }));
    p.push(part(box(0.3, 3.6, 2), P.win, { p: [x1 + 0.05, 0, 0] }));
    return mesh(p);
  }
  // Thermen: ruïne van het badhuis (binnenplaats + natatio, frigidarium, tepidarium, caldarium met apsis) onder een glazen kap met dun frame
  function thermen(w, l) {
    const p = [], rnd = rng(11), hw = w * 0.42, hl = l * 0.42, S = Math.min(hw / 31, hl / 21) * 0.92, X = v => v * S; // plattegrond 62 × 42 m, geschaald
    p.push(prism(rect(-hw, -hl, hw, hl), -3, 3.1, P.floor), prism(rect(X(-31), X(-21), X(31), X(21)), 0.1, 0.12, P.ruinTop), prism(rect(X(-29), X(-19), X(-1), X(19)), 0.15, 0.1, P.sand));
    const walls = [], room = (x0, z0, x1, z1) => walls.push([x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
    room(-30, -20, 0, 20); room(0, -20, 14, 4); room(14, -20, 24, 4); room(24, -20, 30, 4); room(0, 4, 30, 20);
    walls.push([10, 4, 10, 20], [20, 4, 20, 20]);
    for (let k = 0; k < 9; k++) { const a0 = -Math.PI / 2 + k / 9 * Math.PI, a1 = a0 + Math.PI / 9; walls.push([30 + Math.cos(a0) * 5, -8 + Math.sin(a0) * 5, 30 + Math.cos(a1) * 5, -8 + Math.sin(a1) * 5]); }
    const th = X(0.9);
    for (const [ax, az, bx, bz] of walls) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 4.5)), ang = Math.atan2(-(bz - az), bx - ax);
      for (let t = 0; t < n; t++) {
        if (rnd() < 0.12) continue; // doorgang / ingestort
        const f = (t + 0.5) / n, h = 0.6 + Math.floor(rnd() * rnd() * 5) * 0.5;
        p.push(part(box(X(L / n) + th * 0.6, h, th), P.ruin, { p: [X(ax + (bx - ax) * f), 0.15, X(az + (bz - az) * f)], r: [0, ang, 0] }));
      }
    }
    for (const [x0, z0, x1, z1] of [[3, -16, 11, -6], [-24, -9, -8, 9]]) { // baden: donkere bodem + lage rand
      p.push(prism(rect(X(x0), X(z0), X(x1), X(z1)), 0.24, 0.06, P.pool));
      for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]])
        p.push(part(box(X(Math.hypot(bx - ax, bz - az)) + X(0.6), 0.55, X(0.6)), P.ruinTop, { p: [X((ax + bx) / 2), 0.15, X((az + bz) / 2)], r: [0, Math.atan2(-(bz - az), bx - ax), 0] }));
    }
    const wH = 9, rH = 3.6, cs = 12, colW = 0.6; // kap: kolommen, ring, spanten, nok + glas
    for (const s of [1, -1]) {
      for (let x = -hw; x <= hw + 0.1; x += (2 * hw) / Math.round(2 * hw / cs)) p.push(part(box(colW, wH, colW), P.frame, { p: [x, 0, s * hl] }));
      for (let z = -hl; z <= hl + 0.1; z += (2 * hl) / Math.round(2 * hl / cs)) p.push(part(box(colW, wH, colW), P.frame, { p: [s * hw, 0, z] }));
      p.push(part(box(2 * hw + colW, 0.5, colW), P.frame, { p: [0, wH - 0.5, s * hl] }), part(box(colW, 0.5, 2 * hl + colW), P.frame, { p: [s * hw, wH - 0.5, 0] }));
    }
    const rg = Math.round(2 * hw / 12); for (let k = 0; k <= rg; k++) { const x = -hw + 2 * hw * k / rg; for (const s of [1, -1]) p.push(rod([x, wH, s * hl], [x, wH + rH, 0], 0.18, P.frame)); }
    p.push(rod([-hw, wH + rH, 0], [hw, wH + rH, 0], 0.25, P.frame));
    const gp = [], quad = (a, b, c, e) => gp.push(...a, ...b, ...c, ...a, ...c, ...e);
    for (const s of [1, -1]) {
      quad([-hw, wH, s * hl], [hw, wH, s * hl], [hw, wH + rH, 0], [-hw, wH + rH, 0]); quad([-hw, 0, s * hl], [hw, 0, s * hl], [hw, wH, s * hl], [-hw, wH, s * hl]);
      quad([s * hw, 0, -hl], [s * hw, 0, hl], [s * hw, wH, hl], [s * hw, wH, -hl]); gp.push(s * hw, wH, -hl, s * hw, wH, hl, s * hw, wH + rH, 0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); g.computeVertexNormals();
    const gm = new THREE.Mesh(g, GLASS); gm.renderOrder = 3;
    // alleen in de gewone kleurpass: niet in NRM-pass (omlijning), schaduw of bakken (overrideMaterial ≠ GLASS)
    gm.onBeforeRender = (r, sc, cam, geo, mat) => geo.setDrawRange(0, mat === GLASS ? Infinity : 0);
    return [mesh(p), gm];
  }
  // Schachtbok: vakwerktoren + schoor + twee wielen (los, draaien) boven een schachtgebouw, met ophaalmachinegebouw + kabels. Lokaal +x = schoor/machine.
  function wheel(R) {
    const p = [part(new THREE.TorusGeometry(R, 0.24, 5, 16), P.steel)];
    for (let k = 0; k < 4; k++) p.push(part(new THREE.BoxGeometry(2 * R, 0.18, 0.12), P.steelD, { r: [0, 0, k / 4 * Math.PI] }));
    p.push(part(new THREE.CylinderGeometry(0.45, 0.45, 0.8, 8).rotateX(Math.PI / 2), P.steelD));
    const m = mesh(p); m.castShadow = false; return m;
  }
  function schacht() {
    const p = [], H = 36, b0 = 4.2, b1 = 2.6, r = 0.3, bays = 6, cx = -6;
    const cor = y => { const s = b0 + (b1 - b0) * y / H; return [[cx + s, y, s], [cx - s, y, s], [cx - s, y, -s], [cx + s, y, -s]]; };
    for (let k = 0; k < 4; k++) p.push(rod(cor(0)[k], cor(H)[k], r * 1.3, P.steel));
    for (let b = 1; b <= bays; b++) {
      const A = cor((b - 1) / bays * H), B = cor(b / bays * H);
      for (let k = 0; k < 4; k++) p.push(rod(B[k], B[(k + 1) % 4], r, P.steel), rod(b % 2 ? A[k] : A[(k + 1) % 4], b % 2 ? B[(k + 1) % 4] : B[k], r * 0.7, P.steelD));
    }
    const R = 3.2, wy = H + R * 0.6;
    p.push(part(box(2 * b1 + 2, 0.5, 2 * b1 + 2), P.steelD, { p: [cx, H, 0] }));
    for (const s of [1, -1]) p.push(rod([cx - b1, H, s * (b1 + 0.6)], [cx, wy, s * (b1 + 0.6)], r, P.steel), rod([cx + b1, H, s * (b1 + 0.6)], [cx, wy, s * (b1 + 0.6)], r, P.steel));
    p.push(rod([cx, wy, -b1 - 1], [cx, wy, b1 + 1], 0.3, P.steelD));
    const fx = cx + 21; // schoor
    for (const s of [1, -1]) {
      p.push(rod([cx + b1, H - 1, s * b1], [fx, 0, s * (b1 + 1.5)], r * 1.4, P.steel));
      for (let t = 1; t < 4; t++) { const f = t / 4; p.push(rod([cx + b0 + (b1 - b0) * (1 - f), (H - 1) * (1 - f), s * b1], [cx + b1 + (fx - cx - b1) * f, (H - 1) * (1 - f), s * (b1 + 1.5 * f)], r * 0.7, P.steelD)); }
    }
    for (let t = 1; t < 4; t++) { const f = t / 4, x = cx + b1 + (fx - cx - b1) * f, y = (H - 1) * (1 - f); p.push(rod([x, y, -(b1 + 1.5 * f)], [x, y, b1 + 1.5 * f], r * 0.8, P.steelD)); }
    p.push(part(box(15, 9, 13), P.brick, { p: [cx, -3, 0] }), gable(15.6, 13.6, 3.2, P.brickR, { p: [cx, 6, 0] })); // schachtgebouw
    for (const s of [1, -1]) for (let k = -1; k <= 1; k++) p.push(part(box(1.6, 3, 0.3), P.win, { p: [cx + k * 4.5, 1.8, s * 6.55], glow: 0.6 }));
    const mx = cx + 26; // ophaalmachinegebouw + schoorsteen + kabels
    p.push(part(box(11, 11, 10), P.brick, { p: [mx, -3, 0] }), gable(11.6, 10.6, 3.6, P.brickR, { p: [mx, 8, 0], r: [0, Math.PI / 2, 0] }));
    for (const z of [-2.2, 2.2]) p.push(part(box(1.6, 4, 0.3), P.win, { p: [mx - 5.45, 3, z], r: [0, Math.PI / 2, 0], glow: 0.6 }));
    p.push(part(cyl(1.1, 0.8, 22, 8), P.brick, { p: [mx + 3.5, 0, -6] }));
    for (const s of [1, -1]) p.push(rod([cx + R, wy, s * (b1 + 0.6)], [mx - 5.5, 6.5, s * 1.5], 0.08, '#2a2420', 3));
    const wheels = [1, -1].map(s => { const w = wheel(R); w.position.set(cx, wy, s * (b1 + 0.6)); return w; });
    return { body: mesh(p), wheels };
  }

  // ---------- plattegrond van een BAG-pand uit de app-geometrie: omhullende + kleinste rechthoek (RD-m), hoogte boven het maaiveld ----------
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = []; for (const p of pts) { while (lo.length > 1 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.reverse()) { while (up.length > 1 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function footprint(id) {
    const f = H.findBuilding(id); if (!f) return null;
    const O = H.areaInfo.origin, pos = f.c.mesh.geometry.attributes.position.array, pts = []; let top = -1e9;
    for (const v of H.facesOf(f.c, f.b)) { pts.push([pos[v * 3] + O[0], O[1] - pos[v * 3 + 2]]); top = Math.max(top, pos[v * 3 + 1]); }
    if (pts.length < 3) return null;
    const Hl = hull(pts); let best = null;
    for (let k = 0; k < Hl.length; k++) {
      const a = Hl[k], q = Hl[(k + 1) % Hl.length], ang = Math.atan2(q[1] - a[1], q[0] - a[0]), cs = Math.cos(ang), sn = Math.sin(ang);
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (const [x, y] of Hl) { const u = x * cs + y * sn, v = -x * sn + y * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const A = (u1 - u0) * (v1 - v0);
      if (!best || A < best.A) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { A, ang, w: u1 - u0, l: v1 - v0, cx: uc * cs - vc * sn, cy: uc * sn + vc * cs }; }
    }
    if (best.l > best.w) { [best.w, best.l] = [best.l, best.w]; best.ang += Math.PI / 2; } // w = lange zijde
    const ground = H.heightAt(best.cx, best.cy);
    let hs = Hl; for (let pass = 0; pass < 3; pass++) hs = hs.filter((p, k) => { const a = hs[(k + hs.length - 1) % hs.length], q = hs[(k + 1) % hs.length]; const L = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1; return Math.abs((q[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (q[1] - a[1])) / L > 1.5; });
    return { ...best, ground, H: top - ground, hullRD: hs };
  }

  // ---------- plaatsen ----------
  const root = new THREE.Group(); root.name = 'models';
  function group(X, Y, ang, base) {
    const O = H.areaInfo.origin, g = new THREE.Group();
    g.position.set(X - O[0], base, -(Y - O[1])); g.rotation.y = ang; g.scale.y = POP;
    return g;
  }
  let wheels = [], wAng = 0, last = 0, built = false;
  function build() {
    if (built || !H.findBuilding) return; built = true;
    mats();
    const fg = footprint(BAG.glas), fk = footprint(BAG.kerk), ft = footprint(BAG.therm); // eerst meten, dan pas verbergen (verbergen maakt de driehoeken plat)
    if (fg) { const g = group(fg.cx, fg.cy, 0, fg.ground); g.add(glaspaleis(fg.hullRD.map(([x, y]) => [x - fg.cx, y - fg.cy]), fg.H)); root.add(g); H.hideBuilding(BAG.glas); }
    if (fk) { let a = fk.ang; if (Math.cos(a) > 0) a += Math.PI; const g = group(fk.cx, fk.cy, a, fk.ground); g.add(kerk(fk.w, fk.l, fk.H)); root.add(g); H.hideBuilding(BAG.kerk); } // toren (+x) naar het westen
    if (ft) { const g = group(ft.cx, ft.cy, ft.ang, ft.ground); g.add(...thermen(ft.w, ft.l)); root.add(g); H.hideBuilding(BAG.therm); }
    const sb = schacht(), base = H.heightAt(...SPOT_S) - 0.2, g = group(SPOT_S[0], SPOT_S[1], SHAFT_ANG, base); g.add(sb.body); root.add(g);
    const gw = group(SPOT_S[0], SPOT_S[1], SHAFT_ANG, base); gw.add(...sb.wheels); wheels = sb.wheels;
    H.scene.add(root);
    if (H.addDynamic) { H.addDynamic(gw); H.animate(tick, 'wielen'); } else g.add(...sb.wheels);
    H.shadowDirty?.(); H.rebake?.(); H.redraw?.();
  }
  const half = () => { const c = H.camera(); return c && c.isOrthographicCamera ? (c.top - c.bottom) / (2 * c.zoom) : Infinity; };
  function tick(now) { // ±15/s draaien, alleen ingezoomd in iso
    if (H.U.uIso.value < 0.5 || half() > WHEEL_HALF) { last = 0; return 'none'; }
    const dt = last ? Math.min(0.2, (now - last) / 1000) : 0; last = now;
    wAng += dt * WHEEL_SPEED;
    wheels.forEach((w, k) => { w.rotation.z = (k % 2 ? -1 : 1) * wAng; });
    return 'post';
  }
  H.on('loaded', build);
})();
