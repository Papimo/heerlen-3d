// iso/rails.js — vangrails langs de snelweg (alleen iso): stalen geleiderail (W-profiel als band 0,45–0,78 m) op paaltjes om de 4 m,
// aan beide kanten van elke rijbaan, 0,9 m buiten het asfalt. Gat waar een op-/afrit, andere weg of brug in de buurt komt.
// Leest snelweg-lijnen (niet op een brug) uit H3D_DATA.ground.line vóór ground.js prep() die leegt. Bouwt per km-vak één mesh op 'terrain'.
// Ver weg (zoals straatmeubilair, iso/props.js detail) en buiten de rijafstand verborgen.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null, GD = window.H3D_DATA?.ground;
  if (!H || !H.on || !GD?.line) return;
  const q = GD.q, MAIN = [], LINKS = [];
  for (const [c, w, br, d, fl = 0] of GD.line) {
    if (c !== 'snelweg' && c !== 'autoweg') continue;
    const rec = { c, w: w / 10, br, d, link: !!(fl & 8) };
    if (c === 'snelweg' && !br && !rec.link) MAIN.push(rec); else LINKS.push(rec); // autoweg/afritten/bruggen = alleen om gaten te maken
  }
  if (!MAIN.length) return;
  const STEP = 4, OFF = 0.9, POST = [0.07, 0.8], BEAM = [0.45, 0.78];
  const C = { steel: new THREE.Color('#b9bec4'), dark: new THREE.Color('#7d838a'), post: new THREE.Color('#8e949b') };
  let O = null, km = 1000, mat = null, group = null, segs = null;
  const VAK = new Map(); // vaksleutel → { c, mesh }
  const key = (x, y) => Math.floor(x / km) + '_' + Math.floor(y / km);

  function prep() {
    O = H.areaInfo.origin; km = H.areaInfo.km || 1000;
    const dec = r => { const a = []; let x = 0, y = 0; for (let k = 0; k < r.d.length; k += 2) { x += r.d[k]; y += r.d[k + 1]; a.push([O[0] + x * q, O[1] + y * q]); } return a; };
    for (const r of MAIN) r.a = dec(r);
    // obstakels voor gaten: afritten/autoweg/bruggen + de andere rijbanen niet (middenberm mag een rail hebben)
    segs = new Map(); const G = 30;
    for (const r of LINKS) {
      const a = dec(r);
      for (let i = 0; i + 1 < a.length; i++) {
        const s = [a[i][0], a[i][1], a[i + 1][0], a[i + 1][1], r.w / 2 + 1.2];
        for (let gx = Math.floor(Math.min(s[0], s[2]) / G) - 1; gx <= Math.floor(Math.max(s[0], s[2]) / G) + 1; gx++)
          for (let gy = Math.floor(Math.min(s[1], s[3]) / G) - 1; gy <= Math.floor(Math.max(s[1], s[3]) / G) + 1; gy++) { const k = gx + ',' + gy; (segs.get(k) || segs.set(k, []).get(k)).push(s); }
      }
    }
    segs.G = G;
  }
  const blocked = (x, y) => {
    for (const s of segs.get(Math.floor(x / segs.G) + ',' + Math.floor(y / segs.G)) || []) {
      const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2));
      if (Math.hypot(s[0] + dx * t - x, s[1] + dy * t - y) < s[4]) return true;
    }
    return false;
  };

  function build(c) {
    if (!O) prep();
    const pos = [], col = [];
    const tri = (A, B, D, cc) => { pos.push(...A, ...B, ...D); for (let i = 0; i < 3; i++) col.push(cc.r, cc.g, cc.b); };
    const quad = (A, B, D, E, cc) => { tri(A, B, D, cc); tri(A, D, E, cc); };
    for (const r of MAIN) {
      const a = r.a, hw = r.w / 2 + OFF;
      for (const side of [1, -1]) {
        // punten om de STEP m langs de lijn, zijwaarts verschoven
        let prev = null, carry = 0;
        for (let i = 0; i + 1 < a.length; i++) {
          const [x0, y0] = a[i], [x1, y1] = a[i + 1], L = Math.hypot(x1 - x0, y1 - y0); if (L < 1e-3) continue;
          const ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy * side, ny = ux * side;
          for (let s = carry; s <= L; s += STEP) {
            const px = x0 + ux * s + nx * hw, py = y0 + uy * s + ny * hw;
            const ok = H.chunks.get(key(px, py)) === c && !blocked(px, py);
            const cur = ok ? { x: px - O[0], z: -(py - O[1]), y: H.heightAt(px, py), nx, nz: -ny } : null;
            if (cur) { // paaltje: smal kruis (2 vlakken), van onder de grond tot net onder de bovenkant
              const p = POST[0];
              for (const [ax, az] of [[ux * p, -uy * p], [nx * p, -ny * p]]) quad([cur.x - ax, cur.y - 0.3, cur.z - az], [cur.x + ax, cur.y - 0.3, cur.z + az], [cur.x + ax, cur.y + POST[1], cur.z + az], [cur.x - ax, cur.y + POST[1], cur.z - az], C.post);
            }
            if (cur && prev) { // ligger: band naar de weg toe (licht), bovenrand (donker)
              const P = (o, h) => /* 12 cm naar de weg vóór de paaltjes */ [o.x - o.nx * 0.12, o.y + h, o.z - o.nz * 0.12];
              quad(P(prev, BEAM[0]), P(cur, BEAM[0]), P(cur, BEAM[1]), P(prev, BEAM[1]), C.steel);
              const T = (o, d) => [o.x - o.nx * d, o.y + BEAM[1], o.z - o.nz * d];
              quad(T(prev, 0.12), T(cur, 0.12), T(cur, 0.02), T(prev, 0.02), C.dark);
            }
            prev = cur;
          }
          carry = (carry - L) % STEP; if (carry < 0) carry += STEP;
        }
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = false; m.receiveShadow = true; m.name = 'vangrail';
    group.add(m); VAK.set(c, { c, mesh: m }); detail(VAK.get(c));
  }
  function detail(v) {
    const drv = !!H.driving?.(), d = H.treeDist ? H.treeDist(H.chunkDist(v.c) * H.lens()) : 0;
    const vis = drv ? H.chunkDist(v.c) < (H.DRV_FAR || 650) + 100 : d < 1800;
    if (v.mesh.visible !== vis) { v.mesh.visible = vis; return true; }
    return false;
  }
  const done = new Set();
  H.on('terrain', c => {
    if (!c?.dem || done.has(c) || !H.areaInfo) return;
    if (!group) {
      mat = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'vangrail');
      group = new THREE.Group(); group.name = 'vangrails'; group.visible = H.getMode?.() === 'iso'; H.scene.add(group);
    }
    done.add(c); build(c); H.redraw?.();
  });
  H.on('detail', () => { let ch = false; for (const v of VAK.values()) ch = detail(v) || ch; if (ch) H.redraw?.(); });
  H.on('mode', () => { if (group) { group.visible = H.getMode?.() === 'iso'; H.redraw?.(); } });
})();
