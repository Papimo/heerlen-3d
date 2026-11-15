// iso/kastelen.js — kastelen Voerendaal (Puth, Haeren, Cortenbach, Rivieren) + grachten en bruggen (keuze design/24b: modellen a + b, alleen iso).
// Kasteel: BAG-driehoeken gekopieerd en opnieuw gekleurd (echte vorm), ramen met mergelrand in de shader, torens met kegel-/peerspits erbij; origineel verborgen.
// Gracht: kademuurtjes langs bestaande vijvers rond het kasteel, anders een ring om de omtrek (water 4,5–13 m) → H.waterAdd (geen bomen in de gracht) + brug naar de dichtste straat.
// Alles in RD-meters; wereld = (x − O0, h, −(y − O1)). Bouwt zodra de panden rond het kasteel geladen zijn (timer 0,7 s, daarna alleen aan/uit bij iso-wissel).
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null;
  if (!H?.on || !H.U || !H.celify) return;
  const U = H.U;
  let O = null, KM = 1000;
  const iso = () => H.getMode?.() === 'iso';
  const col3 = c => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; };

  // ---------- materialen ----------
  let MAT, WATER, BLD, QUAY;
  function mats() {
    if (MAT) return;
    MAT = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), 'kasteel');
    QUAY = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), 'kade');
    WATER = H.celify(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, side: THREE.DoubleSide }), 'gracht');
    WATER.onBeforeCompile = s => { // plat, stil (water c, design/23): lichte glinstering op wereldpositie, geen tijd
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW;').replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW; float wH(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
        .replace('#include <color_fragment>', `#include <color_fragment>
          { vec2 q = floor(vWW.xz * 0.7); float g = wH(q) * wH(q + 17.0); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.94, 0.97), step(0.86, g) * 0.6); }`);
    };
    // gebouwen: vertexkleur + ramen in de shader. aWin.x: 0 geen · 1 ramen met mergelrand · 2 schietgaten · 3 ramen + speklagen; aWin.y = maaiveld
    BLD = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    BLD.onBeforeCompile = s => {
      s.uniforms.uNight = U.uNight;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aWin; varying vec2 vWin; varying vec3 vBW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWin = aWin; vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWin; varying vec3 vBW; uniform float uNight; float bwGlow = 0.0;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (vWin.x > 0.5) {
            vec3 fn = normalize(cross(dFdx(vBW), dFdy(vBW)));
            if (abs(fn.y) < 0.3) {
              vec2 tg = normalize(vec2(-fn.z, fn.x)); float u = dot(vBW.xz, tg), y = vBW.y - vWin.y;
              float k = vWin.x; vec3 GL = vec3(0.23, 0.25, 0.29), MG = vec3(0.93, 0.89, 0.80);
              if (k > 2.5 && fract(y / 1.5) < 0.22 && y > 0.6) diffuseColor.rgb = mix(diffuseColor.rgb, MG, 0.85); // speklagen (mergel in baksteen)
              float sp = k > 1.5 && k < 2.5 ? 5.5 : 3.3, fw = k > 1.5 && k < 2.5 ? 0.22 : 0.62, wh = k > 1.5 && k < 2.5 ? 1.2 : 1.8;
              float du = abs(fract(u / sp) - 0.5) * sp, yy = mod(y - 1.1, 3.5);
              bool inW = du < fw && yy < wh && y > 0.8 && y < 60.0;
              bool inF = du < fw + 0.2 && yy < wh + 0.2 && y > 0.6 && !inW && k < 1.5;
              if (inF) diffuseColor.rgb = MG;
              if (inW) { diffuseColor.rgb = GL; bwGlow = step(0.5, fract(sin(dot(floor(vec2(u / sp, y / 3.5)), vec2(12.9898, 78.233))) * 43758.5453)); }
            }
          }`)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.78, 0.46), bwGlow * uNight * 0.85);');
    };
    H.celify(BLD, 'kasteelbld');
  }

  // ---------- geometrie (vertexkleur, geen normals: flatShading) ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function part(g, c, o = {}) {
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().compose(V3(...(o.p || [0, 0, 0])), new THREE.Quaternion(), V3(...(o.s || [1, 1, 1]))));
    return { g, c: new THREE.Color(c), w: o.w || [0, 0] };
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const cyl = (r0, r1, h, s = 8) => new THREE.CylinderGeometry(r1, r0, h, s).translate(0, h / 2, 0);
  function merge(parts, win) { // win: ook aWin meegeven (gebouwmateriaal)
    const n = parts.reduce((t, p) => t + p.g.attributes.position.count, 0);
    const P = new Float32Array(n * 3), C = new Float32Array(n * 3), W = win ? new Float32Array(n * 2) : null;
    let o = 0;
    for (const p of parts) {
      const a = p.g.attributes.position.array, m = a.length / 3; P.set(a, o * 3);
      for (let k = 0; k < m; k++) { C[(o + k) * 3] = p.c.r; C[(o + k) * 3 + 1] = p.c.g; C[(o + k) * 3 + 2] = p.c.b; if (W) { W[(o + k) * 2] = p.w[0]; W[(o + k) * 2 + 1] = p.w[1]; } }
      o += m; p.g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    if (W) g.setAttribute('aWin', new THREE.BufferAttribute(W, 2));
    g.computeBoundingSphere(); return g;
  }
  function triGeo(P, C) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere(); return g; }

  // ---------- 2D-hulpjes ----------
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1)); // ccw
  }
  const nrm = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  function offset(p, d) { // convexe ccw-veelhoek naar buiten
    const n = p.length;
    return p.map((b, k) => {
      const a = p[(k + n - 1) % n], c = p[(k + 1) % n];
      const n1 = nrm([b[1] - a[1], a[0] - b[0]]), n2 = nrm([c[1] - b[1], b[0] - c[0]]), m = nrm([n1[0] + n2[0], n1[1] + n2[1]]);
      const s = d / Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
      return [b[0] + m[0] * s, b[1] + m[1] * s];
    });
  }

  // ---------- panden zoeken bij een punt ----------
  function near(x, y, r) {
    const out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const c = H.chunks.get((Math.floor(x / KM) + i) + '_' + (Math.floor(y / KM) + j)); if (!c?.mesh || !c.bR) continue;
      const P = c.mesh.geometry.attributes.position.array, I = c.mesh.geometry.index.array;
      for (let b = 0; b < c.ids.length; b++) {
        const f0 = c.bR[b], f1 = b + 1 < c.bR.length ? c.bR[b + 1] : c.nr; if (f1 <= f0) continue;
        const v = I[f0 * 3]; if (Math.hypot(P[v * 3] + O[0] - x, O[1] - P[v * 3 + 2] - y) > r + 60) continue;
        let sx = 0, sy = 0, n = 0, top = -1e9; for (let t = f0 * 3; t < f1 * 3; t++) { const u = I[t]; sx += P[u * 3]; sy += P[u * 3 + 2]; top = Math.max(top, P[u * 3 + 1]); n++; }
        const cx = sx / n + O[0], cy = O[1] - sy / n;
        if (Math.hypot(cx - x, cy - y) <= r) out.push({ c, b, id: String(c.ids[b]).padStart(16, '0'), cx, cy, top, n });
      }
    }
    return out;
  }
  // BAG-driehoeken kopiëren (vóór verbergen: verbergen maakt ze plat) en opnieuw kleuren: muur / steil dak (lei) / plat dak
  function copyBag(list, wall, roof, kind) {
    const P = [], C = [], W = [], pts = []; let top = -1e9;
    const cw = col3(wall), cr = col3(roof), cf = col3('#8b8f94');
    const g0 = Math.min(...list.map(o => H.heightAt(o.cx, o.cy)));
    for (const o of list) {
      const A = o.c.mesh.geometry.attributes.position.array, idx = H.facesOf(o.c, o.b);
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
        const ux = A[b] - A[a], uy = A[b + 1] - A[a + 1], uz = A[b + 2] - A[a + 2], vx = A[c] - A[a], vy = A[c + 1] - A[a + 1], vz = A[c + 2] - A[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, ln = Math.hypot(nx, ny, nz) || 1, upn = Math.abs(ny / ln);
        const cc = upn > 0.96 ? cf : upn > 0.28 ? cr : cw, kk = upn > 0.28 ? 0 : kind;
        for (const v of [a, b, c]) { P.push(A[v], A[v + 1], A[v + 2]); C.push(...cc); W.push(kk, g0); pts.push([A[v] + O[0], O[1] - A[v + 2]]); top = Math.max(top, A[v + 1]); }
      }
    }
    const g = triGeo(P, C); g.setAttribute('aWin', new THREE.Float32BufferAttribute(W, 2));
    return { geo: g, pts, top, g0 };
  }

  // ---------- kastelen ----------
  const SLATE = '#4c5664', SLATE_D = '#3b4350';
  const CASTLE = { // r = zoekstraal rond het OSM-punt (layers.landmarks); wall = gevel; n = torens; roof cone|bulb; kind = ramen
    puth: { r: 34, wall: '#ece5d6', n: 2, roof: 'cone', kind: 1 },          // wit gepleisterd omgracht huis
    haeren: { r: 42, wall: '#b4664a', n: 4, roof: 'cone', kind: 1 },        // baksteen, vierkant met binnenhof
    cortenbach: { r: 42, wall: '#cbbd94', n: 4, roof: 'bulb', kind: 1 },    // Kunradersteen, ronde hoektorens
    rivieren: { r: 48, wall: '#eee8dc', n: 2, roof: 'cone', kind: 1 },
  };
  function tower(r, h, wall, roofKind, g0) {
    const p = [part(cyl(r, r * 0.96, h, 14), wall, { w: [2, g0] }), part(cyl(r * 1.08, r * 1.08, 0.6, 14), '#d9cfba', { p: [0, h - 0.6, 0] })];
    if (roofKind === 'bulb') { // peerspits: ingesnoerde bol + lantaarn + naald
      p.push(part(new THREE.SphereGeometry(r * 0.95, 12, 8), SLATE, { p: [0, h + r * 0.75, 0], s: [1, 1.15, 1] }),
        part(cyl(r * 0.3, r * 0.3, r * 0.9, 8), SLATE_D, { p: [0, h + r * 1.7, 0] }),
        part(new THREE.SphereGeometry(r * 0.38, 10, 6), SLATE, { p: [0, h + r * 2.75, 0] }),
        part(new THREE.ConeGeometry(r * 0.16, r * 1.6, 6).translate(0, r * 0.8, 0), SLATE_D, { p: [0, h + r * 3.0, 0] }));
    } else p.push(part(new THREE.ConeGeometry(r * 1.12, r * 2.6, 14).translate(0, r * 1.3, 0), SLATE, { p: [0, h, 0] }));
    p.push(part(new THREE.SphereGeometry(0.35, 6, 4), '#d9a54a', { p: [0, h + (roofKind === 'bulb' ? r * 4.6 : r * 2.6) + 0.2, 0] }));
    return p;
  }
  function castle(id) {
    const cf = CASTLE[id], lm = H.layerData?.landmarks?.find(l => l[0] === id); if (!lm) return null;
    const list = near(lm[2], lm[3], cf.r).filter(o => o.top - H.heightAt(o.cx, o.cy) > 3);
    if (!list.length) return null;
    const cp = copyBag(list, cf.wall, SLATE, cf.kind), grp = new THREE.Group();
    const body = new THREE.Mesh(cp.geo, BLD); body.castShadow = body.receiveShadow = true; grp.add(body);
    const hl = hull(cp.pts), cx = hl.reduce((s, q) => s + q[0], 0) / hl.length, cy = hl.reduce((s, q) => s + q[1], 0) / hl.length;
    // torens op de scherpste/verste hoeken, ≥ 14 m uit elkaar
    const cand = hl.map((b, k) => { const a = hl[(k + hl.length - 1) % hl.length], c = hl[(k + 1) % hl.length]; const d1 = nrm([a[0] - b[0], a[1] - b[1]]), d2 = nrm([c[0] - b[0], c[1] - b[1]]);
      return { b, sc: (d1[0] * d2[0] + d1[1] * d2[1]) + Math.hypot(b[0] - cx, b[1] - cy) / 40 }; }).sort((a, b) => b.sc - a.sc);
    const pick = []; for (const c of cand) { if (pick.length >= cf.n) break; if (pick.every(q => Math.hypot(q.b[0] - c.b[0], q.b[1] - c.b[1]) > 14)) pick.push(c); }
    const hTop = cp.top - cp.g0;
    for (const c of pick) {
      const r = 3.3, d = nrm([c.b[0] - cx, c.b[1] - cy]), x = c.b[0] + d[0] * r * 0.25, y = c.b[1] + d[1] * r * 0.25, g = H.heightAt(x, y) - 0.4;
      const h = Math.max(9, hTop * 0.85) + 1.5;
      const t = new THREE.Mesh(merge(tower(r, h, cf.wall, cf.roof, g), true), BLD); t.position.set(x - O[0], g, -(y - O[1])); t.castShadow = t.receiveShadow = true; grp.add(t);
    }
    return { grp, ids: list.map(o => o.id), hull: hl, cx, cy };
  }
  // gracht: kademuurtjes langs bestaande vijvers (≤ 95 m) of een ring om de omtrek (geen water in de kaartdata) + brug naar de dichtste straat
  function moat(cs) {
    const grp = new THREE.Group(), lay = H.layerData, P = [], C = [], WP = [], WC = [];
    const stone = col3('#b7aa90'), wat = col3('#4e88ad');
    const wall = (a, b, y0, y1, c) => { P.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]); for (let k = 0; k < 6; k++) C.push(...c); };
    const W = ([x, y]) => [x - O[0], -(y - O[1])];
    const ponds = (lay.ponds || []).filter(p => { const r = p[1]; for (let k = 0; k < r.length; k += 2) if (Math.hypot(r[k] - cs.cx, r[k + 1] - cs.cy) < 95) return true; return false; });
    let wy = 0;
    if (ponds.length) {
      for (const p of ponds) { const r = p[1]; let hs = 1e9; for (let k = 0; k < r.length; k += 2) hs = Math.min(hs, H.heightAt(r[k], r[k + 1])); hs -= 0.1;
        for (let k = 0; k + 3 < r.length; k += 2) { const a = W([r[k], r[k + 1]]), b = W([r[k + 2], r[k + 3]]); wall(a, b, hs - 0.6, hs + 0.75, stone); } }
    } else {
      const inner = offset(cs.hull, 4.5), outer = offset(cs.hull, 13);
      let s = 0, n = 0; for (const q of outer.concat(inner)) { s += H.heightAt(q[0], q[1]); n++; } wy = s / n + 0.15;
      const lo = Math.min(...outer.concat(inner).map(q => H.heightAt(q[0], q[1]))) - 0.5;
      for (let k = 0; k < inner.length; k++) {
        const a = W(inner[k]), b = W(inner[(k + 1) % inner.length]), c = W(outer[(k + 1) % outer.length]), d = W(outer[k]);
        WP.push(a[0], wy, a[1], d[0], wy, d[1], c[0], wy, c[1], a[0], wy, a[1], c[0], wy, c[1], b[0], wy, b[1]); for (let t = 0; t < 6; t++) WC.push(...wat);
        wall(a, b, lo, wy + 0.8, stone); wall(c, d, lo, wy + 0.8, stone);
      }
      const wm = new THREE.Mesh(triGeo(WP, WC), WATER); wm.receiveShadow = true; grp.add(wm);
      H.waterAdd?.({ rings: [outer.flat(), inner.flat()] }); // even-odd: alleen de band tussen buiten- en binnenrand is water
    }
    const sm = new THREE.Mesh(triGeo(P, C), QUAY); sm.castShadow = sm.receiveShadow = true; grp.add(sm);
    // brug: richting van het midden naar het dichtstbijzijnde straatpunt
    let best = null; for (const s of lay.streets || []) { const r = s[2]; for (let k = 0; k < r.length; k += 2) { const d = Math.hypot(r[k] - cs.cx, r[k + 1] - cs.cy); if (d > 20 && (!best || d < best.d)) best = { d, x: r[k], y: r[k + 1] }; } }
    if (best) {
      const dir = nrm([best.x - cs.cx, best.y - cs.cy]);
      let e0 = 0; for (const q of cs.hull) e0 = Math.max(e0, (q[0] - cs.cx) * dir[0] + (q[1] - cs.cy) * dir[1]);
      const L = ponds.length ? 16 : 14, s0 = e0 - 1, mx = cs.cx + dir[0] * (s0 + L / 2), my = cs.cy + dir[1] * (s0 + L / 2);
      const by = (ponds.length ? H.heightAt(mx, my) : wy) + 0.9;
      const bp = [part(box(L, 0.7, 3.4), '#c9bba0', { p: [0, -0.7, 0] }), part(box(L, 0.9, 0.3), '#b7aa90', { p: [0, 0, 1.55] }), part(box(L, 0.9, 0.3), '#b7aa90', { p: [0, 0, -1.55] }),
        part(box(1.4, 3.2, 3.0), '#a89a80', { p: [-L / 4, -3.9, 0] }), part(box(1.4, 3.2, 3.0), '#a89a80', { p: [L / 4, -3.9, 0] })]; // pijlers
      const br = new THREE.Mesh(merge(bp), MAT); br.position.set(mx - O[0], by, -(my - O[1])); br.rotation.y = Math.atan2(dir[1], dir[0]); br.castShadow = br.receiveShadow = true; grp.add(br);
    }
    return grp;
  }

  // ---------- besturing: bouwen zodra de panden er zijn, zichtbaar alleen in iso ----------
  const BUILT = {}; // id → {grp, ids}
  let ROOT = null, shown = null, slow = false;
  function scan() {
    if (!O) { O = H.areaInfo?.origin; KM = H.areaInfo?.km || 1000; if (!O) return; }
    if (!H.layerData?.landmarks) return;
    const want = iso();
    for (const id in CASTLE) {
      if (BUILT[id] || !want) continue;
      mats();
      const b = castle(id); if (!b) continue;
      b.grp.add(moat(b));
      ROOT ||= Object.assign(new THREE.Group(), { name: 'kastelen' }); if (!ROOT.parent) H.scene.add(ROOT);
      ROOT.add(b.grp); BUILT[id] = b; shown = null; // hieronder BAG-pand verbergen
    }
    if (shown !== want && ROOT) {
      shown = want; ROOT.visible = want;
      for (const id in BUILT) for (const i of BUILT[id].ids) H.hideBuilding(i, want);
      H.shadowDirty?.(); H.redraw();
    }
    if (!slow && Object.keys(BUILT).length === Object.keys(CASTLE).length && shown === want) { slow = true; clearInterval(T); T = setInterval(scan, 2000); } // alles staat: alleen nog iso-wissel volgen
  }
  let T = setInterval(scan, 700);
})();
