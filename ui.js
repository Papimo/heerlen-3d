// Parkstad 3D — interface: zoeken, categorieën, pins (OSM + eigen), infokaartje, kaartstijl, kompas.
(() => {
  const $ = id => document.getElementById(id);
  const gemNames = () => (H3D.areaInfo?.parts || [{ name: 'Heerlen' }]).map(p => p.name); // gemeenten die aan staan (zoeken, teksten)
  const gemQ = () => gemNames().join(' OR ');
  document.body.dataset.lm = H3D.lmStyle?.() || 'w3'; // stijl bekende gebouwen (app.js LM_STYLES, style.css)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---------- Categorieën ----------
  const CATS = {
    koffie: { label: 'Koffie', icon: '☕', color: '#6b4a36', words: ['koffie', 'cafe', 'coffee', 'thee', 'lunchroom', 'espresso'] },
    eten: { label: 'Eten', icon: '🍽', color: '#a8432e', words: ['eten', 'restaurant', 'restaurants', 'diner', 'lunch', 'snack', 'snackbar', 'frituur', 'fastfood', 'ijs'] },
    drinken: { label: 'Drinken', icon: '🍺', color: '#c8963a', dark: true, words: ['drinken', 'bar', 'kroeg', 'bier', 'pub', 'borrel', 'uitgaan'] },
    boodschappen: { label: 'Boodschappen', icon: '🛒', color: '#5f6b3a', words: ['boodschappen', 'supermarkt', 'bakker', 'slager', 'groente'] },
    winkels: { label: 'Winkels', icon: '🛍', color: '#4a5f72', words: ['winkel', 'winkels', 'shop', 'shoppen', 'winkelen'] },
    cultuur: { label: 'Cultuur', icon: '🎭', color: '#7a4e5e', words: ['cultuur', 'museum', 'kunst', 'theater', 'bioscoop', 'bibliotheek', 'bezienswaardigheid'] },
    studeren: { label: 'Studeren', icon: '🎓', color: '#2f5f6b', words: ['studeren', 'universiteit', 'universiteiten', 'hogeschool', 'onderwijs', 'campus', 'open universiteit', 'zuyd'] },
    overnachten: { label: 'Overnachten', icon: '🛏', color: '#b5713a', words: ['hotel', 'overnachten', 'slapen', 'b&b', 'pension'] },
    mijn: { label: 'Mijn pins', icon: '📍', color: '#d2582a', words: ['mijn', 'pins', 'favoriet', 'favorieten', 'bewaard'] },
    lm: { label: 'Bekende gebouwen', icon: '⚑', color: '#3a2f2a', dark: true, hidden: true, words: ['bekend', 'bekende gebouwen', 'monument', 'monumenten'] }, // laag "gebouwen", geen knop
  };
  const SHUT = '#a19d97'; // dicht (filter "nu open")
  const SUB = {
    university: 'Universiteit', college: 'Hogeschool / mbo', cafe: 'Café / koffie', coffee: 'Koffiebranderij', tea: 'Thee', restaurant: 'Restaurant', fast_food: 'Snackbar / fastfood', ice_cream: 'IJssalon', food_court: 'Foodcourt',
    bar: 'Bar', pub: 'Kroeg', biergarten: 'Biertuin', nightclub: 'Club', supermarket: 'Supermarkt', bakery: 'Bakker', butcher: 'Slager', greengrocer: 'Groenteboer',
    convenience: 'Buurtwinkel', deli: 'Delicatessen', cheese: 'Kaas', pastry: 'Banketbakker', confectionery: 'Snoep', chocolate: 'Chocolade', seafood: 'Vis', beverages: 'Dranken',
    wine: 'Wijn', alcohol: 'Slijterij', organic: 'Biologisch', farm: 'Boerderijwinkel', clothes: 'Kleding', shoes: 'Schoenen', hairdresser: 'Kapper', beauty: 'Schoonheidssalon',
    optician: 'Opticien', florist: 'Bloemist', books: 'Boeken', chemist: 'Drogist', mobile_phone: 'Telefoons', jewelry: 'Juwelier', furniture: 'Meubels', hardware: 'IJzerwaren',
    doityourself: 'Bouwmarkt', bicycle: 'Fietsen', car: "Auto's", car_repair: 'Garage', electronics: 'Elektronica', gift: 'Cadeaus', toys: 'Speelgoed', pet: 'Dierenwinkel',
    sports: 'Sport', variety_store: 'Budgetwinkel', department_store: 'Warenhuis', kiosk: 'Kiosk', tobacco: 'Tabak', tattoo: 'Tattoo', laundry: 'Wasserette', dry_cleaning: 'Stomerij',
    travel_agency: 'Reisbureau', museum: 'Museum', artwork: 'Kunstwerk', gallery: 'Galerie', attraction: 'Bezienswaardigheid', viewpoint: 'Uitzicht', theatre: 'Theater',
    cinema: 'Bioscoop', arts_centre: 'Cultuurcentrum', library: 'Bibliotheek', hotel: 'Hotel', guest_house: 'B&B / pension', hostel: 'Hostel', apartment: 'Appartement', motel: 'Motel',
    yes: 'Winkel', second_hand: 'Tweedehands', charity: 'Kringloop', massage: 'Massage', cosmetics: 'Cosmetica', perfumery: 'Parfumerie', bag: 'Tassen', fabric: 'Stoffen', interior_decoration: 'Woonaccessoires',
    computer: 'Computers', music: 'Muziek', musical_instrument: 'Muziekinstrumenten', photo: 'Foto', stationery: 'Kantoorartikelen', garden_centre: 'Tuincentrum', paint: 'Verf',
    kitchen: 'Keukens', bed: 'Bedden', lighting: 'Verlichting', medical_supply: 'Zorgwinkel', hearing_aids: 'Hoortoestellen', funeral_directors: 'Uitvaart', copyshop: 'Kopieerwinkel',
  };
  const subLabel = s => SUB[s] || (s ? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '');
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], DAYNL = { Mo: 'ma', Tu: 'di', We: 'wo', Th: 'do', Fr: 'vr', Sa: 'za', Su: 'zo', PH: 'feestdagen', off: 'dicht' };

  // ---------- Openingstijden (eenvoudige OSM-notatie) → open / dicht / onbekend ----------
  function openNow(spec, now = new Date()) {
    if (!spec) return null;
    if (/^\s*24\/7\s*$/.test(spec)) return true;
    const day = (now.getDay() + 6) % 7, min = now.getHours() * 60 + now.getMinutes();
    let result = null;
    for (const rule of spec.split(';').map(s => s.trim()).filter(Boolean)) {
      const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)+)?\s*(.*)$/);
      if (!m) return null;
      let days = new Set(DAYS.map((_, i) => i));
      if (m[1]) {
        days = new Set();
        for (const part of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
          const [a, b] = part.split('-').map(d => DAYS.indexOf(d));
          if (b === undefined) days.add(a); else for (let k = a; ; k = (k + 1) % 7) { days.add(k); if (k === b) break; }
        }
      } else if (/^(PH|SH|\w+\s)/.test(m[2]) && !/^\d/.test(m[2])) continue; // feestdagen e.d. overslaan
      const times = m[2].trim();
      const yesterday = (day + 6) % 7;
      if (/^(off|closed)$/.test(times)) { if (days.has(day)) result = false; continue; }
      if (!/^\d/.test(times)) return null;
      let open = false;
      for (const r of times.split(',')) {
        const t = r.trim().match(/^(\d\d):(\d\d)-(\d\d):(\d\d)\+?$/);
        if (!t) return null;
        const a = +t[1] * 60 + +t[2], b = +t[3] * 60 + +t[4];
        if (b > a) { if (days.has(day) && min >= a && min < b) open = true; }
        else { if ((days.has(day) && min >= a) || (days.has(yesterday) && min < b)) open = true; } // over middernacht
      }
      if (days.has(day) || days.has(yesterday)) result = open || (result === true && !days.has(day));
    }
    return result;
  }
  const hoursNL = s => esc(s).replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH|off)\b/g, d => DAYNL[d]).replace(/;\s*/g, '<br>');

  // ---------- Toestand ----------
  const state = {
    on: new Set(store.get('h3d.cats', ['koffie', 'eten', 'drinken', 'mijn'])),
    pins: store.get('h3d.pins.v1', []),
    sel: null,
    openOnly: store.get('h3d.openonly', false),
  };
  const savePins = () => store.set('h3d.pins.v1', state.pins);
  const saveCats = () => store.set('h3d.cats', [...state.on]);

  // ---------- Categorieknoppen ----------
  function renderChips() {
    const counts = {};
    for (const p of H3D.places) counts[p.cat] = (counts[p.cat] || 0) + 1;
    counts.mijn = state.pins.length;
    const vis = Object.entries(CATS).filter(([, c]) => !c.hidden), on = vis.filter(([k]) => state.on.has(k));
    $('g-plek').querySelector('small').textContent = on.length ? on.map(([, c]) => c.icon).join('') : '';
    $('chipl').innerHTML = Object.entries(CATS).filter(([, c]) => !c.hidden).map(([k, c]) =>
      `<button class="chip${state.on.has(k) ? ' on' : ''}" data-cat="${k}" style="--c:${c.color}${c.dark ? ';--t:#1d1a16' : ''}" title="${c.label} tonen/verbergen"><span>${c.icon}</span>${c.label}<small>${counts[k] || 0}</small></button>`).join('');
  }
  $('chipl').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    const k = b.dataset.cat;
    if (state.on.has(k)) state.on.delete(k); else state.on.add(k);
    saveCats(); renderChips(); rebuildPins();
    if (state.on.has(k)) showList(k);
  });

  // ---------- Plekken op de kaart: het pand licht op (app.js setMarks); hier alleen namen + bolletjes ----------
  // Gekoppeld aan een pand → naam boven het dak als je dichtbij bent. Geen pand gevonden → klein gekleurd bolletje.
  const pinEls = new Map(); // sleutel → { el, item, at }
  const key = it => it.cat === 'mijn' ? 'm' + it.id : it.cat === 'lm' ? 'l' + it.id : 'p' + it.k;
  const colorOf = it => it.cat === 'mijn' ? it.color || CATS.mijn.color : CATS[it.cat].color;
  const isShut = it => state.openOnly && it.cat !== 'mijn' && it.cat !== 'lm' && openNow(it.hours) === false;
  let lms = null; // bekende gebouwen uit data/layers.js
  const landmarks = () => lms ||= (H3D.layerData?.landmarks || []).map(([id, name, x, y, txt, wiki]) => ({ cat: 'lm', id, name, x, y, txt, wiki }));
  function allItems() {
    const mine = state.pins.map(p => ({ ...p, cat: 'mijn' }));
    return [...H3D.places, ...mine, ...landmarks()];
  }
  function rebuildPins() {
    const want = new Map(), sk = state.sel && key(state.sel);
    // voorrang bij meerdere plekken in één pand: geselecteerd, eigen pins, dan categorievolgorde
    // bekend gebouw gaat voor; dichte plekken (filter "nu open") achteraan en grijs
    const order = Object.keys(CATS), rank = it => key(it) === sk ? -3 : it.cat === 'lm' ? -2 : it.cat === 'mijn' ? -1 : order.indexOf(it.cat) + (isShut(it) ? 20 : 0);
    const lmOn = H3D.layerOn('gebouwen');
    for (const it of allItems()) if ((it.cat === 'lm' ? lmOn : state.on.has(it.cat)) || key(it) === sk || inWijk(it)) want.set(key(it), it);
    const list = [...want.values()].sort((a, b) => rank(a) - rank(b));
    H3D.setMarks(list.map(it => ({ key: key(it), x: it.x, y: it.y, color: isShut(it) ? SHUT : colorOf(it) })));
    for (const [k, p] of pinEls) if (!want.has(k)) { p.el.remove(); pinEls.delete(k); }
    for (const [k, it] of want) {
      let p = pinEls.get(k);
      if (!p) {
        const el = document.createElement('button');
        el.className = 'pin'; el.type = 'button';
        el.addEventListener('click', e => { e.stopPropagation(); openItem(pinEls.get(k).item, { fly: false }); });
        el.style.display = 'none';
        $('pins').appendChild(el);
        p = { el, hidden: true }; pinEls.set(k, p);
      }
      p.item = it; p.at = null;
      const c = it.cat === 'mijn' ? CATS.mijn : CATS[it.cat];
      p.el.style.setProperty('--c', isShut(it) ? SHUT : colorOf(it));
      p.el.classList.toggle('shut', isShut(it)); p.el.classList.toggle('lm', it.cat === 'lm');
      p.el.innerHTML = it.cat === 'lm' ? `<s class="flag"><u></u></s><i></i><em>${esc(it.name)}</em>` : `<i></i><em><b>${c.icon}</b>${esc(it.name)}</em>`;
      p.el.title = it.name;
    }
    markSelected(); H3D.redraw();
  }
  H3D.on('marks', () => { for (const p of pinEls.values()) p.at = null; H3D.redraw(); });
  const v3 = new THREE.Vector3();
  function placePins() {
    const cam = H3D.camera(), W = innerWidth, Hh = innerHeight, cp = cam.position, sk = state.sel && key(state.sel);
    for (const [k, p] of pinEls) {
      if (!p.at) p.at = H3D.markAt(k);
      const hide = () => { if (!p.hidden) { p.el.style.display = 'none'; p.hidden = true; } };
      if (!p.at) { hide(); continue; }
      v3.copy(p.at.w); v3.y += p.at.linked ? 2 : 1;
      const d = v3.distanceTo(cp) * H3D.lens();
      v3.project(cam);
      if (v3.z > 1 || v3.z < -1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1 || d > 9000) { hide(); continue; }
      if (p.hidden) { p.el.style.display = ''; p.hidden = false; }
      const sx = (v3.x + 1) / 2 * W, sy = (1 - v3.y) / 2 * Hh;
      p.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      p.el.style.zIndex = String(10000 - Math.round(d / 2));
      p.el.classList.toggle('roof', p.at.linked);
      p.sx = sx; p.sy = sy; p.d = d; p.near = d < (p.item.cat === 'lm' ? 4000 : 650) || k === sk;
    }
    // namen: geselecteerd en dichtstbij eerst, overlappende weglaten
    const boxes = [], list = [...pinEls.entries()].filter(([, p]) => !p.hidden && p.near).sort(([ka, a], [kb, b]) => (ka === sk ? -1 : a.d) - (kb === sk ? -1 : b.d));
    for (const p of pinEls.values()) if (p.hidden || !p.near) p.el.classList.remove('named');
    for (const [, p] of list) {
      const w = 34 + (p.item.name || '').length * 7, b = [p.sx - w / 2, p.sy - 30, p.sx + w / 2, p.sy - 6];
      const free = !boxes.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      p.el.classList.toggle('named', free);
      if (free) boxes.push(b);
    }
    H3D.pinBoxes = boxes; // labels.js: pins gaan voor
  }
  function markSelected() {
    for (const [k, p] of pinEls) p.el.classList.toggle('sel', !!state.sel && key(state.sel) === k);
  }

  // ---------- Afstand t.o.v. het midden van het beeld ----------
  const distTo = it => { const [x, y] = H3D.target(); return Math.hypot(it.x - x, it.y - y); };
  const fmtD = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;

  // ---------- Infokaartje ----------
  let bagTok = 0; // elk nieuw kaartje ophogen → laat binnenkomende BAG-data overschrijft niets
  function card(html) { bagTok++; $('card').innerHTML = `<button class="x" id="cardx" title="Sluiten">×</button>${html}`; $('card').hidden = false; }
  function closeCard() { bagTok++; if (tour.on) setTour(false); $('card').hidden = true; state.sel = null; markSelected(); H3D.clearSelection(); rebuildPins(); }
  $('card').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (e.target.id === 'cardx') return closeCard();
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'fly') H3D.flyTo(+b.dataset.x, +b.dataset.y, { dist: 260 });
    if (act === 'pin') editPin({ x: +b.dataset.x, y: +b.dataset.y, name: b.dataset.name || '', ref: b.dataset.ref || '' });
    if (act === 'edit') editPin(state.pins.find(p => p.id === b.dataset.id));
    if (act === 'del') { state.pins = state.pins.filter(p => p.id !== b.dataset.id); savePins(); renderChips(); closeCard(); }
  });
  function openItem(it, { fly = true } = {}) {
    state.sel = it;
    rebuildPins(); requestAnimationFrame(() => H3D.selectMark(key(it)));
    if (fly) H3D.flyTo(it.x, it.y, { dist: 280 });
    if (it.cat === 'mijn') return cardMine(it);
    if (it.cat === 'lm') return cardLm(it);
    const c = CATS[it.cat], open = openNow(it.hours);
    const rows = [
      it.addr && `<div class="row"><b>Adres</b><span>${esc(it.addr)}</span></div>`,
      it.cuisine && `<div class="row"><b>Keuken</b><span>${esc(it.cuisine.replace(/_/g, ' ').replace(/;/g, ', '))}</span></div>`,
      it.hours && `<div class="row"><b>Open</b><span>${hoursNL(it.hours)}</span></div>`,
      it.phone && `<div class="row"><b>Telefoon</b><span><a href="tel:${esc(it.phone.replace(/\s/g, ''))}">${esc(it.phone)}</a></span></div>`,
      it.web && `<div class="row"><b>Website</b><span><a href="${esc(/^https?:/.test(it.web) ? it.web : 'https://' + it.web)}" target="_blank" rel="noopener">${esc(it.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></span></div>`,
    ].filter(Boolean).join('');
    const osm = it.osm ? `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[it.osm[0]]}/${it.osm.slice(1)}` : '';
    card(`<div class="kind" style="--c:${c.color}">${c.icon} ${esc(subLabel(it.sub))}${open === true ? ' <i class="open">nu open</i>' : open === false ? ' <i class="closed">nu dicht</i>' : ''}</div>
      <h2>${esc(it.name)}</h2>${rows}
      <div class="acts"><button data-act="fly" data-x="${it.x}" data-y="${it.y}">Vlieg erheen</button>
      <button data-act="pin" data-x="${it.x}" data-y="${it.y}" data-name="${esc(it.name)}" data-ref="${esc(it.osm)}">📍 Bewaar</button>
      ${osm ? `<a class="btn" href="${osm}" target="_blank" rel="noopener">OSM</a>` : ''}</div>`);
    rebuildPins();
  }
  function cardMine(p) {
    card(`<div class="kind" style="--c:${p.color || CATS.mijn.color}">📍 Mijn pin</div><h2>${esc(p.name || 'Zonder naam')}</h2>
      ${p.note ? `<p class="note">${esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="acts"><button data-act="fly" data-x="${p.x}" data-y="${p.y}">Vlieg erheen</button><button data-act="edit" data-id="${p.id}">Bewerken</button><button data-act="del" data-id="${p.id}" class="danger">Verwijderen</button></div>`);
    rebuildPins();
  }
  function cardLm(it) {
    const w = it.wiki && (/^https?:/.test(it.wiki) ? it.wiki : `https://${it.wiki.split(':')[0]}.wikipedia.org/wiki/${encodeURIComponent(it.wiki.split(':').slice(1).join(':').replace(/ /g, '_'))}`);
    card(`<div class="kind" style="--c:${CATS.lm.color}">◆ Bekend gebouw</div><h2>${esc(it.name)}</h2>
      <p class="note">${esc(it.txt)}</p>
      <div class="acts"><button data-act="fly" data-x="${it.x}" data-y="${it.y}">Vlieg erheen</button>
      <button data-act="pin" data-x="${it.x}" data-y="${it.y}" data-name="${esc(it.name)}">📍 Bewaar</button>
      ${w ? `<a class="btn" href="${esc(w)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}</div>`);
    rebuildPins();
  }
  const PIN_COLORS = ['#d2582a', '#ff2d2d', '#7ddc1f', '#00e5ff', '#ff00ff', '#222'];
  function editPin(p) {
    const isNew = !p.id, c0 = p.color || PIN_COLORS[0];
    card(`<div class="kind" style="--c:${c0}">📍 ${isNew ? 'Nieuwe pin' : 'Pin bewerken'}</div>
      <form id="pinform"><label>Naam<input name="name" value="${esc(p.name)}" placeholder="bv. Lekkere koffie" required></label>
      <label>Notitie<textarea name="note" rows="3" placeholder="Waarom deze plek?">${esc(p.note || '')}</textarea></label>
      <div class="colors">${PIN_COLORS.map(c => `<label style="--c:${c}"><input type="radio" name="color" value="${c}"${c === c0 ? ' checked' : ''}><i></i></label>`).join('')}</div>
      <div class="acts"><button type="submit" class="primary">Opslaan</button></div></form>`);
    const f = $('pinform');
    f.name.focus();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const d = { name: f.name.value.trim(), note: f.note.value.trim(), color: f.color.value };
      let pin;
      if (isNew) { pin = { id: Date.now().toString(36), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, ref: p.ref || '', t: new Date().toISOString(), ...d }; state.pins.push(pin); }
      else { pin = Object.assign(state.pins.find(q => q.id === p.id), d); }
      savePins(); state.on.add('mijn'); saveCats(); renderChips();
      openItem({ ...pin, cat: 'mijn' }, { fly: false });
    });
  }
  // ---------- BAG (data/bag, tools/build-bag.cjs): pas laden bij eerste klik op een pand ----------
  const BAG = { dict: null, vak: new Map(), wait: new Map() };
  const GD_NL = { woon: 'wonen', 'overige gebruiks': 'overig', gezondheidszorg: 'zorg', bijeenkomst: 'bijeenkomst', cel: 'cel (gevangenis)' };
  const gdName = k => { const s = BAG.dict?.gd[k] ?? '?'; return GD_NL[s] || s; };
  const bagScript = (src, done) => { const s = document.createElement('script'); s.src = src; s.onload = () => s.remove(); s.onerror = () => { s.remove(); done(); }; document.head.appendChild(s); };
  H3D.bagDict = d => { BAG.dict = d; BAG.wait.get('dict')?.(); };
  H3D.bag = (i, j, d) => { BAG.vak.set(i + '_' + j, d); BAG.wait.get(i + '_' + j)?.(); };
  const bagGet = (k, src) => BAG.wait.has(k + '?') ? BAG.wait.get(k + '?') : (BAG.wait.set(k + '?', new Promise(res => { const ok = () => { BAG.wait.delete(k); res(); }; BAG.wait.set(k, ok); bagScript(src, ok); })), BAG.wait.get(k + '?'));
  const bagLoad = (i, j) => Promise.all([BAG.dict || bagGet('dict', 'data/bag/bag-dict.js'), bagGet(i + '_' + j, `data/bag/b_${i}_${j}.js`)]).then(() => BAG.vak.get(i + '_' + j) || null);
  const bagOf = (v, b) => !v || !BAG.dict || v.h !== b.h ? null : v.p[b.b] || {}; // controlegetal anders = vakken nieuwer dan BAG-data → niets tonen
  H3D.on('pick', hit => {
    if (!hit) { if (!$('card').hidden && !document.getElementById('pinform')) closeCard(); return; }
    if (hit.type === 'halte') { state.sel = null; markSelected(); return openBoard(hit); }
    if (hit.type === 'pand' && hit.marks?.length) { // opgelicht pand: plek(ken) erin tonen
      const items = hit.marks.map(k => pinEls.get(k)?.item).filter(Boolean);
      if (items.length === 1) return openItem(items[0], { fly: false });
      if (items.length > 1) {
        state.sel = null; markSelected();
        card(`<div class="kind" style="--c:#6b6b6b">🏠 In dit pand</div><h2>${items.length} plekken</h2>
          <div class="near">${items.map(p => { const c = p.cat === 'mijn' ? CATS.mijn : CATS[p.cat]; return `<button class="res" data-key="${key(p)}"><span style="--c:${colorOf(p)}">${c.icon}</span>${esc(p.name)}</button>`; }).join('')}</div>`);
        return;
      }
    }
    state.sel = null; markSelected();
    const pinBtn = `<button data-act="pin" data-x="${hit.x.toFixed(1)}" data-y="${hit.y.toFixed(1)}">📍 Pin hier</button>`;
    // plekken vlakbij (binnen 25 m)
    const near = H3D.places.filter(p => Math.hypot(p.x - hit.x, p.y - hit.y) < 25).sort((a, b) => Math.hypot(a.x - hit.x, a.y - hit.y) - Math.hypot(b.x - hit.x, b.y - hit.y)).slice(0, 4);
    const nearHtml = near.length ? `<div class="near"><b>Hier zit</b>${near.map(p => `<button class="res" data-k="${p.k}"><span style="--c:${CATS[p.cat].color}">${CATS[p.cat].icon}</span>${esc(p.name)}</button>`).join('')}</div>` : '';
    if (hit.type === 'pand') {
      const b = hit.info; let tok = ++bagTok;
      const draw = bag => { // bag: undefined = laden, null = geen/verouderde data, anders info van dit pand ({} = pand zonder adressen)
        if (tok !== bagTok) return; // intussen ander pand/kaartje
        const a = bag?.a || [], first = a[0] && `${a[0][0]} ${a[0][2].split(',')[0]}`;
        const bagRows = bag === undefined ? `<div class="row"><b>Adressen</b><span class="dim">laden…</span></div>`
          : !bag ? '' : [
            `<div class="row"><b>Adressen</b><span>${a.length ? a.slice(0, 6).map(([s, pc, nrs]) => `${esc(s)} ${esc(nrs)}<small> ${esc(pc)}</small>`).join('<br>') + (a.length > 6 ? `<br><small>+ ${a.length - 6} straten meer</small>` : '') : '<span class="dim">geen (bijgebouw)</span>'}</span></div>`,
            bag.n > 1 && `<div class="row"><b>Aantal</b><span>${bag.n} adressen/eenheden</span></div>`,
            bag.g?.length && `<div class="row"><b>Gebruik</b><span>${bag.g.map(gdName).join(', ')}</span></div>`,
            bag.m && `<div class="row"><b>Oppervlak</b><span>${bag.m.toLocaleString('nl-NL')} m²</span></div>`,
            bag.mo && `<div class="row"><b>Monument</b><span>Rijksmonument ${esc(bag.mo[0])}${bag.mo[1] ? ` · ${esc(bag.mo[1])}` : ''}<br><a href="https://monumentenregister.cultureelerfgoed.nl/monumenten/${encodeURIComponent(bag.mo[0])}" target="_blank" rel="noopener">Monumentenregister</a></span></div>`,
          ].filter(Boolean).join('');
        const plaats = bag?.pl != null && BAG.dict?.pl[bag.pl];
        card(`<div class="kind" style="--c:${bag?.mo ? '#a0743a' : '#6b6b6b'}">${bag?.mo ? '🏛 Rijksmonument' : '🏠 Pand'}${plaats ? ` · ${esc(plaats)}` : ''}</div>
          <h2>${first ? esc(first) : b.year ? `Gebouwd in ${b.year}` : 'Gebouw'}</h2>
          ${first && b.year ? `<div class="row"><b>Bouwjaar</b><span>${b.year}</span></div>` : ''}${bagRows}
          <div class="row"><b>Hoogte</b><span>${b.height.toFixed(1).replace('.', ',')} m${b.floors ? ` · ${b.floors} bouwlagen` : ''}</span></div>
          <div class="row"><b>Grond</b><span>${hit.h.toFixed(0)} m boven NAP</span></div>${nearHtml}
          <div class="acts">${pinBtn}<a class="btn" href="https://bagviewer.kadaster.nl/lvbag/bag-viewer/?objectId=${b.id}" target="_blank" rel="noopener">BAG-viewer</a></div>`);
        tok = bagTok; // card() hoogde op; 2e aanroep (data binnen) mag dit kaartje vervangen
      };
      const v = BAG.vak.get(b.ci + '_' + b.cj);
      if (v && BAG.dict) draw(bagOf(v, b)); else { draw(undefined); bagLoad(b.ci, b.cj).then(v => draw(bagOf(v, b))); }
    } else {
      card(`<div class="kind" style="--c:#6b6b6b">🌍 Plek</div><h2>${hit.h.toFixed(0)} m boven NAP</h2>${nearHtml}<div class="acts">${pinBtn}</div>`);
    }
  });
  // ---------- Vertrekbord (iso/traffic.js, data/transit.js): ververst zolang het kaartje open is ----------
  let boardT = 0;
  const hhmm = s => { s = ((Math.round(s / 60) % 1440) + 1440) % 1440; return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  function openBoard(hit) {
    clearInterval(boardT);
    let tok = 0;
    const draw = () => {
      if (!H3D.transit) return;
      const L = H3D.transit.departures(hit.g, H3D.now(), 10), tr = hit.k === 1;
      const rows = L.length ? L.map(d => `<div class="dep"><span>${hhmm(d.at)}</span><span class="ln" style="--c:${d.col}">${esc(d.ref || (d.k === 'train' ? 'trein' : 'bus'))}</span><span class="hd">${esc(d.head || d.name)}</span><span class="w${d.w < 60 ? ' nu' : ''}">${d.w < 60 ? 'nu' : Math.round(d.w / 60) + ' min'}</span></div>`).join('')
        : '<div class="none">Geen vertrekken in de komende 4 uur.</div>';
      const keep = $('card').scrollTop;
      card(`<div class="kind" style="--c:${tr ? '#2c5d8f' : '#b88a12'}">${tr ? '🚆 Station' : '🚌 Bushalte'}</div><h2>${esc(hit.name)}</h2><div class="board">${rows}</div>
        <p class="hint">Volgens de dienstregeling (${esc(H3D.transit.src || 'OVapi')}), zonder live vertraging.</p>`);
      $('card').scrollTop = keep; tok = bagTok; // card() hoogt bagTok op: ander kaartje geopend → tok klopt niet meer → stoppen
    };
    draw();
    boardT = setInterval(() => { if ($('card').hidden || bagTok !== tok) return clearInterval(boardT); draw(); }, 2000);
  }

  $('card').addEventListener('click', e => {
    const r = e.target.closest('.res[data-k]'); if (r) return openItem(H3D.places[+r.dataset.k], { fly: false });
    const q = e.target.closest('.res[data-key]'); if (q) { const it = allItems().find(p => key(p) === q.dataset.key); if (it) openItem(it, { fly: false }); }
  });

  // ---------- Zoeken: plekken (lokaal) + adressen/straten (PDOK Locatieserver) ----------
  const q = $('q'), res = $('results');
  let addrT = 0, addrTok = 0, lastList = [], nameHit = true;
  function catOf(text) { const t = norm(text).trim(); return Object.entries(CATS).find(([, c]) => c.words.includes(t))?.[0]; }
  // bouwjaar in de zoekvraag: "jaren 30 huis", "jaren 1960", "30s", "1930-1939", "1920 tot 1940", "bouwjaar 1925", "van voor 1900", "na 2010"
  function eraOf(text) {
    const t = norm(text), Y = 2030;
    let m = t.match(/(1[5-9]\d\d|20[0-3]\d)\s*(?:-|–|tot|t\/m|tm)\s*(1[5-9]\d\d|20[0-3]\d)/); if (m) { const a = +m[1], b = +m[2]; return [Math.min(a, b), Math.max(a, b), `${Math.min(a, b)}–${Math.max(a, b)}`]; }
    m = t.match(/jaren\s*'?(\d{2}|\d{4})\b/) || t.match(/\b'?(\d{2}|1[5-9]\d0|20[0-3]0)s\b/);
    if (m) { let d = +m[1]; if (d < 100) d = d === 0 || d === 10 ? 2000 + d : 1900 + d; d -= d % 10; return [d, d + 9, `jaren ${String(d).slice(d < 2000 ? 2 : 0)} (${d}–${d + 9})`]; }
    m = t.match(/\b(?:van\s+)?voor\s+(1[5-9]\d\d|20[0-3]\d)\b/); if (m) return [1000, +m[1] - 1, `van vóór ${m[1]}`];
    m = t.match(/\b(?:na|vanaf|sinds)\s+(1[5-9]\d\d|20[0-3]\d)\b/); if (m) return [+m[1] + (/na/.test(m[0]) ? 1 : 0), Y, `${/na/.test(m[0]) ? 'na' : 'vanaf'} ${m[1]}`];
    m = t.match(/\b(?:bouwjaar|gebouwd(?:\s+in)?|uit|in)\s+(1[5-9]\d\d|20[0-3]\d)\b/); if (m) return [+m[1], +m[1], `bouwjaar ${m[1]}`];
    return null;
  }
  let eraHead = '', eraHit = null;
  function search(text) {
    const t = norm(text).trim(), words = t.split(/\s+/).filter(Boolean);
    eraHit = t ? eraOf(text) : null;
    eraHead = eraHit ? `<button class="res" data-era="1"><span style="--c:#d9822b">🏠</span><b>Panden ${esc(eraHit[2])}</b><small>Bouwjaar uit 3D BAG · licht ze op in de kaart</small><em>${H3D.countEra(eraHit[0], eraHit[1]).toLocaleString('nl-NL')}</em></button>` : '';
    if (!t) { res.innerHTML = ''; res.hidden = true; return; }
    const cat = catOf(text);
    if (cat) return showList(cat);
    const scored = [];
    for (const it of allItems()) {
      const n = norm(it.name);
      let s = 0;
      if (n.startsWith(t)) s += 4; else if (n.includes(t)) s += 3;
      const hay = n + ' ' + norm(subLabel(it.sub)) + ' ' + norm(it.cuisine) + ' ' + norm(it.addr) + ' ' + norm(it.note);
      if (words.every(w => hay.includes(w))) s += 1.5;
      if (s) scored.push([s - distTo(it) / 20000, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    lastList = scored.slice(0, 8).map(x => x[1]);
    nameHit = scored.some(x => x[0] >= 2.5);
    renderResults(lastList, [], null);
    clearTimeout(addrT);
    if (t.length >= 3) addrT = setTimeout(() => addresses(text), 280);
  }
  async function addresses(text) {
    const tok = ++addrTok;
    try {
      const u = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(text)}&fq=gemeentenaam:(${gemQ()})&fq=type:(adres OR weg OR buurt OR wijk OR woonplaats OR postcode)&rows=6&fl=weergavenaam,type,centroide_rd`;
      const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (tok !== addrTok) return;
      const list = d.response.docs.map(o => { const m = o.centroide_rd.match(/POINT\(([\d.]+) ([\d.]+)\)/); return { name: o.weergavenaam, type: o.type, x: +m[1], y: +m[2] }; });
      renderResults(lastList, list, null);
    } catch { /* offline: alleen lokale treffers */ }
  }
  const TYPE_NL = { adres: 'Adres', weg: 'Straat', buurt: 'Buurt', wijk: 'Wijk', woonplaats: 'Plaats', postcode: 'Postcode' };
  let shownAddr = [];
  function renderResults(items, addr, head) {
    shownAddr = addr;
    const it = items.map(p => {
      const c = p.cat === 'mijn' ? { ...CATS.mijn, color: p.color || CATS.mijn.color } : CATS[p.cat], o = openNow(p.hours);
      return `<button class="res" data-key="${key(p)}"><span style="--c:${c.color}">${c.icon}</span><b>${esc(p.name)}</b>
        <small>${esc(p.cat === 'mijn' ? 'Mijn pin' : subLabel(p.sub))}${o === true ? ' · <i class="open">open</i>' : o === false ? ' · <i class="closed">dicht</i>' : ''}</small><em>${fmtD(distTo(p))}</em></button>`;
    }).join('');
    const ad = addr.map((a, i) => `<button class="res" data-addr="${i}"><span style="--c:#777">⌖</span><b>${esc(a.name.replace(/, Heerlen$/, ''))}</b><small>${TYPE_NL[a.type] || a.type}</small><em>${fmtD(distTo(a))}</em></button>`).join('');
    const adBlock = ad ? `<div class="sep">Adressen en straten</div>${ad}` : '';
    const body = !it && !ad ? `<div class="empty">Niets gevonden in ${gemNames().join(' of ')}</div>` : !head && !nameHit ? adBlock + (it ? `<div class="sep">Plekken</div>${it}` : '') : it + adBlock;
    res.innerHTML = (head || '') + (head ? '' : eraHead) + body;
    res.hidden = false;
  }
  function showList(cat) {
    const c = CATS[cat], list = allItems().filter(p => p.cat === cat).sort((a, b) => distTo(a) - distTo(b));
    const onlyOpen = state.openOnly && cat !== 'mijn';
    const shown = (onlyOpen ? list.filter(p => openNow(p.hours) === true) : list).slice(0, 60);
    lastList = shown;
    if (!state.on.has(cat)) { state.on.add(cat); saveCats(); renderChips(); rebuildPins(); }
    renderResults(shown, [], `<div class="listhead"><b style="color:${c.color}">${c.icon} ${c.label}</b> <small>${list.length} · dichtbij eerst</small>
      ${cat !== 'mijn' ? `<label class="oo"><input type="checkbox" id="openonly"${onlyOpen ? ' checked' : ''} data-cat="${cat}"> nu open</label>` : ''}</div>`);
  }
  q.addEventListener('input', () => search(q.value));
  q.addEventListener('focus', () => { if (q.value) search(q.value); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Escape') { q.value = ''; search(''); q.blur(); }
    if (e.key === 'Enter') res.querySelector('.res')?.click();
  });
  $('qx').addEventListener('click', () => { q.value = ''; search(''); q.focus(); });
  // dichtgeklapt zoeken: vergrootglas → balk; dicht bij verlaten als hij leeg is en er geen lijst open staat
  const sbox = $('search');
  const openSearch = () => { sbox.classList.add('open'); q.focus(); };
  $('qopen').addEventListener('click', openSearch);
  q.addEventListener('blur', () => setTimeout(() => { if (!q.value && res.hidden && !sbox.contains(document.activeElement)) sbox.classList.remove('open'); }, 150));
  new MutationObserver(() => { if (!res.hidden) sbox.classList.add('open'); }).observe(res, { attributes: true, attributeFilter: ['hidden'] }); // categorie-lijst opent de balk mee
  res.addEventListener('change', e => { if (e.target.id === 'openonly') { setOpenOnly(e.target.checked); showList(e.target.dataset.cat); } });
  // ---------- Filter "nu open": dichte plekken grijs op de kaart (lijst: alleen open) ----------
  const openBtn = $('openf'), showOpen = () => openBtn.classList.toggle('on', state.openOnly);
  function setOpenOnly(on) { state.openOnly = !!on; store.set('h3d.openonly', state.openOnly); showOpen(); rebuildPins(); }
  openBtn.addEventListener('click', () => { setOpenOnly(!state.openOnly); const oo = $('openonly'); if (oo && !res.hidden) showList(oo.dataset.cat); });
  showOpen();
  setInterval(() => { if (state.openOnly) rebuildPins(); }, 60000); // tijd loopt door
  // ---------- Lagen aan/uit ----------
  const LAYERS = { straten: 'Straatnamen', wijken: 'Wijken en stations', water: 'Water', spoor: 'Spoor', wegen: 'Wegen', bomen: 'Bossen', gebouwen: '◆ Bekende gebouwen' };
  $('layers').innerHTML = Object.entries(LAYERS).map(([k, l]) => `<label><input type="checkbox" data-layer="${k}"${H3D.layerOn(k) ? ' checked' : ''}> ${l}</label>`).join('');
  $('layers').addEventListener('change', e => { const k = e.target.dataset.layer; if (k) { H3D.setLayer(k, e.target.checked); showCounts(); } });
  // ---------- Effecten: menu's Sfeer (licht + wolken, lucht, randen) en Stad (verkeer, meubilair, schaduw, diorama) ----------
  const FX = { // naam, icoon, kosten 1–3, uitleg
    wolken: ['Wolkschaduw', '☁', 2, '±1,3 ms per beeld'], lucht: ['Ballon en vogels', '🎈', 1, 'af en toe iets in de lucht'], randen: ['Zachte randen', '◎', 3, '±2,1 ms per beeld · toets T'],
    zuinig: ['Zuinig', '🍃', 0, 'animaties 10/s i.p.v. 20/s, water stil, geen contactschaduw, scherpte 1× — rustiger voor laptop/accu'],
    inkt: ['Inktlijnen', '✒', 0, 'iso: volle donkere lijn om panden en vouwen i.p.v. een dunne silhouetlijn'], film: ['Filmisch licht', '🎞', 2, 'iso: lagere zon, filmische kleuren, gloed op glans en glas, waas in de verte (zwaarder voor de GPU)'], bouwjaar: ['Daken op bouwjaar', '🏠', 0, 'oud = rode pannen, jaren 40–70 = oranje, nieuw = antraciet; gevels baksteen of licht (uit = Mijnstreek-palet)'],
    verkeer: ['Bussen en treinen', '🚌', 1, '±0,2 ms per beeld'], props: ['Straatmeubilair', '🌳', 2, 'straatbomen, lantaarns, bankjes'], ao: ['Contactschaduw', '◐', 1, 'één keer gebakken, daarna bijna gratis'], diorama: ['Diorama-rand', '▱', 1, 'aardlagen langs de gemeentegrens'],
  };
  const GRP = { sfeer: ['wolken', 'lucht', 'randen'], stad: ['verkeer', 'props', 'ao', 'diorama'] };
  const FXK_ALL = [...GRP.sfeer, ...GRP.stad];
  const fxRow = k => { const [n, ic, c, t] = FX[k]; return `<label title="${t}"><span class="ic">${ic}</span>${n}<span class="cost">${c ? [1, 2, 3].map(i => `<i class="${i <= c ? 'f' : ''}"></i>`).join('') : ''}</span><input type="checkbox" class="sw" data-fx="${k}"${H3D.fxOn(k) ? ' checked' : ''}></label>`; };
  const LIGHTS = { dag: '☀ Dag', schemer: '🌇 Schemer', avond: '🌙 Nacht', nu: '🕒 Nu' };
  const SEASONS = { lente: '🌸 Lente', zomer: '🌳 Zomer', herfst: '🍂 Herfst', winter: '❄ Winter' };
  const sfeer = $('g-sfeer').querySelector('div'), stad = $('g-stad').querySelector('div');
  sfeer.innerHTML = `<h4>Licht</h4><div class="lseg">${Object.entries(LIGHTS).map(([k, l]) => `<button data-light="${k}">${l}</button>`).join('')}</div><h4>Seizoen</h4><div class="lseg">${Object.entries(SEASONS).map(([k, l]) => `<button data-season="${k}">${l}</button>`).join('')}</div><h4>Stijl</h4>${fxRow('film')}${fxRow('inkt')}${fxRow('bouwjaar')}<div class="sep2"></div><h4>Effecten</h4>${GRP.sfeer.map(fxRow).join('')}<div class="sep2"></div>${fxRow('zuinig')}`;
  const gemRow = g => `<label title="${g} laden (±50% meer vakken); omzetten herlaadt de pagina"><span class="ic">▦</span>${g} tonen<span class="cost">${[1, 2, 3].map(i => `<i class="${i <= 3 ? 'f' : ''}"></i>`).join('')}</span><input type="checkbox" data-gem="${g}"${H3D.gemOn(g) ? ' checked' : ''}></label>`;
  stad.innerHTML = GRP.stad.map(fxRow).join('') + '<p class="hint">Contactschaduw wordt één keer gebakken (±10 s), daarna bijna gratis.</p>'
    + (H3D.gemParts?.().length ? '<h4>Gebied</h4>' + H3D.gemParts().map(gemRow).join('') + '<p class="hint">Uit = lichter (minder geheugen en GPU). Omzetten herlaadt de kaart.</p>' : '');
  stad.addEventListener('change', e => { const g = e.target.dataset?.gem; if (g) H3D.setGem(g, e.target.checked); });
  const showLight = () => sfeer.querySelectorAll('[data-light]').forEach(b => b.classList.toggle('on', b.dataset.light === H3D.getLight()));
  const showSeason = () => sfeer.querySelectorAll('[data-season]').forEach(b => b.classList.toggle('on', b.dataset.season === H3D.getSeason?.()));
  sfeer.addEventListener('click', e => { const b = e.target.closest('[data-light]'); if (b) { H3D.setLight(b.dataset.light); showLight(); } const z = e.target.closest('[data-season]'); if (z) { H3D.setSeason(z.dataset.season); showSeason(); } });
  showLight(); showSeason(); H3D.on('light', showLight); // klok versnellen zet licht op 'nu'
  function showCounts() {
    const n = (keys, on) => keys.filter(on).length + '/' + keys.length;
    $('g-kaart').querySelector('small').textContent = n(Object.keys(LAYERS), H3D.layerOn);
    for (const g in GRP) $('g-' + g).querySelector('small').textContent = n(GRP[g], H3D.fxOn);
    const all = Object.keys(LAYERS).filter(H3D.layerOn).length + FXK_ALL.filter(H3D.fxOn).length; // samen op de ene knop
    $('g-view').querySelector('summary small').textContent = all + '/' + (Object.keys(LAYERS).length + FXK_ALL.length);
  }
  document.addEventListener('change', e => { const k = e.target.dataset?.fx; if (k) H3D.setFx(k, e.target.checked); });
  // Zuinig voorstellen: bij trage beelden (app.js 'slow') of op de accu; één keer, 'nee' = nooit meer (h3d.zuinig.nee)
  const askZuinig = why => {
    try { if (localStorage.getItem('h3d.zuinig.nee') || H3D.fxOn('zuinig') || document.getElementById('zask')) return; } catch { return; }
    const d = document.createElement('div'); d.id = 'zask';
    d.innerHTML = `<span>🍃 ${why} Zuinig aanzetten? Rustiger beeld, minder stroom.</span><button data-z="1">Ja</button><button data-z="0">Nee</button>`;
    d.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.z === '1') H3D.setFx('zuinig', 1); else try { localStorage.setItem('h3d.zuinig.nee', '1'); } catch {} d.remove(); };
    document.body.appendChild(d); setTimeout(() => d.remove(), 20000);
  };
  H3D.on('slow', fps => askZuinig(`De kaart loopt wat stroef (±${fps} beelden/s).`));
  H3D.on('loaded', () => navigator.getBattery?.().then(b => { if (!b.charging) askZuinig('Je laptop draait op de accu.'); }).catch(() => {}));
  H3D.on('fx', (k, on) => { const i = document.querySelector(`[data-fx="${k}"]`); if (i) i.checked = on; showCounts(); });
  showCounts();
  // één groep tegelijk open; klik ernaast sluit
  const grps = [...document.querySelectorAll('.grp')];
  grps.forEach(d => d.addEventListener('toggle', () => { if (d.open) grps.forEach(o => o !== d && o.removeAttribute('open')); }));
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.grp')) grps.forEach(d => d.removeAttribute('open')); });
  H3D.on('layer', k => { if (k === 'gebouwen') rebuildPins(); });
  // ontwerppagina's (design/18_bekende-gebouwen.html) sturen de app in een iframe: stijl bekende gebouwen proberen (niet bewaren), naar een gebouw vliegen
  addEventListener('message', e => { const d = e.data || {}; if (d.h3d === 'lm') H3D.setLmStyle(d.v, true); if (d.h3d === 'biz') H3D.setBiz(d.v, d.fade, true); if (d.h3d === 'fly') H3D.flyTo(d.x, d.y, { dist: d.dist || 260 }); if (d.h3d === 'goto') { const it = landmarks().find(l => l.id === d.id); if (it) openItem(it); } });
  res.addEventListener('click', e => {
    const b = e.target.closest('.res'); if (!b) return;
    if (b.dataset.era) setEra(eraHit);
    else if (b.dataset.addr != null) {
      const a = shownAddr[+b.dataset.addr];
      H3D.flyTo(a.x, a.y, { dist: a.type === 'adres' ? 220 : a.type === 'weg' ? 500 : 1200 });
      card(`<div class="kind" style="--c:#777">⌖ ${TYPE_NL[a.type] || a.type}</div><h2>${esc(a.name)}</h2>
        <div class="acts"><button data-act="pin" data-x="${a.x}" data-y="${a.y}" data-name="${esc(a.name.replace(/, \d{4} ?[A-Z]{2} Heerlen$|, Heerlen$/, ''))}">📍 Pin hier</button></div>`);
    } else {
      const it = allItems().find(p => key(p) === b.dataset.key);
      if (it) openItem(it);
    }
    res.hidden = true; q.blur();
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#search')) res.hidden = true; });

  // bouwjaar-filter aan/uit: chip bij de categorieën met × ; de rest krimpt de grond in (H3D.setEra)
  let eraChip = null, eraDimmed = false;
  // ---------- Wijk aanklikken (labels.js): alle plekken in die wijk aan; nog een keer = uit ----------
  // Wijken zijn alleen OSM-namen op een punt (geen grens) → plek hoort bij de dichtstbijzijnde naam van hetzelfde niveau (binnen WIJK_R m)
  const WIJK_BIG = new Set(['suburb', 'town', 'village']), WIJK_R = { big: 2500, small: 1000 };
  let wijkChip = null;
  const lvl = p => WIJK_BIG.has(p.kind) ? 'big' : 'small';
  function inWijk(it) {
    const w = H3D.wijkOn; if (!w) return false;
    if (!w.has) { // per wijk één keer uitrekenen
      const L = lvl(w), peers = (H3D.wijkPlaces || []).filter(p => lvl(p) === L), R2 = WIJK_R[L] ** 2;
      w.has = new Set();
      for (const p of allItems()) {
        let best = null, bd = R2;
        for (const q of peers) { const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = q; } }
        if (best === w) w.has.add(key(p));
      }
    }
    return w.has.has(key(it));
  }
  function setWijk(w) {
    if (H3D.wijkOn) H3D.wijkOn.has = null;
    H3D.wijkOn = H3D.wijkOn === w ? null : w;
    wijkChip?.remove(); wijkChip = null;
    rebuildPins();
    if (H3D.wijkOn) {
      wijkChip = Object.assign(document.createElement('button'), { className: 'chip', title: 'Plekken van deze wijk weer verbergen' });
      wijkChip.style.setProperty('--c', '#7a6a55');
      wijkChip.innerHTML = `<span>📍</span>${esc(w.name)} <small>${H3D.wijkOn.has.size}</small> ×`;
      wijkChip.addEventListener('click', () => setWijk(H3D.wijkOn));
      $('chips').appendChild(wijkChip);
    }
  }
  H3D.onWijk = setWijk;

  function setEra(e) {
    const n = H3D.setEra(e ? e[0] : 0, e ? e[1] : 0);
    if (eraDimmed) { H3D.setDim(false); eraDimmed = false; showDim(); } // vroeger: dimmen; nu krimpt de rest de grond in (app.js uEra)
    eraChip?.remove(); eraChip = null;
    if (e) {
      eraChip = Object.assign(document.createElement('button'), { className: 'chip', title: 'Bouwjaar-filter uitzetten' });
      eraChip.style.setProperty('--c', '#d9822b');
      eraChip.innerHTML = `<span>🏠</span>Panden ${esc(e[2])} <small>${n.toLocaleString('nl-NL')}</small> ×`;
      eraChip.addEventListener('click', () => setEra(null));
      $('chips').appendChild(eraChip);
    }
    q.value = ''; res.hidden = true;
  }

  // ---------- Kaartstijl, weergave, kompas ----------
  function renderStyles() { // kaartstijl-knoppen zijn weg (iso tekent eigen grond); alleen de bronvermelding
    $('attr').innerHTML = `${H3D.STYLES[H3D.getStyle()].attr} · Gebouwen © <a href="https://3dbag.nl" target="_blank" rel="noopener">3D BAG</a> · Terrein AHN · Plekken © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>${window.H3D_DATA?.transit ? ' · Dienstregeling <a href="https://gtfs.ovapi.nl" target="_blank" rel="noopener">OVapi</a>' : ''} · v${H3D.VERSION}`;
  }
  const showMode = () => {}; // modusknoppen Plat/3D/Rondkijken zijn weg; iso is de enige weergave
  const dimBtn = $('dim'), showDim = () => dimBtn.classList.toggle('on', H3D.getDim());
  dimBtn.addEventListener('click', () => { H3D.setDim(!H3D.getDim()); showDim(); });
  showDim();
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => H3D.view(b.dataset.view)));

  // ---------- Rondleiding: in Rondkijken een voor een langs je pins, anders langs de dichtstbijzijnde plekken in beeld ----------
  const tour = { on: false, i: 0, list: [], t: 0 }, tourBtn = $('tour');
  function tourList() {
    if (state.pins.length) return state.pins.map(p => ({ ...p, cat: 'mijn' }));
    const [tx, ty] = H3D.target(), d = p => (p.x - tx) ** 2 + (p.y - ty) ** 2;
    return H3D.places.filter(p => state.on.has(p.cat)).sort((a, b) => d(a) - d(b)).slice(0, 8);
  }
  function tourStep() {
    if (!tour.on) return;
    const it = tour.list[tour.i % tour.list.length]; tour.i++;
    tourBtn.textContent = `■ Stop ${(tour.i - 1) % tour.list.length + 1}/${tour.list.length}`;
    openItem(it, { fly: false });
    H3D.spin(false);
    H3D.flyTo(it.x, it.y, { dist: 360, polar: 0.95, ms: 2600 });
    // even rondkijken (iso: twee kwartslagen), dan door
    if (H3D.getMode() === 'iso') tour.t = setTimeout(() => { H3D.isoTurn(1); tour.t = setTimeout(() => { H3D.isoTurn(1); tour.t = setTimeout(tourStep, 4000); }, 3500); }, 2700);
    else tour.t = setTimeout(() => { H3D.spin(true); tour.t = setTimeout(tourStep, 9000); }, 2700);
  }
  function setTour(on) {
    clearTimeout(tour.t); tour.on = on; tourBtn.classList.toggle('on', on);
    tourBtn.textContent = '▶ Rondleiding';
    if (!on) return;
    tour.list = tourList(); tour.i = 0;
    if (!tour.list.length) { tour.on = false; tourBtn.classList.remove('on'); alert('Geen pins of plekken om langs te gaan. Bewaar een plek of zet een categorie aan.'); return; }
    if (H3D.getMode() !== 'rond' && H3D.getMode() !== 'iso') { H3D.setMode('rond'); showMode(); }
    tourStep();
  }
  tourBtn.addEventListener('click', () => setTour(!tour.on));
  H3D.on('interact', () => { if (tour.on) setTour(false); }); // zelf slepen/zoomen = rondleiding stopt
  let lastAz = NaN;
  let pRef = null, pSkip = 0; // iso-pannen: pins-laag verschuiven i.p.v. elk beeld opnieuw plaatsen (zoals labels.js)
  H3D.on('still', () => { pRef = null; });
  H3D.on('frame', () => {
    const s = H3D.panShift?.(pRef), pe = $('pins');
    if (s && ++pSkip < 4) pe.style.transform = `translate(${s[0].toFixed(1)}px,${s[1].toFixed(1)}px)`;
    else { pSkip = 0; pe.style.transform = ''; placePins(); pRef = H3D.panRef?.(); }
    const az = H3D.azimuth();
    if (!(Math.abs(az - lastAz) < 1e-3)) { lastAz = az; $('needle').style.transform = `rotate(${(az * 180 / Math.PI).toFixed(1)}deg)`; }
  });

  // ---------- Mijn pins: exporteren / importeren ----------
  $('menu').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'export') {
      const blob = new Blob([JSON.stringify({ app: 'heerlen-3d', version: 1, pins: state.pins }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `heerlen-3d-pins-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    if (b.dataset.m === 'import') $('importfile').click();
  });
  $('importfile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text()), list = Array.isArray(d) ? d : d.pins || [];
      const have = new Set(state.pins.map(p => p.id)); let n = 0;
      for (const p of list) if (p && p.id && isFinite(p.x) && isFinite(p.y) && !have.has(p.id)) { state.pins.push(p); n++; }
      savePins(); state.on.add('mijn'); saveCats(); renderChips(); rebuildPins();
      alert(`${n} pin(s) toegevoegd.`);
    } catch (err) { alert('Kon het bestand niet lezen: ' + err.message); }
    e.target.value = '';
  });

  // ---------- Laden ----------
  H3D.on('progress', (n, tot) => {
    $('progress').hidden = n >= tot;
    $('progress').querySelector('i').style.width = `${(n / tot * 100).toFixed(0)}%`;
    $('progress').querySelector('span').textContent = `Kaart bouwen… ${n}/${tot} km²`;
  });
  

  document.addEventListener('DOMContentLoaded', () => {
    renderStyles(); renderChips(); rebuildPins();
    document.addEventListener('keydown', e => {
      if (e.target.closest('input,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); $('search').classList.add('open'); q.focus(); }
      else if (e.key === 'q' || e.key === 'Q') H3D.isoTurn(-1); // iso: kwartslag draaien
      else if (e.key === 'e' || e.key === 'E') H3D.isoTurn(1);
      else if (e.key === '+' || e.key === '=') H3D.zoomStep(-1);
      else if (e.key === '-' || e.key === '_') H3D.zoomStep(1);
    });
    document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => H3D.isoTurn(+b.dataset.rot)));
    document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => H3D.zoomStep(+b.dataset.zoom)));
    // klok: echte tijd, ×10/×60 (H3D.now/setSpeed in app.js); klik op de tijd = terug naar nu
    const clk = $('clock'), DAG = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
    const showClock = () => {
      const d = H3D.now(), sp = H3D.speed(), today = new Date().toDateString() === d.toDateString();
      $('clockt').textContent = `${today ? '' : DAG[d.getDay()] + ' '}${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      clk.classList.toggle('fast', sp > 1 || !today || Math.abs(d - Date.now()) > 90e3);
      clk.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === sp));
    };
    clk.addEventListener('click', e => { const b = e.target.closest('[data-speed]'); if (b) H3D.setSpeed(+b.dataset.speed); else if (e.target.id === 'clockt') H3D.setSpeed(1, true); showClock(); });
    setInterval(showClock, 250); showClock();
  });
})();
