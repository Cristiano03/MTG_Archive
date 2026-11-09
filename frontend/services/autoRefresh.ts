import { useEffect } from 'react';
import { api } from './api';
// Aggiornamento automatico, una volta per ogni apertura (o ricaricamento) del sito: niente pulsanti.
// Prezzi Cardmarket (via Scryfall) della collezione e dei desideri, poi la banlist se ha più di un giorno.
// Scryfall aggiorna i prezzi una volta al giorno: le stampe controllate nell'ultima ora non si riscaricano.
// Alla fine le pagine aperte ricaricano i dati (evento "prices:updated").
const MAX_AGE_H = 1;
let started: Promise<void> | null = null;
const done = () => dispatchEvent(new Event('prices:updated'));
export function refreshOnOpen() {
  return started ??= (async () => {
    await api('/prices/collection', 'POST', { maxAgeH: MAX_AGE_H }).then(done).catch(() => {});
    await api('/wishlist/prices', 'POST').then(done).catch(() => {});
    try {
      const s = await api('/stats'), last = s.banlist?.lastOk;
      if (s.activeDecks > 0 && (!last || Date.now() - new Date(last).getTime() > 24 * 3600e3)) { await api('/catalog/refresh', 'POST'); done(); }
    } catch { /* riprova alla prossima apertura */ }
  })();
}
// mazzo aperto: le sue carte (anche quelle che non sono in collezione), una volta per apertura del sito
const decks = new Set<number>();
export function refreshDeckOnce(id: number) {
  if (decks.has(id)) return Promise.resolve(false);
  decks.add(id);
  return api(`/prices/deck/${id}`, 'POST', { maxAgeH: MAX_AGE_H }).then(() => true).catch(() => false);
}
// ricarica i dati della pagina quando l'aggiornamento automatico finisce
export function usePricesUpdated(reload: () => unknown) {
  useEffect(() => { const h = () => { reload(); }; addEventListener('prices:updated', h); return () => removeEventListener('prices:updated', h); }, [reload]);
}
