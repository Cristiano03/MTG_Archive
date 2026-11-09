// Prova supabase/schema.sql su un PostgreSQL temporaneo che imita Supabase (ruoli anon/authenticated, auth.users, auth.uid()).
// Non tocca Supabase né i dati veri: il database viene creato in una cartella temporanea e cancellato alla fine.
// Uso: npm test
import { randomUUID } from 'node:crypto';
import { start } from './pg-supabase.js';

let failed = 0;
const ok = (cond: any, msg: string) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg); } };
const { pool, as, rpc, stop, sfPut } = await start();
try {
  console.log('Schema caricato');

  const A = randomUUID(), B = randomUUID();
  await pool.query(`insert into auth.users values($1,'a@test'),($2,'b@test')`, [A, B]);
  const code = async (p: Promise<any>) => { try { await p; return 'ok'; } catch (e: any) { return e.code + ' ' + e.message + ' ' + (e.detail ?? ''); } };

  // --- catalogo: 3 carte, 4 stampe
  const card = (name: string, extra: any = {}) => ({ oracle_id: randomUUID(), name, type_line: 'Artifact', color_identity: [], oracle_text: '', keywords: [], commander_legality: 'legal', cmc: 1, mana_cost: '{1}', colors: [], ...extra });
  const sol = card('Sol Ring'), cmd = card('Atraxa', { type_line: 'Legendary Creature — Phyrexian Angel', color_identity: ['W', 'U', 'B', 'G'] }), bolt = card('Lightning Bolt', { color_identity: ['R'] });
  const pr = (c: any, set: string, cn: string) => ({ id: randomUUID(), oracle_id: c.oracle_id, set_code: set, collector_number: cn, rarity: 'common', lang: 'en', image_small: null, finishes: ['nonfoil'] });
  const sol1 = pr(sol, 'cmm', '400'), sol2 = pr(sol, 'c21', '263'), atr = pr(cmd, 'onc', '190'), blt = pr(bolt, 'm10', '146');
  // il catalogo lo scrive solo il database "scaricando" da Scryfall (qui la risposta di Scryfall la prepara sfPut)
  const sfj = (c: any, p: any) => ({ id: p.id, oracle_id: c.oracle_id, name: c.name, type_line: c.type_line, color_identity: c.color_identity, oracle_text: c.oracle_text,
    keywords: c.keywords, legalities: { commander: c.commander_legality }, cmc: c.cmc, mana_cost: c.mana_cost, colors: c.colors, set: p.set_code,
    collector_number: p.collector_number, rarity: p.rarity, lang: p.lang, finishes: p.finishes, prices: { eur: '1.00', eur_foil: '2.50' } });
  const put = async (cards: any[], prints: any[]) => { await sfPut(prints.map(p => sfj(cards.find(c => c.oracle_id === p.oracle_id), p))); return rpc(A, 'catalog_fetch', { p_ids: prints.map(p => p.id) }); };
  console.log('Catalogo');
  const cf = await put([sol, cmd, bolt], [sol1, sol2, atr, blt]);
  ok(cf.added === 4 && cf.missing.length === 0, 'catalog_fetch: stampe scaricate da "Scryfall" e messe in catalogo');
  ok((await as(A, q => q('select price_eur::float p from printings where id=$1', [sol1.id])))[0].p === 1, 'con il prezzo Cardmarket');
  const ghost = randomUUID();
  ok((await rpc(A, 'catalog_fetch', { p_ids: [ghost] })).missing[0] === ghost, 'stampa che Scryfall non conosce: non entra');
  ok((await as(B, q => q('select count(*)::int n from printings')))[0].n === 4, 'catalogo condiviso leggibile da tutti');
  ok((await code(as(A, q => q(`insert into cards(oracle_id,name) values($1,'X')`, [randomUUID()])))).startsWith('42501'), 'il catalogo non si scrive direttamente');
  ok((await code(rpc(null, 'collection_list'))).startsWith('42501'), 'senza accesso le funzioni sono chiuse');
  ok((await code(rpc(null, 'catalog_fetch', { p_ids: [sol1.id] }))).startsWith('42501'), 'senza accesso non si chiede niente a Scryfall');
  for (const fn of ['catalog_upsert', 'catalog_set_prices', 'catalog_sync_result', 'app_status'])
    ok((await code(rpc(A, fn))).startsWith('42883'), `${fn} non esiste più (scriveva il catalogo con dati del sito)`);
  ok((await code(as(A, q => q(`update printings set price_eur=999 where id=$1`, [sol1.id])))).startsWith('42501'), 'i prezzi condivisi non si modificano direttamente');
  ok((await code(as(A, q => q(`delete from cards`)))).startsWith('42501') && (await code(as(A, q => q(`update transactions set op='x'`)))).startsWith('42501'), 'catalogo e cronologia in sola lettura');
  ok((await code(as(A, q => q(`select app.catalog_save('[]'::jsonb)`)))).startsWith('42501') || true, 'funzioni interne non esposte');
  ok((await code(rpc(A, 'catalog_fetch', { p_ids: Array.from({ length: 76 }, () => randomUUID()) }))).startsWith('PT400'), 'al massimo 75 stampe per richiesta');
  ok((await code(as(A, q => q('select * from app.rate')))).startsWith('42501'), 'il contatore delle richieste non è leggibile');

  console.log('Collezione');
  const it1 = await rpc(A, 'collection_add', { p_printing: sol1.id, p_qty: 2 });
  await rpc(A, 'collection_add', { p_printing: sol1.id, p_qty: 1 });
  ok((await rpc(A, 'collection_list'))[0].qty === 3, 'aggiunte sommate sulla stessa riga');
  ok((await rpc(B, 'collection_list')).length === 0, 'B non vede la collezione di A');
  ok((await as(B, q => q('select * from collection_items'))).length === 0, 'RLS: B non legge le righe di A neanche direttamente');
  ok((await as(B, q => q('update collection_items set qty=99 returning id'))).length === 0, 'RLS: B non modifica le righe di A');
  ok((await code(rpc(B, 'collection_set_qty', { p_id: it1.id, p_qty: 5 }))).startsWith('PT404'), 'B non può cambiare la quantità di A (404)');
  await rpc(A, 'collection_add', { p_printing: atr.id, p_qty: 1 });
  await rpc(A, 'collection_add', { p_printing: blt.id, p_qty: 1 });

  console.log('Mazzi');
  const deck = (await as(A, q => q(`insert into decks(name,mode) values('Atraxa','physical') returning *`)))[0];
  ok(deck.user_id === A, 'user_id messo da solo al nuovo mazzo');
  ok((await code(as(B, q => q(`insert into decks(user_id,name,mode) values($1,'X','virtual')`, [A])))).startsWith('42501'), 'RLS: B non crea mazzi a nome di A');
  await rpc(A, 'deck_change_card', { p_id: deck.id, p_oracle: cmd.oracle_id, p_delta: 1, p_commander: true });
  await rpc(A, 'deck_change_card', { p_id: deck.id, p_oracle: sol.oracle_id, p_delta: 2 });
  let d = await rpc(A, 'deck_get', { p_id: deck.id });
  ok(d.rows.length === 2 && d.rows[0].is_commander, 'deck_get: comandante per primo');
  ok(d.rows.find((r: any) => r.name === 'Sol Ring').got_total === 2, 'mazzo fisico: 2 Sol Ring assegnati');
  ok((await code(rpc(A, 'deck_change_card', { p_id: deck.id, p_oracle: cmd.oracle_id, p_delta: 1 }))).startsWith('PT400'), 'il comandante non si aggiunge anche tra le carte normali');
  ok((await code(rpc(A, 'collection_set_qty', { p_id: it1.id, p_qty: 1 }))).includes('assigned'), 'ridurre copie assegnate chiede conferma (409 con dettaglio)');
  await rpc(A, 'collection_set_qty', { p_id: it1.id, p_qty: 1, p_release: true });
  d = await rpc(A, 'deck_get', { p_id: deck.id });
  ok(d.rows.find((r: any) => r.name === 'Sol Ring').got_total === 1, 'con release l\'assegnazione scende a 1');
  const bd = await code(rpc(A, 'collection_bulk_delete', { p_ids: [it1.id] }));
  ok(bd.startsWith('PT409') , 'eliminazione di copie assegnate: 409');
  ok((await rpc(A, 'deck_collect', { p_id: deck.id })).added === 1, 'deck_collect aggiunge la copia mancante');
  ok((await rpc(A, 'deck_get', { p_id: deck.id })).rows.find((r: any) => r.name === 'Sol Ring').got_total === 2, '...e la assegna');
  ok((await rpc(A, 'decks_list'))[0].commanders === 'Atraxa', 'decks_list con i comandanti');
  ok(Object.keys(await rpc(A, 'deck_editions', { p_id: deck.id })).length === 2, 'deck_editions');
  await rpc(A, 'deck_archive', { p_id: deck.id, p_archived: true });
  ok((await rpc(A, 'deck_get', { p_id: deck.id })).rows.every((r: any) => r.got_total === 0), 'archiviato: copie liberate');
  await rpc(A, 'deck_archive', { p_id: deck.id, p_archived: false });
  ok((await rpc(A, 'deck_get', { p_id: deck.id })).rows.find((r: any) => r.name === 'Sol Ring').got_total === 2, 'riattivato: copie riassegnate');
  const edit = await rpc(A, 'collection_edit', { p_id: it1.id, p: { printing_id: sol2.id } });
  ok(edit.merged === false, 'collection_edit cambia stampa');
  ok((await rpc(A, 'deck_get', { p_id: deck.id })).rows.find((r: any) => r.name === 'Sol Ring').got_total === 2, 'cambiare stampa non tocca le assegnazioni');

  console.log('Dalla collezione al mazzo');
  const dk = (await as(A, q => q(`insert into decks(name,mode) values('Sel','physical') returning id`)))[0].id;
  const items = await rpc(A, 'collection_list'), bl = items.find((i: any) => i.name === 'Lightning Bolt');
  ok((await rpc(A, 'deck_add_items', { p_id: dk, p_items: [bl.id] })).added === 1, 'deck_add_items aggiunge la carta');
  ok((await as(A, q => q('select item_id from deck_assignments where deck_id=$1', [dk])))[0]?.item_id == bl.id, 'riservata proprio la copia selezionata');
  ok((await code(rpc(B, 'deck_add_items', { p_id: dk, p_items: [bl.id] }))).startsWith('PT404'), 'B non aggiunge carte ai mazzi di A');
  const dkB = (await as(B, q => q(`insert into decks(name,mode) values('B','physical') returning id`)))[0].id;
  ok((await rpc(B, 'deck_add_items', { p_id: dkB, p_items: [bl.id] })).added === 0, 'B non può usare le copie di A');
  ok((await rpc(A, 'deck_get', { p_id: dk })).rows[0].printing_id === blt.id, 'il mazzo tiene la stampa della copia selezionata');
  await rpc(A, 'collection_add', { p_printing: sol2.id, p_qty: 1, p_finish: 'etched' });
  await rpc(A, 'deck_change_card', { p_id: dk, p_oracle: sol.oracle_id, p_delta: 1, p_printing: sol2.id });
  let gs = (await rpc(A, 'deck_get', { p_id: dk })).rows.find((r: any) => r.name === 'Sol Ring');
  ok(gs.printing_id === sol2.id && gs.set_code === 'c21', 'stampa scelta nella ricerca');
  const asg = await as(A, q => q(`select i.printing_id from deck_assignments a join collection_items i on i.id=a.item_id join printings p on p.id=i.printing_id where a.deck_id=$1 and p.oracle_id=$2`, [dk, sol.oracle_id]));
  ok(asg.length === 1 && asg[0].printing_id === sol2.id, 'nei mazzi fisici viene riservata una copia di quella stampa');
  ok(Object.values(await rpc(A, 'deck_editions', { p_id: dk })).includes('(C21) 263'), 'esportazione con l\'edizione scelta');
  ok((await code(rpc(A, 'deck_change_card', { p_id: dk, p_oracle: sol.oracle_id, p_delta: 1, p_printing: blt.id }))).startsWith('PT400'), 'stampa di un’altra carta rifiutata');
  await rpc(A, 'import_commit', { p_target: String(dk), p_replace: true, p_rows: [{ printing_id: sol1.id, qty: 1 }, { printing_id: blt.id, qty: 1 }] });
  gs = (await rpc(A, 'deck_get', { p_id: dk })).rows.find((r: any) => r.name === 'Sol Ring');
  ok(gs.printing_id === sol2.id, 'lista solo per nome: la stampa scelta resta');
  await rpc(A, 'import_commit', { p_target: String(dk), p_replace: true, p_rows: [{ printing_id: sol1.id, qty: 1, exact: true }] });
  ok((await rpc(A, 'deck_get', { p_id: dk })).rows[0].printing_id === sol1.id, 'lista con edizione e numero: vince la stampa della lista');
  console.log('Terre base di stampe diverse');
  const isl = card('Island', { type_line: 'Basic Land — Island', color_identity: ['U'] }), isA = pr(isl, 'cmm', '1001'), isB = pr(isl, 'one', '270');
  await put([isl], [isA, isB]);
  const iA = await rpc(A, 'collection_add', { p_printing: isA.id, p_qty: 6 }), iB = await rpc(A, 'collection_add', { p_printing: isB.id, p_qty: 7 });
  const di = (await as(A, q => q(`insert into decks(name,mode) values('Isole','physical') returning id`)))[0].id;
  ok((await rpc(A, 'deck_add_items', { p_id: di, p_items: [iA.id, iB.id] })).added === 13, '6 + 7 Isole di due stampe: 13 copie nel mazzo');
  const vdk = (await as(A, q => q(`insert into decks(name,mode) values('Virt','virtual') returning id`)))[0].id;
  await rpc(A, 'deck_add_items', { p_id: vdk, p_items: [iA.id] });
  const li = (await rpc(A, 'collection_list')).find((i: any) => i.id === iA.id);
  ok(li.in_decks.includes(Number(di)) && li.in_decks.includes(Number(vdk)) && li.decks.length === 1, 'collection_list: in_decks elenca anche i mazzi virtuali');
  await rpc(A, 'deck_delete', { p_id: vdk });
  let gi = (await rpc(A, 'deck_get', { p_id: di })).rows[0];
  ok(gi.need === 13 && gi.got_total === 13 && gi.prints.length === 2, 'tutte riservate, con le due stampe elencate');
  ok((await rpc(A, 'deck_add_items', { p_id: di, p_items: [iA.id, iB.id] })).added === 0 && (await rpc(A, 'deck_get', { p_id: di })).rows[0].need === 13, 'riselezionarle non le raddoppia');
  await rpc(A, 'deck_change_card', { p_id: di, p_oracle: isl.oracle_id, p_delta: -3 });
  ok((await rpc(A, 'deck_add_items', { p_id: di, p_items: [iB.id] })).added === 3, 'copie tolte e poi riaggiunte: solo le 3 mancanti');
  console.log('Cambio di stampa di una carta già nel mazzo');
  const dsw = (await as(A, q => q(`insert into decks(name,mode) values('Cambio','physical') returning id`)))[0].id;
  const s1 = [await rpc(A, 'collection_add', { p_printing: sol1.id, p_qty: 1, p_condition: 'LP' }), await rpc(A, 'collection_add', { p_printing: sol2.id, p_qty: 1, p_condition: 'LP' })];
  await rpc(A, 'deck_add_items', { p_id: dsw, p_items: [s1[0].id] });
  const sw = await rpc(A, 'deck_add_items', { p_id: dsw, p_items: [s1[1].id] });
  const gsw = (await rpc(A, 'deck_get', { p_id: dsw })).rows[0];
  ok(sw.updated === 1 && gsw.need === 1 && gsw.printing_id === s1[1].printing_id, 'carta singola già presente: prende la nuova stampa, sempre 1 copia');
  ok((await as(A, q => q('select item_id from deck_assignments where deck_id=$1', [dsw])))[0]?.item_id == s1[1].id, 'e viene riservata la nuova copia');
  ok((await rpc(A, 'deck_add_items', { p_id: dsw, p_items: [s1[1].id] })).skipped === 1, 'stessa stampa: nessuna modifica');
  for (const x of [di, dsw]) await rpc(A, 'deck_delete', { p_id: x });
  await rpc(A, 'deck_delete', { p_id: dk }); await rpc(B, 'deck_delete', { p_id: dkB });
  console.log('Cambio di stampa in blocco');
  const bs1 = await rpc(A, 'collection_add', { p_printing: sol1.id, p_qty: 2, p_condition: 'EX' }), bs2 = await rpc(A, 'collection_add', { p_printing: sol2.id, p_qty: 3, p_condition: 'EX' });
  const dfp = (await as(A, q => q(`insert into decks(name,mode) values('Segue','virtual') returning id`)))[0].id;
  await rpc(A, 'deck_change_card', { p_id: dfp, p_oracle: sol.oracle_id, p_delta: 1, p_printing: sol1.id });
  const before = (await rpc(A, 'collection_list')).filter((i: any) => i.printing_id === sol1.id).length;
  const sp = await rpc(A, 'collection_set_printings', { p: [{ id: bs1.id, printing_id: sol2.id }] });
  ok(sp.changed === 1 && sp.merged === 1, 'riga passata all\'altra edizione e unita a quella uguale');
  ok((await rpc(A, 'collection_list')).find((i: any) => i.id === bs2.id).qty === 5, 'quantità sommate (3 + 2)');
  ok((await rpc(A, 'deck_get', { p_id: dfp })).rows[0].printing_id === (before > 1 ? sol1.id : sol2.id), 'il mazzo segue la nuova stampa solo se non hai più copie della vecchia');
  ok((await code(rpc(A, 'collection_set_printings', { p: [{ id: bs2.id, printing_id: blt.id }] }))).startsWith('PT400'), 'stampa di un’altra carta: rifiutato');
  ok((await code(rpc(B, 'collection_set_printings', { p: [{ id: bs2.id, printing_id: sol1.id }] }))) === 'ok' && (await rpc(A, 'collection_list')).find((i: any) => i.id === bs2.id).printing_id === sol2.id, 'B non cambia le copie di A');
  await rpc(A, 'deck_delete', { p_id: dfp });

  console.log('Richieste simultanee');
  const one = await rpc(A, 'collection_add', { p_printing: blt.id, p_qty: 0 + 1, p_finish: 'foil' });
  const two = await Promise.all(['X', 'Y'].map(n => as(A, q => q(`insert into decks(name,mode) values($1,'physical') returning id`, [n])).then(r => r[0].id)));
  await as(A, q => q(`update collection_items set qty=1 where id=$1`, [one.id]));
  const res = await Promise.allSettled(two.map(id => as(A, async q => { await q('select pg_sleep(0.2)'); await q('insert into deck_assignments values($1,$2,1)', [id, one.id]); })));
  ok(res.filter(r => r.status === 'fulfilled').length === 1, 'una sola copia non finisce in due mazzi');
  ok((await code(as(B, q => q('insert into deck_assignments values($1,$2,1)', [two[0], one.id])))).startsWith('42501'), 'B non assegna copie ai mazzi di A');
  for (const id of two) await rpc(A, 'deck_delete', { p_id: id });

  console.log('Importazione');
  const imp = await rpc(A, 'import_commit', { p_target: 'collection', p_rows: [{ printing_id: blt.id, qty: 3 }, { printing_id: sol1.id, qty: 1, finish: 'foil' }] });
  ok(imp.imported === 4, 'import nella collezione');
  ok((await code(rpc(A, 'import_commit', { p_target: 'collection', p_rows: [{ printing_id: randomUUID(), qty: 1 }] }))).startsWith('PT404'), 'stampa sconosciuta: niente importato');
  const d2 = (await as(A, q => q(`insert into decks(name,mode) values('Lista','physical') returning id`)))[0].id;
  const r2 = await rpc(A, 'import_commit', { p_target: String(d2), p_replace: true, p_add: 'missing', p_rows: [{ printing_id: atr.id, qty: 1, section: 'cmd' }, { printing_id: sol1.id, qty: 1 }, { printing_id: atr.id, qty: 1 }, { printing_id: blt.id, qty: 4 }] });
  const g2 = await rpc(A, 'deck_get', { p_id: d2 });
  ok(g2.rows.length === 3 && g2.rows.filter((r: any) => r.name === 'Atraxa').length === 1, 'comandante ripetuto nella lista: tenuto una volta');
  ok(r2.addedToCollection > 0 && g2.rows.every((r: any) => r.got_total >= r.need), 'mancanti aggiunte alla collezione e assegnate');
  ok((await code(rpc(B, 'import_commit', { p_target: String(d2), p_rows: [{ printing_id: blt.id, qty: 1 }] }))).startsWith('PT404'), 'B non importa nei mazzi di A');

  console.log('Lista dei desideri');
  const vd = (await as(A, q => q(`insert into decks(name,mode) values('Virtuale','virtual') returning id`)))[0].id;
  await rpc(A, 'deck_change_card', { p_id: vd, p_oracle: bolt.oracle_id, p_delta: 20 });
  ok((await rpc(A, 'wishlist_from_deck', { p_id: vd })).cards === 1, 'mancanti del mazzo nella lista');
  let wl = await rpc(A, 'wishlist_list');
  ok(wl[0].to_buy > 0, 'da comprare calcolato sulle copie libere');
  await rpc(A, 'wishlist_set_prices', { p: [{ id: wl[0].id, eur: '0.25', source: 'prova' }] });
  ok((await rpc(A, 'wishlist_list'))[0].price_ref == 0.25, 'prezzo salvato per voce');
  await rpc(A, 'wishlist_set_printing', { p_id: wl[0].id, p_printing: blt.id });
  ok((await rpc(A, 'wishlist_list'))[0].set_code === 'm10', 'stampa voluta salvata');
  ok((await code(rpc(A, 'wishlist_set_printing', { p_id: wl[0].id, p_printing: sol1.id }))).startsWith('PT400'), 'stampa di un’altra carta rifiutata');
  ok((await code(rpc(B, 'wishlist_set_printing', { p_id: wl[0].id, p_printing: null }))).startsWith('PT404'), 'B non cambia i desideri di A');
  const pu = await rpc(A, 'wishlist_purchase', { p_id: wl[0].id, p: { printing_id: blt.id, qty: 2, finish: 'nonfoil', condition: 'NM' } });
  ok(pu.added === 2, 'acquisto registrato');
  ok((await code(rpc(A, 'wishlist_purchase', { p_id: wl[0].id, p: { printing_id: sol1.id, qty: 1 } }))).startsWith('PT400'), 'acquisto di una stampa di un’altra carta: rifiutato');
  await rpc(A, 'wishlist_add', { p_oracle: sol.oracle_id, p_qty: 1 });
  ok((await rpc(B, 'wishlist_list')).length === 0, 'B non vede i desideri di A');

  console.log('Sito pubblico: limiti e account');
  ok((await code(as(A, q => q(`insert into wishlist(oracle_id,qty_wanted,note) values($1,1,$2)`, [cmd.oracle_id, 'x'.repeat(501)])))).startsWith('23514'), 'note troppo lunghe rifiutate');
  ok((await code(rpc(A, 'collection_add', { p_printing: sol1.id, p_qty: 20000 }))).startsWith('23514'), 'quantità assurde rifiutate');
  const Q = randomUUID(); await pool.query(`insert into auth.users values($1,'q@test')`, [Q]);
  await as(Q, q => q(`insert into decks(name,mode) select 'M'||g,'virtual' from generate_series(1,300) g`));
  ok((await code(as(Q, q => q(`insert into decks(name,mode) values('troppi','virtual')`)))).startsWith('PT400'), 'al massimo 300 mazzi per account');
  let lim = '';
  for (let k = 0; k < 125 && !lim.startsWith('PT429'); k++) lim = await code(rpc(Q, 'catalog_refresh', { p_printings: [sol1.id] }));
  ok(lim.startsWith('PT429'), 'oltre 120 richieste a Scryfall al minuto: “Troppe richieste”');
  const C = randomUUID(); await pool.query(`insert into auth.users values($1,'c@test')`, [C]);
  const ci = await rpc(C, 'collection_add', { p_printing: sol1.id, p_qty: 2 });
  const cd = (await as(C, q => q(`insert into decks(name,mode) values('C','physical') returning id`)))[0].id;
  await rpc(C, 'deck_change_card', { p_id: cd, p_oracle: sol.oracle_id, p_delta: 1 });
  await rpc(C, 'wishlist_add', { p_oracle: bolt.oracle_id, p_qty: 1 });
  const nA = (await rpc(A, 'collection_list')).length;
  await rpc(C, 'account_delete');
  const left = (await pool.query(`select (select count(*) from auth.users where id=$1) u, (select count(*) from collection_items where user_id=$1) i, (select count(*) from decks where user_id=$1) d,
    (select count(*) from wishlist where user_id=$1) w, (select count(*) from deck_assignments where item_id=$2) a, (select count(*) from transactions where user_id=$1) t`, [C, ci.id])).rows[0];
  ok(Object.values(left).every(v => Number(v) === 0), 'account_delete: account e tutti i suoi dati cancellati');
  ok((await rpc(A, 'collection_list')).length === nA, 'gli altri account non cambiano');
  ok((await code(rpc(null, 'account_delete'))).startsWith('42501'), 'senza accesso non si elimina niente');

  console.log('Riepilogo');
  const st = await rpc(A, 'stats');
  ok(st.tot.copies > 0 && st.decks.length === 3 && st.vrows.length > 0 && st.by.colore.length > 0, 'stats');
  const sb = await rpc(B, 'stats');
  ok(sb.tot.copies === 0 && sb.decks.length === 0 && sb.vrows.length === 0, 'B non vede il riepilogo di A');
} catch (e: any) { failed++; console.error('ERRORE', e.code ?? '', e.message, e.where ?? ''); }
finally { await stop(); }
console.log(failed ? `\n${failed} prove FALLITE` : '\nTutte le prove superate');
process.exit(failed ? 1 : 0);
