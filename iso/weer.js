// iso/weer.js — weer en dag/nacht (keuze design/24a: weer b + d + f, alleen iso).
//  echt weer nu (Open-Meteo, EU; elke 10 min): regen nu of ≥ 0,2 mm in de laatste 3 uur → natte straten + plassen; bewolking/regen → grijzer licht.
//   Geen regenstreepjes of mistlaag (gebruiker: alleen nat + grijs). Schakelaar Sfeer › Echt weer (fx 'weer', standaard aan); tekst in het menu (#weertxt).
//  dag in 60 s (knop Sfeer, niet standaard): klok ×1440, licht volgt de zon van H.now(), zonrichting vast (geen herbakken); na één rondje terug naar nu.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null;
  if (!H?.on || !H.U || !H.addPost) return;
  const U = H.U;
  const iso = () => H.getMode?.() === 'iso';

  // ---------- nat + grijs: één nabewerking (na de wolkschaduw), stil (geen tijd) ----------
  const camW = new THREE.Matrix4(), lrbt = new THREE.Vector4();
  const WU = { tIn: { value: null }, tN: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uCamW: { value: camW }, uLRBT: { value: lrbt },
    uWet: { value: 0 }, uGrey: { value: 0 }, uNight: { value: 0 }, uHor: U.uHor, uZen: U.uZen };
  const wm = new THREE.ShaderMaterial({ name: 'weer', uniforms: WU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform highp sampler2D tN; uniform mat4 uCamW; uniform vec4 uLRBT;
      uniform float uWet, uGrey, uNight; uniform vec3 uHor, uZen;
      ${H.NRM_GLSL}
      float h1(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec4 c = texture2D(tIn, vUv), n = texelFetch(tN, clamp(ivec2(gl_FragCoord.xy), ivec2(0), textureSize(tN, 0) - 1), 0);
        float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        c.rgb = mix(c.rgb, vec3(lum) * vec3(0.94, 0.97, 1.03), 0.42 * uGrey) * (1.0 - 0.16 * uGrey); // grijs weer: minder kleur, koeler, donkerder
        if (n.g > 0.0 && uWet > 0.0) { // nat: vlak + grijs (asfalt, klinkers, platte daken) of rood fietsasfalt → donkerder, spiegelt de lucht; plassen als vlekken
          vec3 wp = (uCamW * vec4(mix(uLRBT.x, uLRBT.y, vUv.x), mix(uLRBT.z, uLRBT.w, vUv.y), -n.g, 1.0)).xyz;
          vec3 wn = normalize(mat3(uCamW) * nrmUnpack(n.r));
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sat = (mx - mn) / max(mx, 1e-3);
          float fl = smoothstep(0.86, 0.96, wn.y), grey = 1.0 - smoothstep(0.1, 0.2, sat);
          float red = smoothstep(0.25, 0.4, sat) * step(c.g * 1.25, c.r) * step(c.b * 1.2, c.r) * (1.0 - smoothstep(0.55, 0.7, mx));
          float w = uWet * fl * max(grey * smoothstep(0.08, 0.18, lum) * (1.0 - smoothstep(0.62, 0.8, lum)), red * 0.8);
          float pud = smoothstep(0.6, 0.68, vn(wp.xz / 4.0) * 0.7 + vn(wp.xz / 1.3) * 0.3) * smoothstep(0.3, 0.8, uWet);
          vec3 sky = mix(uHor, uZen, 0.3 + 0.35 * vn(wp.xz / 9.0)) * mix(1.0, 0.6, uNight);
          c.rgb *= 1.0 - 0.36 * w;
          c.rgb = mix(c.rgb, sky, w * (0.14 + 0.12 * vn(vec2(wp.x * 0.12, wp.z * 0.5)) + 0.62 * pud));
        }
        gl_FragColor = c;
        #include <colorspace_fragment>
      }` });
  function wCam() {
    const cam = H.camera(); if (!cam?.isOrthographicCamera) return;
    cam.updateMatrixWorld(); camW.copy(cam.matrixWorld);
    const cx = (cam.right + cam.left) / 2, cy = (cam.top + cam.bottom) / 2, dx = (cam.right - cam.left) / (2 * cam.zoom), dy = (cam.top - cam.bottom) / (2 * cam.zoom);
    lrbt.set(cx - dx, cx + dx, cy - dy, cy + dy); WU.uNight.value = H.night();
  }
  let post = null;

  // ---------- echt weer nu (Open-Meteo, EU) ----------
  let RW = null, rwAt = 0, rwBusy = false;
  const WMO = c => c === 0 ? 'helder' : c <= 2 ? 'licht bewolkt' : c === 3 ? 'bewolkt' : c <= 48 ? 'mist' : c <= 57 ? 'motregen' : c <= 67 ? 'regen' : c <= 77 ? 'sneeuw' : c <= 82 ? 'buien' : c <= 86 ? 'sneeuwbuien' : 'onweer';
  async function realWeather() {
    if (rwBusy || (RW && Date.now() - rwAt < 6e5)) return; rwBusy = true;
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.888&longitude=5.98&current=temperature_2m,precipitation,cloud_cover,weather_code&hourly=precipitation&past_hours=3&forecast_hours=1&timezone=Europe%2FAmsterdam');
      const j = await r.json(), c = j.current, code = c.weather_code, past = (j.hourly?.precipitation || []).reduce((a, b) => a + (b || 0), 0);
      const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
      RW = { wet: rainy || past > 0.2 ? Math.min(1, 0.5 + past / 3) : 0, grey: Math.min(1, Math.max(0, (c.cloud_cover - 40) / 60) * 0.8 + (rainy ? 0.2 : 0) + (code === 45 || code === 48 ? 0.3 : 0)),
        txt: `Heerlen nu: ${Math.round(c.temperature_2m)} °C · ${WMO(code)} · ${c.cloud_cover}% bewolkt` };
    } catch { RW = { wet: 0, grey: 0, txt: 'Echt weer: geen verbinding met Open-Meteo' }; }
    rwAt = Date.now(); rwBusy = false; show(); apply();
  }
  const show = () => { const el = document.getElementById('weertxt'); if (el) el.textContent = H.fxOn('weer') ? RW?.txt || 'Echt weer ophalen…' : ''; };
  function apply() {
    const on = iso() && H.fxOn('weer');
    if (on) realWeather();
    const wet = on && RW ? RW.wet : 0, grey = on && RW ? RW.grey : 0, en = wet > 0 || grey > 0;
    if (en && !post) post = H.addPost({ material: wm, order: 12, still: true, before: wCam, enabled: true });
    if (!post) return;
    if (post.enabled !== en || WU.uWet.value !== wet || WU.uGrey.value !== grey) { post.enabled = en; WU.uWet.value = wet; WU.uGrey.value = grey; H.redraw(); }
  }
  H.on('fx', k => { if (k === 'weer') { show(); apply(); } });
  setInterval(apply, 30e3); // ook iso-wissel en de 10-minutengrens; ophalen zelf max. elke 10 min
  setTimeout(() => { show(); apply(); }, 1500);

  // ---------- dag in 60 s ----------
  function sunElev(d) { // = app.js sunElev
    const doy = (d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5, rad = Math.PI / 180;
    const decl = -23.44 * rad * Math.cos(2 * Math.PI * (doy + 10) / 365), lat = 50.89 * rad;
    const ha = ((d.getUTCHours() + d.getUTCMinutes() / 60 + 5.98 / 15) - 12) * 15 * rad;
    return Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)) / rad;
  }
  let TL = null, lastN = -1;
  function tlTick() {
    if (!TL) return 'none';
    if (performance.now() - TL.t0 > 60e3) { H.dag60(false); return 'none'; }
    const n = Math.round(100 * Math.min(1, Math.max(0, (4 - sunElev(H.now())) / 10))) / 100;
    if (n !== lastN) { lastN = n; H.setNightGoal(n, true); }
    return 'none';
  }
  H.dag60 = on => { // knop Sfeer › Dag in 60 s; on = undefined → wisselen
    on = on ?? !TL;
    if (on && !TL) { TL = { t0: performance.now() }; lastN = -1; H.setSpeed(1440); }
    else if (!on && TL) { TL = null; H.setSpeed(1, true); H.setNightGoal(0, false); H.setLight(H.getLight(), true); }
    H.emit('dag60', !!TL); H.redraw();
  };
  H.dag60On = () => !!TL;
  H.animate?.(tlTick, 'dag60');
})();
