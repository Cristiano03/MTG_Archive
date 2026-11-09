import { Router } from 'express';
import { w } from './http.js';
export const router = Router();
import { pool, tx, log } from '../database/pool.js';
import { err, int } from '../services/errors.js';
import { syncDeck, lockDeck, deckInfo, dedupeCommanders, collectMissing } from '../services/inventory/decks.js';
import { validateById } from '../services/commander-validation/index.js';
import { uidOf } from '../services/auth.js';

router.get('/decks', w(async (q, s) => s.json((await pool.query(`select d.id,d.name,d.mode,d.archived,d.updated_at,
  (select coalesce(sum(qty),0)::int from deck_cards where deck_id=d.id) cards,(select coalesce(sum(qty),0)::int from deck_assignments where deck_id=d.id) assigned,
  coalesce((select array_agg(distinct x order by x) from deck_cards dc join cards c on c.oracle_id=dc.oracle_id, unnest(c.color_identity) x where dc.deck_id=d.id and dc.is_commander),'{}') ci,
  coalesce((select string_agg(c.name,' + ' order by c.name) from deck_cards dc join cards c on c.oracle_id=dc.oracle_id where dc.deck_id=d.id and dc.is_commander),'') commanders
  from decks d where d.user_id=$1 order by d.updated_at desc`, [uidOf(q)])).rows)));
router.get('/decks/:id', w(async (q, s) => s.json(await deckInfo(pool, int(q.params.id), uidOf(q)))));
router.post('/decks', w(async (q, s) => { const { name, mode = 'virtual', description } = q.body;
  if (!name || !['physical', 'virtual'].includes(mode)) throw err(400, 'name e mode (physical|virtual) obbligatori');
  s.json((await pool.query('insert into decks(user_id,name,mode,description) values($4,$1,$2,$3) returning *', [String(name).slice(0, 120), mode, description ?? null, uidOf(q)])).rows[0]); }));
