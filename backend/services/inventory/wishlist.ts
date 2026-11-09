// Lista dei desideri: separata dall'inventario, ragiona per carta (non per stampa).
import { pool, type C, log } from '../../database/pool.js';
import { err, int } from '../errors.js';
import { ensurePrinting } from '../card-catalog/scryfall.js';
import { FIN, COND } from './collection.js';
import { syncDeck } from './decks.js';

export async function listWishlist(uid: number) {
  return (await pool.query(`
    with own as (select p.oracle_id,sum(i.qty)::int owned,sum(i.qty-coalesce((select sum(qty) from deck_assignments a where a.item_id=i.id),0))::int free
      from collection_items i join printings p on p.id=i.printing_id where i.user_id=$1 group by 1)
    select w.id,w.oracle_id,c.name,w.qty_wanted,coalesce(o.owned,0) owned,coalesce(o.free,0) free,greatest(0,w.qty_wanted-coalesce(o.free,0)) to_buy,
      w.priority,w.note,w.price_ref,w.price_source,w.price_at,(select image_small from printings p where p.oracle_id=w.oracle_id limit 1) image
    from wishlist w join cards c on c.oracle_id=w.oracle_id left join own o on o.oracle_id=w.oracle_id
    where w.user_id=$1 order by w.priority nulls last, c.name`, [uid])).rows;
}
// mode 'add': somma alla quantità già desiderata; mode 'atleast': porta la quantità almeno a qty (usato dai mazzi, non raddoppia)
export async function upsertWish(c: C, uid: number, oracleId: string, qty: number, mode: 'add' | 'atleast', extra: { priority?: number | null; note?: string | null } = {}) {
  if (!(await c.query('select 1 from cards where oracle_id=$1', [oracleId])).rowCount) throw err(404, 'Carta non in catalogo');
  await c.query(`insert into wishlist(user_id,oracle_id,qty_wanted,priority,note) values($5,$1,$2,$3,$4)
    on conflict(user_id,oracle_id) do update set qty_wanted=${mode === 'add' ? 'wishlist.qty_wanted+excluded.qty_wanted' : 'greatest(wishlist.qty_wanted,excluded.qty_wanted)'},
      priority=coalesce(excluded.priority,wishlist.priority),note=coalesce(excluded.note,wishlist.note)`, [oracleId, qty, extra.priority ?? null, extra.note ?? null, uid]);
}
// carte che mancano a un mazzo: fisico = richieste meno assegnate; virtuale = richieste meno copie libere
export async function wishFromDeck(c: C, uid: number, deckId: number) {
  const d = (await c.query('select mode from decks where id=$1 and user_id=$2', [deckId, uid])).rows[0]; if (!d) throw err(404, 'Mazzo non trovato');
  const rows = (await c.query(`select dc.oracle_id,sum(dc.qty)::int need,
      coalesce((select sum(a.qty) from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=$1 and p.oracle_id=dc.oracle_id),0)::int got,
      coalesce((select sum(i.qty-coalesce((select sum(qty) from deck_assignments x where x.item_id=i.id),0)) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=dc.oracle_id and i.user_id=$2),0)::int free
    from deck_cards dc where dc.deck_id=$1 group by dc.oracle_id`, [deckId, uid])).rows;
  let added = 0;
  for (const r of rows) {
    const missing = d.mode === 'physical' ? r.need - r.got : r.need - r.free;
    if (missing > 0) { await upsertWish(c, uid, r.oracle_id, missing, 'atleast'); added++; }
  }
  await log(c, 'wishlist.from_deck', { deckId, cards: added }, uid); return { cards: added };
}
// Acquisto guidato: la copia entra nella collezione e la quantità desiderata scende, nella stessa transazione.
// Le nuove copie vanno ai mazzi fisici che le aspettavano (se assign non è false).
export async function purchase(c: C, uid: number, wishId: number, b: any) {
  const w = (await c.query('select * from wishlist where id=$1 and user_id=$2 for update', [wishId, uid])).rows[0]; if (!w) throw err(404, 'Voce non trovata');
  const qty = int(b.qty), finish = b.finish ?? 'nonfoil', cond = b.condition ?? 'NM';
  if (!FIN.includes(finish) || !COND.includes(cond)) throw err(400, 'Finitura o condizione non valida');
  await ensurePrinting(c, b.printing_id);
  const p = (await c.query('select oracle_id,lang from printings where id=$1', [b.printing_id])).rows[0];
  if (p.oracle_id !== w.oracle_id) throw err(400, 'La stampa scelta è di un’altra carta');
  await c.query(`insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values($6,$1,$2,$3,$4,$5)
    on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty`, [b.printing_id, qty, p.lang, finish, cond, uid]);
  if (w.qty_wanted - qty > 0) await c.query('update wishlist set qty_wanted=$2 where id=$1', [wishId, w.qty_wanted - qty]);
  else await c.query('delete from wishlist where id=$1', [wishId]);
  const assignedTo: string[] = [];
  if (b.assign !== false) {
    const decks = (await c.query(`select distinct d.id,d.name from decks d join deck_cards dc on dc.deck_id=d.id where dc.oracle_id=$1 and d.user_id=$2 and d.mode='physical' and not d.archived order by d.id`, [w.oracle_id, uid])).rows;
    for (const d of decks) {
      const before = (await c.query('select coalesce(sum(qty),0)::int n from deck_assignments where deck_id=$1', [d.id])).rows[0].n;
      await syncDeck(c, d.id);
      if ((await c.query('select coalesce(sum(qty),0)::int n from deck_assignments where deck_id=$1', [d.id])).rows[0].n > before) assignedTo.push(d.name);
    }
  }
  await log(c, 'wishlist.purchase', { wishId, printing_id: b.printing_id, qty, assignedTo }, uid);
  return { added: qty, remaining: Math.max(0, w.qty_wanted - qty), assignedTo };
}
// Prezzo di riferimento: Scryfall (EUR, media Cardmarket) della stampa predefinita; è una stima, con data e fonte.
export async function refreshPrices(uid: number, ids?: string[]) {
  const all = ids ?? (await pool.query('select oracle_id from wishlist where user_id=$1', [uid])).rows.map((r: any) => r.oracle_id); let n = 0;
  for (let i = 0; i < all.length; i += 75) {
    const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'mtg-manager/1.0', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: all.slice(i, i + 75).map(oracle_id => ({ oracle_id })) }) });
    if (!r.ok) throw err(502, 'Scryfall ' + r.status);
    for (const c of (await r.json() as any).data) {
      const eur = c.prices?.eur ?? c.prices?.eur_foil; if (!eur) continue;
      n += (await pool.query(`update wishlist set price_ref=$2,price_source='Scryfall (Cardmarket, EUR)',price_at=now() where oracle_id=$1 and user_id=$3`, [c.oracle_id ?? c.card_faces?.[0]?.oracle_id, eur, uid])).rowCount ?? 0;
    }
    await new Promise(f => setTimeout(f, 120));
  }
  return { updated: n };
}
