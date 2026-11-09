import { Router } from 'express';
import { w } from './http.js';
export const router = Router();
import { pool, tx } from '../database/pool.js';
import { err, int } from '../services/errors.js';
import { ensurePrinting } from '../services/card-catalog/scryfall.js';
import { listWishlist, upsertWish, wishFromDeck, purchase, refreshPrices } from '../services/inventory/wishlist.js';
import { uidOf } from '../services/auth.js';

router.get('/wishlist', w(async (q, s) => s.json(await listWishlist(uidOf(q)))));
// aggiunta manuale: da una stampa scelta nella ricerca (printing_id) o da una carta già in catalogo (oracle_id)
router.post('/wishlist', w(async (q, s) => {
  const qty = int(q.body.qty ?? 1), oid = await tx(async c => {
    let o = q.body.oracle_id;
    if (q.body.printing_id) { await ensurePrinting(c, q.body.printing_id); o = (await c.query('select oracle_id from printings where id=$1', [q.body.printing_id])).rows[0].oracle_id; }
    if (!o) throw err(400, 'Serve printing_id oppure oracle_id');
    await upsertWish(c, uidOf(q), o, qty, 'add', { priority: q.body.priority ?? null, note: q.body.note ?? null }); return o as string;
  });
  await refreshPrices(uidOf(q), [oid]).catch(() => {}); // il prezzo è facoltativo: se Scryfall non risponde, la voce resta senza
  s.json({ ok: true });
}));
router.post('/wishlist/from-deck/:id', w(async (q, s) => s.json(await tx(c => wishFromDeck(c, uidOf(q), int(q.params.id))))));
router.patch('/wishlist/:id', w(async (q, s) => {
  const { qty_wanted, priority, note } = q.body;
  const r = await pool.query(`update wishlist set qty_wanted=coalesce($2,qty_wanted),priority=case when $5 then $3 else priority end,note=case when $6 then $4 else note end where id=$1 and user_id=$7`,
    [int(q.params.id), qty_wanted === undefined ? null : int(qty_wanted), priority ?? null, note || null, 'priority' in q.body, 'note' in q.body, uidOf(q)]);
  if (!r.rowCount) throw err(404, 'Voce non trovata'); s.json({ ok: true });
}));
router.delete('/wishlist/:id', w(async (q, s) => { await pool.query('delete from wishlist where id=$1 and user_id=$2', [int(q.params.id), uidOf(q)]); s.json({ ok: true }); }));
router.post('/wishlist/:id/purchase', w(async (q, s) => s.json(await tx(c => purchase(c, uidOf(q), int(q.params.id), q.body)))));
router.post('/wishlist/prices', w(async (q, s) => s.json(await refreshPrices(uidOf(q)))));
router.get('/export/wishlist.txt', w(async (q, s) => {
  const rows = (await listWishlist(uidOf(q))).filter((r: any) => r.to_buy > 0);
  s.setHeader('Content-Type', 'text/plain; charset=utf-8'); s.setHeader('Content-Disposition', 'attachment; filename="lista-desideri.txt"');
  s.send(rows.map((r: any) => `${r.to_buy} ${r.name}`).join('\n'));
}));
