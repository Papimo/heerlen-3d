// iso/dakdetail.js — optie C "Randjes en dakdetail" (design/20_stijl.html): schoorstenen + dakkapellen op schuine daken, dakrand (opstand) op platte daken.
// Alleen met "Daken op bouwjaar" (uAnime) + uDak (standaard aan; ?dak=0 / H3D.setGev(v, false) = uit). Alleen dichtbij (NEAR), vak voor vak na 'grown'.
// Afdekker + schaduwlijn bovenaan de muur zit in de gevelshader (app.js GEV_WALL, uDak).
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return;
  const KIND = {
    rand: { color: '#d9d6cf', shadow: false },
    schoorsteen: { color: '#ffffff', shadow: true, colors: true },
    kapel: { color: '#f2efe8', shadow: true, kapel: true },
  };
  const L = {}; for (const k in KIND) L[k] = { m: [], c: [] }; // verzamelt de instanties van het vak dat nu gescand wordt
  const done = new Set(), queue = [];
  const V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), M = new THREE.Matrix4(), CO = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
  const on = () => (H.getMode ? H.getMode() === 'iso' : true) && H.U?.uAnime?.value > 0.5 && H.U?.uDak?.value > 0.5;
  const rnd = (s, k) => { const x = Math.sin(s * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

  function put(k, x, y, z, th, sx, sy, sz, col) {
    Q.setFromAxisAngle(UP, -th); M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)); L[k].m.push(...M.elements);
    if (KIND[k].colors) { CO.set(col || '#ffffff'); L[k].c.push(CO.r, CO.g, CO.b); }
  }

  function scan(c) {
    const g = c.mesh?.geometry; if (!g || !c.biz || !c.pA) return;
    const P = g.attributes.position.array, I = g.index.array, n = c.bR.length;
    for (let b = 0; b < n; b++) {
      const r0 = c.bR[b] * 3, r1 = (b + 1 < n ? c.bR[b + 1] : c.nr) * 3; if (r1 <= r0) continue;
      const flat = c.biz[b * 2 + 1] / 255, ar = c.pA[b], ht = c.pH[b] / 10, sd = c.pS[b], yr = c.year?.[b] > 1000 ? c.year[b] : 1930 + sd * 70;
      if (ht < 3) continue;
      if (flat > 0.6) { if (ht >= 5 && ar < 20000) rand(P, I, r0, r1); continue; }
      if (flat > 0.4 || ar > 400) continue;
      // schuin dak: hoogste punt (schoorsteen) + grootste schuine vlak (dakkapel)
      let top = -Infinity, tx = 0, tz = 0, cx = 0, cz = 0, cn = 0, best = 0, B = null;
      for (let k = r0; k + 2 < r1; k += 3) {
        const p = I[k] * 3, q = I[k + 1] * 3, s = I[k + 2] * 3;
        for (const v of [p, q, s]) { cx += P[v]; cz += P[v + 2]; cn++; if (P[v + 1] > top) { top = P[v + 1]; tx = P[v]; tz = P[v + 2]; } }
        const ux = P[q] - P[p], uy = P[q + 1] - P[p + 1], uz = P[q + 2] - P[p + 2], wx = P[s] - P[p], wy = P[s + 1] - P[p + 1], wz = P[s + 2] - P[p + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const a2 = Math.hypot(nx, ny, nz); if (!a2) continue;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const cy = ny / a2; if (cy < 0.45 || cy > 0.92 || a2 / 2 < 10 || a2 <= best) continue;
        best = a2; B = { x: (P[p] + P[q] + P[s]) / 3, y: (P[p + 1] + P[q + 1] + P[s + 1]) / 3, z: (P[p + 2] + P[q + 2] + P[s + 2]) / 3, nx, nz };
      }
      if (!cn) continue; cx /= cn; cz /= cn;
      if (rnd(sd, 1) < (yr < 1990 ? 0.75 : 0.3)) { // schoorsteen 0,6 m naar binnen vanaf het hoogste punt (niet over de topgevel)
        const dx = cx - tx, dz = cz - tz, d = Math.hypot(dx, dz) || 1, k = Math.min(0.6, d * 0.5);
        put('schoorsteen', tx + dx / d * k, top + 0.35, tz + dz / d * k, rnd(sd, 2) * Math.PI, 0.55, 1.3, 0.55, rnd(sd, 3) < 0.7 ? '#8a4a3a' : '#4a4d52');
      }
      if (B && rnd(sd, 4) < 0.5) { // dakkapel: breed langs de nok, voorkant naar buiten
        const th = Math.atan2(-B.nz, B.nx) + Math.PI / 2, h = Math.hypot(B.nx, B.nz) || 1;
        put('kapel', B.x + B.nx / h * 0.3, B.y + 0.1, B.z + B.nz / h * 0.3, th, 2.2, 2.0, 1.6);
      }
    }
  }
  // dakrand: randen van het platte dak die maar bij één driehoek horen = buitenrand → opstand 0,4 m hoog, 0,25 m dik, iets naar binnen
  function rand(P, I, r0, r1) {
    const E = new Map(), key = v => Math.round(P[v] * 20) + ',' + Math.round(P[v + 2] * 20), T = [];
    for (let k = r0; k + 2 < r1; k += 3) {
      const t = [I[k] * 3, I[k + 1] * 3, I[k + 2] * 3];
      const ux = P[t[1]] - P[t[0]], uy = P[t[1] + 1] - P[t[0] + 1], uz = P[t[1] + 2] - P[t[0] + 2], wx = P[t[2]] - P[t[0]], wy = P[t[2] + 1] - P[t[0] + 1], wz = P[t[2] + 2] - P[t[0] + 2];
      const ny = Math.abs(ux * wz - uz * wx); if (!(ny > 0.97 * Math.hypot(uy * wz - uz * wy, ny, ux * wy - uy * wx))) continue;
      const cx = (P[t[0]] + P[t[1]] + P[t[2]]) / 3, cz = (P[t[0] + 2] + P[t[1] + 2] + P[t[2] + 2]) / 3;
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3], ka = key(a), kb = key(b), id = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        const o = E.get(id); if (o) o.n++; else E.set(id, { n: 1, a, b, cx, cz });
      }
    }
    for (const o of E.values()) {
      if (o.n !== 1) continue;
      const ax = P[o.a], az = P[o.a + 2], dx = P[o.b] - ax, dz = P[o.b + 2] - az, len = Math.hypot(dx, dz); if (len < 0.8) continue;
      const mx = ax + dx / 2, mz = az + dz / 2; let px = -dz / len, pz = dx / len;
      if ((o.cx - mx) * px + (o.cz - mz) * pz < 0) { px = -px; pz = -pz; } // naar binnen
      put('rand', mx + px * 0.12, Math.max(P[o.a + 1], P[o.b + 1]) + 0.2, mz + pz * 0.12, Math.atan2(dz, dx), len + 0.25, 0.4, 0.25);
    }
  }

  function material(k) {
    const K = KIND[k], m = new THREE.MeshLambertMaterial({ color: K.color, flatShading: true });
    if (K.kapel) m.onBeforeCompile = s => { // raam in voor-/achterkant, donker plat dakje
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP, vLN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position; vLN = normal;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP, vLN;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        if (vLN.y > 0.5) diffuseColor.rgb = vec3(0.07, 0.075, 0.08);
        else if (abs(vLN.z) > 0.5) { float w = step(abs(vLP.x), 0.36) * step(0.0, vLP.y) * step(vLP.y, 0.38), g = step(abs(vLP.x), 0.33) * step(0.025, vLP.y) * step(vLP.y, 0.355);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.09, 0.12) * (0.8 + vLP.y), g * step(0.02, abs(vLP.x)) * w); }`);
    };
    H.celify?.(m, 'dakdetail-' + k);
    return m;
  }
  // per vak eigen meshes: alleen dichtbij zichtbaar (gelijkwaardige afstand < NEAR, zoals bomen/props; rijden: binnen de kijkafstand). Pas bouwen als een vak dichtbij komt.
  const NEAR = 1500, VAK = new Map(), GEO = new THREE.BoxGeometry(1, 1, 1), MATS = {};
  const near = c => { const drv = !!H.driving?.(); return drv ? H.chunkDist(c) < (H.DRV_FAR || 650) + 100 : H.treeDist(H.chunkDist(c) * H.lens()) < NEAR; };
  function flush(c) {
    const v = { c, m: {} };
    for (const k in L) {
      const l = L[k], cnt = l.m.length / 16; if (!cnt) continue;
      const im = new THREE.InstancedMesh(GEO, MATS[k] ||= material(k), cnt);
      im.instanceMatrix.array.set(l.m);
      if (KIND[k].colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(l.c), 3);
      im.computeBoundingSphere(); im.name = 'dakdetail-' + k; im.castShadow = KIND[k].shadow; im.receiveShadow = true;
      H.scene.add(im); v.m[k] = im; l.m = []; l.c = [];
    }
    VAK.set(c.i + '_' + c.j, v); show(v); H.shadowDirty?.(); H.redraw?.();
  }
  const show = v => { const s = on() && near(v.c); let ch = false; for (const k in v.m) if (v.m[k].visible !== s) { v.m[k].visible = s; ch = true; } return ch; };
  let busy = false;
  function pump() {
    busy = false; const c = queue.shift(); if (!c) return;
    try { scan(c); } catch (e) { console.error('dakdetail', c.i, c.j, e); for (const k in L) { L[k].m = []; L[k].c = []; } }
    flush(c);
    if (queue.length) { busy = true; setTimeout(pump, 0); }
  }
  function add(c) { if (!on() || !c.mesh || c.growing || !near(c)) return; const k = c.i + '_' + c.j; if (done.has(k)) return; done.add(k); queue.push(c); if (!busy) { busy = true; setTimeout(pump, 0); } }
  const all = () => { if (H.chunks) for (const c of H.chunks.values()) add(c); };
  const vis = () => { let ch = false; for (const v of VAK.values()) ch = show(v) || ch; all(); if (ch) { H.shadowDirty?.(); H.redraw?.(); } };
  H.on('grown', add);
  H.on('detail', vis); H.on('mode', vis); H.on('fx', vis); H.on('gevstyle', vis);
  all();
})();
