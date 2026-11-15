// iso/stijl.js — stijlmodi (keuze design/25: d aquarel + e prentbriefkaart 1930, alleen iso, alleen nabewerking).
//  Schakelaars Sfeer › Stijl (fx 'aquarel' / 'kaart', één tegelijk; aquarel standaard aan sinds test13). Nabewerking order 16, stil, ook tijdens rijden.
//  Afgewezen in ronde 25: pentekening, kleurplaat, blauwdruk.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null;
  if (!H?.on || !H.addPost) return;
  const iso = () => H.getMode?.() === 'iso';
  const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // iso (orthografisch) of rijden (perspectief, H.driving): diepte in tN = afstand langs de kijkas → wereldpunt per pixel
  const camW = new THREE.Matrix4(), lrbt = new THREE.Vector4(), tanF = new THREE.Vector2(1, 1), persp = { value: 0 };
  function cam() {
    const c = H.camera(); if (!c) return;
    c.updateMatrixWorld(); camW.copy(c.matrixWorld);
    persp.value = c.isPerspectiveCamera ? 1 : 0;
    if (c.isPerspectiveCamera) { const t = Math.tan(c.fov * Math.PI / 360); tanF.set(t * c.aspect, t); return; }
    const cx = (c.right + c.left) / 2, cy = (c.top + c.bottom) / 2, dx = (c.right - c.left) / (2 * c.zoom), dy = (c.top - c.bottom) / (2 * c.zoom);
    lrbt.set(cx - dx, cx + dx, cy - dy, cy + dy);
  }
  const SU = { tIn: { value: null }, tN: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uHalf: { value: 800 }, uCamW: { value: camW }, uLRBT: { value: lrbt }, uSty: { value: 0 }, uPersp: persp, uTanF: { value: tanF } };
  const styM = new THREE.ShaderMaterial({ name: 'stijl', uniforms: SU, depthTest: false, depthWrite: false, vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform highp sampler2D tN; uniform vec2 uRes; uniform float uHalf; uniform mat4 uCamW; uniform vec4 uLRBT; uniform float uSty, uPersp; uniform vec2 uTanF;
      ${H.NRM_GLSL}
      float h1(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h1(i), h1(i + vec2(1, 0)), f.x), mix(h1(i + vec2(0, 1)), h1(i + vec2(1, 1)), f.x), f.y); }
      vec3 toS(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
      vec3 toL(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
      vec4 nf(ivec2 p) { return texelFetch(tN, clamp(p, ivec2(0), textureSize(tN, 0) - 1), 0); }
      vec3 wpos(vec2 uv, float d) {
        if (uPersp > 0.5) return (uCamW * vec4((uv * 2.0 - 1.0) * uTanF * d, -d, 1.0)).xyz;
        return (uCamW * vec4(mix(uLRBT.x, uLRBT.y, uv.x), mix(uLRBT.z, uLRBT.w, uv.y), -d, 1.0)).xyz; }
      float edges(ivec2 p, int s, float mpp) { // randen: normaal-sprong, diepte-sprong, rand van de lucht
        vec4 a = nf(p); vec3 na = a.g > 0.0 ? nrmUnpack(a.r) : vec3(0.0); float e = 0.0;
        ivec2 OF[4] = ivec2[4](ivec2(s, 0), ivec2(-s, 0), ivec2(0, s), ivec2(0, -s));
        for (int i = 0; i < 4; i++) {
          vec4 b = nf(p + OF[i]);
          if ((a.g > 0.0) != (b.g > 0.0)) { e = 1.0; continue; }
          if (a.g <= 0.0) continue;
          e = max(e, smoothstep(0.12, 0.3, 1.0 - dot(na, nrmUnpack(b.r))));
          if (uPersp > 0.5) { float c2 = nf(p - OF[i]).g; if (c2 > 0.0) e = max(e, smoothstep(0.04, 0.08, abs(b.g + c2 - 2.0 * a.g) / a.g)); } // rijden: 2e afgeleide (scherende grond geeft geen valse randen)
          else { float k = mpp * float(s) * 2.5 + 0.6; e = max(e, smoothstep(k, k * 2.0, abs(b.g - a.g))); }
        }
        return e;
      }
      void main() {
        vec4 c = texture2D(tIn, vUv); ivec2 p = ivec2(gl_FragCoord.xy); vec4 n = nf(p);
        vec3 cs = toS(c.rgb); float lum = dot(cs, vec3(0.299, 0.587, 0.114)), mpp = 2.0 * uHalf / uRes.y;
        float sc = max(1.0, uRes.y / 1000.0); int s = int(sc + 0.5); vec2 g = gl_FragCoord.xy / sc;
        bool sky = n.g <= 0.0; vec3 wp = sky ? vec3(g, 0.0).xzy : wpos(vUv, n.g);
        float e = edges(p, s, mpp); vec3 o = cs;
        if (uSty < 1.5) { // aquarel: verzadigd, vlekkerig, papier op de lichtste plekken, natte randen
          vec3 paper = vec3(0.97, 0.95, 0.9);
          vec2 px = 2.0 * sc / uRes; float ce = 0.0;
          for (int i = 0; i < 4; i++) { vec2 d = i == 0 ? vec2(px.x, 0) : i == 1 ? vec2(-px.x, 0) : i == 2 ? vec2(0, px.y) : vec2(0, -px.y); ce = max(ce, length(toS(texture2D(tIn, vUv + d).rgb) - cs)); }
          o = mix(vec3(lum), cs, 1.25); o = mix(o, floor(o * 7.0 + 0.5) / 7.0, 0.35);
          vec2 bq = sky ? g / 6.0 : wp.xz;
          o *= 0.9 + 0.2 * (vn(bq / 40.0) * 0.6 + vn(bq / 9.0) * 0.4);
          o = mix(o, paper, smoothstep(0.72, 0.92, lum) * 0.7 + (sky ? 0.35 : 0.0));
          o *= 1.0 - 0.25 * smoothstep(0.08, 0.3, ce); o = mix(o, o * 0.55, e * 0.5);
          o *= (0.96 + 0.06 * h1(floor(g * 0.7))) * (0.98 + 0.03 * vn(g * 0.3));
        } else { // prentbriefkaart 1930: sepia met handkleuring, vervaagd, vignet, korrel
          vec3 sep = vec3(lum) * vec3(1.08, 0.94, 0.74);
          o = mix(sep, cs, 0.32); o = mix(vec3(0.95, 0.9, 0.8), o, 0.86);
          vec2 q = vUv - 0.5; o *= 1.0 - 0.55 * dot(q, q);
          o += (h1(g) - 0.5) * 0.05; o = mix(o, vec3(0.3, 0.2, 0.12), e * 0.45);
        }
        gl_FragColor = vec4(toL(o), 1.0);
        #include <colorspace_fragment>
      }` });
  let post = null;
  function apply() {
    const id = H.fxOn('aquarel') ? 1 : H.fxOn('kaart') ? 2 : 0, on = iso() && id > 0;
    if (on && !post) post = H.addPost({ material: styM, order: 16, still: true, drive: true, before: cam, enabled: true });
    if (!post) return;
    post.enabled = on; SU.uSty.value = id; H.redraw();
  }
  H.on('fx', (k, on) => {
    if (k !== 'aquarel' && k !== 'kaart') return;
    const other = k === 'aquarel' ? 'kaart' : 'aquarel';
    if (on && H.fxOn(other)) H.setFx(other, 0); // één stijl tegelijk (setFx stuurt zelf weer 'fx' → apply)
    apply();
  });
  H.on('mode', apply);
  setTimeout(apply, 1500);
})();
