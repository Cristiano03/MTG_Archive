// Collegamento a Supabase (database e account). Non c'è un server: il sito parla direttamente con Supabase.
// URL e chiave pubblica arrivano da frontend/.env al momento della compilazione (vedi docs/firebase-supabase.md).
// La chiave "anon"/"publishable" è fatta per stare nel sito: la sicurezza vera sono le regole RLS di supabase/schema.sql.
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env ?? {}, url = env.VITE_SUPABASE_URL as string | undefined, key = env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = !!(url && key);
export const supabase = createClient(url || 'http://configurazione-mancante.invalid', key || 'x', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Errore di Supabase/PostgREST -> errore con stato HTTP e messaggio in italiano (come rispondeva il server).
// Le funzioni del database usano i codici PTnnn (= stato nnn); il dettaglio, se c'è, è JSON (es. le carte assegnate).
export function toError(e: any): Error & { status: number; data?: any } {
  const msg: string = e?.message ?? String(e), code: string = e?.code ?? '';
  let status = /^PT\d{3}$/.test(code) ? Number(code.slice(2)) : 500, text = msg, data: any;
  try { data = e?.details ? JSON.parse(e.details) : undefined; } catch { /* dettaglio non JSON */ }
  if (code === '23514') status = 409;
  else if (code === '22P02') { status = 400; text = 'Identificativo non valido'; }
  else if (code === '42501') { status = 403; text = 'Operazione non permessa'; }
  else if (/^PGRST30/.test(code) || /JWT/i.test(msg)) { status = 401; text = 'Accesso richiesto'; }
  else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) { status = 0; text = navigator.onLine ? 'Supabase non raggiungibile: riprova tra poco (se il progetto è in pausa, riattivalo dal pannello di Supabase).' : 'Sei offline: i dati sono disponibili solo con la connessione.'; }
  return Object.assign(new Error(text), { status, data });
}
export async function rpc<T = any>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw toError(error);
  return data as T;
}
// risultato di una query sulle tabelle (supabase.from(...)): dati oppure errore
export const rows = <T = any>(r: { data: T | null; error: any }): T => { if (r.error) throw toError(r.error); return r.data as T; };
