// iso/sky.js — stroom D, sfeer (keuze design/5_sfeer.html): T4 zachte randen + vignet (aan/uit-knop), W4 wolkschaduw met zonnevlekken,
// af en toe iets in de lucht: L1 luchtballon, L2 trekvogels in V, L3 spreeuwenwolk, L4 duiven rond het hoogste pand.
// Alleen via aanhaakpunten (H3D.addPost, animate, scene, on('chunk'|'loaded'), night, camera). Bewegende dingen werpen geen echte schaduw;
// de ballon krijgt een vlekschaduw in dezelfde beeldstap als de wolken.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return; // H3D = const in app.js (geen window-eigenschap)
  const SUN = new THREE.Vector3(-0.55, 0.75, 0.35).normalize(); // = zonrichting in app.js (vast)
  const WIND = new THREE.Vector2(0.8, -0.6);                    // wolken + ballon drijven naar het zuidoosten (x oost, z zuid)
  const CLOUD = { scale: 380, cov: 0.45, soft: 0.12, dark: 0.42, speed: 9, sun: 0.12, height: 900 };
  const TILT = { amt: 0.6, w0: 0.22, w1: 0.5, sat: 1.04, vig: 0.22 };
  let tiltOn = H.fxOn('randen'); // aan/uit via H.setFx('randen') (menu Sfeer, toets T)

  const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const camW = new THREE.Matrix4(), lrbt = new THREE.Vector4(), bal = new THREE.Vector4(0, -1e5, 0, 0);

  // ---------- W4: wolkschaduw (wereldpositie per pixel uit de diepte van de ortho-camera) + ballonschaduw ----------
  const cloudM = new THREE.ShaderMaterial({ name: 'wolken',
    uniforms: { tIn: { value: null }, tN: { value: null }, uTime: { value: 0 }, uMove: { value: 0 }, uCamW: { value: camW }, uLRBT: { value: lrbt }, uSun: { value: SUN },
      uWind: { value: WIND.clone().multiplyScalar(CLOUD.speed) }, uScale: { value: CLOUD.scale }, uCov: { value: CLOUD.cov }, uSoft: { value: CLOUD.soft },
      uDark: { value: CLOUD.dark }, uSunB: { value: CLOUD.sun }, uNight: { value: 0 }, uCloudY: { value: 1000 }, uBal: { value: bal } },
    vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tIn, tN; uniform mat4 uCamW; uniform vec4 uLRBT, uBal; uniform vec3 uSun; uniform vec2 uWind;
      uniform float uTime, uMove, uScale, uCov, uSoft, uDark, uSunB, uNight, uCloudY;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.0, w = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8); for (int i = 0; i < 5; i++) { if (uMove > 0.5 && i >= 3) { a += w * 0.75; break; } a += w * vn(p); p = r * p * 2.03 + 17.0; w *= 0.5; } return a; }
      void main() {
        vec4 c = texture2D(tIn, vUv), n = texture2D(tN, vUv);
        if (n.g > 0.0) {
          vec3 wp = (uCamW * vec4(mix(uLRBT.x, uLRBT.y, vUv.x), mix(uLRBT.z, uLRBT.w, vUv.y), -n.g, 1.0)).xyz;
          float k = 1.0 - uNight * 0.75;
          vec2 q = (wp.xz + uSun.xz / uSun.y * (uCloudY - wp.y) - uWind * uTime) / uScale; // langs de zonnestraal omhoog naar de wolk
          float f = clamp((fbm(q) - 0.48) * 5.0 + 0.5, 0.0, 1.0); // fbm zit dicht rond 0,5 → oprekken
          float t = 1.0 - uCov, s = smoothstep(t - uSoft, t + uSoft + 0.002, f);
          c.rgb *= mix(vec3(1.0), vec3(0.86, 0.9, 1.06) * (1.0 - uDark), s * k);
          c.rgb *= mix(vec3(1.0), vec3(1.0 + uSunB, 1.0 + uSunB * 0.7, 1.0 + uSunB * 0.2), (1.0 - s) * k);
          if (uBal.w > 0.0) { // ballon: zachte vlek waar de zonnestraal door de ballon gaat
            float d = length(wp.xz + uSun.xz / uSun.y * (uBal.y - wp.y) - uBal.xz) / uBal.w;
            c.rgb *= 1.0 - 0.22 * (1.0 - smoothstep(0.6, 1.0, d)) * step(wp.y, uBal.y);
          }
        }
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  // ---------- T4: zachte randen boven/onder + warm vignet ----------
  const tiltM = new THREE.ShaderMaterial({ name: 'randen',
    uniforms: { tIn: { value: null }, uMove: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uAmt: { value: TILT.amt }, uW0: { value: TILT.w0 }, uW1: { value: TILT.w1 }, uSat: { value: TILT.sat }, uVig: { value: TILT.vig } },
    vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uRes; uniform float uMove, uAmt, uW0, uW1, uSat, uVig;
      void main() {
        vec4 c = texture2D(tIn, vUv);
        float r = smoothstep(uW0, uW1, abs(vUv.y - 0.5)) * uAmt * uRes.y / 100.0; // straal in px
        if (r > 0.4) { vec4 a = vec4(0.0); float n = 0.0; for (int i = 0; i < 24; i++) { n += 1.0; float t = float(i) * 2.39996, q = sqrt(float(i) + 0.5) / 4.9; a += texture2D(tIn, vUv + vec2(cos(t), sin(t)) * q * r / uRes); } c = a / n; /* 8 monsters tijdens bewegen gaf spookstrepen → altijd 24 */ /* 24 i.p.v. 40 monsters (draait bij elk wolkenbeeld) */ }
        c.rgb = mix(vec3(dot(c.rgb, vec3(0.3, 0.59, 0.11))), c.rgb, uSat);
        vec2 p = vUv - 0.5; c.rgb *= mix(vec3(1.0), vec3(0.72, 0.62, 0.52), smoothstep(0.25, 0.75, length(p * vec2(1.0, 1.25))) * uVig * 2.0);
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
    depthTest: false, depthWrite: false,
  });
  let tiltPost = null;
  let cloudPost = null;
  const setTilt = on => H.setFx('randen', on);
  H.on('fx', (k, on) => {
    if (k === 'randen') { tiltOn = on; if (tiltPost) tiltPost.enabled = on; }
    if (k === 'wolken' && cloudPost) cloudPost.enabled = on;
  });
  addEventListener('keydown', e => { if ((e.key === 't' || e.key === 'T') && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) setTilt(!tiltOn); });

  // ---------- hulp ----------
  const O = () => H.toRD(new THREE.Vector3(0, 0, 0)); // RD van wereld-oorsprong
  let o0 = null;
  const hW = (x, z) => H.heightAt(x + o0[0], o0[1] - z); // grondhoogte op wereld x/z
  const target = () => { const [x, y] = H.target(); return H.toWorld(x, y); };
  const isoCam = () => { const c = H.camera(); return c && c.isOrthographicCamera ? c : null; };
  const half = () => { const c = isoCam(); return c ? (c.top - c.bottom) / (2 * c.zoom) : Infinity; };
  const wd = () => new THREE.Vector3(WIND.x, 0, WIND.y).normalize();
  const rnd = (a, b) => a + Math.random() * (b - a);

  // hoge punten per vak (voor de duiven): per 100 m het hoogste dakpunt, alleen > 15 m boven de grond
  const TOPS = [];
  H.on('chunk', c => {
    if (!o0) o0 = O();
    const P = c.mesh?.geometry?.attributes?.position; if (!P) return;
    c.mesh.updateMatrixWorld(); const m = c.mesh.matrixWorld, v = new THREE.Vector3(), cell = new Map();
    for (let k = 0; k < P.count; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(m);
      const key = Math.floor(v.x / 100) + ',' + Math.floor(v.z / 100), b = cell.get(key);
      if (!b || v.y > b.y) cell.set(key, v.clone());
    }
    for (const p of cell.values()) { const g = hW(p.x, p.z); if (p.y - g > 15) TOPS.push(p); }
  });

  // ---------- modellen ----------
  function celMat(o) { return H.celify(new THREE.MeshLambertMaterial(Object.assign({ flatShading: true }, o)), 'sky-' + (o.vertexColors ? 'vc' : 'c')); }
  function balloon() {
    const g = new THREE.Group(), prof = [];
    for (let i = 0; i <= 4; i++) { const t = i / 4, a = 110 * Math.PI / 180; prof.push(new THREE.Vector2(2.4 + (Math.sin(a) * 12 - 2.4) * t, -17 + (Math.cos(a) * 12 + 17) * t)); }
    for (let i = 1; i <= 12; i++) { const a = (110 - i * 110 / 12) * Math.PI / 180; prof.push(new THREE.Vector2(Math.max(0.01, Math.sin(a) * 12), Math.cos(a) * 12)); }
    const env = new THREE.LatheGeometry(prof, 16).toNonIndexed(), col = [], pa = env.attributes.position;
    const cs = ['#c95f48', '#f2dcb6', '#d9a441', '#f2dcb6', '#5f7f9e', '#f2dcb6', '#6f8f6a', '#f2dcb6'].map(c => new THREE.Color(c));
    for (let k = 0; k < pa.count; k += 3) { // kleur per baan
      const cx = (pa.getX(k) + pa.getX(k + 1) + pa.getX(k + 2)) / 3, cz = (pa.getZ(k) + pa.getZ(k + 1) + pa.getZ(k + 2)) / 3;
      const c = cs[Math.floor(((Math.atan2(cz, cx) / (Math.PI * 2) + 1) % 1) * 16) % 8];
      for (let q = 0; q < 3; q++) col.push(c.r, c.g, c.b);
    }
    env.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const envM = celMat({ vertexColors: true, side: THREE.DoubleSide, emissive: new THREE.Color('#ff8a3a'), emissiveIntensity: 0 });
    const e = new THREE.Mesh(env, envM); e.position.y = 19; g.add(e);
    const brown = celMat({ color: '#8a5a36' });
    const basket = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3.2), brown); basket.position.y = -1.3; g.add(basket);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 0.15), brown); r.position.set(sx * 1.6, 1.1, sz * 1.6); g.add(r); }
    g.scale.setScalar(1.5); g.visible = false;
    return { obj: g, envM };
  }
  // vogels: één geometrie per zwerm, vleugels per vogel op de CPU (2 driehoeken), zodat de omlijning gewoon meedoet
  function flock(n, span, color) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 18), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); m.frustumCulled = false; m.visible = false;
    m.userData = { n, span }; return m;
  }
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0);
  function setBird(m, i, p, dir, flap) {
    const P = m.geometry.attributes.position.array, s = m.userData.span / 2, o = i * 18;
    _r.crossVectors(dir, _u).normalize(); const up = flap * s * 0.55, back = s * 0.35;
    P.set([p.x + dir.x * s * 0.3, p.y, p.z + dir.z * s * 0.3, p.x - _r.x * s - dir.x * back, p.y + up, p.z - _r.z * s - dir.z * back, p.x - dir.x * s * 0.35, p.y + 0.15 * s, p.z - dir.z * s * 0.35,
      p.x + dir.x * s * 0.3, p.y, p.z + dir.z * s * 0.3, p.x - dir.x * s * 0.35, p.y + 0.15 * s, p.z - dir.z * s * 0.35, p.x + _r.x * s - dir.x * back, p.y + up, p.z + _r.z * s - dir.z * back], o);
  }

  // ---------- gebeurtenissen: om de 1–2,5 min één ding, nooit tegelijk ----------
  // elk: { obj, dur (s), ok() = mag nu, start(anker), step(t 0–1, sec, nacht) }
  let F = null, ev = null, nextAt = 0;
  function makeEvents() {
    const B = balloon(), G = flock(13, 7, '#3a332c'), S = flock(160, 4.2, '#2a2420'), D = flock(14, 3.6, '#5b5f6a');
    for (const o of [B.obj, G, S, D]) H.addDynamic(o); // bewegende laag: geen hele scène-render per beeld
    F = {
      balloon: { obj: B.obj, dur: 150, ok: () => half() < 1600,
        start(a) { this.a = a; this.side = rnd(-80, 80); },
        step(t, s, night) { // drijft met de wind ±500 m door het beeld
          const W = wd(), p = this.a.clone().addScaledVector(W, (t * 2 - 1) * 500).addScaledVector(new THREE.Vector3(-W.z, 0, W.x), this.side);
          p.y = hW(p.x, p.z) + 150 + Math.sin(s * 0.4) * 6; B.obj.position.copy(p); B.obj.rotation.y = s * 0.05;
          bal.set(p.x, p.y + 45, p.z, 27); // midden van de bol, straal (schaal 1,5)
          B.envM.emissiveIntensity = night * 0.35 * (Math.sin(s * 7) > 0.3 ? 1 : 0.35) * (Math.sin(s * 0.9) > -0.2 ? 1 : 0.2); // brander
        } },
      geese: { obj: G, dur: 45, ok: () => half() < 500,
        start(a) { this.a = a; const W = wd(); this.d = new THREE.Vector3(W.z, 0, -W.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1); },
        step(t, s) { // V-formatie dwars op de wind
          const d = this.d, r = new THREE.Vector3(-d.z, 0, d.x), lead = this.a.clone().addScaledVector(d, (t * 2 - 1) * 600); lead.y = this.a.y + 120;
          for (let i = 0; i < G.userData.n; i++) {
            const rank = Math.ceil(i / 2), sg = i % 2 ? 1 : -1, p = lead.clone().addScaledVector(d, -rank * 6).addScaledVector(r, sg * rank * 6.5);
            p.y += Math.sin(s * 0.7 + i) * 0.6; setBird(G, i, p, d, Math.sin(s * 4.2 - rank * 0.6));
          }
          G.geometry.attributes.position.needsUpdate = true;
        } },
      starlings: { obj: S, dur: 70, ok: () => half() < 500,
        start(a) { this.a = a; },
        step(t, s) { // golvende wolk die met de wind door het beeld trekt
          const W = wd(), ctr = this.a.clone().addScaledVector(W, (t * 2 - 1) * 450).addScaledVector(new THREE.Vector3(-W.z, 0, W.x), Math.sin(s / 9) * 60); ctr.y = this.a.y + 70;
          const sx = 38 + 18 * Math.sin(s * 0.31), sy = 14 + 8 * Math.sin(s * 0.23 + 1), sz = 26 + 14 * Math.cos(s * 0.27), p = new THREE.Vector3(), q = new THREE.Vector3(), dir = new THREE.Vector3();
          const at = (v, tt, a, b) => v.set(Math.sin(tt * 0.9 + a * 5) * sx + Math.sin(tt * 0.37 + b * 9) * 10, Math.sin(tt * 1.3 + b * 7) * sy, Math.cos(tt * 0.7 + a * 3) * sz + Math.sin(tt * 0.5 + b) * 8).add(ctr);
          for (let i = 0; i < S.userData.n; i++) {
            const a = i * 0.618, b = i * 0.37, tt = s * 0.5 + a * 6;
            at(p, tt, a, b); at(q, tt - 0.05, a, b); dir.subVectors(p, q).setY(0).normalize();
            setBird(S, i, p, dir, Math.sin(s * 14 + i * 1.7));
          }
          S.geometry.attributes.position.needsUpdate = true;
        } },
      pigeons: { obj: D, dur: 40, ok() { return half() < 350 && this.find(target()); },
        find(a) { let best = null, bd = 300; for (const p of TOPS) { const d = Math.hypot(p.x - a.x, p.z - a.z); if (d < bd) { bd = d; best = p; } } return best; },
        start(a) { this.h = this.find(a); },
        step(t, s) { // opstijgen van het dak, cirkelen, weer neerstrijken
          const h = this.h, up = Math.min(1, t * 8) * Math.min(1, (1 - t) * 8);
          for (let i = 0; i < D.userData.n; i++) {
            const a = s * 0.55 + i * (Math.PI * 2 / D.userData.n) + Math.sin(i * 3.1) * 0.3, r = (26 + 6 * Math.sin(i * 1.7)) * (0.2 + 0.8 * up);
            const p = new THREE.Vector3(h.x + Math.cos(a) * r, h.y + 1 + (17 + Math.sin(s + i) * 3) * up, h.z + Math.sin(a) * r);
            setBird(D, i, p, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), up < 0.1 ? -0.2 : Math.sin(s * 11 + i * 2.3));
          }
          D.geometry.attributes.position.needsUpdate = true;
        } },
    };
  }
  // snelheid: wolken ±15/s, ballon/vogels ±20/s, beide alleen nabewerking ('post'; bewegende laag H.addDynamic); buiten iso niets
  function tick(now) {
    const s = now / 1000, cam = isoCam(), fxL = H.fxOn('lucht'); let force = false; // begin/einde gebeurtenis → één volledige render
    if (ev && (!cam || s > ev.t1 || !fxL)) { ev.e.obj.visible = false; if (ev.e === F.balloon) bal.w = 0; ev = null; nextAt = s + rnd(60, 150); force = true; }
    if (!ev && cam && fxL && s > nextAt) {
      const ok = Object.values(F).filter(e => e.ok());
      if (ok.length) { const e = ok[Math.floor(Math.random() * ok.length)]; e.start(target()); e.obj.visible = true; ev = { e, t0: s, t1: s + e.dur }; force = true; }
      else nextAt = s + 10;
    }
    if (!cam || (!ev && !H.fxOn('wolken'))) return force || 'none'; // niets dat beweegt
    if (ev) ev.e.step((s - ev.t0) / ev.e.dur, s, H.night()); // tempo = gedeelde tik (H.animate)
    return 'post'; // ballon/vogels zitten op de bewegende laag → nabewerking volstaat
  }
  // wolken: camera → uniforms (ortho-grenzen zoals three ze met zoom berekent); vlak vóór de pass, dus ook bij pannen zonder tik
  function cloudCam() {
    const cam = isoCam();
    if (cam) {
      cam.updateMatrixWorld(); camW.copy(cam.matrixWorld);
      const cx = (cam.right + cam.left) / 2, cy = (cam.top + cam.bottom) / 2, dx = (cam.right - cam.left) / (2 * cam.zoom), dy = (cam.top - cam.bottom) / (2 * cam.zoom);
      lrbt.set(cx - dx, cx + dx, cy - dy, cy + dy);
      cloudM.uniforms.uNight.value = H.night(); cloudM.uniforms.uCloudY.value = target().y + CLOUD.height;
    }
  }

  let started = false;
  H.on('terrain', () => { // eerste vak (niet pas bij 'loaded': laden gebeurt alleen in beeld)
    if (started) return; started = true;
    if (!o0) o0 = O();
    cloudPost = H.addPost({ material: cloudM, order: 10, before: cloudCam, enabled: H.fxOn('wolken') });
    tiltPost = H.addPost({ material: tiltM, order: 20, enabled: tiltOn });
    makeEvents();
    nextAt = performance.now() / 1000 + 12; // eerste keer snel, daarna af en toe
    H.animate(tick, 'lucht'); // wolken: alleen nabewerking opnieuw (scène-render hergebruikt), zie tick
  });
  H.sky = { setTilt, tilt: () => tiltOn, events: () => F, trigger: k => { if (!F?.[k] || (k === 'pigeons' && !F.pigeons.find(target()))) return; if (ev) { ev.e.obj.visible = false; bal.w = 0; } F[k].start(target()); F[k].obj.visible = true; const s = performance.now() / 1000; ev = { e: F[k], t0: s, t1: s + F[k].dur }; } };
})();
