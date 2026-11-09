// Heerlen 3D — namen op de kaart (DOM, zoals de pins): wijken/buurten ver weg, straatnamen dichtbij gedraaid langs de straat, stations.
// Data uit data/layers.js (H3D.layerData). Overlappende labels weglaten; dezelfde straatnaam hooguit één keer in beeld.
(() => {
  const POOL = 70, CELL = 250, FLOAT = 40, PF = 20, TILT = 0.45; // wijknamen liggen plat ±40 m boven de grond; PF = basis-lettergrootte (px) waarop de matrix schaalt
  let streets = null, places = [], stations = [];
  const grid = new Map(); // cel → straatankers
  const MAJOR = new Set(['primary', 'secondary', 'tertiary']);
  const PLACE = { suburb: [17, 30000], town: [17, 30000], village: [16, 30000], quarter: [15, 9000], neighbourhood: [13, 4200], hamlet: [13, 4200] }; // [lettergrootte, max afstand]

  function prepare(d) {
    streets = [];
    for (const [name, hw, xy] of d.streets) {
      const cum = [0];
      for (let k = 2; k < xy.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(xy[k] - xy[k - 2], xy[k + 1] - xy[k - 1]));
      const L = cum[cum.length - 1];
      if (L < 50) continue;
      const n = Math.max(1, Math.round(L / 300)); // om de ±300 m een anker
      for (let a = 0; a < n; a++) {
        const at = L * (a + 0.5) / n;
        let s = 1; while (s < cum.length - 1 && cum[s] < at) s++;
        const t = (at - cum[s - 1]) / ((cum[s] - cum[s - 1]) || 1), k = (s - 1) * 2;
        const x = xy[k] + (xy[k + 2] - xy[k]) * t, y = xy[k + 1] + (xy[k + 3] - xy[k + 1]) * t;
        const dx = xy[k + 2] - xy[k], dy = xy[k + 3] - xy[k + 1], l = Math.hypot(dx, dy) || 1;
        const it = { name, major: MAJOR.has(hw), x, y, dx: dx / l, dy: dy / l, w: 10 + name.length * 6.3, h: null };
        streets.push(it);
        const ck = Math.floor(x / CELL) + '_' + Math.floor(y / CELL);
        (grid.get(ck) || grid.set(ck, []).get(ck)).push(it);
      }
    }
    places = d.places.filter(p => PLACE[p[1]]).map(([name, kind, x, y]) => ({ name, kind, x, y, size: PLACE[kind][0], max: PLACE[kind][1], w: 12 + name.length * PLACE[kind][0] * 0.8, h: null }));
    stations = d.stations.map(([name, x, y]) => ({ name: 'Station ' + name, x, y, w: 30 + name.length * 7, h: null }));
  }

  const box = document.createElement('div'); box.id = 'labels';
  const els = [];
  let used = 0;
  function el(cls, text) {
    let e = els[used];
    if (!e) { e = document.createElement('span'); box.appendChild(e); els.push(e); }
    used++;
    if (e._t !== text) { e.textContent = text; e._t = text; }
    if (e.className !== cls) { e.className = cls; e.style.fontSize = ''; } // hergebruikt element: lettergrootte van een wijknaam niet meenemen naar een straatnaam
    e.style.display = '';
    return e;
  }

  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  const hOf = it => it.h ?? (H3D.chunks.has(Math.floor(it.x / H3D.areaInfo.km) + '_' + Math.floor(it.y / H3D.areaInfo.km)) ? (it.h = H3D.heightAt(it.x, it.y)) : null);
  function screen(it, lift, cam, W, Hh) { // → [sx, sy, afstand] of null
    const h = hOf(it); if (h == null) return null;
    v.copy(H3D.toWorld(it.x, it.y, h + lift));
    const d = v.distanceTo(cam.position) * H3D.lens();
    v.project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * Hh, d];
  }
  const R = new THREE.Vector3(), F = new THREE.Vector3(), P = new THREE.Vector3();
  function flat(it, cam, W, Hh, s) { // → [a, b, c, d]: schermpixels per meter langs camera-rechts (a,b) en naar-de-camera (c,d) over de grond
    R.setFromMatrixColumn(cam.matrixWorld, 0); R.y = 0; R.normalize();
    F.setFromMatrixColumn(cam.matrixWorld, 2); F.y = 0; F.normalize(); // +z camera = naar achteren = naar de kijker toe
    const base = H3D.toWorld(it.x, it.y, it.h + FLOAT), L = 20, out = [];
    for (const D of [R, F]) { P.copy(base).addScaledVector(D, L).project(cam); out.push(((P.x + 1) / 2 * W - s[0]) / L, ((1 - P.y) / 2 * Hh - s[1]) / L); }
    return out;
  }
  const boxes = [];
  const free = b => !boxes.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);

  function place() {
    used = 0; boxes.length = 0;
    if (streets) {
      const cam = H3D.camera(), W = innerWidth, Hh = innerHeight, camD = H3D.cameraDistance() * H3D.lens();
      // pins en hun namen gaan voor: hun plek telt als bezet
      for (const b of H3D.pinBoxes || []) boxes.push(b); // vakjes van pin-namen (ui.js placePins), niet uit de DOM meten: dat dwong elk beeld een layout af
      if (H3D.layerOn('wijken')) {
        const list = [];
        for (const it of [...places, ...stations]) {
          const st = !it.kind;
          const s = screen(it, st ? 15 : FLOAT, cam, W, Hh); if (!s) continue;
          if (st ? s[2] > 7000 : s[2] > it.max || s[2] < (it.size >= 15 ? 450 : 350)) continue;
          if (!st) { // plat liggend: tekst-x = camera-rechts over de grond, tekst-y = naar de camera toe → CSS-matrix uit geprojecteerde grondvectoren
            const m = flat(it, cam, W, Hh, s), want = Math.max(12, Math.min(it.size * 3.4, it.size * 2.2 * 2500 / s[2])); // lettergrootte (px): groter dichtbij, geklemd
            const k = want / PF / (Math.hypot(m[0], m[1]) || 1); // matrix zo schalen dat de breedte-as precies die grootte geeft; plat blijft plat
            const n = Math.hypot(m[0], m[1]); // half liggend: hoogte-as mengen tussen plat (op de grond) en rechtop (TILT 0 = rechtop, 1 = plat)
            it.m = [m[0] * k, m[1] * k, m[2] * TILT * k, (m[3] * TILT + n * (1 - TILT)) * k];
          }
          list.push([it, s, st ? 0 : -it.size]);
        }
        list.sort((a, b) => a[2] - b[2] || a[1][2] - b[1][2]);
        for (const [it, [sx, sy], st] of list) {
          let hw = it.w / 2, hh = 9;
          if (it.size) { const [a, b2, c, d] = it.m, tw = it.w * PF / it.size / 2, th = PF / 2 + 2; hw = Math.abs(a) * tw + Math.abs(c) * th; hh = Math.abs(b2) * tw + Math.abs(d) * th; }
          const b = [sx - hw, sy - hh, sx + hw, sy + hh];
          if (!free(b)) continue;
          boxes.push(b);
          const e = el(st === 0 ? 'lb st' : 'lb pl', it.name);
          if (it.size) { e.style.fontSize = PF + 'px'; e.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) matrix(${it.m.map(q => q.toFixed(4)).join(',')},0,0) translate(-50%,-50%)`; }
          else e.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%)`;
        }
      }
      if (H3D.layerOn('straten') && H3D.U.uIso.value > 0.5 && camD < 1800) { // buiten iso staan de namen al in de kaarttegels (PDOK/CARTO)
        const [tx, ty] = H3D.target(), R = Math.min(1600, camD * 1.6), c0 = Math.floor((tx - R) / CELL), c1 = Math.floor((tx + R) / CELL), r0 = Math.floor((ty - R) / CELL), r1 = Math.floor((ty + R) / CELL);
        const list = [];
        for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) for (const it of grid.get(i + '_' + j) || []) {
          const s = screen(it, 1.5, cam, W, Hh); if (!s || s[2] > (it.major ? 1500 : 950)) continue;
          list.push([it, s]);
        }
        list.sort((a, b) => (b[0].major - a[0].major) || a[1][2] - b[1][2]);
        const seen = new Set();
        for (const [it, [sx, sy]] of list) {
          if (seen.has(it.name) || used >= POOL) continue;
          // hoek op het scherm: punt 10 m verder langs de straat projecteren
          v2.copy(H3D.toWorld(it.x + it.dx * 10, it.y + it.dy * 10, it.h + 1.5)).project(cam);
          let ang = Math.atan2(-(v2.y - v.copy(H3D.toWorld(it.x, it.y, it.h + 1.5)).project(cam).y) * Hh, (v2.x - v.x) * W);
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          const cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang)), hw = (it.w * cs + 14 * sn) / 2, hh = (it.w * sn + 14 * cs) / 2;
          const b = [sx - hw, sy - hh, sx + hw, sy + hh];
          if (!free(b)) continue;
          boxes.push(b); seen.add(it.name);
          const e = el(it.major ? 'lb sr mj' : 'lb sr', it.name);
          e.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) rotate(${ang.toFixed(3)}rad)`;
        }
      }
    }
    for (let k = used; k < els.length; k++) if (els[k].style.display !== 'none') els[k].style.display = 'none';
  }

  let need = true;
  H3D.on('frame', () => { need = true; });
  H3D.on('layer', () => { need = true; H3D.redraw(); });
  // los van het tekenen bijwerken (hooguit 1× per beeld, na de pins)
  (function tick() { requestAnimationFrame(tick); if (need) { need = false; place(); } })();
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pins').before(box);
    if (H3D.layerData) prepare(H3D.layerData);
  });
  H3D.on('layers', prepare);
})();
