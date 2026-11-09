// Mooi laden (iso), nabewerking: niet-geladen vakken als lijntekening die inkleurt + wolkendek van de intro. Ontwerp design/11_laden.html
// (optie "Niet geladen" 3 = papier + potloodraster 100 m → inktlijnen → aquarel-invulling, ±1,3 s per vak; "Eerste beeld" 1+2 = wolkendek uAll).
// Voortgang per km-vak in een kleine textuur (1 texel per vak, lineair gefilterd = zachte rand); vakken buiten de gemeente = altijd onthuld.
// Wereldpositie per pixel uit de diepte (tN.g) en de ortho-camera. Stap staat alleen aan zolang er in beeld iets onthult of de intro loopt.
// Haakt in via H3D: addPost, animate, on('terrain'), loadState, introCover, camera, controls, areaInfo, NRM_GLSL.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null;
  if (!H) return;
  const REV_S = 1.3; // s van lijntekening naar volle kleur (wolken trekken in de eerste ±0,6 s weg)
  const G_WAIT = 4; // s: grond na zoveel tijd nog niet geschilderd (geen iso/ground.js, fout) → toch onthullen

  let grid = null, tex, data, post, cover = 0;
  const pend = new Map(); // texel → starttijd (s) onthullen (= grond geschilderd)
  const terr = new Map(); // texel → tijd (s) terrein binnen, grond nog niet
  const cells = []; // { k, box } van vakken in de gemeente die nog niet helemaal onthuld zijn
  const now = () => performance.now() / 1000;
  const fr = new THREE.Frustum(), M4 = new THREE.Matrix4(), camW = new THREE.Matrix4(), hv = new THREE.Vector2(1, 1), pg = new THREE.Vector4();

  function init() {
    const a = H.areaInfo; if (!a || !a.chunks?.length) return false;
    const is = a.chunks.map(c => c[0]), js = a.chunks.map(c => c[1]), km = a.km, O = a.origin;
    const i0 = Math.min(...is) - 1, j0 = Math.min(...js) - 1, W = Math.max(...is) - i0 + 2, Hh = Math.max(...js) - j0 + 2;
    grid = { i0, j0, W, H: Hh };
    data = new Uint8Array(W * Hh * 4).fill(255);
    for (const [i, j] of a.chunks) {
      const k = (j - j0) * W + (i - i0), x0 = i * km - O[0], z1 = -(j * km - O[1]);
      data[k * 4] = 0;
      cells.push({ k, key: i + '_' + j, box: new THREE.Box3(new THREE.Vector3(x0, 40, z1 - km), new THREE.Vector3(x0 + km, 700, z1)) /* t/m wolkenhoogte */ });
    }
    tex = new THREE.DataTexture(data, W, Hh); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    // texel-middens = vakmiddens: uv = (RD/km − i0 − 0,5 + 0,5) / W → (wereld-x/km + O/km − i0) / W
    pg.set(O[0] / km - i0, O[1] / km - j0, 1 / (W * km), 1 / (Hh * km)); pg.x *= km; pg.y *= km;
    post = H.addPost({ material: makeMat(), order: 5, before, enabled: true });
    H.animate(tick, 'laden');
    return true;
  }

  function makeMat() {
    const ink = H.isoColors?.ink || new THREE.Color('#2a2420');
    return new THREE.ShaderMaterial({ name: 'laden',
      uniforms: { tIn: { value: null }, tN: { value: null }, tP: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uCamW: { value: camW }, uHV: { value: hv }, uPG: { value: pg }, uAll: { value: 0 }, uGY: { value: 120 }, uCY: { value: 440 }, uInk: { value: ink } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform sampler2D tIn, tN, tP; uniform vec2 uRes, uHV; uniform float uTime, uAll, uGY, uCY; uniform vec3 uInk; uniform mat4 uCamW; uniform vec4 uPG;
        ${H.NRM_GLSL}
        float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s / 0.97; }
        vec4 N(vec2 o) { vec2 s = texture2D(tN, vUv + o / uRes).xy; return vec4(nrmUnpack(s.x), s.y); }
        void main() {
          vec4 c = texture2D(tIn, vUv);
          float dep = texture2D(tN, vUv).y;
          // wereldpositie (ortho: evenwijdige stralen); lucht = snijpunt met het grondvlak
          vec3 P0 = (uCamW * vec4((vUv * 2.0 - 1.0) * uHV, 0.0, 1.0)).xyz, F = -normalize(uCamW[2].xyz);
          vec3 W = dep > 0.0 ? P0 + F * dep : P0 + F * ((uGY - P0.y) / F.y);
          float p = texture2D(tP, vec2((W.x + uPG.x) * uPG.z, (uPG.y - W.z) * uPG.w)).r; // 0 = niet geladen … 1 = helemaal onthuld
          if (p < 0.999) { // papier → inktlijnen → aquarel
            float n = fbm(W.xz / 160.0), fill = smoothstep(0.2 + n * 0.55, 0.3 + n * 0.55, p);
            vec2 gq = W.xz / 100.0, g = abs(fract(gq + 0.5) - 0.5) / fwidth(gq);
            vec3 paper = vec3(0.965, 0.94, 0.88) * (0.97 + 0.04 * h1(floor(vUv * uRes / 2.0)));
            paper = mix(paper, vec3(0.62, 0.66, 0.72), (1.0 - clamp(min(g.x, g.y), 0.0, 1.0)) * 0.35 * (1.0 - p));
            float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
            vec3 sketch = dep > 0.0 && p > 0.01 ? paper * (0.86 + 0.14 * smoothstep(0.35, 0.8, lum)) : paper;
            if (p > 0.01 && dep > 0.0) { // inktlijnen opnieuw (het kleurbeeld heeft ze al, maar dat wordt hier papier)
              vec4 n0 = N(vec2(0.0)), a = N(vec2(1.0, 0.0)), b = N(vec2(-1.0, 0.0)), d = N(vec2(0.0, 1.0)), e = N(vec2(0.0, -1.0));
              float nd = 4.0 - dot(n0.xyz, a.xyz) - dot(n0.xyz, b.xyz) - dot(n0.xyz, d.xyz) - dot(n0.xyz, e.xyz);
              float dd = abs(a.w + b.w - 2.0 * n0.w) + abs(d.w + e.w - 2.0 * n0.w);
              sketch = mix(sketch, uInk, max(smoothstep(0.42, 0.52, nd), smoothstep(1.7, 2.1, dd)) * 0.8 * smoothstep(0.01, 0.15, p));
            }
            c.rgb = mix(sketch, c.rgb, fill);
          }
          // wolkendek: intro (uAll) of boven nog niet onthulde vakken (voortgang op wolkenhoogte → wolken hangen bóven het papier, trekken als eerste weg)
          vec3 C = P0 + F * ((uCY - P0.y) / F.y);
          float pc = texture2D(tP, vec2((C.x + uPG.x) * uPG.z, (uPG.y - C.z) * uPG.w)).r;
          float cov = max(uAll, 1.0 - smoothstep(0.0, 0.45, pc));
          if (cov > 0.0) { // drijft met de wind
            vec2 q = C.xz / 340.0 + vec2(uTime * 0.018, uTime * 0.007);
            float n = fbm(q), th = 1.02 - cov * 1.18, aC = smoothstep(th, th + 0.06, n);
            float n2 = fbm(q + vec2(-0.05, 0.05));
            vec3 cc = mix(vec3(0.72, 0.77, 0.85), vec3(1.0, 0.993, 0.975), clamp(0.55 + (n - n2) * 7.0, 0.0, 1.0));
            cc = mix(cc, vec3(1.0), smoothstep(th + 0.06, th + 0.35, n) * 0.35);
            float sh = smoothstep(th - 0.1, th + 0.02, fbm(q + vec2(0.12, -0.1))) * 0.28 * (1.0 - aC); // wolkschaduw op de grond ernaast
            c.rgb = mix(c.rgb * (1.0 - sh), cc, aC);
          }
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  function before() {
    const cam = H.camera(), u = post.material.uniforms;
    if (!cam?.isOrthographicCamera) return;
    cam.updateMatrixWorld(); camW.copy(cam.matrixWorld);
    hv.set((cam.right - cam.left) / (2 * cam.zoom), (cam.top - cam.bottom) / (2 * cam.zoom));
    const t = H.controls?.target; if (t) { u.uGY.value = t.y; u.uCY.value = t.y + 320; }
    u.tP.value = tex; u.uAll.value = cover = H.introCover?.() || 0;
  }

  function tick() {
    if (!grid) return 'none';
    let ch = false;
    const t = now();
    for (const [k, t0] of terr) if (t - t0 > G_WAIT) start(k);
    for (const [k, t0] of pend) {
      const p = Math.min(1, (t - t0) / REV_S), v = Math.round(p * 255);
      if (data[k * 4] !== v) { data[k * 4] = v; ch = true; }
      if (p >= 1) pend.delete(k);
    }
    if (ch) tex.needsUpdate = true;
    // aan zolang er in beeld iets niet onthuld is of de wolken nog (deels) dicht zijn
    const cam = H.camera();
    let need = (H.introCover?.() || 0) > 0 || cover > 0;
    if (!need && cam?.isOrthographicCamera) {
      cam.updateMatrixWorld(); M4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(M4);
      for (const e of cells) if (data[e.k * 4] < 255 && fr.intersectsBox(e.box)) { need = true; break; }
    }
    const was = post.enabled !== false;
    post.enabled = need;
    if (was !== need) { H.redraw(); return 'post'; }
    return need ? 'post' : 'none'; // ook stil wachten: wolken drijven door
  }

  // onthullen pas als de grond geschilderd is (iso/ground.js 'ground'); terrein alleen = papier + wolken blijven
  const kOf = c => (c.j - grid.j0) * grid.W + (c.i - grid.i0);
  function start(k) { terr.delete(k); if (data[k * 4] === 0 && !pend.has(k)) pend.set(k, now()); }
  H.on('terrain', c => {
    if (!grid && !init()) return;
    const k = kOf(c);
    if (H.groundReady?.(c)) start(k); else if (data[k * 4] === 0 && !pend.has(k)) terr.set(k, now());
  });
  H.on('ground', c => { if (grid || init()) start(kOf(c)); });
})();
