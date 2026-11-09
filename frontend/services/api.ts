// Accesso ai dati. Non c'è più un server: api() esegue nel browser l'operazione corrispondente (services/routes.ts),
// che legge e scrive su Supabase. Stessi indirizzi e stesse risposte di prima, così le pagine non cambiano.
import { route, saveFile, type FileOut } from './routes';
import { toError } from './supabase';

// anteprima locale (npm run anteprima): le operazioni girano sul database temporaneo del Mac, non su Supabase
export const DEMO = import.meta.env?.VITE_DEMO === '1';
async function demo(path: string, method: string, body: unknown) {
  const r = await (await fetch('/__mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, method, body }) })).json();
  if (r.error) throw Object.assign(new Error(r.error.message), r.error);
  return r.ok;
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try { return DEMO ? await demo(path, method, body) : await route(path, method, body); }
  catch (e: any) {
    const err = typeof e?.status === 'number' ? e : toError(e);
    if (err.status === 401) dispatchEvent(new Event('auth:required')); // sessione scaduta: si torna all'accesso
    throw err;
  }
}
// testo di un'esportazione (es. lista del mazzo da copiare o modificare)
export const apiText = async (path: string) => (await api<FileOut>(path)).text;
// scarica un'esportazione come file
export const download = (path: string) => api<FileOut>(path).then(saveFile).catch(fail);
// Ricerca su Scryfall, i più pertinenti prima (vedi score), a parità il nome più corto.
// Due ricerche insieme: una sui nomi che iniziano con il testo (così "sol" trova Sol Ring anche se ci sono centinaia di altri nomi con "sol"),
// una normale (nomi che contengono il testo, nomi italiani, sintassi di Scryfall).
export const scry = async (q: string, unique: 'prints' | 'cards'): Promise<any[]> => {
  const get = async (query: string) => { const r = await fetch('https://api.scryfall.com/cards/search?' + new URLSearchParams({ q: query + ' game:paper -t:token -t:emblem', unique, order: 'name' })); return r.ok ? (await r.json()).data as any[] : []; };
  const t = q.replace(/^!?"|"$/g, '').trim().toLowerCase(), esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const simple = /^[\p{L}\p{N} ',-]+$/u.test(t) && !q.includes(':');
  const [a, b] = await Promise.all([simple ? get(`name:/^${esc.replace(/\//g, '')}/`) : Promise.resolve([]), get(q)]);
  const seen = new Set<string>(), all = [...a, ...b].filter(c => !seen.has(c.id) && seen.add(c.id));
  // 0 nome esatto, 1 inizia con la parola intera ("Sol Ring"), 2 inizia con il testo ("Solar Array"), 3 una parola inizia con il testo, 4 il resto
  const score = (n: string) => { n = n.toLowerCase(); return n === t ? 0 : new RegExp('^' + esc + '\\b').test(n) ? 1 : n.startsWith(t) ? 2 : new RegExp('\\b' + esc).test(n) ? 3 : 4; };
  return all.map((c, i) => ({ c, i, s: score(c.name) })).sort((x, y) => x.s - y.s || (x.s <= 2 ? x.c.name.length - y.c.name.length : 0) || x.i - y.i).slice(0, 30).map(x => x.c);
};
export const fail = (e: any) => alert(e.message);
