import { type C, log } from './pool.js';
import { err } from '../services/errors.js';

// migrazione una tantum dal backup JSON della versione HTML (solo su database vuoto)
export async function migrateHtmlBackup(c: C, uid: number, b: any) {
  if (!b?.P || !Array.isArray(b.items) || !Array.isArray(b.decks)) throw err(400, 'File di backup non valido');
  if (+(await c.query('select (select count(*) from collection_items where user_id=$1)+(select count(*) from decks where user_id=$1) n', [uid])).rows[0].n > 0) throw err(409, 'Il tuo account contiene già dati: la migrazione richiede una collezione vuota');
  const have = new Set<string>(), skipped: string[] = [];
  for (const [oid, pid] of Object.entries<any>(b.C ?? {})) { const p = b.P[pid]; if (!p) continue; have.add(oid);
    await c.query('insert into cards(oracle_id,name,type_line,color_identity,oracle_text,keywords,commander_legality,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing',
      [oid, p.name, p.type ?? '', p.ci ?? [], p.or ?? '', p.kw ?? [], p.leg ?? null, new Date(p.t || 0)]); }
  for (const p of Object.values<any>(b.P)) if (have.has(p.oid))
    await c.query('insert into printings(id,oracle_id,set_code,collector_number,rarity,lang,image_small) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing', [p.id, p.oid, p.set, p.cn, p.rar, p.lang ?? 'en', p.img]);
  const itemMap = new Map<string, number>(), deckMap = new Map<string, number>(); let items = 0, cardsN = 0, asg = 0;
  for (const i of b.items) { if (!have.has(b.P[i.pid]?.oid)) { skipped.push(i.pid); continue; }
    itemMap.set(i.id, (await c.query('insert into collection_items(user_id,printing_id,qty,lang,finish,condition,note) values($7,$1,$2,$3,$4,$5,$6) on conflict(user_id,printing_id,lang,finish,condition) do update set qty=collection_items.qty+excluded.qty returning id',
      [i.pid, i.qty, i.lang ?? 'en', i.fin ?? 'nonfoil', i.cond ?? 'NM', i.note ?? null, uid])).rows[0].id); items += i.qty; }
  for (const d of b.decks) {
    const id = (await c.query('insert into decks(user_id,name,mode,archived,description) values($5,$1,$2,$3,$4) returning id', [d.name, d.mode === 'physical' ? 'physical' : 'virtual', !!d.arch, d.desc ?? null, uid])).rows[0].id; deckMap.set(d.id, id);
    for (const o of d.cmd ?? []) if (have.has(o)) { await c.query('insert into deck_cards values($1,$2,1,true) on conflict do nothing', [id, o]); cardsN++; }
    for (const k of d.cards ?? []) if (have.has(k.oid) && k.qty > 0) { await c.query('insert into deck_cards values($1,$2,$3,false) on conflict do nothing', [id, k.oid, k.qty]); cardsN += k.qty; }
  }
  for (const a of b.asg ?? []) if (a.qty > 0 && deckMap.has(a.deck) && itemMap.has(a.item)) { await c.query('insert into deck_assignments values($1,$2,$3) on conflict(deck_id,item_id) do update set qty=deck_assignments.qty+excluded.qty', [deckMap.get(a.deck), itemMap.get(a.item), a.qty]); asg += a.qty; }
  await log(c, 'import.migrate', { items, decks: b.decks.length, cardsN, asg, skipped: skipped.length }, uid);
  return { copies: items, decks: b.decks.length, deck_cards: cardsN, assigned: asg, skipped_items: skipped.length };
}
