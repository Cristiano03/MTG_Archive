import pg from 'pg';
export type C = pg.PoolClient;
// Connessione al database, creata alla prima richiesta (le piattaforme cloud leggono le variabili solo all'esecuzione).
// Supabase/Postgres esterno: DATABASE_URL. Netlify Database: NETLIFY_DB_URL.
let real: pg.Pool | null = null;
function getPool() {
  if (real) return real;
  const url = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL;
  if (!url) throw Object.assign(new Error('Database non configurato: manca DATABASE_URL'), { status: 500 });
  const remote = !/@(127\.0\.0\.1|localhost)[:/]/.test(url);
  // Supabase usa un certificato della propria autorità: connessione cifrata senza verifica della catena
  const ssl = remote && !/sslmode=disable/.test(url) ? { rejectUnauthorized: false } : undefined;
  real = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl, max: remote ? 3 : 10, idleTimeoutMillis: 10_000 });
  return real;
}
export const pool = new Proxy({} as pg.Pool, { get: (_t, k) => { const p = getPool() as any, v = p[k]; return typeof v === 'function' ? v.bind(p) : v; } });
// Transazione tutto-o-niente: rollback su qualsiasi errore
export async function tx<T>(fn: (c: C) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
export const log = (c: C, op: string, payload: object, uid?: number) => c.query('insert into transactions(op,payload,user_id) values($1,$2,$3)', [op, payload, uid ?? null]);
