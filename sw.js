// Service worker (alleen online, niet via file://): tweede bezoek laadt app + vakken uit de cache.
// Eén cache per versie; tools/publish-site.sh vervangt 85942f2d7f door een hash van de site → nieuwe versie = nieuwe cache, oude weg.
// Strategie: eigen bestanden cache-first binnen de versie (app en data altijd van dezelfde versie, nooit gemengd). Andere domeinen: ongemoeid.
const CACHE = 'h3d-85942f2d7f';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('h3d-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE), hit = await c.match(r, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(r);
    if (res.ok && res.type === 'basic') c.put(r, res.clone()).catch(() => {}); // vol = gewoon niet bewaren
    return res;
  })());
});
