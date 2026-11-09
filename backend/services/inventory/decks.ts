import type pg from 'pg';
import { type C } from '../../database/pool.js';
import { err } from '../errors.js';

export async function syncDeck(c: C, id: number) {
  const d = (await c.query('select mode,archived,user_id from decks where id=$1', [id])).rows[0];
  const n = d.mode === 'physical' && !d.archived ? (await c.query('select oracle_id,sum(qty)::int q from deck_cards where deck_id=$1 group by 1', [id])).rows : [];
  const want = new Map<string, number>(n.map((r: any) => [r.oracle_id, r.q]));
  (await c.query(`select distinct p.oracle_id from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=$1`, [id]))
    .rows.forEach((r: any) => want.has(r.oracle_id) || want.set(r.oracle_id, 0));
  if (!want.size) return;
  const it = (await c.query(`select i.id,p.oracle_id,(i.qty-coalesce((select sum(qty) from deck_assignments x where x.item_id=i.id),0))::int free,
      coalesce((select qty from deck_assignments x where x.item_id=i.id and x.deck_id=$2),0)::int mine
    from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=any($1) and i.user_id is not distinct from $3 order by i.id for update of i`, [[...want.keys()], id, d.user_id])).rows;
  for (const [o, w] of want) {
    const rows = it.filter((r: any) => r.oracle_id === o), tg = new Map<number, number>(rows.map((r: any) => [r.id, r.mine]));
    let cur = rows.reduce((t: number, r: any) => t + r.mine, 0);
    for (const r of [...rows].reverse()) { if (cur <= w) break; const t = Math.min(cur - w, tg.get(r.id)!); tg.set(r.id, tg.get(r.id)! - t); cur -= t; }
    for (const r of rows) { if (cur >= w) break; const t = Math.min(w - cur, r.free); if (t > 0) { tg.set(r.id, tg.get(r.id)! + t); cur += t; } }
    for (const r of rows) { const t = tg.get(r.id)!; if (t === r.mine) continue;
      if (t === 0) await c.query('delete from deck_assignments where deck_id=$1 and item_id=$2', [id, r.id]);
      else await c.query('insert into deck_assignments values($1,$2,$3) on conflict(deck_id,item_id) do update set qty=excluded.qty', [id, r.id, t]); }
  }
}
export const lockDeck = async (c: C, id: number, uid: number) => { const d = (await c.query('select * from decks where id=$1 and user_id=$2 for update', [id, uid])).rows[0]; if (!d) throw err(404, 'Mazzo non trovato'); return d; };
export const deckInfo = async (c: C | pg.Pool, id: number, uid: number) => {
  const d = (await c.query('select * from decks where id=$1 and user_id=$2', [id, uid])).rows[0]; if (!d) throw err(404, 'Mazzo non trovato');
  // comandante e carte normali restano righe separate, anche se sono la stessa carta (così si vede il doppione)
  const rows = (await c.query(`select c.oracle_id,c.name,c.color_identity,coalesce(c.colors,'{}') colors,c.cmc::float cmc,c.mana_cost,c.type_line,(select image_small from printings p where p.oracle_id=c.oracle_id limit 1) image,dc.is_commander,dc.qty::int need,coalesce(g.q,0)::int got_total,
      coalesce((select sum(i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=c.oracle_id and i.user_id=$2),0)::int free_total,
      coalesce((select sum(i.qty) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=c.oracle_id and i.user_id=$2),0)::int owned
    from deck_cards dc join cards c on c.oracle_id=dc.oracle_id
    left join (select p.oracle_id,sum(a.qty)::int q from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=$1 group by 1) g on g.oracle_id=dc.oracle_id
    where dc.deck_id=$1 order by dc.is_commander desc,c.name`, [id, uid])).rows;
  // le copie assegnate vanno prima al comandante, poi alle righe normali
  const left = new Map<string, number>(), cards: any[] = [];
  for (const r of rows) {
    const avail = left.has(r.oracle_id) ? left.get(r.oracle_id)! : r.got_total, got = Math.min(r.need, avail);
    left.set(r.oracle_id, avail - got); const { got_total, free_total, ...rest } = r; cards.push({ ...rest, got, free: free_total });
  }
  const missing = d.mode === 'physical' ? cards.reduce((t: number, r: any) => t + Math.max(0, r.need - r.got), 0) : 0;
  // da aggiungere alla collezione (solo mazzi fisici): copie non ancora assegnate al mazzo
  const need = new Map<string, number>(); for (const r of cards) need.set(r.oracle_id, (need.get(r.oracle_id) ?? 0) + r.need);
  const toCollect = [...need].reduce((t, [o, n]) => { const r = cards.find(x => x.oracle_id === o);
    const got = cards.filter(x => x.oracle_id === o).reduce((a, x) => a + x.got, 0);
    return t + (d.mode === 'physical' ? Math.max(0, n - got) : 0); }, 0);
  return { ...d, toCollect, total: cards.reduce((t: number, r: any) => t + r.need, 0), missing, cards };
};

