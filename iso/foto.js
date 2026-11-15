// iso/foto.js — fotomodus (keuze design/25: a schoon beeld, d A3-poster, e miniatuur; alleen iso). Alles standaard uit.
//  Sfeer › Foto: fx 'foto' (UI weg + knop 📷 → PNG op schermgrootte) of 'poster' (staand A3-kader, PNG 2480 × 3508 met titel, noordpijl, schaalbalk);
//   één tegelijk, niet bewaard over herladen (app.js). Uit via ✕ naast de fotoknop of Esc.
//  fx 'mini' (miniatuur): scherpe band iets onder het midden, rest vaag, meer kleur — nabewerking order 24, stil.
//  Afgewezen in ronde 25: dubbel zo groot, prentbriefkaart-kader.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null;
  if (!H?.on || !H.addPost) return;
  const iso = () => H.getMode?.() === 'iso';
  const O = () => H.areaInfo?.origin || [0, 0];
  const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // ---------- miniatuur ----------
  const miniM = new THREE.ShaderMaterial({ name: 'mini', uniforms: { tIn: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } }, depthTest: false, depthWrite: false, vertexShader: VS,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uRes;
      void main() { // scherpe band iets onder het midden, erboven/eronder vervaagd; kleur en contrast omhoog
        float b = smoothstep(0.08, 0.4, abs(vUv.y - 0.46)) * 7.0 * max(1.0, uRes.y / 1000.0);
        vec3 s = texture2D(tIn, vUv).rgb;
        for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; s += texture2D(tIn, vUv + vec2(cos(a), sin(a)) * b * (i % 2 == 0 ? 1.0 : 0.55) / uRes).rgb; }
        vec3 cs = pow(s / 13.0, vec3(1.0 / 2.2)); float l = dot(cs, vec3(0.299, 0.587, 0.114));
        cs = clamp((mix(vec3(l), cs, 1.3) - 0.5) * 1.08 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(pow(cs, vec3(2.2)), 1.0);
        #include <colorspace_fragment>
      }` });
  let miniPost = null;

  // ---------- schoon beeld, kader, knoppen ----------
  const css = document.createElement('style');
  css.textContent = `body.fotoclean #top, body.fotoclean #chips, body.fotoclean #tools, body.fotoclean #clock, body.fotoclean #compass, body.fotoclean #zoom, body.fotoclean #menu,
    body.fotoclean #card, body.fotoclean #progress, body.fotoclean .help, body.fotoclean #drivebtn { display: none !important; }
    .fotoov { position: fixed; inset: 0; pointer-events: none; z-index: 6; display: none; }
    .fotohole { position: absolute; box-shadow: 0 0 0 9999px #0008; outline: 1px solid #fff8; }
    .fotohole i { position: absolute; left: 0; right: 0; bottom: 0; height: 17%; background: #f4efe6; display: flex; flex-direction: column; align-items: center; justify-content: center; font: 600 clamp(16px, 4.2vh, 44px) Georgia, serif; letter-spacing: .3em; color: #2b2620; font-style: normal; }
    .fotohole i small { font: 12px system-ui, sans-serif; letter-spacing: .08em; color: #6f665b; margin-top: 4px; }
    .fotobar { position: fixed; right: 16px; bottom: 16px; z-index: 7; display: none; gap: 8px; }
    .fotobar button { border: 0; border-radius: 999px; padding: 10px 18px; background: #fbf8f2; color: #2b2620; font: 600 14px system-ui, sans-serif; box-shadow: 0 3px 12px #0005; cursor: pointer; }
    .fotoflash { position: fixed; inset: 0; background: #fff; z-index: 8; pointer-events: none; opacity: 0; transition: opacity .5s; }`;
  document.head.append(css);
  const ov = document.createElement('div'); ov.className = 'fotoov'; ov.innerHTML = '<div class="fotohole"></div>'; document.body.append(ov);
  const hole = ov.firstChild;
  const bar = document.createElement('div'); bar.className = 'fotobar';
  bar.innerHTML = '<button data-snap>📷 Foto opslaan</button><button data-close title="fotomodus uit (Esc)">✕</button>'; document.body.append(bar);
  const flash = document.createElement('div'); flash.className = 'fotoflash'; document.body.append(flash);
  const poster = () => H.fxOn('poster');
  const active = () => iso() && (H.fxOn('foto') || poster());
  function frameRect() { // in CSS-px
    const W = innerWidth, Hh = innerHeight; if (!poster()) return { x: 0, y: 0, w: W, h: Hh };
    const asp = 297 / 420; let h = Hh * 0.88, w = h * asp;
    if (w > W * 0.9) { w = W * 0.9; h = w / asp; }
    return { x: (W - w) / 2, y: (Hh - h) / 2, w, h };
  }
  const centerRD = () => { const t = H.controls.target, o = O(); return [o[0] + t.x, o[1] - t.z]; };
  const wgsTxt = () => { const [x, y] = centerRD(), w = H.rd2wgs?.(x, y); if (!w) return ''; const la = w.lat ?? w[0], lo = w.lon ?? w.lng ?? w[1]; return la ? `${(+la).toFixed(3).replace('.', ',')}° N · ${(+lo).toFixed(3).replace('.', ',')}° O` : ''; };
  function apply() {
    const on = active(), k = on && poster();
    document.body.classList.toggle('fotoclean', on);
    ov.style.display = k ? 'block' : 'none'; bar.style.display = on ? 'flex' : 'none';
    if (k) {
      const r = frameRect(); Object.assign(hole.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      hole.innerHTML = `<i>HEERLEN<small>Parkstad 3D · ${wgsTxt()}</small></i>`;
    }
    const mi = iso() && H.fxOn('mini');
    if (mi && !miniPost) miniPost = H.addPost({ material: miniM, order: 24, still: true, enabled: true });
    if (miniPost && miniPost.enabled !== mi) { miniPost.enabled = mi; H.redraw(); }
  }
  const close = () => { if (H.fxOn('foto')) H.setFx('foto', 0); if (poster()) H.setFx('poster', 0); };
  addEventListener('resize', () => { if (poster()) apply(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && active()) close(); });
  H.on('still', () => { if (poster()) apply(); });

  // foto maken: na het volgende getekende beeld de canvas kopiëren (zelfde taak → tekenbuffer nog geldig, geen preserveDrawingBuffer nodig)
  let pend = null;
  H.on('frame', () => { if (!pend) return; const f = pend; pend = null; const src = H.renderer.domElement, cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); f([cv, src]); });
  const grab = () => new Promise(res => { pend = res; H.redraw(); });
  function cover(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) { const a = dw / dh; let w = sw, h = sw / a; if (h > sh) { h = sh; w = sh * a; } ctx.drawImage(img, sx + (sw - w) / 2, sy + (sh - h) / 2, w, h, dx, dy, dw, dh); return w; }
  function save(cv, name) {
    cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }, 'image/png');
  }
  const stamp = () => { const d = new Date(); return d.toISOString().slice(0, 16).replace(/[T:]/g, '-'); };
  async function snap() {
    if (!active()) return;
    bar.style.visibility = 'hidden';
    const [img, src] = await grab();
    bar.style.visibility = ''; flash.style.transition = 'none'; flash.style.opacity = 0.8; requestAnimationFrame(() => { flash.style.transition = 'opacity .5s'; flash.style.opacity = 0; });
    if (!poster()) return save(img, `parkstad3d-${stamp()}.png`);
    const r = frameRect(), sc = img.width / innerWidth, crop = [r.x * sc, r.y * sc, r.w * sc, r.h * sc];
    // A3-poster 2480 × 3508: beeld, titel, coördinaten, noordpijl, schaalbalk
    const cv = document.createElement('canvas'), x = cv.getContext('2d');
    cv.width = 2480; cv.height = 3508;
    x.fillStyle = '#f4efe6'; x.fillRect(0, 0, 2480, 3508);
    const PW = 2200, PH = 2620, used = cover(x, img, ...crop, 140, 140, PW, PH);
    x.strokeStyle = '#2b2620'; x.lineWidth = 3; x.strokeRect(140, 140, PW, PH);
    x.fillStyle = '#2b2620'; x.textAlign = 'center'; x.font = '600 250px Georgia, serif'; x.letterSpacing = '60px'; x.fillText('HEERLEN', 1240 + 30, 3070); x.letterSpacing = '0px';
    x.font = '42px system-ui, sans-serif'; x.fillStyle = '#6f665b'; x.fillText(`Parkstad 3D  ·  ${wgsTxt()}  ·  ${new Date().toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })}`, 1240, 3170);
    x.font = '30px system-ui, sans-serif'; x.fillText('Gebouwen 3D BAG · hoogte AHN · kaartgegevens OpenStreetMap', 1240, 3250);
    const cmr = H.camera(), v = new THREE.Vector3(0, 0, -1).transformDirection(cmr.matrixWorldInverse), ang = Math.atan2(v.x, v.y);
    x.save(); x.translate(2200, 3020); x.rotate(ang); x.fillStyle = '#2b2620'; x.beginPath(); x.moveTo(0, -80); x.lineTo(34, 50); x.lineTo(0, 26); x.lineTo(-34, 50); x.closePath(); x.fill(); x.restore();
    x.font = '600 40px Georgia, serif'; x.fillStyle = '#2b2620'; x.fillText('N', 2200 + Math.sin(ang) * 130, 3020 - Math.cos(ang) * 130 + 14);
    const mPerSrc = 2 * (H.isoHalf?.() || 800) / src.height, mPerOut = mPerSrc * used / PW;
    const len = [50, 100, 200, 250, 500, 1000, 2000].find(m => m / mPerOut > 260) || 2000, px = len / mPerOut;
    x.fillRect(200, 3030, px, 16); x.fillStyle = '#f4efe6'; x.fillRect(200 + px / 2, 3034, px / 2 - 4, 8);
    x.fillStyle = '#2b2620'; x.textAlign = 'left'; x.font = '36px system-ui, sans-serif'; x.fillText(len >= 1000 ? len / 1000 + ' km' : len + ' m', 200, 3010);
    save(cv, `parkstad3d-poster-${stamp()}.png`);
  }
  bar.addEventListener('click', e => { if (e.target.closest('[data-snap]')) snap(); if (e.target.closest('[data-close]')) close(); });

  H.on('fx', (k, on) => {
    if (k !== 'foto' && k !== 'poster' && k !== 'mini') return;
    if (on && k !== 'mini') { const other = k === 'foto' ? 'poster' : 'foto'; if (H.fxOn(other)) H.setFx(other, 0); }
    apply();
  });
  H.on('mode', apply);
  setTimeout(apply, 1500);
})();
