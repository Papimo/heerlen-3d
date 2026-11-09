// iso/spires.js — accent op kerktorens/spitsen: kleine gouden tip (bol + kruisje) op het hoogste dakpunt, 's avonds met gloed.
// Herkenning: (a) OSM-kerken/klokkentorens uit data/spires.js (tools/build-spires.cjs): pand dat een omtrek raakt, ≥ 15 m;
// (b) terugval/aanvulling: slank en hoog (≥ 25 m, dakpunten boven 80% van de hoogte < 40 m²). Eén InstancedMesh; alleen in iso.
// De donkere inktrand doet de bestaande omlijning (NRM-pass) al; geen eigen lijn.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return;
  const SKIP = new Set(['917100000047751', '917100000050176', '917100000047163']); // eigen modellen (iso/models.js BAG): verborgen panden
  const MIN_H = 25, MIN_OSM = 15, TOP_FR = 0.8, TOP_A = 40, CAP = 600, TIP_UP = 0.3, GOLD = '#d9a54a';
  const tips = new Map(); // sleutel → [x, y, z] (wereld); 'o<n>' = OSM-omtrek n (hoogste pand wint), 'h<bag>' = heuristiek
  let mesh = null, dirty = false;

  // ---------- OSM-data (RD) ----------
  const D = (window.H3D_DATA || {}).spires || {};
  const rings = (D.r || []).map(a => { // omtrek als platte [x,y,…] + omhullende
    let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
    for (let k = 0; k < a.length; k += 2) { x0 = Math.min(x0, a[k]); x1 = Math.max(x1, a[k]); y0 = Math.min(y0, a[k + 1]); y1 = Math.max(y1, a[k + 1]); }
    return { a, x0, y0, x1, y1 };
  });
  const pts = D.p || []; // losse punten [x,y,…] (klokkentoren als node)
  const pip = (x, y, a) => { let in_ = false; for (let k = 0, n = a.length / 2, j = n - 1; k < n; j = k++) { const xi = a[2 * k], yi = a[2 * k + 1], xj = a[2 * j], yj = a[2 * j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) in_ = !in_; } return in_; };
  function osmHit(x, y, bb) { // RD-punt (hoogste dakpunt) + omhullende van het pand [x0,y0,x1,y1] → omtrekindex of -1
    for (let r = 0; r < rings.length; r++) {
      const g = rings[r]; if (bb[2] < g.x0 - 2 || bb[0] > g.x1 + 2 || bb[3] < g.y0 - 2 || bb[1] > g.y1 + 2) continue;
      if (pip(x, y, g.a) || pip((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, g.a)) return r;
    }
    for (let k = 0; k < pts.length; k += 2) if (pts[k] > bb[0] - 2 && pts[k] < bb[2] + 2 && pts[k + 1] > bb[1] - 2 && pts[k + 1] < bb[3] + 2) return 100000 + k;
    return -1;
  }

  // ---------- tip: bol + kruisje, ±2,8 m, voet op y 0 ----------
  function geo() {
    const parts = [new THREE.SphereGeometry(0.7, 8, 6).translate(0, 0.6, 0), new THREE.BoxGeometry(0.22, 1.5, 0.22).translate(0, 1.85, 0), new THREE.BoxGeometry(0.9, 0.22, 0.22).translate(0, 2.2, 0)].map(g => g.toNonIndexed());
    const n = parts.reduce((t, g) => t + g.attributes.position.count, 0), P = new Float32Array(n * 3); let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; g.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
  function make() {
    const m = new THREE.MeshLambertMaterial({ color: GOLD, flatShading: true });
    m.onBeforeCompile = s => { // 's avonds opgloeien (zelfde patroon als iso/models.js)
      s.uniforms.uNight = H.U.uNight;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.8, 0.42), uNight * 0.75);');
    };
    H.celify(m, 'spits');
    mesh = new THREE.InstancedMesh(geo(), m, CAP); mesh.name = 'spits'; mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.visible = H.getMode ? H.getMode() === 'iso' : true;
    H.scene.add(mesh);
  }
  function flush() { // instanties opnieuw vullen
    dirty = false; if (!mesh) return;
    const M = new THREE.Matrix4(); let n = 0;
    for (const t of tips.values()) { if (n >= CAP) break; mesh.setMatrixAt(n++, M.makeTranslation(t[0], t[1] - TIP_UP, t[2])); }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; H.redraw?.();
  }

  // ---------- panden van een vak aflopen ----------
  function scan(c) {
    if (!c.mesh || !c.bR || !H.facesOf) return;
    const O = H.areaInfo.origin, P = c.mesh.geometry.attributes.position.array, I = c.mesh.geometry.index.array, n = c.ids.length;
    for (let b = 0; b < n; b++) {
      if (SKIP.has(String(c.ids[b]).padStart(16, '0'))) continue;
      let lo = Infinity, hi = -Infinity, hv = -1, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const v of H.facesOf(c, b)) { const y = P[v * 3 + 1], x = P[v * 3], z = P[v * 3 + 2]; if (y < lo) lo = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const r0 = c.bR[b] * 3, r1 = (b + 1 < n ? c.bR[b + 1] : c.nr) * 3; // dakdriehoeken
      for (let k = r0; k < r1; k++) { const v = I[k] * 3; if (P[v + 1] > hi) { hi = P[v + 1]; hv = v; } }
      const h = hi - lo; if (hv < 0 || !(h >= MIN_OSM)) continue; // ook platgemaakte (verborgen) panden vallen hier af
      const X = P[hv], Z = P[hv + 2], rx = X + O[0], ry = O[1] - Z;
      const o = osmHit(rx, ry, [x0 + O[0], O[1] - z1, x1 + O[0], O[1] - z0]);
      if (o >= 0) { // OSM: per omtrek het hoogste pand
        const key = 'o' + o, old = tips.get(key); if (!old || old[1] < hi) tips.set(key, [X, hi, Z]); continue;
      }
      if (h < MIN_H) continue;
      let a = 0, cut = lo + h * TOP_FR; // oppervlak (xz) van dakdriehoeken boven 80% van de hoogte
      for (let k = r0; k < r1; k += 3) {
        const i = I[k] * 3, j = I[k + 1] * 3, l = I[k + 2] * 3; if ((P[i + 1] + P[j + 1] + P[l + 1]) / 3 < cut) continue;
        a += Math.abs((P[j] - P[i]) * (P[l + 2] - P[i + 2]) - (P[l] - P[i]) * (P[j + 2] - P[i + 2])) / 2; if (a > TOP_A) break;
      }
      if (a <= TOP_A) tips.set('h' + c.ids[b], [X, hi, Z]);
    }
  }
  function onChunk(c) { if (!mesh) make(); scan(c); dirty = true; flush(); }
  H.on('chunk', onChunk);
  H.on('mode', m => { if (mesh) { mesh.visible = m === 'iso'; H.redraw?.(); } });
  if (H.chunks) for (const c of H.chunks.values()) if (c.mesh) onChunk(c); // vakken die er al waren
})();
