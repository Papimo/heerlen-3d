// iso/daken.js — dakstukjes bedrijfspanden (design/16_bedrijfspanden.html keuze A·A·D), alleen in iso + "Daken op bouwjaar" (uAnime).
// Hallen (plat > 60%, > 2500 m², < 16 m): witte lichtstraten om de 18 m + blokken zonnepanelen ertussen.
// Overige platte daken met "grind" (fract(seed × 3,1) in [0,34; 0,67), zelfde keuze als PLAT_D in app.js): 1–5 installatiekasten, liftopbouw op panden > 12 m.
// Plaatsing in de eigen assen van het dak (c.biz = PCA-hoek + deel plat, uit app.js build) = bzLoc() in de shader; alleen binnen de platte dakdriehoeken
// (rooster van 0,5 m per pand). Opeenvolgende panelen/lichtstraten = één langgerekte instantie (naden in de shader) → weinig instanties.
// Na 'grown' in een wachtrij (één vak per keer), dus niet in de gebakken schaduw (iso/bake.js) — stukjes zijn laag, valt nauwelijks op.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return;
  const G = 0.5, MAXC = 3e6; // roostercel (m), max cellen per pand
  const KIND = {
    strip: { color: '#e9f1f5', shadow: true },
    panel: { color: '#2d3f5c', shadow: false, seam: 1.1 },
    unit: { color: '#ffffff', shadow: true, colors: true },
  };
  const L = {}; for (const k in KIND) L[k] = { m: [], c: [], mesh: null, cap: 0 };
  const done = new Set(), queue = [];
  const V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), QT = new THREE.Quaternion(), M = new THREE.Matrix4(), CO = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);
  const on = () => (H.getMode ? H.getMode() === 'iso' : true) && H.U?.uAnime?.value > 0.5;

  function put(k, x, y, z, th, tilt, sx, sy, sz, col) {
    Q.setFromAxisAngle(UP, -th); if (tilt) Q.multiply(QT.setFromAxisAngle(AX, tilt));
    M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)); L[k].m.push(...M.elements);
    if (KIND[k].colors) { CO.set(col || '#ffffff'); L[k].c.push(CO.r, CO.g, CO.b); }
  }

  // ---------- dak van één pand als rooster in eigen assen (a langs, c dwars) ----------
  function grid(T, th) {
    const d0 = Math.cos(th), d1 = Math.sin(th), n = T.length / 3, A = new Float32Array(n), C = new Float32Array(n);
    let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
    for (let k = 0; k < n; k++) { const x = T[k * 3], z = T[k * 3 + 2]; A[k] = x * d0 + z * d1; C[k] = -x * d1 + z * d0; a0 = Math.min(a0, A[k]); a1 = Math.max(a1, A[k]); c0 = Math.min(c0, C[k]); c1 = Math.max(c1, C[k]); }
    const na = Math.ceil((a1 - a0) / G) + 1, nc = Math.ceil((c1 - c0) / G) + 1; if (na * nc > MAXC) return null;
    const Y = new Float32Array(na * nc).fill(NaN);
    for (let t = 0; t < n; t += 3) {
      const ax = A[t], az = C[t], bx = A[t + 1], bz = C[t + 1], cx = A[t + 2], cz = C[t + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-6) continue;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - a0) / G)), i1 = Math.min(na - 1, Math.ceil((Math.max(ax, bx, cx) - a0) / G));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - c0) / G)), j1 = Math.min(nc - 1, Math.ceil((Math.max(az, bz, cz) - c0) / G));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = a0 + (i + 0.5) * G, z = c0 + (j + 0.5) * G;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
        if (l1 >= -1e-4 && l2 >= -1e-4 && l3 >= -1e-4) Y[i * nc + j] = l1 * T[t * 3 + 1] + l2 * T[t * 3 + 4] + l3 * T[t * 3 + 7];
      }
    }
    const y = (a, c) => { const i = Math.floor((a - a0) / G), j = Math.floor((c - c0) / G); if (i < 0 || j < 0 || i >= na || j >= nc) return NaN; return Y[i * nc + j]; };
    return { y, a0, a1, c0, c1, d0, d1 };
  }
  // past een rechthoek (±w langs, ±l dwars) rond (a, c) op hetzelfde vlakke dak? → dakhoogte of NaN
  function fits(R, a, c, w, l) {
    const y = R.y(a, c); if (y !== y) return NaN;
    for (const [da, dc] of [[-w, -l], [w, -l], [-w, l], [w, l]]) { const yy = R.y(a + da, c + dc); if (!(Math.abs(yy - y) < 0.3)) return NaN; }
    return y;
  }
  const toX = (R, a, c) => a * R.d0 - c * R.d1, toZ = (R, a, c) => a * R.d1 + c * R.d0;
  // rijen langs a: aaneengesloten geldige plekken (stap sa) → één instantie per reeks
  function runs(R, sa, oa, c, ok, emit) {
    let s = null, n = 0, ys = 0, last = 0;
    const end = () => { if (s !== null) emit(s, last, n, ys / n); s = null; n = 0; ys = 0; };
    for (let a = Math.ceil((R.a0 - oa) / sa) * sa + oa; a <= R.a1; a += sa) {
      const y = ok(a);
      if (y === y && (s === null || Math.abs(y - ys / n) < 0.3)) { if (s === null) s = a; n++; ys += y; last = a; }
      else { end(); if (y === y) { s = a; n = 1; ys = y; last = a; } }
    }
    end();
  }
  const rng = s => (k => () => (k = (k * 16807) % 2147483647) / 2147483647)(Math.floor(s * 1e6) + 1);

  function hal(R, B) {
    // lichtstraten: om de 18 m dwars (c = 9 + 18n), stukjes van 3 m langs → reeksen
    for (let c = Math.ceil((R.c0 - 9) / 18) * 18 + 9; c <= R.c1; c += 18)
      runs(R, 3, 0, c, a => fits(R, a, c, 1.5, 1.2), (s, e, n, y) => { const m = (s + e) / 2; put('strip', toX(R, m, c), y + 0.3, toZ(R, m, c), B.th, 0, (e - s) + 3.05, 0.6, 1.8); });
    // zonnepanelen: rijen om de 2,4 m, paneel 1,1 m; niet naast de lichtstraten; blokken (24 × 18 m) ±28% leeg; naad per paneel in de shader
    for (let c = Math.ceil(R.c0 / 2.4) * 2.4; c <= R.c1; c += 2.4) {
      if (Math.abs((((c % 18) + 18) % 18) - 9) < 2.6) continue;
      const cb = Math.floor(c / 18);
      let blk = null;
      runs(R, 1.1, 0, c, a => {
        if (Math.abs(Math.sin(Math.floor(a / 24) * 12.99 + cb * 78.23 + B.sd * 99) * 43758.5) % 1 > 0.72) return NaN;
        const b = Math.floor(a / 24); if (blk !== null && b !== blk) { blk = b; return NaN; } // nieuw blok = nieuwe reeks (kleine tussenruimte)
        blk = b; return fits(R, a, c, 1.6, 1.6);
      }, (s, e, n, y) => { const m = (s + e) / 2; put('panel', toX(R, m, c), y + 0.45, toZ(R, m, c), B.th, 0.22, n * 1.1 - 0.08, 0.05, 1.65); });
    }
  }
  function units(R, B) { // 1–5 kasten, de eerste = liftopbouw op hoge panden
    const cand = [];
    for (let a = Math.ceil(R.a0 / 2.5) * 2.5; a <= R.a1; a += 2.5) for (let c = Math.ceil(R.c0 / 2.5) * 2.5; c <= R.c1; c += 2.5) { const y = fits(R, a, c, 1.3, 1.3); if (y === y) cand.push([a, c, y]); }
    if (!cand.length) return;
    const r = rng(B.sd), nU = Math.min(5, 1 + Math.floor(B.ar / 250));
    for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }
    cand.slice(0, nU).forEach(([a, c, y], k) => {
      const x = toX(R, a, c), z = toZ(R, a, c);
      if (k === 0 && B.ht > 11) { put('unit', x, y + 1.3, z, B.th, 0, 2.8, 2.6, 2.8, '#bdb7aa'); return; }
      put('unit', x, y + 0.55, z, B.th + (r() < 0.5 ? 0 : Math.PI / 2), 0, 1.4, 1.1, 1.0, r() < 0.6 ? '#cfd1d3' : '#8e9296');
    });
  }

  // ---------- panden van een vak ----------
  function scan(c) {
    const g = c.mesh?.geometry; if (!g || !c.biz || !c.pA) return;
    const P = g.attributes.position.array, I = g.index.array, n = c.bR.length;
    for (let b = 0; b < n; b++) {
      if (c.biz[b * 2 + 1] < 0.6 * 255) continue;
      const r0 = c.bR[b] * 3, r1 = (b + 1 < n ? c.bR[b + 1] : c.nr) * 3; if (r1 <= r0) continue;
      const v0 = I[r0], ar = c.pA[b], ht = c.pH[b] / 10, sd = c.pS[b], isHal = ar > 2500 && ht < 16;
      if (!isHal) { const mk = (sd * 3.1) % 1; if (mk < 0.34 || mk >= 0.67) continue; } // alleen grind-daken krijgen kasten
      const T = [];
      for (let k = r0; k + 2 < r1; k += 3) {
        const p = I[k] * 3, q = I[k + 1] * 3, s = I[k + 2] * 3;
        const ux = P[q] - P[p], uy = P[q + 1] - P[p + 1], uz = P[q + 2] - P[p + 2], wx = P[s] - P[p], wy = P[s + 1] - P[p + 1], wz = P[s + 2] - P[p + 2];
        const ny = Math.abs(ux * wz - uz * wx); if (!(ny > 0.97 * Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx))) continue; // ook verborgen (platgemaakte) panden vallen af
        T.push(P[p], P[p + 1], P[p + 2], P[q], P[q + 1], P[q + 2], P[s], P[s + 1], P[s + 2]);
      }
      if (!T.length) continue;
      const th = (c.biz[b * 2] / 255 - 0.5) * Math.PI, R = grid(T, th); if (!R) continue; // = vBz.x in de shader
      const B = { th, sd, ar, ht };
      isHal ? hal(R, B) : units(R, B);
    }
  }

  // ---------- meshes (één per soort over alle vakken) ----------
  function material(k) {
    const K = KIND[k], m = new THREE.MeshLambertMaterial({ color: K.color, flatShading: true });
    if (K.seam) m.onBeforeCompile = s => { // naden tussen de panelen in een reeks
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPa, vLen;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLen = length(instanceMatrix[0].xyz); vPa = (position.x + 0.5) * vLen;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPa, vLen;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        { float q = (vPa + 0.08) / ${K.seam.toFixed(2)}, fw = fwidth(q);
          float seam = 1.0 - step(0.073, fract(q)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.82), mix(seam, 0.073, smoothstep(0.2, 0.6, fw)) * 0.8); }`);
    };
    H.celify?.(m, 'dak-' + k);
    return m;
  }
  function flush() {
    for (const k in L) {
      const l = L[k], cnt = l.m.length / 16; if (!cnt) continue;
      if (!l.mesh || cnt > l.cap) {
        if (l.mesh) { H.scene.remove(l.mesh); l.mesh.dispose(); }
        l.cap = Math.max(256, cnt * 1.5 | 0);
        l.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), l.mat ||= material(k), l.cap);
        if (KIND[k].colors) l.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(l.cap * 3), 3);
        l.mesh.name = 'dak-' + k; l.mesh.frustumCulled = false; l.mesh.castShadow = KIND[k].shadow; l.mesh.receiveShadow = true;
        H.scene.add(l.mesh);
      }
      l.mesh.instanceMatrix.array.set(l.m); l.mesh.instanceMatrix.needsUpdate = true;
      if (KIND[k].colors) { l.mesh.instanceColor.array.set(l.c); l.mesh.instanceColor.needsUpdate = true; }
      l.mesh.count = cnt; l.mesh.visible = on();
    }
    H.redraw?.();
  }
  let busy = false;
  function pump() {
    busy = false; const c = queue.shift(); if (!c) return;
    try { scan(c); } catch (e) { console.error('daken', c.i, c.j, e); }
    flush();
    if (queue.length) { busy = true; setTimeout(pump, 0); }
  }
  function add(c) { const k = c.i + '_' + c.j; if (done.has(k) || !c.mesh) return; done.add(k); queue.push(c); if (!busy) { busy = true; setTimeout(pump, 0); } }
  const vis = () => { for (const k in L) if (L[k].mesh) L[k].mesh.visible = on(); H.redraw?.(); };
  H.on('grown', add);
  H.on('mode', vis); H.on('fx', vis);
  if (H.chunks) for (const c of H.chunks.values()) if (c.mesh && !c.growing) add(c);
})();
