// Service worker: rende l'app installabile e apre l'interfaccia anche offline.
// I DATI (Supabase, altro dominio) non vengono mai messi in cache: inventario e mazzi devono essere sempre quelli del database.
const SHELL = 'mtg-shell-v2', IMAGES = 'mtg-img-v2'; // cambiare versione forza l'aggiornamento del service worker (es. dopo un cambio della CSP)
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== IMAGES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // immagini delle carte Scryfall: prima la cache (non cambiano), massimo ~300
  if (url.hostname.endsWith('scryfall.io')) {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); c.keys().then(k => k.length > 300 && c.delete(k[0])); }
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/@')) return;
  // interfaccia: prima la rete (sempre aggiornata), la cache solo se offline
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req.mode === 'navigate' ? '/' : req)) || Response.error()));
});
