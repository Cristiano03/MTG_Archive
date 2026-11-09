// Prova il sito senza browser: le operazioni di frontend/services/routes.ts (quelle che chiamano le pagine con api())
// girano contro il PostgreSQL temporaneo di pg-supabase.ts, con un finto client Supabase che fa ciò che fa PostgREST
// (ogni chiamata è una transazione con il ruolo "authenticated" e l'utente collegato). Scryfall è quello vero (serve la rete).
// Uso: npm run test:web
import { randomUUID } from 'node:crypto';
import { start } from './pg-supabase.js';
import { installMock } from './mock-supabase.js';

let failed = 0;
const ok = (cond: any, msg: string) => { if (cond) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg); } };
const h = await start();
let uid = randomUUID();
await installMock(h, () => uid);
const { api, apiText } = await import('../frontend/services/api.js');
const st = async (p: Promise<any>) => { try { await p; return 200; } catch (e: any) { return e.status; } };

try {
  await h.pool.query(`insert into auth.users values($1,'u@test')`, [uid]);
  console.log('Importazione da testo (Scryfall vero)');
  const prev = (await api('/import/preview', 'POST', { text: "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring (CMM) 410\n4 Fulmine\n1 Carta Che Non Esiste Xyzq" })).rows;
  ok(prev[0].status === 'ok' && prev[0].section === 'cmd', 'comandante riconosciuto');
  ok(prev[1].status === 'ok' && prev[1].set_code === 'cmm', 'edizione e numero rispettati');
  ok(prev[2].status === 'fuzzy' && prev[2].card_name === 'Lightning Bolt', 'nome italiano interpretato');
  ok(prev[3].status === 'err', 'carta inesistente segnalata');
  const good = prev.filter((r: any) => r.printing_id);
  ok((await api('/import/commit', 'POST', { target: 'collection', rows: good.map((r: any) => ({ printing_id: r.printing_id, qty: r.qty })) })).imported === 6, 'importate 6 copie nella collezione');
  const col = await api('/collection');
  ok(col.length === 3 && col.every((i: any) => i.free === i.qty), 'collezione con 3 righe libere');

  console.log('Mazzi');
  const deck = await api('/decks', 'POST', { name: 'Atraxa', mode: 'physical' });
  ok(deck.id && deck.mode === 'physical', 'mazzo creato');
  const r = await api('/import/commit', 'POST', { target: deck.id, replace: true, addToCollection: 'missing', rows: good.map((r: any) => ({ printing_id: r.printing_id, qty: r.qty, section: r.section })) });
  ok(r.imported === 6 && r.addedToCollection === 0, 'lista nel mazzo: usa le copie libere, niente da aggiungere');
  let d = await api('/decks/' + deck.id);
  ok(d.cards.length === 3 && d.cards[0].is_commander && d.missing === 0 && d.total === 6, 'mazzo: comandante, 6 carte, nessuna mancante');
  const v = await api(`/decks/${deck.id}/validation`);
  ok(v.status === 'non valido' && v.count === 6 && v.issues.some((i: any) => /Lightning Bolt fuori identità/.test(i.text)), 'validazione: Fulmine fuori identità di colore');
  const signet = await (await fetch('https://api.scryfall.com/cards/named?exact=Arcane%20Signet')).json();
  const k = await api('/catalog/printings', 'POST', { id: signet.id });
  ok(k.oracle_id === signet.oracle_id && k.name === 'Arcane Signet', 'stampa nuova aggiunta al catalogo');
  d = await api(`/decks/${deck.id}/cards`, 'POST', { oracle_id: k.oracle_id, delta: 1, is_commander: false });
  ok(d.missing === 1 && d.toCollect === 1, 'carta che non hai: risulta mancante');
  ok((await api(`/decks/${deck.id}/collect`, 'POST', {})).added === 1, 'aggiunta alla collezione la mancante');
  const sections = await apiText(`/decks/${deck.id}/export?format=sections`), mox = await apiText(`/decks/${deck.id}/export?format=moxfield`);
  ok(/^Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n/.test(sections), 'esportazione con sezioni');
  ok(mox.includes('1 Sol Ring (CMM) 410'), 'esportazione con edizioni'); if (!mox.includes('1 Sol Ring (CMM) 410')) console.log('MOX>>' + mox.replace(/\n/g, ' | '));
  ok((await apiText(`/decks/${deck.id}/export?format=plain&missing=1`)).trim() === '', 'nessuna mancante da esportare');
  ok((await api('/decks/' + deck.id, 'PATCH', { name: 'Atraxa +1' })).name === 'Atraxa +1', 'rinomina');
  ok((await api('/decks'))[0].commanders === "Atraxa, Praetors' Voice", 'elenco mazzi con comandante');

  console.log('Collezione');
  const bolt = (await api('/collection')).find((i: any) => i.name === 'Lightning Bolt');
  ok(bolt.assigned === 4, 'i 4 Fulmine sono assegnati al mazzo');
  const e409 = await api('/collection/' + bolt.id, 'PATCH', { qty: 2 }).catch(e => e);
  ok(e409.status === 409, 'ridurre copie assegnate: 409');
  await api('/collection/' + bolt.id, 'PATCH', { qty: 3, release: true });
  ok((await api('/decks/' + deck.id)).missing === 1, 'con conferma: il mazzo ne ha una in meno');
  const bulk = await api('/collection/bulk-delete', 'POST', { ids: [bolt.id] }).catch(e => e);
  ok(bulk.status === 409 && bulk.data?.assigned?.[0] === 'Lightning Bolt', 'eliminazione: 409 con i nomi delle carte assegnate');
  const ed = await api(`/collection/${bolt.id}/attrs`, 'PATCH', { finish: 'foil', note: 'prova' });
  ok(ed.merged === false && (await api('/collection')).find((i: any) => i.id === bolt.id).finish === 'foil', 'cambio finitura');
  ok(await st(api(`/collection/${bolt.id}/attrs`, 'PATCH', { finish: 'oro' })) === 400, 'finitura non valida: 400');

  console.log('Dalla collezione al mazzo');
  const dd = await api('/decks', 'POST', { name: 'Dalla collezione', mode: 'physical' });
  const coll = await api('/collection'), sol = coll.find((i: any) => i.name === 'Sol Ring'), atx = coll.find((i: any) => i.name.startsWith('Atraxa'));
  const ad = await api(`/decks/${dd.id}/add-items`, 'POST', { item_ids: [sol.id, atx.id] });
  ok(ad.added === 2 && ad.skipped === 0, 'due carte selezionate aggiunte al mazzo');
  const gd = await api('/decks/' + dd.id);
  ok(gd.cards.length === 2 && gd.cards.every((c: any) => c.need === 1), 'una copia per carta');
  ok(gd.cards.find((c: any) => c.name === 'Sol Ring').got === 0, 'Sol Ring: nessuna copia libera, risulta mancante');
  ok((await api(`/decks/${dd.id}/add-items`, 'POST', { item_ids: [sol.id] })).skipped === 1, 'carta già nel mazzo: saltata');
  ok(gd.cards.find((c: any) => c.name === 'Sol Ring').set_code === sol.set_code && gd.cards.find((c: any) => c.name === 'Sol Ring').image === sol.image_small, 'il mazzo mostra la stampa della collezione');
  ok((await apiText(`/decks/${dd.id}/export?format=moxfield`)).includes(`1 Sol Ring (${sol.set_code.toUpperCase()}) ${sol.collector_number}`), 'esportazione con l’edizione della collezione');
  ok(await st(api(`/decks/${dd.id}/add-items`, 'POST', { item_ids: [] })) === 400, 'nessuna carta selezionata: 400');
  await api('/decks/' + dd.id, 'DELETE');
  console.log('Lista dei desideri');
  const vd = await api('/decks', 'POST', { name: 'Virtuale', mode: 'virtual' });
  await api(`/decks/${vd.id}/cards`, 'POST', { oracle_id: k.oracle_id, delta: 1 });
  ok((await api(`/wishlist/from-deck/${vd.id}`, 'POST')).cards === 1, 'virtuale: l’unica copia è nel mazzo fisico, quindi va comprata');
  let wl = await api('/wishlist');
  ok(wl[0].printing_id === null && wl[0].price_ref > 0 && /più economica/.test(wl[0].price_source), `qualsiasi stampa: prezzo della più economica (${wl[0].price_ref} €, ${wl[0].price_source})`);
  await api('/wishlist', 'POST', { printing_id: signet.id, qty: 2 });
  wl = await api('/wishlist');
  ok(wl.length === 1 && wl[0].qty_wanted === 3 && wl[0].printing_id === signet.id, 'desiderio aggiunto alla voce esistente (1 + 2), con la stampa scelta');
  await api('/wishlist/' + wl[0].id, 'PATCH', { note: 'per Atraxa', priority: 1 });
  ok((await api('/wishlist'))[0].note === 'per Atraxa', 'nota salvata');
  const pr = await api('/wishlist/prices', 'POST'); wl = await api('/wishlist');
  ok(pr.updated === 1 && wl[0].price_source.includes(`${signet.set.toUpperCase()} ${signet.collector_number}`) && (wl[0].price_ref == null) === (signet.prices.eur == null && signet.prices.eur_foil == null),
    `prezzo della stampa scelta (${wl[0].price_ref ?? 'nessuno'} €, ${wl[0].price_source})`);
  await api(`/wishlist/${wl[0].id}/printing`, 'POST', { printing_id: null });
  ok(/più economica/.test((await api('/wishlist'))[0].price_source), 'tornata a qualsiasi stampa: di nuovo la più economica');
  ok((await apiText('/export/wishlist.txt')).includes('Arcane Signet'), 'esportazione lista');
  const pu = await api(`/wishlist/${wl[0].id}/purchase`, 'POST', { printing_id: signet.id, qty: 1, finish: 'nonfoil', condition: 'NM', assign: true });
  ok(pu.added === 1 && pu.remaining === 2 && pu.assignedTo.length === 0, 'acquisto: 1 copia, 2 ancora in lista');
  const conv = await api(`/decks/${vd.id}/convert`, 'POST', {});
  ok(conv.converted === true, 'virtuale -> fisico');
  await api(`/decks/${vd.id}/archive`, 'POST', { archived: true });
  ok((await api('/decks/' + vd.id)).archived === true, 'archiviato');
  await api('/decks/' + vd.id, 'DELETE');
  ok(await st(api('/decks/' + vd.id)) === 404, 'eliminato');

  console.log('Riepilogo, legalità, esportazioni');
  const s = await api('/stats');
  ok(s.copies > 0 && s.activeDecks === 1 && s.problems.length === 1 && s.by.colore.length > 0 && s.recent.length > 0, 'statistiche della Home');
  const rf = await api('/catalog/refresh', 'POST').catch(e => ({ error: e.message })); ok(rf.updated === 4, 'legalità aggiornata da Scryfall'); if (rf.updated !== 4) console.log('REFRESH>>', rf);
  ok((await api('/stats')).banlist.lastOk, 'data dell\'ultimo aggiornamento registrata');
  ok((await apiText('/export/collection.csv')).startsWith('﻿nome,set,numero'), 'CSV');

  console.log('Prezzi Cardmarket (Scryfall vero)');
  const p1 = await api('/prices/collection', 'POST', {});
  ok(p1.updated === 0, 'prezzi già presenti: arrivano con la carta quando entra in catalogo');
  ok((await api('/prices/collection', 'POST', {})).updated === 0, 'prezzi recenti: niente da riscaricare');
  const val = (await api('/stats')).value;
  const cp = await api('/collection');
  ok(cp.every((i: any) => i.price_at) && cp.some((i: any) => i.price > 0) && Math.abs(cp.reduce((t: number, i: any) => t + (i.price ?? 0) * i.qty, 0) - val.eur) < 0.01, 'collezione: prezzo per riga, la somma è il valore della Home');
  ok(val.eur > 0 && val.oldest && val.never === 0, `valore della collezione: ${val.eur.toFixed(2)} €`);
  const dv = await api('/decks/' + deck.id);
  ok(dv.value.eur > 0 && dv.value.oldest, `valore del mazzo: ${dv.value.eur.toFixed(2)} €`);
  ok((await api(`/prices/deck/${deck.id}`, 'POST', { force: true })).updated >= 1, 'aggiornamento forzato dei prezzi del mazzo');

  console.log('Cambio di stampa in blocco (Scryfall vero)');
  const cl = await api('/collection'), pickIds = cl.filter((i: any) => ['Sol Ring', 'Arcane Signet'].includes(i.name)).map((i: any) => i.id);
  const sets = await api('/collection/common-sets', 'POST', { item_ids: pickIds });
  const full = sets.filter((x: any) => x.all);
  ok(full.length > 3 && full.every((x: any) => x.changes.length === pickIds.length), `${full.length} edizioni con sia Sol Ring sia Arcane Signet`);
  const target = full.find((x: any) => !x.current);
  const rsp = await api('/collection/set-printings', 'POST', { changes: target.changes });
  const after = (await api('/collection')).filter((i: any) => ['Sol Ring', 'Arcane Signet'].includes(i.name));
  ok(rsp.changed >= 1 && after.every((i: any) => i.set_code === target.set), `carte passate a ${target.set_name}`);

  // come un precostruito senza terre base: un'Isola insieme alle carte del mazzo
  const isl = await (await fetch('https://api.scryfall.com/cards/named?exact=Island&set=fdn')).json();
  await api('/collection', 'POST', { printing_id: isl.id, qty: 3 });
  const cl2 = await api('/collection'), withLand = cl2.filter((i: any) => ['Sol Ring', 'Arcane Signet', 'Island'].includes(i.name));
  const sets2 = await api('/collection/common-sets', 'POST', { item_ids: withLand.map((i: any) => i.id) });
  const fdc = sets2.find((x: any) => x.set === 'fdc');
  ok(fdc && !fdc.all && fdc.cards === 2 && fdc.total === 3, 'con un\'Isola: Foundations Commander proposta con 2 carte su 3');
  await api('/collection/set-printings', 'POST', { changes: fdc.changes });
  const cl3 = await api('/collection');
  ok(cl3.filter((i: any) => ['Sol Ring', 'Arcane Signet'].includes(i.name)).every((i: any) => i.set_code === 'fdc') && cl3.find((i: any) => i.name === 'Island').set_code === 'fdn', 'cambiano solo le carte presenti in FDC, l\'Isola resta');

  console.log('Altri account');
  const other = uid; uid = randomUUID(); await h.pool.query(`insert into auth.users values($1,'v@test')`, [uid]);
  ok((await api('/collection')).length === 0 && (await api('/decks')).length === 0 && (await api('/stats')).copies === 0, 'il secondo account parte vuoto');
  ok(await st(api('/decks/' + deck.id)) === 404 && await st(api(`/decks/${deck.id}/cards`, 'POST', { oracle_id: k.oracle_id, delta: 1 })) === 404, 'non vede né modifica i mazzi del primo');
  uid = other;
  ok((await api('/collection')).length === 5, 'il primo account non è cambiato');
  ok(await st(api('/non/esiste')) === 404, 'operazione sconosciuta: 404');
} catch (e: any) { failed++; console.error('ERRORE', e.status ?? '', e.message, e.stack?.split('\n').slice(1, 4).join('\n')); }
finally { await h.stop(); }
console.log(failed ? `\n${failed} prove FALLITE` : '\nTutte le prove superate');
process.exit(failed ? 1 : 0);
