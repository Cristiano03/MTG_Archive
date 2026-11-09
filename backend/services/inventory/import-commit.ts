import { type C, log } from '../../database/pool.js';
import { err, int } from '../errors.js';
import { lockDeck, syncDeck, dedupeCommanders } from './decks.js';
import { ensurePrinting } from '../card-catalog/scryfall.js';
import { FIN, COND } from './collection.js';

// Conferma di un'importazione (tutto o niente).
// target: 'collection' oppure l'id di un mazzo.
// replace (solo mazzi): sostituisce le carte del mazzo con quelle della lista. Se la lista non ha una sezione
//   "Commander", il comandante attuale resta (le liste in testo semplice di solito non lo indicano).
// addToCollection (solo mazzi fisici): 'missing' aggiunge alla collezione le copie che non hai già libere,
//   'all' aggiunge tutte le carte come copie nuove (es. un mazzo appena comprato), 'none' non tocca la collezione.
export async function commitImport(c: C, uid: number, body: any) {
  const { target, rows, replace = false, addToCollection = 'none' } = body;
  if (!Array.isArray(rows) || !rows.length) throw err(400, 'Nessuna riga da importare');
  if (!['none', 'missing', 'all'].includes(addToCollection)) throw err(400, 'Opzione collezione non valida');
  const deckId = target === 'collection' ? null : int(target);
  const deck = deckId !== null ? await lockDeck(c, deckId, uid) : null;

  // prepara le righe: stampa in catalogo, finitura e condizione valide
  const prepared: { printing_id: string; oracle_id: string; lang: string; qty: number; finish: string; cond: string; cmd: boolean }[] = [];
  for (const r of rows) {
    const qty = int(r.qty), finish = r.finish ?? 'nonfoil', cond = r.condition ?? 'NM';
    if (!FIN.includes(finish) || !COND.includes(cond)) throw err(400, 'Finitura o condizione non valida');
    await ensurePrinting(c, r.printing_id); // le stampe scelte dallo scanner possono non essere ancora in catalogo
    const p = (await c.query('select oracle_id,lang from printings where id=$1', [r.printing_id])).rows[0];
    prepared.push({ printing_id: r.printing_id, oracle_id: p.oracle_id, lang: p.lang, qty, finish, cond, cmd: r.section === 'cmd' });
  }
  const addCopies = (printing: string, lang: string, qty: number, finish = 'nonfoil', cond = 'NM') => c.query(
    `insert into collection_items(user_id,printing_id,qty,lang,finish,condition) values($6,$1,$2,$3,$4,$5)
     on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty`, [printing, qty, lang, finish, cond, uid]);
  const total = prepared.reduce((t, r) => t + r.qty, 0);

  if (deckId === null) {
    for (const r of prepared) await addCopies(r.printing_id, r.lang, r.qty, r.finish, r.cond);
    await log(c, 'import.commit', { target, lines: rows.length, copies: total }, uid);
    return { imported: total, addedToCollection: total };
  }

  if (replace) {
    const hasCmd = prepared.some(r => r.cmd);
    await c.query(`delete from deck_cards where deck_id=$1 ${hasCmd ? '' : 'and not is_commander'}`, [deckId]);
  }
  for (const r of prepared)
    await c.query('insert into deck_cards values($1,$2,$3,$4) on conflict(deck_id,oracle_id,is_commander) do update set qty=deck_cards.qty+$3', [deckId, r.oracle_id, r.qty, r.cmd]);
  const cmds = (await c.query('select coalesce(sum(qty),0)::int n from deck_cards where deck_id=$1 and is_commander', [deckId])).rows[0].n;
  if (cmds > 2) throw err(400, 'La lista indica più di 2 comandanti');
  await c.query('update deck_cards set qty=1 where deck_id=$1 and is_commander and qty>1', [deckId]);
  await dedupeCommanders(c, deckId); // liste che ripetono il comandante anche nel mazzo
  await syncDeck(c, deckId); // prima usa le copie libere che hai già

  let added = 0;
  if (deck.mode === 'physical' && !deck.archived && addToCollection !== 'none') {
    if (addToCollection === 'all') {
      for (const r of prepared) { await addCopies(r.printing_id, r.lang, r.qty); added += r.qty; }
    } else {
      // copie ancora mancanti al mazzo dopo aver usato quelle libere: si aggiungono con la stampa della lista
      const miss = (await c.query(`select dc.oracle_id,sum(dc.qty)::int need,
          coalesce((select sum(a.qty) from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id
            where a.deck_id=$1 and p.oracle_id=dc.oracle_id),0)::int got
        from deck_cards dc where dc.deck_id=$1 group by dc.oracle_id`, [deckId])).rows.filter((r: any) => r.need > r.got);
      for (const m of miss) {
        const r = prepared.find(x => x.oracle_id === m.oracle_id);
        const pr = r ?? (await c.query('select id printing_id,lang from printings where oracle_id=$1 limit 1', [m.oracle_id])).rows[0];
        if (!pr) continue;
        await addCopies(pr.printing_id, pr.lang, m.need - m.got); added += m.need - m.got;
      }
    }
    await syncDeck(c, deckId); // assegna al mazzo le copie appena aggiunte
  }
  await c.query('update decks set updated_at=now() where id=$1', [deckId]);
  await log(c, 'import.commit', { target, lines: rows.length, copies: total, replace, addToCollection, added }, uid);
  return { imported: total, addedToCollection: added };
}
