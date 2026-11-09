import { type C, log } from '../../database/pool.js';
import { err } from '../errors.js';
import { ensurePrinting } from '../card-catalog/scryfall.js';

// Se la nuova quantità è inferiore alle copie assegnate serve release=true (libera le assegnazioni in eccesso), altrimenti 409.
export async function setQty(c: C, uid: number, id: number, qty: number, release: boolean) {
  const it = (await c.query('select * from collection_items where id=$1 and user_id=$2 for update', [id, uid])).rows[0];
  if (!it) throw err(404, 'Copia non trovata');
  const asg = (await c.query('select deck_id,qty from deck_assignments where item_id=$1 order by qty desc for update', [id])).rows;
  let ex = asg.reduce((t, a) => t + a.qty, 0) - qty;
  if (ex > 0 && !release) throw Object.assign(err(409, 'Copie assegnate a mazzi: conferma con release=true'), { assigned: asg });
  for (const a of asg) { if (ex <= 0) break; const t = Math.min(ex, a.qty);
    if (t === a.qty) await c.query('delete from deck_assignments where deck_id=$1 and item_id=$2', [a.deck_id, id]);
    else await c.query('update deck_assignments set qty=qty-$3 where deck_id=$1 and item_id=$2', [a.deck_id, id, t]);
    ex -= t; }
  if (qty === 0) await c.query('delete from collection_items where id=$1', [id]); else await c.query('update collection_items set qty=$2 where id=$1', [id, qty]);
  await log(c, 'collection.qty', { id, from: it.qty, to: qty, release }, uid);
}

// Modifica stampa/lingua/finitura/condizione/nota. Se la combinazione esiste già, le due righe vengono unite (quantità e assegnazioni comprese).
export const FIN = ['nonfoil', 'foil', 'etched'], COND = ['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
export async function editItem(c: C, uid: number, id: number, b: any) {
  const it = (await c.query('select * from collection_items where id=$1 and user_id=$2 for update', [id, uid])).rows[0]; if (!it) throw err(404, 'Copia non trovata');
  let pid: string = it.printing_id, lang: string = b.lang ?? it.lang;
  if (b.printing_id && b.printing_id !== it.printing_id) {
    await ensurePrinting(c, b.printing_id);
    const o = (await c.query('select oracle_id from printings where id=$1', [it.printing_id])).rows[0].oracle_id;
    const n = (await c.query('select oracle_id,lang from printings where id=$1', [b.printing_id])).rows[0];
    if (n.oracle_id !== o) throw err(400, 'La nuova stampa deve essere la stessa carta');
    pid = b.printing_id; if (b.lang === undefined) lang = n.lang;
  }
  const finish = b.finish ?? it.finish, cond = b.condition ?? it.condition, note = b.note === undefined ? it.note : (b.note || null);
  if (!FIN.includes(finish) || !COND.includes(cond) || !String(lang).trim()) throw err(400, 'Lingua, finitura o condizione non valida');
  const t = (await c.query('select * from collection_items where user_id=$6 and printing_id=$1 and lang=$2 and finish=$3 and condition=$4 and id<>$5 for update', [pid, lang, finish, cond, id, uid])).rows[0];
  if (!t) { await c.query('update collection_items set printing_id=$2,lang=$3,finish=$4,condition=$5,note=$6 where id=$1', [id, pid, lang, finish, cond, note]); await log(c, 'collection.edit', { id, ...b }, uid); return { merged: false }; }
  await c.query('update collection_items set qty=qty+$2,note=coalesce(note,$3) where id=$1', [t.id, it.qty, note]);
  for (const a of (await c.query('select deck_id,qty from deck_assignments where item_id=$1 for update', [id])).rows) {
    await c.query('delete from deck_assignments where deck_id=$1 and item_id=$2', [a.deck_id, id]);
    await c.query('insert into deck_assignments values($1,$2,$3) on conflict(deck_id,item_id) do update set qty=deck_assignments.qty+excluded.qty', [a.deck_id, t.id, a.qty]);
  }
  await c.query('delete from collection_items where id=$1', [id]); await log(c, 'collection.merge', { from: id, into: t.id }, uid);
  return { merged: true, into: t.id };
}
