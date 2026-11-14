// iso/nacht.js — avondlicht (design/21 § 5, keuze A warm licht + W warm aangelicht): lantaarns die echt licht werpen, aangelichte kerken/monumenten, nachtsfeer.
// Lichtkaart: canvas in wereld-xz rond de camera (iso: kijkpunt, rijden: vóór de auto), lampen als lichtvlekken ('lighter'), bovenkant van de
// lamp in een tweede, kleine kaart ('lighten' = max). app.js LIT_PARS lampL leest ze in elke cel-shader: grond, gevels (kant naar de lamp), bomen, auto's.
// Opnieuw tekenen alleen als het kijkpunt een stuk verschoven is of de zoomstap wisselt (en het donker is). Vlag: ?nl= (nachtsfeer).
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on || !H.U?.tLmp) return;
  const P = window.H3D_DATA?.props, U = H.U, QS = new URLSearchParams(location.search);
  const OPT = { nl: ['0', 'b', 'm', 's'] };
  const N = {};
  for (const k in OPT) { let v = QS.get(k); try { if (!OPT[k].includes(v)) v = localStorage.getItem('h3d.n.' + k); } catch {} N[k] = OPT[k].includes(v) ? v : '0'; }
  const K = 1.25; // sterkte lichtkaart

  // ---------- lichtvlek-sprites: I(r) = 1/(1+(r/h)²)^1,5 tot 2,6·h, kleur × piek ----------
  const SP = 64;
  function sprite(rgb, peak, ring) {
    const c = document.createElement('canvas'); c.width = c.height = SP; const x = c.getContext('2d'), im = x.createImageData(SP, SP);
    for (let j = 0; j < SP; j++) for (let i = 0; i < SP; i++) {
      const r = Math.hypot(i + 0.5 - SP / 2, j + 0.5 - SP / 2) / (SP / 2); // 0–1 = 0–2,6 h
      let v = ring ? Math.exp(-(((r - 0.55) / 0.22) ** 2)) : Math.pow(1 + (r * 2.6) ** 2, -1.5); v *= 1 - Math.min(1, Math.max(0, (r - 0.8) / 0.2)); if (r >= 1) v = 0;
      const o = (j * SP + i) * 4; im.data[o] = 255 * rgb[0] * v * peak; im.data[o + 1] = 255 * rgb[1] * v * peak; im.data[o + 2] = 255 * rgb[2] * v * peak; im.data[o + 3] = 255;
    }
    x.putImageData(im, 0, 0); return c;
  }
  const SPR = { warm: sprite([1.0, 0.6, 0.28], 0.55), fw: sprite([1.0, 0.74, 0.42], 0.7, true) };

  // ---------- kaarten ----------
  const cv = document.createElement('canvas'), hv = document.createElement('canvas'); hv.width = hv.height = 256;
  let tex = null, htex = null, R = 0;
  function ensure(r) {
    if (R === r) return; R = r; cv.width = cv.height = r;
    tex?.dispose(); htex?.dispose();
    tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    htex = new THREE.CanvasTexture(hv); htex.flipY = false; htex.colorSpace = THREE.NoColorSpace; htex.generateMipmaps = false; htex.minFilter = THREE.LinearFilter;
    U.tLmp.value = tex; U.tLmpH.value = htex;
  }

  // lampen (RD) → lijst met kop/poel; één keer
  let LAMPS = null;
  function lamps() {
    if (LAMPS) return LAMPS; LAMPS = [];
    const L = P?.lamps || [];
    for (let k = 0; k < L.length; k += 5) {
      const big = L[k + 2] ? 1 : 0, th = L[k + 4] * Math.PI / 180, arm = big ? 1.5 : 0.6;
      LAMPS.push({ x: L[k] + Math.cos(th) * arm, y: L[k + 1] + Math.sin(th) * arm, big, h: big ? 8 : 4.8 });
    }
    return LAMPS;
  }
  // aangelichte gebouwen: kerken (iso/spires.js: omtrek of toppunt) + bekende gebouwen (data/layers.js)
  function floods() {
    const out = [], O = H.areaInfo.origin, sp = H.spires;
    if (sp) for (const [key, t] of sp.tips) { // t = wereld [x, y, z]
      const ring = key[0] === 'o' && +key.slice(1) < 100000 ? sp.rings[+key.slice(1)]?.a : null;
      out.push({ x: O[0] + t[0], y: O[1] - t[2], top: t[1] + 2, ring, r: 9, tower: true });
    }
    for (const l of H.layerData?.landmarks || []) out.push({ x: l[2], y: l[3], top: null, ring: null, r: 20 });
    return out;
  }

  const reg = { cx: 0, cz: 0, S: 0, at: 0, dirty: true, mode: '' };
  const hasDem = (x, y) => { const km = H.areaInfo.km || 1000; return !!H.chunks?.get(Math.floor(x / km) + '_' + Math.floor(y / km))?.dem; };
  function paint(cx, cz, S, r) {
    ensure(r);
    const O = H.areaInfo.origin, x = cv.getContext('2d'), hx = hv.getContext('2d'), sc = r / S, hs = 256 / S;
    const x0 = cx - S / 2, z0 = cz - S / 2; // wereld
    const px = X => (X - O[0] - x0) * sc, pz = Y => (-(Y - O[1]) - z0) * sc; // RD → canvas
    x.globalCompositeOperation = 'source-over'; x.fillStyle = '#000'; x.fillRect(0, 0, r, r); x.globalCompositeOperation = 'lighter';
    hx.globalCompositeOperation = 'source-over'; hx.fillStyle = '#000'; hx.fillRect(0, 0, 256, 256); hx.globalCompositeOperation = 'lighten';
    const L = lamps(), wx0 = O[0] + x0, wx1 = wx0 + S, wy1 = O[1] - z0, wy0 = wy1 - S;
    let base = 1e9; const use = [];
    for (const l of L) {
      if (l.x < wx0 - 25 || l.x > wx1 + 25 || l.y < wy0 - 25 || l.y > wy1 + 25 || !hasDem(l.x, l.y)) continue;
      l.g = H.heightAt(l.x, l.y); base = Math.min(base, l.g); use.push(l);
    }
    const F = floods().filter(f => f.x > wx0 - 60 && f.x < wx1 + 60 && f.y > wy0 - 60 && f.y < wy1 + 60 && hasDem(f.x, f.y));
    for (const f of F) { f.g = H.heightAt(f.x, f.y); if (f.top == null) f.top = f.g + 30; base = Math.min(base, f.g); }
    if (base > 1e8) base = 0; base -= 1;
    const gray = t => { const v = Math.max(0, Math.min(255, Math.round((t - base) / 127.5 * 255))); return `rgb(${v},${v},${v})`; };
    // lampen
    for (const l of use) {
      const rr = 2.6 * l.h * sc;
      x.drawImage(SPR.warm, px(l.x) - rr, pz(l.y) - rr, rr * 2, rr * 2);
      hx.fillStyle = gray(l.g + l.h + 0.6); hx.beginPath(); hx.arc((px(l.x) / sc) * hs, (pz(l.y) / sc) * hs, 3.2 * l.h * hs, 0, 6.2832); hx.fill();
    }
    // aangelicht: lichtband langs de omtrek (binnen weggeknipt → licht komt van buiten op de muur), anders een ring om het toppunt
    for (const f of F) {
      const rgb = [255, 190, 110];
      if (f.ring) {
        const a = f.ring, path = () => { x.beginPath(); for (let k = 0; k < a.length; k += 2) (k ? x.lineTo : x.moveTo).call(x, px(a[k]), pz(a[k + 1])); x.closePath(); };
        x.lineJoin = 'round';
        for (const [w, al] of [[16, 0.16], [10, 0.2], [5, 0.26]]) { path(); x.lineWidth = w * sc; x.strokeStyle = `rgba(${rgb},${al})`; x.stroke(); }
        x.globalCompositeOperation = 'destination-out'; path(); x.fillStyle = '#000'; x.fill(); x.globalCompositeOperation = 'lighter';
        hx.beginPath(); for (let k = 0; k < a.length; k += 2) (k ? hx.lineTo : hx.moveTo).call(hx, px(a[k]) / sc * hs, pz(a[k + 1]) / sc * hs); hx.closePath();
        hx.fillStyle = hx.strokeStyle = gray(f.top); hx.lineWidth = 34 * hs; hx.stroke(); hx.fill();
      } else {
        const rr = (f.r + 12) * sc;
        x.drawImage(SPR.fw, px(f.x) - rr, pz(f.y) - rr, rr * 2, rr * 2);
        hx.fillStyle = gray(f.top); hx.beginPath(); hx.arc(px(f.x) / sc * hs, pz(f.y) / sc * hs, (f.r + 14) * hs, 0, 6.2832); hx.fill();
      }
    }
    tex.needsUpdate = true; htex.needsUpdate = true;
    U.uLmpR.value.set(x0, z0, 1 / S, base);
    U.uLmpK.value = K;
    reg.cx = cx; reg.cz = cz; reg.S = S; reg.at = performance.now(); reg.dirty = false;
    H.redraw?.();
  }

  // ---------- elk beeld: kaart verschuiven als nodig ----------
  function tick() {
    const n = U.uNight.value, drv = !!H.driving?.(), st = drv ? H.drive?.state() : null;
    if (n < 0.01 || H.getMode?.() !== 'iso') { if (U.uLmpK.value) U.uLmpK.value = 0; reg.dirty = true; return; }
    let cx, cz, S, r;
    if (drv && st) { const s = Math.sin(st.yaw), c = Math.cos(st.yaw); cx = st.x - s * 220; cz = st.z - c * 220; S = 1400; r = 1024; }
    else { const t = H.controls?.target; if (!t) return; cx = t.x; cz = t.z; const h = H.isoHalf ? H.isoHalf() : 800; S = 800; while (S < Math.min(8000, h * 5)) S *= 2; r = 2048; }
    const far = Math.hypot(cx - reg.cx, cz - reg.cz) > reg.S * (drv ? 0.12 : 0.2);
    if ((reg.dirty || far || S !== reg.S) && performance.now() - reg.at > (drv ? 300 : 450)) paint(cx, cz, S, r);
    else if (!U.uLmpK.value) U.uLmpK.value = K;
  }
  H.on('frame', tick);
  let chT = 0; H.on('chunk', () => { clearTimeout(chT); chT = setTimeout(() => { reg.dirty = true; H.redraw?.(); }, 800); }); // vak erbij → hoogtes kloppen nu

  // ---------- keuzes ----------
  function apply() {
    H.setNightLook?.(N.nl);
    reg.dirty = true; H.redraw?.();
  }
  H.setNacht = (o, keep) => {
    for (const k in OPT) if (o && OPT[k].includes(o[k])) { N[k] = o[k]; if (!keep) try { localStorage.setItem('h3d.n.' + k, N[k]); } catch {} }
    apply(); H.emit('nacht', { ...N });
  };
  H.nacht = () => ({ ...N });
  apply();
})();
