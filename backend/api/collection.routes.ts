import { Router } from 'express';
import { w } from './http.js';
export const router = Router();
import { pool, tx, log } from '../database/pool.js';
import { err, int } from '../services/errors.js';
import { ensurePrinting } from '../services/card-catalog/scryfall.js';
import { setQty, editItem } from '../services/inventory/collection.js';
import { uidOf } from '../services/auth.js';

router.get('/collection', w(async (q, s) => s.json((await pool.query(`
  select i.id,i.printing_id,c.name,p.set_code,p.collector_number,i.lang,i.finish,i.condition,i.note,i.qty,
    coalesce(a.s,0)::int assigned,(i.qty-coalesce(a.s,0))::int free,p.rarity,p.image_small,c.type_line,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,i.created_at,
    coalesce((select json_agg(x.deck_id) from deck_assignments x where x.item_id=i.id),'[]'::json) decks
  from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id
  left join (select item_id,sum(qty) s from deck_assignments group by item_id) a on a.item_id=i.id where i.user_id=$1 order by c.name,p.set_code`, [uidOf(q)])).rows)));
router.post('/collection', w(async (q, s) => s.json(await tx(async c => {
  const { printing_id, finish = 'nonfoil', condition = 'NM', lang } = q.body, n = int(q.body.qty);
  await ensurePrinting(c, printing_id);
  const r = await c.query(`insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values($6,$1,$2,coalesce($3,(select lang from printings where id=$1)),$4,$5)
    on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty returning *`, [printing_id, n, lang ?? null, finish, condition, uidOf(q)]);
  await log(c, 'collection.add', { printing_id, qty: n }, uidOf(q)); return r.rows[0];
}))));
// rimozione di più righe insieme (tutte le copie di ogni riga). Se qualcuna è assegnata a un mazzo serve release=true.
router.post('/collection/bulk-delete', w(async (q, s) => s.json(await tx(async c => {
  const uid = uidOf(q), asked: number[] = Array.isArray(q.body?.ids) ? q.body.ids.map((x: any) => int(x)) : [];
  if (!asked.length) throw err(400, 'Nessuna carta selezionata');
  const ids: number[] = (await c.query('select id from collection_items where id=any($1) and user_id=$2', [asked, uid])).rows.map((r: any) => Number(r.id));
  if (!q.body.release) {
    const busy = (await c.query(`select distinct c.name from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id where a.item_id=any($1)`, [ids])).rows.map((r: any) => r.name);
    if (busy.length) throw Object.assign(err(409, 'Alcune carte sono assegnate a un mazzo'), { assigned: busy });
  }
  let copies = 0;
  for (const id of ids) { const it = (await c.query('select qty from collection_items where id=$1', [id])).rows[0]; if (!it) continue; copies += it.qty; await setQty(c, uid, id, 0, true); }
  return { removed: ids.length, copies };
}))));
router.patch('/collection/:id', w(async (q, s) => { await tx(c => setQty(c, uidOf(q), int(q.params.id), int(q.body.qty, 0), !!q.body.release)); s.json({ ok: true }); }));
router.delete('/collection/:id', w(async (q, s) => { await tx(c => setQty(c, uidOf(q), int(q.params.id), 0, q.query.release === 'true')); s.json({ ok: true }); }));

router.patch('/collection/:id/attrs', w(async (q, s) => s.json(await tx(c => editItem(c, uidOf(q), int(q.params.id), q.body ?? {})))));

