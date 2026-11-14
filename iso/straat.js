// iso/straat.js — straatniveau (design/21 § 3, keuze C): verkeerslichten (OSM, paal per kant), voorrang/stopborden, zebraborden aan beide einden van elke zebra,
// paaltjes, prullenbakken, fietsenrekken, brievenbussen (OSM) en stoepranden in 3D (rand langs de rijbaan, open bij kruisingen).
// Data: data/street.js (tools/build-street.cjs) + GD.lineKeep/crossKeep (iso/ground.js). Per km-vak, alleen dichtbij, vak voor vak.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return;
  const NEAR = 1300;
  const V = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), M = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);

  // ---------- modellen: vertexkleur + aSG (eigen licht: 1 = brandt, ook overdag; 's avonds feller) ----------
  let MAT = null, GEO = null;
  function mats() {
    if (MAT) return;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    m.onBeforeCompile = s => {
      s.uniforms.uStN = H.U.uNight;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSG; varying float vSG;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSG = aSG;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uStN; varying float vSG;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSG * (0.5 + 2.2 * uStN);');
    };
    MAT = H.celify(m, 'prop-straat');
    const part = (g, c, glow = 0) => { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, C = new Float32Array(n * 3), k = new THREE.Color(c); for (let i = 0; i < n * 3; i += 3) { C[i] = k.r; C[i + 1] = k.g; C[i + 2] = k.b; } g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aSG', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1)); g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; };
    const merge = list => { const n = list.reduce((t, g) => t + g.attributes.position.count, 0), P = new Float32Array(n * 3), C = new Float32Array(n * 3), G = new Float32Array(n); let o = 0;
      for (const g of list) { P.set(g.attributes.position.array, o * 3); C.set(g.attributes.color.array, o * 3); G.set(g.attributes.aSG.array, o); o += g.attributes.position.count; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aSG', new THREE.BufferAttribute(G, 1)); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };
    const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z), Cy = (r, h, y, s = 6) => new THREE.CylinderGeometry(r, r, h, s).translate(0, y, 0);
    const disc = (y, z) => new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10).rotateX(Math.PI / 2).translate(0, y, z); // voorkant = +z
    const signal = lit => merge([part(Cy(0.06, 3.3, 1.65), '#3a3d42'), part(B(0.32, 0.95, 0.24, 0, 2.75, 0.02), '#25272b'), part(B(0.46, 1.1, 0.03, 0, 2.75, -0.11), '#1d1e21'),
      part(disc(3.07, 0.16), '#ff3a2a', lit === 'r' ? 1 : 0.08), part(disc(2.75, 0.16), '#ffb02a', 0.08), part(disc(2.43, 0.16), '#3aff7a', lit === 'g' ? 1 : 0.08)]);
    const tri = (r, z, c) => part(new THREE.CylinderGeometry(r, r, 0.02, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2 * 3).translate(0, 0, z), c);
    const plate = (g, y) => { g.translate(0, y, 0); return g; };
    const triSign = () => { const a = tri(0.42, 0.02, '#c8262a'), b = tri(0.3, 0.035, '#f6f4ee'); a.translate(0, 2.05, 0); b.translate(0, 2.05, 0); return merge([part(Cy(0.04, 2.1, 1.05), '#a3a8ad'), a, b]); };
    const stop = () => merge([part(Cy(0.04, 2.1, 1.05), '#a3a8ad'), part(plate(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 0, 0.03), 2.1), '#c8262a'), part(plate(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 0, 0.035), 2.1), '#d23a34')]);
    const zebra = () => { const t = tri(0.2, 0.05, '#f6f4ee'); t.translate(0, 2.25, 0); return merge([part(Cy(0.04, 2.6, 1.3), '#a3a8ad'), part(B(0.6, 0.6, 0.03, 0, 2.25, 0.03), '#1f5fb0', 0.15), t, part(B(0.3, 0.06, 0.04, 0, 2.08, 0.05), '#1c1c1c')]); };
    GEO = {
      sigR: signal('r'), sigG: signal('g'), give: triSign(), stop: stop(), zebra: zebra(),
      bol: merge([part(Cy(0.07, 0.9, 0.45, 8), '#3b3c40'), part(Cy(0.075, 0.1, 0.72, 8), '#f2f0ea')]),
      bin: merge([part(Cy(0.03, 0.9, 0.45, 5), '#5a5e62'), part(Cy(0.21, 0.6, 0.62, 10), '#3d6b4a'), part(Cy(0.23, 0.05, 0.95, 10), '#2e5039')]),
      post: merge([part(B(0.45, 1.05, 0.34, 0, 0.53, 0), '#ec7a1e'), part(B(0.47, 0.06, 0.36, 0, 1.08, 0), '#d0661a'), part(B(0.26, 0.04, 0.02, 0, 0.82, 0.18), '#2a2a2a')]),
      rack: merge([part(B(0.05, 0.75, 0.05, -0.35, 0.38, 0), '#9aa0a6'), part(B(0.05, 0.75, 0.05, 0.35, 0.38, 0), '#9aa0a6'), part(B(0.75, 0.05, 0.05, 0, 0.75, 0), '#9aa0a6')]),
      kerb: merge([part(B(1, 1, 1, 0, 0.5, 0), '#ffffff')]),
    };
  }

  // ---------- data per vak ----------
  let BY = null;
  function bucket() {
    BY = new Map(); BY.noRd = !window.H3D_DATA?.ground?.lineKeep; const km = H.areaInfo.km || 1000, O = H.areaInfo.origin, GD = window.H3D_DATA?.ground, q = GD?.q || 0.5, D = window.H3D_DATA?.street || {};
    const get = (x, y) => { const id = Math.floor(x / km) + '_' + Math.floor(y / km); return BY.get(id) || BY.set(id, { sig: [], sign: [], bol: [], bin: [], post: [], bike: [], zeb: [], rd: [] }).get(id); };
    for (let k = 0; k + 2 < (D.sig || []).length; k += 3) get(D.sig[k], D.sig[k + 1]).sig.push([D.sig[k], D.sig[k + 1], D.sig[k + 2]]);
    for (let k = 0; k + 3 < (D.sign || []).length; k += 4) get(D.sign[k], D.sign[k + 1]).sign.push(D.sign.slice(k, k + 4));
    for (let k = 0; k + 1 < (D.bol || []).length; k += 2) get(D.bol[k], D.bol[k + 1]).bol.push([D.bol[k], D.bol[k + 1]]);
    for (const n of ['bin', 'post']) for (let k = 0; k + 2 < (D[n] || []).length; k += 3) get(D[n][k], D[n][k + 1])[n].push(D[n].slice(k, k + 3));
    for (let k = 0; k + 3 < (D.bike || []).length; k += 4) get(D.bike[k], D.bike[k + 1]).bike.push(D.bike.slice(k, k + 4));
    const dec = d => { const a = []; let x = 0, y = 0; for (let k = 0; k < d.length; k += 2) { x += d[k]; y += d[k + 1]; a.push(O[0] + x * q, O[1] + y * q); } return a; };
    for (const [k, bike, d] of GD?.crossKeep || []) { if (bike || k === 'g' || k === 'l') continue; const a = dec(d); if (a.length >= 4) get(a[0], a[1]).zeb.push(a); }
    for (const [c, w, br, d] of GD?.lineKeep || []) { // weg in elk vak dat hij raakt
      const a = dec(d), half = (w / 10 + 0.6) * 26 / 32 / 2, ids = new Set();
      for (let k = 0; k < a.length; k += 2) ids.add(Math.floor(a[k] / km) + '_' + Math.floor(a[k + 1] / km));
      for (const id of ids) { const [i, j] = id.split('_').map(Number); get(i * km + 1, j * km + 1).rd.push({ a, half }); }
    }
    return BY;
  }

  // ---------- één vak ----------
  const done = new Map(), queue = [];
  function scan(c) {
    BY ||= bucket(); mats();
    const b = BY.get(c.i + '_' + c.j); if (!b) { done.set(c, null); return; }
    const O = H.areaInfo.origin, km = H.areaInfo.km || 1000, L = {};
    const hAt = (x, y) => H.heightAt(Math.min(c.x0 + km - 0.01, Math.max(c.x0, x)), Math.min(c.y0 + km - 0.01, Math.max(c.y0, y)));
    // th = richting (rad, RD) waar de voorkant (+z) naar kijkt
    const put = (k, x, y, th, sx = 1, sy = 1, sz = 1, dy = 0) => { Q.setFromAxisAngle(UP, th + Math.PI / 2); M.compose(V.set(x - O[0], hAt(x, y) + dy, -(y - O[1])), Q, S.set(sx, sy, sz)); (L[k] ||= []).push(M.clone()); };
    const R = Math.PI / 180;
    let n = 0;
    for (const [x, y, d] of b.sig) put(n++ % 2 ? 'sigG' : 'sigR', x, y, d * R);
    for (const [x, y, st, d] of b.sign) put(st ? 'stop' : 'give', x, y, d * R);
    for (const a of b.zeb) { // zebrabord aan beide einden, iets naast de stoeprand, kijkt langs de weg
      const ax = a[0], ay = a[1], bx = a.at(-2), by = a.at(-1), len = Math.hypot(bx - ax, by - ay); if (len < 2) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, th = Math.atan2(uy, ux);
      put('zebra', ax - ux * 0.6, ay - uy * 0.6, th + Math.PI / 2); put('zebra', bx + ux * 0.6, by + uy * 0.6, th - Math.PI / 2);
    }
    {
      for (const [x, y] of b.bol) put('bol', x, y, 0);
      for (const [x, y, d] of b.bin) put('bin', x, y, d * R);
      for (const [x, y, d] of b.post) put('post', x, y, d * R);
      for (const [x, y, d, m] of b.bike) for (let i = 0; i < m; i++) { const t = (i - (m - 1) / 2) * 0.8; put('rack', x + Math.cos(d * R) * t, y + Math.sin(d * R) * t, d * R); }
    }
    { // stoepranden: per wegstuk links en rechts op de wegdekrand, weg bij knopen die meer wegen delen (kruising) binnen halve breedte + 1,8 m
      const cnt = new Map(), key = (x, y) => Math.round(x * 2) + ',' + Math.round(y * 2);
      for (const r of b.rd) for (let k = 0; k < r.a.length; k += 2) { const kk = key(r.a[k], r.a[k + 1]), e = cnt.get(kk); if (!e) cnt.set(kk, { n: 1, h: r.half, r }); else if (e.r !== r) { e.n++; e.h = Math.max(e.h, r.half); } }
      for (const r of b.rd) {
        const a = r.a, s = [0]; for (let k = 2; k < a.length; k += 2) s.push(s.at(-1) + Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]));
        const cut = []; for (let k = 0; k < a.length; k += 2) { const e = cnt.get(key(a[k], a[k + 1])); if (e && e.n > 1) cut.push([s[k / 2] - e.h - 1.8, s[k / 2] + e.h + 1.8]); }
        for (let k = 0; k + 3 < a.length; k += 2) {
          const s0 = s[k / 2], s1 = s[k / 2 + 1], len = s1 - s0; if (len < 0.3) continue;
          const ux = (a[k + 2] - a[k]) / len, uy = (a[k + 3] - a[k + 1]) / len, th = Math.atan2(uy, ux);
          let parts = [[s0, s1]];
          for (const [c0, c1] of cut) parts = parts.flatMap(([p0, p1]) => c1 <= p0 || c0 >= p1 ? [[p0, p1]] : [[p0, Math.max(p0, c0)], [Math.min(p1, c1), p1]].filter(([q0, q1]) => q1 - q0 > 0.4));
          for (const [p0, p1] of parts) { const m = (p0 + p1) / 2 - s0, mx = a[k] + ux * m, my = a[k + 1] + uy * m;
            if (mx < c.x0 || mx >= c.x0 + km || my < c.y0 || my >= c.y0 + km) continue;
            for (const sd of [1, -1]) put('kerb', mx - uy * r.half * sd, my + ux * r.half * sd, th - Math.PI / 2, p1 - p0, 0.16, 0.22, -0.04); } // th − 90°: lange as (x) langs de weg
        }
      }
    }
    const g = new THREE.Group(); g.name = 'straat ' + c.i + '_' + c.j;
    const col = new THREE.Color('#d6d1c7');
    for (const k in L) { const im = new THREE.InstancedMesh(GEO[k], MAT, L[k].length); L[k].forEach((m, i) => { im.setMatrixAt(i, m); if (k === 'kerb') im.setColorAt(i, col); }); im.castShadow = k !== 'kerb'; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im); }
    H.scene.add(H.freeze ? H.freeze(g) : g); done.set(c, g); vis(c);
  }
  const near = c => H.treeDist ? H.treeDist(H.chunkDist(c) * H.lens()) < NEAR : true;
  const vis = c => { const g = done.get(c); if (g) g.visible = H.getMode?.() === 'iso' && near(c); };
  let busy = false, gen = 0; // gen: verhoogd bij herstart (wegen), lopende bouw telt dan niet
  function pump() {
    if (busy) return; const i = queue.findIndex(near); if (i < 0) return;
    busy = true; const c = queue.splice(i, 1)[0], g0 = gen;
    setTimeout(() => { try { if (g0 === gen && !done.has(c)) scan(c); else if (!done.has(c)) queue.push(c); } catch (e) { console.warn('straat', e); } busy = false; H.shadowDirty?.(); pump(); }, 30);
  }
  H.on('chunk', c => { if (!done.has(c) && !queue.includes(c)) queue.push(c); pump(); });
  H.on('detail', () => { for (const c of done.keys()) vis(c); pump(); });
  for (const c of H.chunks?.values?.() || []) if (c.dem) queue.push(c);
  function reset() { for (const [c, g] of done) { if (g) { H.scene.remove(g); g.traverse(o => o.isInstancedMesh && o.dispose()); } queue.push(c); } done.clear(); gen++; H.shadowDirty?.(); pump(); }
  H.on('ground', () => { if (BY?.noRd && window.H3D_DATA?.ground?.lineKeep) { BY = null; reset(); } }); // wegen pas na het bouwen van de grond (iso/ground.js keepStreet)
  pump();
})();
