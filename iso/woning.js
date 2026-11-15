// iso/woning.js — 3D-stukjes bij woningen (keuze design/22_woningen.html, 2026-11-15). Aan/uit per onderdeel via H3D.setWon / H3D.won() (app.js "woningdetails").
// goot 'b': goot + regenpijp + overstek met boeiboord · plat 'a': lichtkoepel, ontluchting op platte woningdaken.
// Het geschilderde deel (deur a, balkon a, grind) zit in de gevelshader (app.js GEV_WALL/GEV_ROOF).
// Alleen iso + "Daken op bouwjaar", alleen dichtbij, per vak en per (groep, optie) één keer gebouwd (wachtrij, één per keer).
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on || !H.won) return;
  const GROUPS = { goot: { b: 1 }, plat: { a: 1 } }; // opties mét 3D-stukjes
  const NEAR = { goot: 1500, plat: 1500 };
  const KIND = { sh: { shadow: true }, ns: { shadow: false } };
  const L = {}; for (const k in KIND) L[k] = { m: [], c: [] };
  const V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), QT = new THREE.Quaternion(), M = new THREE.Matrix4(), CO = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);
  const on = () => (H.getMode ? H.getMode() === 'iso' : true) && H.U?.uAnime?.value > 0.5;
  const rnd = (s, k) => { const x = Math.sin(s * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
  const pick = (a, r) => a[Math.min(a.length - 1, Math.floor(r * a.length))];

  // doos: midden (x, y, z), th = richting van de lokale x-as (rad, in het xz-vlak), tilt = kantelen om de lokale x-as
  function put(k, x, y, z, th, sx, sy, sz, col, tilt) {
    Q.setFromAxisAngle(UP, -th); if (tilt) Q.multiply(QT.setFromAxisAngle(AX, tilt));
    M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz)); L[k].m.push(...M.elements);
    CO.set(col || '#ffffff'); L[k].c.push(CO.r, CO.g, CO.b);
  }

  // ---------- muren van één pand: unieke stukken met buitennormaal; base = maaiveld bij het pand (voet + 1 m, zoals de shader) ----------
  function walls(c, b, P, I) {
    const E = new Map(); let lo = Infinity, sx = 0, sz = 0, sn = 0;
    for (const [f0, f1] of H.wallRuns(c, b)) for (let k = (c.nr + f0) * 3, k1 = (c.nr + f1) * 3; k + 2 < k1; k += 3) {
      const t = [I[k] * 3, I[k + 1] * 3, I[k + 2] * 3], p = t[0], q = t[1], s = t[2];
      const ux = P[q] - P[p], uy = P[q + 1] - P[p + 1], uz = P[q + 2] - P[p + 2], wx = P[s] - P[p], wy = P[s + 1] - P[p + 1], wz = P[s + 2] - P[p + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, nh = Math.hypot(nx, nz); if (nh < 1e-6 || Math.abs(ny) > nh) continue;
      const dx = -nz / nh, dz = nx / nh; let a = p, e = p, ta = Infinity, te = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const v of t) { const d = P[v] * dx + P[v + 2] * dz; if (d < ta) { ta = d; a = v; } if (d > te) { te = d; e = v; } y0 = Math.min(y0, P[v + 1]); y1 = Math.max(y1, P[v + 1]); }
      if (te - ta < 0.3) continue;
      const id = Math.round(P[a] * 10) + ',' + Math.round(P[a + 2] * 10) + ',' + Math.round(P[e] * 10) + ',' + Math.round(P[e + 2] * 10), o = E.get(id);
      if (o) { o.y0 = Math.min(o.y0, y0); o.y1 = Math.max(o.y1, y1); }
      else E.set(id, { ax: P[a], az: P[a + 2], bx: P[e], bz: P[e + 2], len: te - ta, y0, y1, nx: nx / nh, nz: nz / nh, mx: (P[a] + P[e]) / 2, mz: (P[a + 2] + P[e + 2]) / 2 });
      lo = Math.min(lo, y0);
    }
    const segs = [...E.values()]; if (!segs.length) return null;
    for (const s of segs) { sx += s.mx * s.len; sz += s.mz * s.len; sn += s.len; }
    sx /= sn; sz /= sn; let out = 0;
    for (const s of segs) out += ((s.mx - sx) * s.nx + (s.mz - sz) * s.nz > 0 ? 1 : -1) * s.len;
    for (const s of segs) {
      if (out < 0) { s.nx = -s.nx; s.nz = -s.nz; }
      s.th = Math.atan2(s.bz - s.az, s.bx - s.ax); if (-Math.sin(s.th) * s.nx + Math.cos(s.th) * s.nz < 0) s.th += Math.PI; // lokale +z = naar buiten
      s.dx = Math.cos(s.th); s.dz = Math.sin(s.th);
    }
    return { segs, base: lo + 1 };
  }
  // ---------- dak van één pand: goten (horizontale buitenranden van schuine vlakken), platte driehoeken, top ----------
  function roof(P, I, r0, r1) {
    const E = new Map(), flats = [], key = v => Math.round(P[v] * 20) + ',' + Math.round(P[v + 1] * 20) + ',' + Math.round(P[v + 2] * 20);
    let top = -Infinity, tx = 0, tz = 0, cx = 0, cz = 0, cn = 0;
    for (let k = r0; k + 2 < r1; k += 3) {
      const t = [I[k] * 3, I[k + 1] * 3, I[k + 2] * 3], p = t[0], q = t[1], s = t[2];
      for (const v of t) { cx += P[v]; cz += P[v + 2]; cn++; if (P[v + 1] > top) { top = P[v + 1]; tx = P[v]; tz = P[v + 2]; } }
      const ux = P[q] - P[p], uy = P[q + 1] - P[p + 1], uz = P[q + 2] - P[p + 2], wx = P[s] - P[p], wy = P[s + 1] - P[p + 1], wz = P[s + 2] - P[p + 2];
      const a2 = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); if (!a2) continue;
      const cy = Math.abs(uz * wx - ux * wz) / a2, mx = (P[p] + P[q] + P[s]) / 3, my = (P[p + 1] + P[q + 1] + P[s + 1]) / 3, mz = (P[p + 2] + P[q + 2] + P[s + 2]) / 3;
      if (cy > 0.97) { flats.push({ a: a2 / 2, x: mx, y: my, z: mz }); continue; }
      if (cy < 0.2) continue;
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3], ka = key(a), kb = key(b), id = ka < kb ? ka + '|' + kb : kb + '|' + ka, o = E.get(id);
        if (o) o.n++; else E.set(id, { n: 1, a, b, mx, mz });
      }
    }
    const eaves = [];
    for (const o of E.values()) {
      if (o.n !== 1 || Math.abs(P[o.a + 1] - P[o.b + 1]) > 0.12) continue;
      const ax = P[o.a], az = P[o.a + 2], dx = P[o.b] - ax, dz = P[o.b + 2] - az, len = Math.hypot(dx, dz); if (len < 1) continue;
      const mx = ax + dx / 2, mz = az + dz / 2; let px = -dz / len, pz = dx / len;
      if ((o.mx - mx) * px + (o.mz - mz) * pz > 0) { px = -px; pz = -pz; } // naar buiten (weg van het dakvlak)
      eaves.push({ ax, az, dx: dx / len, dz: dz / len, len, mx, mz, y: (P[o.a + 1] + P[o.b + 1]) / 2, px, pz, th: Math.atan2(dz, dx) });
    }
    flats.sort((a, b) => b.a - a.a);
    if (cn) { cx /= cn; cz /= cn; }
    return { eaves, flats, top, tx, tz, cx, cz };
  }

  const ZINK = ['#a9b0b3', '#9aa2a6', '#b4b9ba'];
  const BUILD = {
    goot(c, b, B, P, I) { // goot met regenpijp, overstek met boeiboord (schaduwrand op de gevel)
      if (B.flat > 0.6 || B.ar > 700 || B.ht < 3) return;
      const R = roof(P, I, B.r0, B.r1); if (!R.eaves.length) return;
      const W = walls(c, b, P, I), base = W ? W.base : R.top - B.ht, zc = B.yr > 1995 ? '#55595e' : pick(ZINK, rnd(B.sd, 31));
      const boei = B.yr < 1945 ? '#f1eee6' : B.yr < 1980 ? '#e2ded4' : '#4a4e53';
      for (const e of R.eaves) {
        if (e.y - base < 2) continue;
        put('sh', e.mx + e.px * 0.21, e.y - 0.1, e.mz + e.pz * 0.21, e.th, e.len + 0.3, 0.2, 0.46, boei);
        put('ns', e.mx + e.px * 0.5, e.y - 0.04, e.mz + e.pz * 0.5, e.th, e.len + 0.12, 0.13, 0.17, zc);
        if (e.len >= 2.5) { // regenpijp aan één eind (rijtje: elk huis één → ritme van pandgrenzen)
          const k = rnd(B.sd, 32) < 0.5 ? 0.22 : e.len - 0.22, x = e.ax + e.dx * k + e.px * 0.07, z = e.az + e.dz * k + e.pz * 0.07, h = e.y - base;
          put('ns', x, base + h / 2, z, e.th, 0.09, h, 0.09, zc);
          put('ns', e.ax + e.dx * k + e.px * 0.28, e.y - 0.16, e.az + e.dz * k + e.pz * 0.28, e.th, 0.09, 0.09, 0.5, zc); // bocht onder het overstek door
        }
      }
    },
    plat(c, b, B, P, I) { // lichtkoepel + ontluchting
      if (B.flat < 0.6 || B.ar > 400 || B.ht < 2.3) return;
      const F = roof(P, I, B.r0, B.r1).flats; if (!F.length || F[0].a < 4) return;
      const a = F[0], th = B.th;
      if (rnd(B.sd, 51) < 0.6) { put('ns', a.x, a.y + 0.07, a.z, th, 1.1, 0.14, 1.1, '#8d9296'); put('ns', a.x, a.y + 0.24, a.z, th, 0.9, 0.24, 0.9, '#dfe9ee'); } // lichtkoepel op opstand
      const s = F[1] && F[1].a >= 3 ? F[1] : null; if (!s) return;
      if (rnd(B.sd, 52) < 0.55) { put('sh', s.x, s.y + 0.3, s.z, th, 0.12, 0.6, 0.12, '#8d9296'); put('ns', s.x, s.y + 0.62, s.z, th, 0.22, 0.05, 0.22, '#6d7276'); } // ontluchting met kapje
    },
  };

  function scan(c, grp, opt) {
    const g = c.mesh?.geometry; if (!g || !c.biz || !c.pA || !c.bR) return;
    const P = g.attributes.position.array, I = g.index.array, n = c.bR.length;
    for (let b = 0; b < n; b++) {
      const r0 = c.bR[b] * 3, r1 = (b + 1 < n ? c.bR[b + 1] : c.nr) * 3; if (r1 <= r0) continue;
      const sd = c.pS[b], B = { r0, r1, flat: c.biz[b * 2 + 1] / 255, th: (c.biz[b * 2] / 255 - 0.5) * Math.PI, ar: c.pA[b], ht: c.pH[b] / 10, sd, yr: c.year?.[b] > 1000 ? c.year[b] : 1930 + sd * 70 };
      BUILD[grp](c, b, B, P, I);
    }
  }

  function material(k) {
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    H.celify?.(m, 'woning-' + k);
    return m;
  }

  // ---------- per vak en per (groep, optie) eigen meshes ----------
  const VAK = new Map(), done = new Set(), queue = [], GEO = new THREE.BoxGeometry(1, 1, 1), MATS = {};
  const near = (c, R) => { const drv = !!H.driving?.(); return drv ? H.chunkDist(c) < (H.DRV_FAR || 650) + 100 : H.treeDist(H.chunkDist(c) * H.lens()) < R; };
  function flush(c, grp, opt) {
    const v = { c, grp, opt, m: {} };
    for (const k in L) {
      const l = L[k], cnt = l.m.length / 16; if (!cnt) continue;
      const im = new THREE.InstancedMesh(GEO, MATS[k] ||= material(k), cnt);
      im.instanceMatrix.array.set(l.m); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(l.c), 3);
      im.computeBoundingSphere(); im.name = 'woning-' + grp + '-' + k; im.castShadow = KIND[k].shadow; im.receiveShadow = true;
      H.scene.add(im); v.m[k] = im; l.m = []; l.c = [];
    }
    VAK.set(c.i + '_' + c.j + '_' + grp + '_' + opt, v); show(v); H.shadowDirty?.(); H.redraw?.();
  }
  const show = v => {
    const s = on() && H.won()[v.grp] === v.opt && near(v.c, NEAR[v.grp]); let ch = false;
    for (const k in v.m) if (v.m[k].visible !== s) { v.m[k].visible = s; ch = true; }
    return ch;
  };
  let busy = false;
  function pump() {
    busy = false; const q = queue.shift(); if (!q) return;
    try { scan(q.c, q.grp, q.opt); } catch (e) { console.error('woning', q.grp, q.c.i, q.c.j, e); for (const k in L) { L[k].m = []; L[k].c = []; } }
    flush(q.c, q.grp, q.opt);
    if (queue.length) { busy = true; setTimeout(pump, 0); }
  }
  function add(c) {
    if (!on() || !c.mesh || c.growing) return; const w = H.won();
    for (const grp in GROUPS) {
      const opt = w[grp]; if (!GROUPS[grp][opt] || !near(c, NEAR[grp])) continue;
      const k = c.i + '_' + c.j + '_' + grp + '_' + opt; if (done.has(k)) continue;
      done.add(k); queue.push({ c, grp, opt });
    }
    if (queue.length && !busy) { busy = true; setTimeout(pump, 0); }
  }
  const all = () => { if (H.chunks) for (const c of H.chunks.values()) add(c); };
  const vis = () => {
    let ch = false; for (const v of VAK.values()) ch = show(v) || ch; all(); if (ch) { H.shadowDirty?.(); H.redraw?.(); }
  };
  H.on('grown', add);
  for (const ev of ['detail', 'mode', 'fx', 'gevstyle', 'won']) H.on(ev, vis);
  vis();
})();
