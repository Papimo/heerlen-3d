// iso/bench.js — roadmap 100: vaste vliegroute + frametijden (mediaan/p95), uitkomst als tekst om te kopiëren.
// Aan met ?bench (knop "Bench" naast de meter P) of ?bench=auto (start na 'loaded'). Info-regel voor de meter: H.benchInfo().
// Alleen via H.* (flyTo, isoZoom, isoTurn, addFrame, renderer, controls); pannen = toetsen d/a/w/s zoals een gebruiker.
(() => {
  const H = typeof H3D !== 'undefined' ? H3D : null; if (!H || !H.on) return;
  const QS = new URLSearchParams(location.search), sleep = ms => new Promise(r => setTimeout(r, ms));
  const med = (a, q = 0.5) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const raf = () => new Promise(r => requestAnimationFrame(r));
  let hz = 0, hzBusy = false;
  const meetHz = async () => { // beeldscherm-verversing: mediaan rAF-interval over 1 s
    if (hz || hzBusy) return; hzBusy = true; const d = []; let t0 = await raf(), end = t0 + 1000;
    for (;;) { const t = await raf(); d.push(t - t0); t0 = t; if (t > end) break; }
    const m = med(d); hz = Math.round(1000 / m); hzBusy = false;
  };
  const gl = () => H.renderer.getContext();
  const ext = n => { try { return gl().getExtension(n); } catch (e) { return null; } };
  const browser = () => { const u = navigator.userAgent; return (/Edg\/[\d.]+/.exec(u) || /Firefox\/[\d.]+/.exec(u) || /Chrome\/[\d.]+/.exec(u) || (/Safari\//.test(u) && /Version\/[\d.]+/.exec(u)) || [u.slice(0, 40)])[0]; };
  const yn = v => v ? 'ja' : 'nee';
  H.benchInfo = () => { meetHz(); const w2 = H.renderer.capabilities.isWebGL2;
    return `scherm ${hz ? hz + ' Hz' : 'meet…'} · MRT ${yn(H.useMRT())} · float_blend ${yn(w2 && ext('EXT_float_blend'))} · ${browser()}`; };

  const key = (k, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k, bubbles: true, cancelable: true }));
  const pan = async (k, ms) => { key(k, true); await sleep(ms); key(k, false); };
  const settle = ms => sleep(ms);
  const ROUTE = [ // [naam, functie] — samen ±30 s
    ['pan oost 2,5 s + terug 2,5 s', async () => { await pan('d', 2500); await pan('a', 2500); }],
    ['pan noord 2,5 s + terug 2,5 s', async () => { await pan('w', 2500); await pan('s', 2500); }],
    ['zoom uit naar 2200', async () => { H.zoomStep(1); await settle(1000); }],
    ['pan op 2200 (4 s)', async () => { await pan('d', 4000); }],
    ['kwartslag draaien', async () => { H.isoTurn(1); await settle(1500); }],
    ['zoom in naar 220', async () => { H.zoomStep(-1); await settle(700); H.zoomStep(-1); await settle(1000); }],
    ['pan op 220 (4 s)', async () => { await pan('a', 4000); }],
  ];

  let running = false, boxEl;
  async function run() {
    if (running) return; running = true; btn.disabled = true; btn.textContent = 'Bench loopt…';
    const stop = H.addFrame(() => true); // continu tekenen
    // GPU-tijd: één TIME_ELAPSED-query per beeld, loopt van rAF tot rAF
    const mOn = H.meterEl?.()?.style.display !== 'none' && !!H.meterEl?.(); // meter (P) heeft eigen timer-query's: er mag er maar één tegelijk lopen
    const g = gl(), tq = H.renderer.capabilities.isWebGL2 && !mOn ? ext('EXT_disjoint_timer_query_webgl2') : null, qs = []; let cur = null; const gpuT = [];
    const poll = () => { while (qs.length && g.getQueryParameter(qs[0], g.QUERY_RESULT_AVAILABLE)) { const q = qs.shift(); if (!g.getParameter(tq.GPU_DISJOINT_EXT)) gpuT.push(g.getQueryParameter(q, g.QUERY_RESULT) / 1e6); g.deleteQuery(q); } };
    let seg = null, last = 0, live = true;
    const tick = t => { if (!live) return; requestAnimationFrame(tick);
      if (tq) { if (cur) { g.endQuery(tq.TIME_ELAPSED_EXT); qs.push(cur); } cur = g.createQuery(); g.beginQuery(tq.TIME_ELAPSED_EXT, cur); poll(); if (seg) seg.gpuN = gpuT.length; }
      if (last && seg) seg.dt.push(t - last); last = t; };
    await meetHz(); if (!hz) hz = 60;
    const x0 = H.toRD(H.controls.target); // start: stand 700 in huidig midden
    H.flyTo(x0[0], x0[1], { half: 700, ms: 600, arc: false }); await settle(1500);
    const segs = []; requestAnimationFrame(tick);
    for (const [name, fn] of ROUTE) { seg = { name, dt: [], g0: gpuT.length, gpuN: 0 }; segs.push(seg); last = 0; const t0 = performance.now(); await fn(); seg.s = (performance.now() - t0) / 1000; seg.g1 = gpuT.length; }
    seg = null; live = false; await sleep(200); if (tq) { if (cur) g.endQuery(tq.TIME_ELAPSED_EXT); await sleep(300); poll(); }
    stop(); running = false; btn.disabled = false; btn.textContent = 'Bench';
    show(segs, gpuT, !!tq);
  }

  function show(segs, gpuT, hasGpu) {
    const f = v => isFinite(v) ? v.toFixed(1) : '–', disp = 1000 / hz;
    const line = (name, dt, gp, s) => { const drop = dt.filter(d => d > 1.5 * disp).length, tot = dt.reduce((a, b) => a + b, 0);
      return `${name}: mediaan ${f(med(dt))} ms · p95 ${f(med(dt, 0.95))} ms · ${f(dt.length / (tot / 1000))} fps · gemist ${drop}/${dt.length}` + (hasGpu ? ` · GPU mediaan ${f(med(gp))} ms p95 ${f(med(gp, 0.95))} ms` : ''); };
    const all = [].concat(...segs.map(s => s.dt)), out = [`Heerlen 3D bench — v${H.VERSION}`, '', 'Resultaat (CPU-beeldinterval via rAF; gemist = interval > 1,5× schermbeeld)'];
    for (const s of segs) out.push('  ' + line(s.name, s.dt, gpuT.slice(s.g0, s.g1)));
    out.push('  ' + line('TOTAAL', all, gpuT), hasGpu ? '' : '  GPU-tijd: n.v.t. (Safari / geen timer-query, of meter P stond aan)', '');
    const c = H.renderer.domElement, ca = gl().getContextAttributes?.() || {}, dbg = ext('WEBGL_debug_renderer_info'), w2 = H.renderer.capabilities.isWebGL2;
    const flags = [...QS.keys()].filter(k => /^no/.test(k));
    out.push('Omgeving',
      `  versie: ${H.VERSION}`, `  browser: ${browser()}`, `  canvas: ${c.width}×${c.height} px (apparaat)`,
      `  devicePixelRatio: ${devicePixelRatio} · renderer pixelRatio: ${H.renderer.getPixelRatio()}`, `  scherm: ${hz} Hz`,
      `  WebGL2: ${yn(w2)} · EXT_float_blend: ${yn(ext('EXT_float_blend'))} · MRT: ${yn(H.useMRT())}`, `  antialias canvas: ${yn(ca.antialias)} · Zuinig: ${yn(H.fxOn?.('zuinig'))}${navigator.getBattery ? ' (op accu = automatisch aan)' : ''}`,
      `  ?no…-schakelaars: ${flags.length ? flags.join(', ') : 'geen'}`, `  GPU: ${dbg ? gl().getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'onbekend'}`);
    if (!boxEl) {
      boxEl = document.createElement('div');
      boxEl.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:100;max-width:92vw;padding:10px 12px;background:rgba(20,18,16,.94);color:#f3ead8;border-radius:8px;font:12px/1.4 ui-monospace,monospace';
      boxEl.innerHTML = '<pre style="margin:0 0 8px;white-space:pre-wrap;max-height:70vh;overflow:auto"></pre><button data-k>Kopieer</button> <button data-x>Sluit</button>';
      document.body.appendChild(boxEl);
      boxEl.querySelector('[data-x]').onclick = () => { boxEl.style.display = 'none'; };
      boxEl.querySelector('[data-k]').onclick = async e => { const t = boxEl.querySelector('pre').textContent;
        try { await navigator.clipboard.writeText(t); e.target.textContent = 'Gekopieerd'; } catch (er) { const r = document.createRange(); r.selectNodeContents(boxEl.querySelector('pre')); getSelection().removeAllRanges(); getSelection().addRange(r); e.target.textContent = 'Selecteer + Ctrl+C'; } };
    }
    boxEl.querySelector('pre').textContent = out.join('\n'); boxEl.querySelector('[data-k]').textContent = 'Kopieer'; boxEl.style.display = '';
  }

  const btn = document.createElement('button'); btn.textContent = 'Bench'; btn.title = 'Vaste vliegroute (±30 s) meten';
  btn.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:100;font:12px ui-monospace,monospace;padding:2px 8px;display:none';
  btn.onclick = run; document.body.appendChild(btn);
  const place = () => { const m = H.meterEl?.(), on = m && m.style.display !== 'none' || QS.has('bench'); btn.style.display = on ? '' : 'none'; if (m && m.style.display !== 'none') btn.style.bottom = (m.offsetHeight + 14) + 'px'; else btn.style.bottom = '8px'; };
  setInterval(place, 500); place();
  if (QS.get('bench') === 'auto') H.on('loaded', () => setTimeout(run, 2000));
})();