router.patch('/decks/:id', w(async (q, s) => {
  const name = String(q.body?.name ?? '').trim(); if (!name) throw err(400, 'Il nome non può essere vuoto');
  const r = await pool.query('update decks set name=$2,updated_at=now() where id=$1 and user_id=$3 returning *', [int(q.params.id), name.slice(0, 120), uidOf(q)]);
  if (!r.rowCount) throw err(404, 'Mazzo non trovato'); s.json(r.rows[0]);
}));
router.delete('/decks/:id', w(async (q, s) => { await tx(async c => { const id = int(q.params.id); await lockDeck(c, id, uidOf(q)); await c.query('delete from decks where id=$1', [id]); await log(c, 'deck.delete', { id }, uidOf(q)); }); s.json({ ok: true }); }));
// delta positivo o negativo; i comandanti sono max 2. L'oracle_id deve già essere in catalogo (POST /catalog/printings).
router.post('/decks/:id/cards', w(async (q, s) => s.json(await tx(async c => {
  const id = int(q.params.id), delta = int(q.body.delta, -999), cmd = !!q.body.is_commander, uid = uidOf(q); await lockDeck(c, id, uid);
  if (!delta) throw err(400, 'delta non può essere 0');
  if (!(await c.query('select 1 from cards where oracle_id=$1', [q.body.oracle_id])).rowCount) throw err(404, 'Carta non in catalogo');
  if (!cmd && delta > 0 && (await c.query('select 1 from deck_cards where deck_id=$1 and oracle_id=$2 and is_commander', [id, q.body.oracle_id])).rowCount)
    throw err(400, 'Questa carta è già il comandante del mazzo: conta già tra le 100 carte');
  const cur = (await c.query('select qty from deck_cards where deck_id=$1 and oracle_id=$2 and is_commander=$3', [id, q.body.oracle_id, cmd])).rows[0]?.qty ?? 0;
  const next = cur + delta;
  if (cmd && next > 1) throw err(400, 'Questa carta è già il comandante: un comandante vale una sola copia');
  if (next <= 0) await c.query('delete from deck_cards where deck_id=$1 and oracle_id=$2 and is_commander=$3', [id, q.body.oracle_id, cmd]);
  else await c.query('insert into deck_cards values($1,$2,$3,$4) on conflict(deck_id,oracle_id,is_commander) do update set qty=excluded.qty', [id, q.body.oracle_id, next, cmd]);
  if ((await c.query('select coalesce(sum(qty),0)::int n from deck_cards where deck_id=$1 and is_commander', [id])).rows[0].n > 2) throw err(400, 'Massimo 2 comandanti');
  if (cmd && delta > 0) await dedupeCommanders(c, id); // se era già tra le carte normali, la copia diventa il comandante
  await syncDeck(c, id); await c.query('update decks set updated_at=now() where id=$1', [id]); return deckInfo(c, id, uid);
}))));
// toglie più carte dal mazzo insieme (tutte le copie di ogni riga); le copie fisiche tornano libere
router.post('/decks/:id/cards/bulk-remove', w(async (q, s) => s.json(await tx(async c => {
  const id = int(q.params.id), uid = uidOf(q); await lockDeck(c, id, uid);
  const items = Array.isArray(q.body?.items) ? q.body.items : []; if (!items.length) throw err(400, 'Nessuna carta selezionata');
  let n = 0;
  for (const it of items) n += (await c.query('delete from deck_cards where deck_id=$1 and oracle_id=$2 and is_commander=$3', [id, it.oracle_id, !!it.is_commander])).rowCount ?? 0;
  await syncDeck(c, id); await c.query('update decks set updated_at=now() where id=$1', [id]);
  await log(c, 'deck.bulk_remove', { id, rows: n }, uid);
  return { removed: n };
}))));
// aggiunge alla collezione le copie mancanti del mazzo (oracle_id facoltativo: solo quella carta)
router.post('/decks/:id/collect', w(async (q, s) => s.json(await tx(async c => {
  const id = int(q.params.id), uid = uidOf(q); await lockDeck(c, id, uid);
  const r = await collectMissing(c, uid, id, q.body?.oracle_id || undefined);
  await log(c, 'deck.collect', { id, oracle_id: q.body?.oracle_id ?? null, added: r.added }, uid);
  return r;
}))));
// virtuale -> fisico: senza confirm restituisce solo cosa manca; con confirm assegna le copie disponibili (atomico)
router.post('/decks/:id/convert', w(async (q, s) => s.json(await tx(async c => {
  const id = int(q.params.id), uid = uidOf(q), d = await lockDeck(c, id, uid); if (d.mode === 'physical') throw err(400, 'Mazzo già fisico');
  const m = (await c.query(`select c.name,sum(dc.qty)::int need,coalesce(f.f,0)::int free from deck_cards dc join cards c on c.oracle_id=dc.oracle_id
    left join (select p.oracle_id,sum(i.qty-coalesce((select sum(qty) from deck_assignments x where x.item_id=i.id),0)) f from collection_items i join printings p on p.id=i.printing_id where i.user_id=$2 group by 1) f on f.oracle_id=dc.oracle_id
    where dc.deck_id=$1 group by c.name,f.f`, [id, uid])).rows.filter((r: any) => r.need > r.free).map((r: any) => ({ name: r.name, missing: r.need - r.free }));
  if (m.length && !q.body.confirm) return { converted: false, missing: m };
  await c.query(`update decks set mode='physical',updated_at=now() where id=$1`, [id]); await syncDeck(c, id); await log(c, 'deck.convert', { id, missing: m }, uid);
  return { converted: true, missing: m };
}))));
router.post('/decks/:id/archive', w(async (q, s) => s.json(await tx(async c => {
  const id = int(q.params.id), uid = uidOf(q); await lockDeck(c, id, uid);
  await c.query('update decks set archived=$2,updated_at=now() where id=$1', [id, !!q.body.archived]); await syncDeck(c, id); return deckInfo(c, id, uid);
}))));
router.post('/assignments/move', w(async (q, s) => { await tx(async c => {
  const { from_deck, to_deck, item_id } = q.body, n = int(q.body.qty), uid = uidOf(q); const [a, b] = [int(from_deck), int(to_deck)].sort((x, y) => x - y);
  await lockDeck(c, a, uid); if (b !== a) await lockDeck(c, b, uid);
  if (!(await c.query('select 1 from collection_items where id=$1 and user_id=$2 for update', [item_id, uid])).rowCount) throw err(404, 'Copia non trovata');
  const src = (await c.query('select qty from deck_assignments where deck_id=$1 and item_id=$2', [from_deck, item_id])).rows[0];
  if (!src || src.qty < n) throw err(409, 'Copie assegnate al mazzo di origine insufficienti');
  const dst = (await c.query(`select 1 from decks where id=$1 and mode='physical' and not archived`, [to_deck])).rowCount; if (!dst) throw err(400, 'Il mazzo di destinazione deve essere fisico e attivo');
  if (src.qty === n) await c.query('delete from deck_assignments where deck_id=$1 and item_id=$2', [from_deck, item_id]); else await c.query('update deck_assignments set qty=qty-$3 where deck_id=$1 and item_id=$2', [from_deck, item_id, n]);
  await c.query('insert into deck_assignments values($1,$2,$3) on conflict(deck_id,item_id) do update set qty=deck_assignments.qty+excluded.qty', [to_deck, item_id, n]);
  await log(c, 'assignment.move', q.body, uid); }); s.json({ ok: true }); }));

router.get('/decks/:id/validation', w(async (q, s) => s.json(await validateById(int(q.params.id), uidOf(q)))));
