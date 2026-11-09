// PostgreSQL temporaneo che imita un progetto Supabase nuovo (ruoli anon/authenticated, auth.users, auth.uid()),
// con supabase/schema.sql già caricato. Usato dalle prove: non tocca Supabase né i dati veri.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export type Q = (sql: string, p?: any[]) => Promise<any[]>;

export async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-sql-')), port = 5400 + Math.floor(Math.random() * 300);
  const db = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'test', port, persistent: false, onLog: () => {} });
  await db.initialise(); await db.start();
  const pool = new pg.Pool({ connectionString: `postgres://postgres:test@127.0.0.1:${port}/postgres`, max: 6 });
  await pool.query(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;`);
  await pool.query(readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8'));
  // al posto dell'estensione http di Supabase: le risposte di Scryfall stanno in app.test_sf (le mette sfPut, dalle prove)
  await pool.query(`create table app.test_sf(id text primary key, oracle_id text, js jsonb not null);
    create or replace function app.sf_collection(p_ids jsonb) returns jsonb language sql security definer set search_path = public as $$
      select coalesce(jsonb_agg(t.js), '[]') from (select distinct on (coalesce(i->>'id', t.oracle_id)) t.js from jsonb_array_elements(p_ids) i
        join app.test_sf t on t.id = i->>'id' or t.oracle_id = i->>'oracle_id' order by coalesce(i->>'id', t.oracle_id), t.id) t $$;`);
  const sfPut = (cards: any[]) => cards.length ? pool.query(`insert into app.test_sf select x->>'id', coalesce(x->>'oracle_id', x->'card_faces'->0->>'oracle_id'), x from jsonb_array_elements($1::jsonb) x
    on conflict(id) do update set js = excluded.js`, [JSON.stringify(cards)]) : Promise.resolve();

  // una "richiesta" del sito: transazione con il ruolo e l'utente del token, come fa PostgREST
  const as = async <T>(uid: string | null, f: (q: Q) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try {
      await c.query('begin'); await c.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
      if (uid) await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]);
      const r = await f(async (sql, p) => (await c.query(sql, p)).rows); await c.query('commit'); return r;
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  };
  // chiamata a una funzione con argomenti per nome, come supabase.rpc (oggetti e liste di oggetti passano come JSON)
  const rpc = (uid: string | null, fn: string, args: Record<string, any> = {}) => {
    const k = Object.keys(args), json = (v: any) => v !== null && typeof v === 'object' && (!Array.isArray(v) || !v.length || v.some(x => x !== null && typeof x === 'object'));
    return as(uid, async q => (await q(`select ${fn}(${k.map((x, i) => `${x}=>$${i + 1}`).join(',')}) r`, k.map(x => json(args[x]) ? JSON.stringify(args[x]) : args[x])))[0].r);
  };
  const stop = async () => { await pool.end(); await db.stop(); rmSync(dir, { recursive: true, force: true }); };
  return { pool, as, rpc, stop, sfPut };
}
