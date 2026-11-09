// Ultimi dati visti, salvati in questo browser: all'apertura la pagina li mostra subito e intanto chiede quelli nuovi.
// Sono legati all'account (email) e si cancellano all'uscita, così su un computer condiviso nessuno vede i dati di un altro.
let owner = '';
const PFX = 'snap.';
export function setSnapOwner(email: string | null) { owner = email ?? ''; }
export function snapGet<T>(key: string): T | undefined {
  if (!owner) return undefined;
  try { const s = localStorage.getItem(PFX + owner + '.' + key); return s ? JSON.parse(s) as T : undefined; } catch { return undefined; }
}
export function snapSet(key: string, data: unknown) {
  if (!owner) return;
  try { const s = JSON.stringify(data); if (s.length < 1_500_000) localStorage.setItem(PFX + owner + '.' + key, s); } catch { /* spazio finito: si ricaricano solo dalla rete */ }
}
export function snapClear() {
  try { Object.keys(localStorage).filter(k => k.startsWith(PFX)).forEach(k => localStorage.removeItem(k)); } catch { /* niente */ }
}
