// iso/bake.js — A2 gebakken licht. Per vak (1 km) één keer: zonschaduw + contactschaduw (AO) → atlas (RGBA8, 512 px/km ≈ 2 m).
// Stap 1: diepte vanuit de zon (vak + rand, 2048²). Stap 2: van bovenaf → per texel zon zichtbaar + hoogte bovenste oppervlak.
// Stap 3: contactschaduw uit hoogteverschillen rondom → atlasplek. Shaders lezen de atlas via U.uBk/uBkI (app.js BAKE_GLSL).
// Alleen in iso, alleen bij stilstand, 1 vak per tik (dichtbij eerst). Zon staat vast (H.SUN_DIR); verandert die → H.rebake().
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H) return;
  const P = 512, M = 8, PM = P + 2 * M, TX = 1000 / P, DS = 2048, LR = 780; // px/vak, rand (texels), diepte-res, halve breedte zoncamera (m)
  let atlas, idx, idxData, slot = new Map(), grid, depthRT, topRT, lightCam, topCam, depthMat, topMat, aoMat, aoScene, aoCam;
  let queue = [], baked = new Set(), timer = 0;

  function init() {
    const r = H.renderer, cs = H.areaInfo?.chunks || []; // alle vakken van de gemeente (plek in de atlas), ook als ze nog niet geladen zijn
    if (!r || !r.capabilities.isWebGL2 || !cs.length) return false;
    const is = cs.map(c => c[0]), js = cs.map(c => c[1]);
    grid = { i0: Math.min(...is), j0: Math.min(...js) }; grid.ni = Math.max(...is) - grid.i0 + 1; grid.nj = Math.max(...js) - grid.j0 + 1;
    const sx = Math.ceil(Math.sqrt(cs.length)), sy = Math.ceil(cs.length / sx);
    if (Math.max(sx, sy) * P > r.capabilities.maxTextureSize) return false;
    cs.forEach((c, n) => slot.set(c[0] + '_' + c[1], [n % sx, Math.floor(n / sx)]));
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    atlas = new THREE.WebGLRenderTarget(sx * P, sy * P, Object.assign({ depthBuffer: false }, nearest));
    idxData = new Uint8Array(grid.ni * grid.nj * 4);
    idx = new THREE.DataTexture(idxData, grid.ni, grid.nj, THREE.RGBAFormat, THREE.UnsignedByteType); Object.assign(idx, nearest); idx.needsUpdate = true;
    const O = H.areaInfo.origin, U = H.U;
    U.uBkI.value = idx; U.uBkR.value.set(grid.i0 * 1000 - O[0], grid.j0 * 1000 - O[1], P, 0); U.uBkN.value.set(grid.ni, grid.nj);
    lightCam = new THREE.OrthographicCamera(-LR, LR, LR, -LR, 3000, 5000);
    const hw = PM * TX / 2; topCam = new THREE.OrthographicCamera(-hw, hw, hw, -hw, 1, 6000); topCam.up.set(0, 0, -1); // beeld: x oost, y noord
    depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    const vs = `varying vec3 vW; void main() { vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      #endif
      p = modelMatrix * p; vW = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }`;
    topMat = new THREE.ShaderMaterial({ // zon zichtbaar (3×3 PCF, normaal-offset) + hoogte in 16 bit
      uniforms: { tDep: { value: null }, uLVP: { value: new THREE.Matrix4() }, uSun: { value: new THREE.Vector3() } },
      vertexShader: vs, side: THREE.DoubleSide,
      fragmentShader: `varying vec3 vW; uniform highp sampler2D tDep; uniform mat4 uLVP; uniform vec3 uSun;
      void main() {
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;
        vec4 l = uLVP * vec4(vW + n * 0.6 + uSun * 0.3, 1.0); vec3 s = l.xyz / l.w * 0.5 + 0.5;
        float vis = 0.0;
        for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++)
          vis += step(s.z - 0.00025, texture2D(tDep, s.xy + vec2(x, y) / ${DS}.0).r);
        vis /= 9.0;
        if (any(lessThan(s.xy, vec2(0.0))) || any(greaterThan(s.xy, vec2(1.0)))) vis = 1.0;
        float e = floor(clamp((vW.y + 100.0) / 1000.0, 0.0, 1.0) * 65535.0 + 0.5), hi = floor(e / 256.0);
        gl_FragColor = vec4(vis, 0.0, hi / 255.0, (e - hi * 256.0) / 255.0);
      }`,
    });
    aoMat = new THREE.ShaderMaterial({ // contactschaduw: hoe ver steekt de omgeving boven dit punt uit (24 monsters, 2–6 m, zacht)
      uniforms: { tTop: { value: null }, uOff: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tTop; uniform vec2 uOff;
      float hOf(vec4 t, float d) { return t == vec4(0.0) ? d : (t.b * 65280.0 + t.a * 255.0) / 65535.0 * 1000.0 - 100.0; }
      void main() {
        ivec2 g = ivec2(gl_FragCoord.xy - uOff) + ${M};
        vec4 t0 = texelFetch(tTop, g, 0); float h0 = hOf(t0, 0.0), occ = 0.0;
        for (int r = 0; r < 3; r++) {
          float rad = r == 0 ? 1.0 : r == 1 ? 2.0 : 3.0; // 2–6 m (was 4–14 m: brede vale vlekken)
          for (int a = 0; a < 8; a++) {
            float an = float(a) * 0.7854 + float(r) * 0.39;
            ivec2 o = ivec2(round(vec2(cos(an), sin(an)) * rad));
            float h = hOf(texelFetch(tTop, clamp(g + o, ivec2(0), ivec2(${PM - 1})), 0), h0);
            occ += clamp((h - h0 - 0.3) / (rad * ${TX.toFixed(4)}), 0.0, 1.0);
          }
        }
        gl_FragColor = t0 == vec4(0.0) ? vec4(0.0) : vec4(t0.r, 1.0 - 0.45 * occ / 24.0, t0.b, t0.a);
      }`,
    });
    aoScene = new THREE.Scene(); aoCam = new THREE.Camera();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), aoMat); q.frustumCulled = false; aoScene.add(q);
    return true;
  }
  function targets() {
    if (depthRT) return;
    depthRT = new THREE.WebGLRenderTarget(DS, DS, { depthBuffer: true, generateMipmaps: false });
    depthRT.depthTexture = new THREE.DepthTexture(DS, DS); depthRT.depthTexture.type = THREE.UnsignedIntType;
    topRT = new THREE.WebGLRenderTarget(PM, PM, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    topMat.uniforms.tDep.value = depthRT.depthTexture; aoMat.uniforms.tTop.value = topRT.texture;
  }
  function freeTargets() { depthRT?.depthTexture.dispose(); depthRT?.dispose(); topRT?.dispose(); depthRT = topRT = null; }

  function bakeChunk(c) {
    const r = H.renderer, scene = H.scene, O = H.areaInfo.origin, sun = H.SUN_DIR.clone().normalize();
    targets();
    const cx = c.x0 + 500 - O[0], cz = -(c.y0 + 500 - O[1]);
    if (!c.terrain.geometry.boundingBox) c.terrain.geometry.computeBoundingBox();
    const bb = c.terrain.geometry.boundingBox, cy = (bb.min.y + bb.max.y) / 2;
    // tijdelijk: alles wat schaduw werpt volledig (alle muren, alle bomen), geen lijntjes/selectie/lucht; schaduwkaart niet meenemen
    const hid = H.overlayObjs().filter(o => o.visible); scene.traverse(o => { if ((o.isLine || o.isPoints || o.isSprite) && o.visible) hid.push(o); });
    for (const o of hid) o.visible = false;
    const trees = []; for (const k of H.chunks.values()) for (const im of k.trees || []) { trees.push([im, im.count, im.geometry]); im.count = im.full; }
    H.allWalls(true);
    const st = { rt: r.getRenderTarget(), ac: r.autoClear, bg: scene.background, fog: scene.fog, sm: r.shadowMap.needsUpdate, cc: r.getClearColor(new THREE.Color()), ca: r.getClearAlpha() };
    r.shadowMap.needsUpdate = false; scene.background = null; scene.fog = null; r.setClearColor(0x000000, 0); r.autoClear = true;
    // 1 · diepte vanuit de zon
    lightCam.position.set(cx, cy, cz).addScaledVector(sun, 4000); lightCam.lookAt(cx, cy, cz); lightCam.updateMatrixWorld(); lightCam.updateProjectionMatrix();
    scene.overrideMaterial = depthMat; r.setRenderTarget(depthRT); r.render(scene, lightCam);
    // 2 · van bovenaf: zon zichtbaar + hoogte
    topMat.uniforms.uLVP.value.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse); topMat.uniforms.uSun.value.copy(sun);
    topCam.position.set(cx, 3000, cz); topCam.lookAt(cx, 0, cz); topCam.updateMatrixWorld();
    scene.overrideMaterial = topMat; r.setRenderTarget(topRT); r.render(scene, topCam);
    scene.overrideMaterial = null;
    // 3 · contactschaduw → atlasplek (alleen dat stuk, rest van de atlas blijft)
    const [sx, sy] = slot.get(c.i + '_' + c.j);
    aoMat.uniforms.uOff.value.set(sx * P, sy * P);
    atlas.viewport.set(sx * P, sy * P, P, P); atlas.scissor.set(sx * P, sy * P, P, P); atlas.scissorTest = true;
    r.autoClear = false; r.setRenderTarget(atlas); r.render(aoScene, aoCam);
    // terugzetten
    r.setRenderTarget(st.rt); r.autoClear = st.ac; r.setClearColor(st.cc, st.ca); r.shadowMap.needsUpdate = st.sm; scene.background = st.bg; scene.fog = st.fog;
    for (const [im, n, g] of trees) { im.count = n; im.geometry = g; }
    for (const o of hid) o.visible = true;
    H.allWalls(false);
    const i = Math.round(c.x0 / 1000) - grid.i0, j = Math.round(c.y0 / 1000) - grid.j0, k = (j * grid.ni + i) * 4;
    const fresh = idxData[k + 2] !== 255; // opnieuw bakken (rebake): niet nog eens infaden
    idxData[k] = sx; idxData[k + 1] = sy; idxData[k + 2] = 255; if (fresh) { idxData[k + 3] = 0; fadeIn(k); } idx.needsUpdate = true;
    H.U.uBk.value = atlas.texture;
  }

  // schaduw van een vers gebakken vak zacht laten opkomen (idx a: 0 → 255, gelezen in BAKE_GLSL bkTexel/bkFade)
  const FADE = 1.2, fading = new Map(); let fadeStop = null;
  function fadeStep(force) {
    for (const [k, t0] of fading) {
      const x = force === k ? 1 : Math.min(1, (performance.now() - t0) / 1000 / FADE);
      idxData[k + 3] = Math.round(255 * x * x * (3 - 2 * x));
      if (x >= 1) fading.delete(k);
    }
    idx.needsUpdate = true;
    if (fading.size) return true;
    fadeStop?.(); fadeStop = null; H.redraw(); return false; // laatste stap ook tekenen
  }
  function fadeIn(k) {
    fading.set(k, performance.now());
    if (!fadeStop) fadeStop = H.animate(() => fadeStep() ? undefined : false, 'schaduw infaden');
    setTimeout(() => { if (fading.has(k)) fadeStep(k); }, FADE * 1000 + 600); // gedeelde tik pauzeert na 2 min zonder invoer → dan meteen af
  }
  function tick() {
    timer = 0;
    if (!queue.length) return;
    if (H.U.uIso.value < 0.5) return; // alleen in iso nodig; bij terugkeer in iso gaat het verder (frame-event)
    if (H.moving()) { timer = setTimeout(tick, 300); return; }
    const t = H.controls?.target;
    if (t) queue.sort((a, b) => H.chunkDist(a, t) - H.chunkDist(b, t));
    const c = queue.shift();
    bakeChunk(c); baked.add(c);
    if (!queue.length) { H.bakeReady = true; freeTargets(); }
    H.redraw();
    if (queue.length) timer = setTimeout(tick, 40);
  }
  function schedule() { if (!timer && queue.length) timer = setTimeout(tick, 200); }
  // opnieuw bakken (laag aan/uit, andere zonrichting): oude kaart blijft zichtbaar tot het vak vervangen is
  H.rebake = () => { if (!atlas) return; queue = [...H.chunks.values()].filter(c => c.mesh && !c.growing); schedule(); };
  let ready = false;
  // per vak zodra de panden staan (mooi laden: groeien eerst, anders valt de schaduw vóór het pand er is)
  H.on('grown', c => { if (!ready && !(ready = init())) return; if (!queue.includes(c)) queue.push(c); schedule(); });
  H.on('layer', () => { if (ready) H.rebake(); });
  H.on('frame', () => { if (ready) schedule(); });
})();
