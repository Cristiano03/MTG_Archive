// Backup dei dati di un utente (collezione, mazzi, assegnazioni, desideri + le carte del catalogo che servono),
// ripristino con anteprima e copie automatiche periodiche (solo quando il server gira su un computer).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool, tx, log, type C } from '../database/pool.js';
import { err } from './errors.js';

const REQUIRED = ['cards', 'printings', 'collection_items', 'decks', 'deck_cards', 'deck_assignments'];

export async function snapshot(uid: number) {
  const q = async (sql: string) => (await pool.query(sql, [uid])).rows;
  const out: any = { format: 'mtg-commander-manager', version: 2, exported_at: new Date().toISOString() };
  out.collection_items = await q('select * from collection_items where user_id=$1 order by id');
  out.decks = await q('select * from decks where user_id=$1 order by id');
  out.deck_cards = await q('select dc.* from deck_cards dc join decks d on d.id=dc.deck_id where d.user_id=$1');
  out.deck_assignments = await q('select a.* from deck_assignments a join decks d on d.id=a.deck_id where d.user_id=$1');
  out.wishlist = await q('select * from wishlist where user_id=$1 order by id');
  out.printings = await q(`select * from printings where id in (select printing_id from collection_items where user_id=$1)
    or oracle_id in (select dc.oracle_id from deck_cards dc join decks d on d.id=dc.deck_id where d.user_id=$1) or oracle_id in (select oracle_id from wishlist where user_id=$1)`);
  out.cards = await q(`select * from cards where oracle_id in (select oracle_id from printings where id in (select printing_id from collection_items where user_id=$1))
    or oracle_id in (select dc.oracle_id from deck_cards dc join decks d on d.id=dc.deck_id where d.user_id=$1) or oracle_id in (select oracle_id from wishlist where user_id=$1)`);
  return out;
}
const summary = (d: any) => ({
  carte_in_catalogo: d.cards?.length ?? 0, stampe: d.printings?.length ?? 0, righe_collezione: d.collection_items?.length ?? 0,
  copie: (d.collection_items ?? []).reduce((t: number, r: any) => t + Number(r.qty || 0), 0), mazzi: d.decks?.length ?? 0,
  carte_nei_mazzi: (d.deck_cards ?? []).reduce((t: number, r: any) => t + Number(r.qty || 0), 0),
  copie_assegnate: (d.deck_assignments ?? []).reduce((t: number, r: any) => t + Number(r.qty || 0), 0), lista_desideri: d.wishlist?.length ?? 0,
});
export function checkBackup(d: any) {
  if (!d || typeof d !== 'object') throw err(400, 'File non valido');
  if (d.P && d.items) throw err(400, 'Questo è un backup della vecchia versione HTML: usa “Migra dal backup della versione HTML”');
  const miss = REQUIRED.filter(t => !Array.isArray(d[t])); if (miss.length) throw err(400, 'Backup incompleto, mancano: ' + miss.join(', '));
}
export async function previewRestore(uid: number, d: any) {
  checkBackup(d);
  return { attuale: summary(await snapshot(uid)), backup: summary(d), esportato_il: d.exported_at ?? null };
}
const insertJson = async (c: C, table: string, rows: any[], conflict: string) => {
  if (!rows.length) return;
  const cols = (await c.query(`select column_name from information_schema.columns where table_name=$1 and table_schema=current_schema()`, [table])).rows
    .map((r: any) => r.column_name).filter((k: string) => k in rows[0]).map((k: string) => `"${k}"`).join(',');
  await c.query(`insert into ${table} (${cols}) select ${cols} from json_populate_recordset(null::${table}, $1::json) ${conflict}`, [JSON.stringify(rows)]);
};
// Sostituisce i dati DELL'UTENTE con quelli del backup, in un'unica transazione (gli altri utenti non vengono toccati).
// Gli id vengono rinumerati, quindi un backup si può ripristinare anche su un altro database o account.
export async function restore(uid: number, d: any) {
  checkBackup(d);
  const safety = await saveToDisk(uid, 'prima-del-ripristino').catch(() => null); // su Netlify non c'è un disco: si salta
  await tx(async c => {
    await c.query('delete from deck_assignments where deck_id in (select id from decks where user_id=$1)', [uid]);
    await c.query('delete from deck_cards where deck_id in (select id from decks where user_id=$1)', [uid]);
    await c.query('delete from decks where user_id=$1', [uid]);
    await c.query('delete from collection_items where user_id=$1', [uid]);
    await c.query('delete from wishlist where user_id=$1', [uid]);
    await insertJson(c, 'cards', d.cards, 'on conflict (oracle_id) do nothing');
    await insertJson(c, 'printings', d.printings, 'on conflict (id) do nothing');
    const items = new Map<string, number>(), decks = new Map<string, number>();
    for (const i of d.collection_items) items.set(String(i.id), (await c.query(`insert into collection_items(user_id,printing_id,qty,lang,finish,condition,note,created_at)
      values($1,$2,$3,$4,$5,$6,$7,coalesce($8,now())) on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty returning id`,
      [uid, i.printing_id, i.qty, i.lang ?? 'en', i.finish ?? 'nonfoil', i.condition ?? 'NM', i.note ?? null, i.created_at ?? null])).rows[0].id);
    for (const k of d.decks) decks.set(String(k.id), (await c.query(`insert into decks(user_id,name,mode,description,archived,created_at,updated_at)
      values($1,$2,$3,$4,$5,coalesce($6,now()),coalesce($7,now())) returning id`, [uid, k.name, k.mode, k.description ?? null, !!k.archived, k.created_at ?? null, k.updated_at ?? null])).rows[0].id);
    for (const r of d.deck_cards) if (decks.has(String(r.deck_id)))
      await c.query('insert into deck_cards values($1,$2,$3,$4) on conflict do nothing', [decks.get(String(r.deck_id)), r.oracle_id, r.qty, !!r.is_commander]);
    for (const a of d.deck_assignments) if (decks.has(String(a.deck_id)) && items.has(String(a.item_id)))
      await c.query('insert into deck_assignments values($1,$2,$3)', [decks.get(String(a.deck_id)), items.get(String(a.item_id)), a.qty]);
    for (const w of d.wishlist ?? []) await c.query(`insert into wishlist(user_id,oracle_id,qty_wanted,priority,note,price_ref,price_source,price_at)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(user_id,oracle_id) do nothing`, [uid, w.oracle_id, w.qty_wanted, w.priority ?? null, w.note ?? null, w.price_ref ?? null, w.price_source ?? null, w.price_at ?? null]);
    await log(c, 'backup.restore', { exported_at: d.exported_at ?? null, safety }, uid);
  });
  return { ripristinato: summary(d), copia_di_sicurezza: safety };
}

const DIR = process.env.BACKUP_DIR ?? join(process.cwd(), '.data', 'backups');
export async function saveToDisk(uid: number, label: string) {
  if (process.env.NETLIFY || process.env.K_SERVICE) throw new Error('Nessun disco disponibile'); // Netlify / Cloud Functions
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-u${uid}-${label}.json`);
  writeFileSync(file, JSON.stringify(await snapshot(uid))); return file;
}
// Copia automatica di ogni utente all'avvio e ogni 24 ore; tiene le 14 più recenti per utente.
export function scheduleBackups() {
  const run = async () => {
    try {
      for (const { id } of (await pool.query('select id from users')).rows) {
        await saveToDisk(id, 'auto');
        const old = readdirSync(DIR).filter(f => f.endsWith(`-u${id}-auto.json`)).sort().slice(0, -14);
        for (const f of old) rmSync(join(DIR, f));
      }
    } catch (e: any) { console.error('Backup automatico fallito:', e.message); }
  };
  run(); setInterval(run, 24 * 3600e3).unref();
}
