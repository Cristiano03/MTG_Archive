// Vecchio indirizzo: il service worker si disinstalla e manda le pagine aperte al nuovo indirizzo del sito.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://mtg-commander-archive.web.app');
})()));