// Un comandante fa già parte delle 100 carte: se la stessa carta è anche tra le carte normali, quella copia in più viene tolta.
// deckId omesso = tutti i mazzi. Restituisce i mazzi corretti.
export async function dedupeCommanders(c: C, deckId?: number) {
  const dup = (await c.query(`select n.deck_id::int deck_id,n.oracle_id,n.qty from deck_cards n
      join deck_cards k on k.deck_id=n.deck_id and k.oracle_id=n.oracle_id and k.is_commander
    where not n.is_commander and ($1::bigint is null or n.deck_id=$1)`, [deckId ?? null])).rows;
  for (const r of dup) {
    if (r.qty > 1) await c.query('update deck_cards set qty=qty-1 where deck_id=$1 and oracle_id=$2 and not is_commander', [r.deck_id, r.oracle_id]);
    else await c.query('delete from deck_cards where deck_id=$1 and oracle_id=$2 and not is_commander', [r.deck_id, r.oracle_id]);
  }
  const decks = [...new Set(dup.map(r => r.deck_id))];
  for (const d of decks) await syncDeck(c, d); // libera eventuali copie fisiche assegnate in più
  return decks;
}

// Aggiunge alla collezione le copie che mancano al mazzo (tutte, o solo quelle di una carta), con una stampa del catalogo:
// quella che possiedi già se c'è, altrimenti la prima disponibile. Nei mazzi fisici le copie vengono subito assegnate.
export async function collectMissing(c: C, uid: number, deckId: number, oracleId?: string) {
  const d = (await c.query('select mode,archived from decks where id=$1 and user_id=$2', [deckId, uid])).rows[0]; if (!d) throw err(404, 'Mazzo non trovato');
  const rows = (await c.query(`select dc.oracle_id,sum(dc.qty)::int need,
      coalesce((select sum(a.qty) from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=$1 and p.oracle_id=dc.oracle_id),0)::int got,
      coalesce((select sum(i.qty-coalesce((select sum(x.qty) from deck_assignments x where x.item_id=i.id),0)) from collection_items i join printings p on p.id=i.printing_id where p.oracle_id=dc.oracle_id and i.user_id=$3),0)::int free
    from deck_cards dc where dc.deck_id=$1 and ($2::uuid is null or dc.oracle_id=$2) group by dc.oracle_id`, [deckId, oracleId ?? null, uid])).rows;
  if (d.mode !== 'physical' || d.archived) throw err(400, 'Solo i mazzi fisici attivi aggiungono carte alla collezione');
  const physical = true; let added = 0;
  await syncDeck(c, deckId); // prima le copie libere che hai già
  for (const r of rows) {
    const got = physical ? (await c.query(`select coalesce(sum(a.qty),0)::int n from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=$1 and p.oracle_id=$2`, [deckId, r.oracle_id])).rows[0].n : 0;
    const n = physical ? r.need - got : r.need - r.free; if (n <= 0) continue;
    const p = (await c.query(`select p.id,p.lang from printings p left join collection_items i on i.printing_id=p.id and i.user_id=$2 where p.oracle_id=$1 order by (i.id is not null) desc,p.set_code limit 1`, [r.oracle_id, uid])).rows[0];
    if (!p) continue;
    await c.query(`insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values($4,$1,$2,$3,'nonfoil','NM')
      on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty`, [p.id, n, p.lang, uid]);
    added += n;
  }
  if (physical) await syncDeck(c, deckId);
  return { added };
}
