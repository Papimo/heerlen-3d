// iso/diorama.js — stroom C (plan_iso.md): gemeente als uitgesneden plak, keuze design/4_diorama.html = optie 5 Schoolplaat · 250 m · schaduw in de lucht.
// Alleen in iso. Haakt in via H3D: patchTerrain, U, on('chunk'|'loaded'|'layers'|'frame'), facesOf-gegevens per vak (c.bR/bW/nr/nw), heightAt, shadowDirty.
(() => {
  const H = typeof H3D !== "undefined" ? H3D : null; if (!H || !window.THREE) return;
  const DEPTH = 250, U = H.U;
  const C = { uMask: { value: null }, uMB: { value: new THREE.Vector4() }, uCut: { value: 0 } };
  let area, O, inMask = () => true, allIn = () => false, RING, wall, lid, shadowPlane, active = false, minH = 0;
  const mine = new Set(), patched = new WeakSet(), uncut = new WeakSet(), plainOf = new WeakMap();
  // object helemaal binnen de grens → kopie van het materiaal zonder uitsnede: discard zet de vroege dieptetest uit (linten: ±5 ms GPU)
  function plain(m) {
    let c = plainOf.get(m); if (c) return c;
    c = m.clone(); const d = m.userData.dioPrev;
    c.onBeforeCompile = d ? d.prev : m.onBeforeCompile; c.customProgramCacheKey = d ? d.key : m.customProgramCacheKey.bind(m);
    uncut.add(c); plainOf.set(m, c); return c;
  }
  const _bb = new THREE.Box3();
  function inside(o) {
    if (o.userData.dioIn === undefined) {
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      _bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      o.userData.dioIn = !o.isInstancedMesh && !_bb.isEmpty() && allIn(_bb.min.x + O[0] - 10, O[1] - _bb.max.z - 10, _bb.max.x + O[0] + 10, O[1] - _bb.min.z + 10);
    }
    return o.userData.dioIn;
  }

  // ---------- masker: R = precies binnen de grens, G = 8 m ruimer (voor de lijnen-pass) ----------
  const MASK_GLSL = `uniform sampler2D uMask; uniform vec4 uMB; uniform float uCut;
    float dioIn(vec3 w, int ch) { vec2 m = (vec2(w.x, -w.z) - uMB.xy) * uMB.zw;
      if (m.x < 0.0 || m.y < 0.0 || m.x > 1.0 || m.y > 1.0) return 0.0; vec4 t = texture2D(uMask, m); return ch == 0 ? t.r : t.g; }`;
  function makeMask() {
    const o = area.outline; let X0 = 1e9, X1 = -1e9, Y0 = 1e9, Y1 = -1e9;
    for (const [x, y] of o) { X0 = Math.min(X0, x); X1 = Math.max(X1, x); Y0 = Math.min(Y0, y); Y1 = Math.max(Y1, y); }
    X0 -= 100; Y0 -= 100; X1 += 100; Y1 += 100;
    const res = 4, W = Math.ceil((X1 - X0) / res), Hh = Math.ceil((Y1 - Y0) / res);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const x = cv.getContext('2d'), path = () => { x.beginPath(); o.forEach(([px, py], k) => x[k ? 'lineTo' : 'moveTo']((px - X0) / res, (Y1 - py) / res)); x.closePath(); };
    x.fillStyle = '#000'; x.fillRect(0, 0, W, Hh);
    path(); x.fillStyle = x.strokeStyle = '#00ff00'; x.lineWidth = 2 * 8 / res; x.lineJoin = 'round'; x.fill(); x.stroke();
    x.globalCompositeOperation = 'lighter'; path(); x.fillStyle = '#ff0000'; x.fill();
    const px = x.getImageData(0, 0, W, Hh).data;
    inMask = (X, Y) => { const i = Math.floor((X - X0) / res), j = Math.floor((Y1 - Y) / res); return i >= 0 && j >= 0 && i < W && j < Hh && px[(j * W + i) * 4] > 127; };
    allIn = (xa, ya, xb, yb) => { // hele RD-rechthoek binnen de grens (elke maskerpixel)
      const i0 = Math.floor((xa - X0) / res), i1 = Math.floor((xb - X0) / res), j0 = Math.floor((Y1 - yb) / res), j1 = Math.floor((Y1 - ya) / res);
      if (i0 < 0 || j0 < 0 || i1 >= W || j1 >= Hh) return false;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (px[(j * W + i) * 4] <= 127) return false;
      return true;
    };
    const t = new THREE.CanvasTexture(cv); t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter;
    C.uMask.value = t; C.uMB.value.set(X0 - O[0], Y0 - O[1], 1 / (W * res), 1 / (Hh * res));
  }

  // uitsnede in een standaard three-shader (ook InstancedMesh); twee keer aanroepen = geen effect
  function addCut(s) {
    if (s.fragmentShader.includes('dioIn(') || !s.vertexShader.includes('#include <project_vertex>') || !s.fragmentShader.includes('#include <clipping_planes_fragment>')) return;
    Object.assign(s.uniforms, C);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 dp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        dp = instanceMatrix * dp;
        #endif
        vCW = (modelMatrix * dp).xyz; }`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;\n' + MASK_GLSL)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uCut > 0.5 && dioIn(vCW, 0) < 0.5) discard;');
  }
  function cutMaterial(m) { // bestaand app-materiaal afknippen; cachekey meeverlengen (anders deelt het een programma met de ongepatchte versie)
    if (!m || patched.has(m) || m.isShaderMaterial || uncut.has(m)) return; patched.add(m);
    const prev = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m); m.userData.dioPrev = { prev, key };
    m.onBeforeCompile = function (s, r) { prev.call(this, s, r); addCut(s); };
    m.customProgramCacheKey = () => key() + '|dio';
    m.needsUpdate = true;
  }
  const depthCut = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); // schaduw buiten de grens weg
  depthCut.onBeforeCompile = addCut; depthCut.customProgramCacheKey = () => 'dio-depth';

  // ---------- rand: strip langs de grens met aardlagen (schoolplaat) ----------
  const DIO = { uDepth: { value: DEPTH }, uBot: { value: 0 }, uNight: U.uNight, uLab: { value: null } };
  const GLSL_N = `float dh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float dn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(dh(i), dh(i + vec2(1, 0)), f.x), mix(dh(i + vec2(0, 1)), dh(i + vec2(1, 1)), f.x), f.y); }`;
  function strata(s) {
    Object.assign(s.uniforms, DIO);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTop; attribute float aU; varying float vTop; varying float vU; varying vec3 vDW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTop = aTop; vU = aU; vDW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying float vTop; varying float vU; varying vec3 vDW; uniform float uDepth, uBot, uNight; uniform sampler2D uLab;
      ${GLSL_N}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float D = uDepth, d = vTop - vDW.y;
        float n1 = dn(vec2(vU / 160.0, 1.3)), wob = (n1 - 0.5) * 0.03 * D;
        float b1 = 0.012 * D + 1.5, b2 = 0.075 * D + wob * 0.4, b3 = 0.15 * D + wob, b4 = 0.235 * D + wob * 0.8, b5 = 0.29 * D + wob * 1.2;
        vec3 col, glow = vec3(0.0);
        if (d < b1) col = vec3(0.42, 0.55, 0.22);        // zode
        else if (d < b2) col = vec3(0.89, 0.69, 0.33);   // löss
        else if (d < b3) col = vec3(0.69, 0.56, 0.41);   // Maasgrind
        else if (d < b4) col = vec3(0.96, 0.9, 0.74);    // zilverzand
        else if (d < b5) col = vec3(0.6, 0.42, 0.29);    // klei
        else { // Carboon: schalie, zandsteenbanken, kolenlagen licht hellend, versprongen langs breuken
          float bc = dot(vDW.xz, vec2(0.8, -0.6)) / 1700.0 + (n1 - 0.5) * 0.12, blk = floor(bc);
          float s = vDW.y + 0.012 * dot(vDW.xz, vec2(0.6, 0.8)) + (dh(vec2(blk, 2.0)) - 0.5) * 0.3 * D;
          float q = s / (0.085 * D), k = floor(q), f = fract(q), th = dh(vec2(k, 4.0)) > 0.4 ? 0.15 : 0.05;
          col = vec3(0.4, 0.36, 0.33);
          if (f > 0.45 && f < 0.62 && dh(vec2(k, 9.0)) > 0.5) col = vec3(0.6, 0.53, 0.43);
          if (f < th) {
            col = vec3(0.122, 0.11, 0.106);
            float sp2 = step(0.985, dh(floor(vec2(vU, vDW.y) / 1.2))) * clamp(1.0 - fwidth(vU) / 2.5, 0.0, 1.0);
            col += 0.25 * sp2; glow += vec3(0.9, 0.85, 0.7) * sp2 * (0.1 + 0.5 * uNight);
          }
          if (abs(bc - floor(bc + 0.5)) * 1700.0 < 2.5) col *= 0.55; // breuk
        }
        float lw = fwidth(d) * 1.3; // inktlijnen op de laaggrenzen
        float e = min(min(abs(d - b1), abs(d - b2)), min(min(abs(d - b3), abs(d - b4)), abs(d - b5)));
        if (e < lw) col = vec3(0.165, 0.141, 0.125);
        float lu = mod(vU, 1400.0) - 120.0; // geschilderde namen, elke 1,4 km
        if (lu > 0.0 && lu < 260.0) { vec4 lab = texture2D(uLab, vec2(lu / 260.0, 1.0 - d / (1.1 * D))); col = mix(col, lab.rgb, lab.a); }
        diffuseColor.rgb = col; totalEmissiveRadiance += glow + col * 0.22 * uLvl; // rand = hoofdrol: schaduwkant niet grauw
      }`);
  }
  function labelTex() { // rijen op deel van de dikte → past bij elke dikte
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 1024;
    const x = cv.getContext('2d'), rows = [['löss', 0.044], ['Maasgrind', 0.112], ['zilverzand', 0.192], ['klei', 0.262], ['Carboon', 0.42], ['met kolenlagen', 0.47]];
    x.font = 'italic 600 40px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const [t, f] of rows) { const y = f / 1.1 * 1024; x.lineWidth = 7; x.strokeStyle = 'rgba(250,246,236,.85)'; x.strokeText(t, 256, y); x.fillStyle = '#2a2420'; x.fillText(t, 256, y); }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; return tx;
  }
  const WALL = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  WALL.onBeforeCompile = strata; H.celify(WALL, 'dio-wall'); // celify draait strata eerst, dan de cel-look (levert uLvl)

  function makeRing() { // grens om de ±15 m, tegen de klok in → strip kijkt naar buiten (nodig: lijnen-pass is FrontSide)
    const o = area.outline.slice(); if (o[0][0] === o.at(-1)[0] && o[0][1] === o.at(-1)[1]) o.pop();
    let a = 0; for (let k = 0; k < o.length; k++) { const p = o[k], q = o[(k + 1) % o.length]; a += p[0] * q[1] - q[0] * p[1]; }
    if (a < 0) o.reverse();
    const r = [o[0]];
    for (const p of o) { const q = r.at(-1); if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 15) r.push(p); }
    RING = r;
  }
  function build() {
    minH = (H.baseH ?? 77) + 3;
    const bot = minH - DEPTH, n = RING.length + 1, P = new Float32Array(n * 6), T = new Float32Array(n * 2), Uu = new Float32Array(n * 2), idx = [];
    let u = 0;
    for (let k = 0; k < n; k++) {
      const [x, y] = RING[k % RING.length];
      if (k) { const [px, py] = RING[k - 1]; u += Math.hypot(x - px, y - py); }
      const top = H.heightAt(x, y) + 0.2;
      P.set([x - O[0], top, -(y - O[1]), x - O[0], bot, -(y - O[1])], k * 6);
      T.set([top, top], k * 2); Uu.set([u, u], k * 2);
      if (k < n - 1) { const i = k * 2; idx.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aTop', new THREE.BufferAttribute(T, 1)); g.setAttribute('aU', new THREE.BufferAttribute(Uu, 1));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    DIO.uBot.value = bot; DIO.uLab.value = labelTex();
    wall = new THREE.Mesh(g, WALL); wall.castShadow = wall.receiveShadow = true;
    // deksel (gemeentevorm, onzichtbaar, werpt wel schaduw): anders vallen pandschaduwen dwars door de plak op het schaduwvlak
    const pts = RING.map(([x, y]) => new THREE.Vector2(x - O[0], -(y - O[1]))), tri = THREE.ShapeUtils.triangulateShape(pts, []);
    const lg = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 0, p.y))); lg.setIndex(tri.flat());
    lid = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false })); lid.position.y = minH - 2; lid.castShadow = true;
    shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.2, color: '#1d2a3a' }));
    shadowPlane.receiveShadow = true; shadowPlane.position.y = bot - 0.15 * DEPTH;
    // lijnen-pass van de app (scene.overrideMaterial) kent geen uitsnede → bij eerste gebruik masker-G-discard toevoegen (via het schaduwvlak: altijd in beeld)
    shadowPlane.onBeforeRender = (r, sc, cam, geo, mat) => { if (sc.overrideMaterial === mat && mat.isShaderMaterial && !mat.userData.dio) patchNRM(mat); };
    for (const m of [wall, lid, shadowPlane]) { m.visible = active; mine.add(m); H.scene.add(m); }
  }
  function patchNRM(m) {
    m.userData.dio = 1;
    const vs = m.vertexShader.replace('varying vec3 vV;', 'varying vec3 vV; varying vec3 vCW;').replace('vec4 mv = modelViewMatrix * p;', 'vCW = (modelMatrix * p).xyz; vec4 mv = modelViewMatrix * p;');
    if (!vs.includes('vCW = ')) return; // NRM-shader veranderd → liever geen uitsnede in de lijnen dan een kapotte shader
    Object.assign(m.uniforms, C);
    m.vertexShader = vs;
    m.fragmentShader = 'varying vec3 vCW;\n' + MASK_GLSL + '\n' + m.fragmentShader.replace('void main() {', 'void main() { if (uCut > 0.5 && dioIn(vCW, 1) < 0.5) discard;');
    m.needsUpdate = true; H.shadowDirty();
  }

  // ---------- panden buiten de grens: driehoeken plat (per pand op zwaartepunt; ver-weg-variant per driehoek) ----------
  function flatten(g, ranges) { // ranges = [[k0, k1]] in de index; terugzetten met de bewaarde kopie
    const I = g.index.array, bak = [];
    for (const [a, e] of ranges) { bak.push([a, I.slice(a, e)]); I.fill(I[a], a, e); }
    g.index.needsUpdate = true; return bak;
  }
  function cutChunk(c) {
    if (c.dioBak || !c.mesh) return;
    c.dioBak = [];
    const g = c.mesh.geometry, I = g.index.array, P = g.attributes.position.array, rs = [];
    for (let b = 0; b < c.bR.length; b++) {
      const r = [[c.bR[b] * 3, (b + 1 < c.bR.length ? c.bR[b + 1] : c.nr) * 3]]; // dak; muren na A1 per richting verspreid → H.wallRuns
      for (const [f0, f1] of H.wallRuns(c, b)) r.push([(c.nr + f0) * 3, (c.nr + f1) * 3]);
      let sx = 0, sz = 0, n = 0;
      for (const [a, e] of r) for (let k = a; k < e; k++) { sx += P[I[k] * 3]; sz += P[I[k] * 3 + 2]; n++; }
      if (n && !inMask(sx / n + O[0], O[1] - sz / n)) rs.push(...r.filter(([a, e]) => e > a));
    }
    if (rs.length) c.dioBak.push([g, flatten(g, rs)]);
    if (c.lo) {
      const g2 = c.lo.geometry, I2 = g2.index.array, P2 = g2.attributes.position.array, r2 = [];
      for (let k = 0; k < I2.length; k += 3) {
        const x = (P2[I2[k] * 3] + P2[I2[k + 1] * 3] + P2[I2[k + 2] * 3]) / 3, z = (P2[I2[k] * 3 + 2] + P2[I2[k + 1] * 3 + 2] + P2[I2[k + 2] * 3 + 2]) / 3;
        if (!inMask(x + O[0], O[1] - z)) r2.push([k, k + 3]);
      }
      if (r2.length) c.dioBak.push([g2, flatten(g2, r2)]);
    }
  }
  function uncutChunk(c) {
    for (const [g, bak] of c.dioBak || []) { const I = g.index.array; for (const [a, v] of bak) I.set(v, a); g.index.needsUpdate = true; }
    c.dioBak = null;
  }

  // ---------- overige app-objecten (linten, bomen, opgelichte panden …) afknippen ----------
  let nextScan = 0;
  function scan() {
    nextScan = performance.now() + 3000;
    H.scene.traverse(o => {
      if (!o.isMesh || mine.has(o) || o.userData.chunk) return; // vakken: terrein via patchTerrain, panden via cutChunk
      if (!Array.isArray(o.material) && !uncut.has(o.material) && inside(o)) { o.material = plain(o.material); return; }
      for (const m of [].concat(o.material)) cutMaterial(m);
      if (o.castShadow && !o.customDepthMaterial) o.customDepthMaterial = depthCut;
    });
  }

  // ---------- aan/uit (alleen iso) ----------
  function setActive(on) {
    if (on === active) return; active = on;
    C.uCut.value = on ? 1 : 0;
    for (const m of mine) m.visible = on;
    for (const c of H.chunks.values()) on ? cutChunk(c) : uncutChunk(c);
    if (on) scan();
    H.shadowDirty();
  }

  function init() {
    area = H.areaInfo; if (!area?.outline) return false;
    O = area.origin; makeMask(); makeRing();
    H.patchTerrain('dio', addCut); // terrein + ondergrond (ground) buiten de grens weg
    return true;
  }
  let ok = false;
  const ensure = () => ok || (ok = init());
  H.on('chunk', c => { if (ensure() && active) { cutChunk(c); if (performance.now() > nextScan) scan(); } });
  H.on('loaded', () => { if (!ensure()) return; build(); if (active) scan(); H.shadowDirty(); });
  H.on('layers', () => { if (active) scan(); });
  H.on('frame', () => {
    if (!ensure()) return;
    const want = U.uIso.value > 0.5;
    if (want !== active) setActive(want);
    else if (active && performance.now() > nextScan) scan();
  });
})();
