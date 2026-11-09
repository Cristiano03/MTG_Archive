// Le operazioni che prima faceva il server, con gli stessi indirizzi (/collection, /decks/:id, …): le pagine chiamano
// api(path, method, body) come prima, ma qui ogni operazione diventa una funzione del database (supabase.rpc) o una query
// sulle tabelle, protette dalle regole RLS. Le operazioni a più passi sono funzioni SQL: tutto o niente.
import { supabase, rpc, rows } from './supabase';
import { ensurePrintings, previewImport, printsOfCards, refreshLegality, refreshPrices, refreshPrintingPrices } from './scryfall';
import { validateDeck } from './validate';

type Any = any;
// risposta da scaricare o copiare (al posto delle risposte "attachment" del server)
export type FileOut = { file: true; name: string; type: string; text: string };
type Ctx = { body: Any; query: URLSearchParams; p: string[] };
const fail = (status: number, msg: string, data?: Any) => Object.assign(new Error(msg), { status, data });
const int = (x: Any, min = 1) => { const n = Number(x); if (!Number.isInteger(n) || n < min) throw fail(400, 'Numero intero non valido'); return n; };
const file = (name: string, type: string, text: string): FileOut => ({ file: true, name, type, text });

// ---------- mazzi: dati grezzi dal database, calcoli come faceva il server
async function deckInfo(id: number) {
  const { deck: d, rows: r } = await rpc('deck_get', { p_id: id });
  // le copie assegnate vanno prima al comandante, poi alle righe normali (comandante e carte normali restano righe separate)
  const left = new Map<string, number>(), cards: Any[] = [];
  for (const x of r) {
    const avail = left.has(x.oracle_id) ? left.get(x.oracle_id)! : x.got_total, got = Math.min(x.need, avail);
    left.set(x.oracle_id, avail - got);
    const { got_total, free_total, oracle_text, keywords, commander_legality, updated_at, ...rest } = x;
    cards.push({ ...rest, got, free: free_total });
  }
  const missing = d.mode === 'physical' ? cards.reduce((t, c) => t + Math.max(0, c.need - c.got), 0) : 0;
  // da aggiungere alla collezione (solo mazzi fisici): copie non ancora assegnate al mazzo
  const need = new Map<string, number>(); for (const c of cards) need.set(c.oracle_id, (need.get(c.oracle_id) ?? 0) + c.need);
  const toCollect = d.mode !== 'physical' ? 0 : [...need].reduce((t, [o, n]) => t + Math.max(0, n - cards.filter(x => x.oracle_id === o).reduce((a, x) => a + x.got, 0)), 0);
  // valore del mazzo: ogni carta al prezzo Cardmarket della stampa mostrata
  const priced = (c: Any) => c.price_eur ?? c.price_eur_foil;
  const value = { eur: cards.reduce((t, c) => t + (priced(c) != null ? c.need * Number(priced(c)) : 0), 0), unpriced: cards.reduce((t, c) => t + (priced(c) == null ? c.need : 0), 0),
    oldest: cards.reduce((m: string | null, c) => !c.price_at ? m : !m || c.price_at < m ? c.price_at : m, null), never: cards.filter(c => !c.price_at).length };
  return { ...d, toCollect, total: cards.reduce((t, c) => t + c.need, 0), missing, cards, value, vrows: r.map((x: Any) => ({ ...x, qty: x.need })) };
}
const validation = async (id: number) => { const d = await deckInfo(id); return validateDeck(d.vrows, d.archived); };

// Lista del mazzo in testo.
// format: 'plain' = "1 Sol Ring" (come l'esportazione in testo di Moxfield), 'moxfield' = "1 Sol Ring (CMM) 400" (con edizione),
//         'sections' = con le intestazioni Commander / Deck (si reimporta mantenendo il comandante). missing=1: solo le copie mancanti.
async function deckExport(id: number, q: URLSearchParams) {
  const d = await deckInfo(id), onlyMissing = q.get('missing') === '1';
  const format = ['plain', 'moxfield', 'sections'].includes(q.get('format') ?? '') ? q.get('format') : 'plain';
  const ed: Record<string, string> = format === 'moxfield' ? await rpc('deck_editions', { p_id: id }) : {};
  const keep = (c: Any) => !onlyMissing || c.need > c.got;
  const line = (c: Any) => `${onlyMissing ? c.need - c.got : c.need} ${c.name}${format === 'moxfield' && ed[c.oracle_id] ? ' ' + ed[c.oracle_id] : ''}`;
  const cmd = d.cards.filter((c: Any) => c.is_commander && keep(c)).map(line), main = d.cards.filter((c: Any) => !c.is_commander && keep(c)).map(line);
  const text = format === 'sections' ? [...(cmd.length ? ['Commander', ...cmd, ''] : []), ...(main.length ? ['Deck', ...main] : [])].join('\n') : [...cmd, ...main].join('\n');
  return file(d.name.replace(/[^\w-]+/g, '_') + (onlyMissing ? '-mancanti' : '') + '.txt', 'text/plain', text + '\n');
}

// ---------- riepilogo della Home
async function stats() {
  const s = await rpc('stats'), active = s.decks.filter((d: Any) => !d.archived), problems: Any[] = [];
  let valid = 0, invalid = 0, missing = 0;
  for (const d of active) {
    const v = validateDeck(s.vrows.filter((r: Any) => r.deck_id === d.id), false), m = d.mode === 'physical' ? d.missing : 0; missing += m;
    if (v.status === 'valido') valid++; else if (v.status === 'non valido') invalid++;
    if (v.status !== 'valido' || m) problems.push({ id: d.id, name: d.name, status: v.status, missing: m });
  }
  return { copies: s.tot.copies, prints: s.tot.prints, unique: s.tot.uniq, assigned: s.assigned, free: s.tot.copies - s.assigned, activeDecks: active.length, valid, invalid, missing, problems,
    banlist: { lastOk: s.sync?.last_ok ?? null, lastError: s.sync?.last_error ?? null, oldest: s.oldest, stale: !!s.oldest && Date.now() - new Date(s.oldest).getTime() > 7 * 864e5 },
    recent: s.recent, by: s.by, value: s.value };
}

// ---------- cambio di stampa in blocco
// Edizioni che contengono le carte selezionate: prima quelle che le hanno TUTTE, poi quelle che ne hanno almeno due
// (es. un mazzo precostruito senza le terre base): lì cambiano solo le carte presenti, le altre restano come sono.
// Per ogni riga si sceglie la stampa con la stessa finitura della copia, poi il numero di collezione più basso
// (la versione principale, non le varianti showcase o borderless).
async function commonSets(itemIds: number[]) {
  const items = (await rpc('collection_list')).filter((i: Any) => itemIds.includes(i.id));
  if (!items.length) throw fail(400, 'Nessuna carta selezionata');
  const oracleOf = new Map<string, string>(), pids = [...new Set<string>(items.map((i: Any) => i.printing_id))];
  for (let k = 0; k < pids.length; k += 100)
    rows(await supabase.from('printings').select('id, oracle_id').in('id', pids.slice(k, k + 100))).forEach((r: Any) => oracleOf.set(r.id, r.oracle_id));
  const oracles = [...new Set(oracleOf.values())];
  const bySet = new Map<string, { set: string; set_name: string; released_at: string; by: Map<string, Any[]> }>();
  for (const c of await printsOfCards(oracles)) {
    const o = c.oracle_id ?? c.card_faces?.[0]?.oracle_id; if (!o) continue;
    const e = bySet.get(c.set) ?? { set: c.set, set_name: c.set_name, released_at: c.released_at, by: new Map() }; bySet.set(c.set, e);
    e.by.set(o, [...(e.by.get(o) ?? []), c]);
  }
  const num = (c: Any) => { const n = parseInt(c.collector_number, 10); return Number.isNaN(n) ? 1e9 : n; };
  const pick = (opts: Any[], finish: string) => [...opts].sort((a, b) => Number((b.finishes ?? []).includes(finish)) - Number((a.finishes ?? []).includes(finish)) || num(a) - num(b) || a.collector_number.localeCompare(b.collector_number))[0];
  const min = Math.min(2, oracles.length);
  return [...bySet.values()].filter(e => e.by.size >= min)
    .sort((a, b) => b.by.size - a.by.size || b.released_at.localeCompare(a.released_at)).slice(0, 40).map(e => {
      const changes = items.filter((i: Any) => e.by.has(oracleOf.get(i.printing_id)!)).map((i: Any) => ({ id: i.id, printing_id: pick(e.by.get(oracleOf.get(i.printing_id)!)!, i.finish).id, current: i.printing_id }));
      return { set: e.set, set_name: e.set_name, released_at: e.released_at, cards: e.by.size, total: oracles.length, all: e.by.size === oracles.length,
        current: changes.every((c: Any) => c.printing_id === c.current), changes: changes.map(({ current, ...c }: Any) => c) };
    });
}

// ---------- tabella delle operazioni: [metodo, percorso con :parametri, funzione]
const R: [string, string, (c: Ctx) => Promise<Any>][] = [
  // collezione
  ['GET', '/collection', () => rpc('collection_list')],
  ['POST', '/collection', async ({ body: b }) => { await ensurePrintings([b.printing_id]);
    return rpc('collection_add', { p_printing: b.printing_id, p_qty: int(b.qty), p_lang: b.lang ?? null, p_finish: b.finish ?? 'nonfoil', p_condition: b.condition ?? 'NM' }); }],
  // rimozione di più righe insieme (tutte le copie di ogni riga). Se qualcuna è assegnata a un mazzo serve release=true.
  ['POST', '/collection/bulk-delete', ({ body: b }) => rpc('collection_bulk_delete', { p_ids: (Array.isArray(b?.ids) ? b.ids : []).map((x: Any) => int(x)), p_release: !!b?.release })],
  ['PATCH', '/collection/:id', async ({ p, body: b }) => { await rpc('collection_set_qty', { p_id: int(p[0]), p_qty: int(b.qty, 0), p_release: !!b.release }); return { ok: true }; }],
  ['DELETE', '/collection/:id', async ({ p, query }) => { await rpc('collection_set_qty', { p_id: int(p[0]), p_qty: 0, p_release: query.get('release') === 'true' }); return { ok: true }; }],
  // cambio di stampa in blocco: prima le edizioni comuni alle carte selezionate, poi l'applicazione (tutto o niente)
  ['POST', '/collection/common-sets', ({ body: b }) => commonSets((Array.isArray(b?.item_ids) ? b.item_ids : []).map((x: Any) => int(x)))],
  ['POST', '/collection/set-printings', async ({ body: b }) => { const ch = Array.isArray(b?.changes) ? b.changes : []; if (!ch.length) throw fail(400, 'Nessuna carta selezionata');
    await ensurePrintings(ch.map((c: Any) => c.printing_id)); return rpc('collection_set_printings', { p: ch.map((c: Any) => ({ id: int(c.id), printing_id: c.printing_id })) }); }],
  ['PATCH', '/collection/:id/attrs', async ({ p, body: b }) => { if (b?.printing_id) await ensurePrintings([b.printing_id]); return rpc('collection_edit', { p_id: int(p[0]), p: b ?? {} }); }],
  // mazzi
  ['GET', '/decks', () => rpc('decks_list')],
  ['GET', '/decks/:id', ({ p }) => deckInfo(int(p[0]))],
  ['POST', '/decks', async ({ body: b }) => { const name = String(b?.name ?? '').trim(), mode = b?.mode ?? 'virtual';
    if (!name || !['physical', 'virtual'].includes(mode)) throw fail(400, 'name e mode (physical|virtual) obbligatori');
    return rows(await supabase.from('decks').insert({ name: name.slice(0, 120), mode, description: b.description ?? null }).select().single()); }],
  ['PATCH', '/decks/:id', async ({ p, body: b }) => { const name = String(b?.name ?? '').trim(); if (!name) throw fail(400, 'Il nome non può essere vuoto');
    const r = rows(await supabase.from('decks').update({ name: name.slice(0, 120), updated_at: new Date().toISOString() }).eq('id', int(p[0])).select());
    if (!r.length) throw fail(404, 'Mazzo non trovato'); return r[0]; }],
  ['DELETE', '/decks/:id', async ({ p }) => { await rpc('deck_delete', { p_id: int(p[0]) }); return { ok: true }; }],
  // delta positivo o negativo; i comandanti sono max 2. L'oracle_id deve già essere in catalogo (POST /catalog/printings).
  ['POST', '/decks/:id/cards', async ({ p, body: b }) => { const id = int(p[0]);
    await rpc('deck_change_card', { p_id: id, p_oracle: b.oracle_id, p_delta: int(b.delta, -999), p_commander: !!b.is_commander, p_printing: b.printing_id ?? null }); return deckInfo(id); }],
  ['POST', '/decks/:id/cards/bulk-remove', ({ p, body: b }) => { const items = Array.isArray(b?.items) ? b.items : []; if (!items.length) throw fail(400, 'Nessuna carta selezionata');
    return rpc('deck_bulk_remove', { p_id: int(p[0]), p_items: items }); }],
  // carte selezionate nella collezione -> mazzo (una copia per carta; nei mazzi fisici si riserva la copia scelta)
  ['POST', '/decks/:id/add-items', ({ p, body: b }) => { const ids = (Array.isArray(b?.item_ids) ? b.item_ids : []).map((x: Any) => int(x)); if (!ids.length) throw fail(400, 'Nessuna carta selezionata');
    return rpc('deck_add_items', { p_id: int(p[0]), p_items: ids }); }],
  ['POST', '/decks/:id/collect', ({ p, body: b }) => rpc('deck_collect', { p_id: int(p[0]), p_oracle: b?.oracle_id || null })],
  ['POST', '/decks/:id/convert', ({ p, body: b }) => rpc('deck_convert', { p_id: int(p[0]), p_confirm: !!b?.confirm })],
  ['POST', '/decks/:id/archive', async ({ p, body: b }) => { const id = int(p[0]); await rpc('deck_archive', { p_id: id, p_archived: !!b?.archived }); return deckInfo(id); }],
  ['GET', '/decks/:id/validation', ({ p }) => validation(int(p[0]))],
  ['GET', '/decks/:id/export', ({ p, query }) => deckExport(int(p[0]), query)],
  // catalogo
  ['POST', '/catalog/printings', async ({ body: b }) => { await ensurePrintings([b.id]);
    const r = rows(await supabase.from('printings').select('id, cards(*)').eq('id', b.id).single()) as Any; return { ...r.cards, printing_id: r.id }; }],
  ['POST', '/catalog/refresh', () => refreshLegality()],
  // importazione
  ['POST', '/import/preview', ({ body: b }) => previewImport(String(b?.text ?? ''))],
  ['POST', '/import/commit', async ({ body: b }) => { const list = Array.isArray(b?.rows) ? b.rows : []; if (!list.length) throw fail(400, 'Nessuna riga da importare');
    await ensurePrintings(list.map((r: Any) => r.printing_id)); // le stampe scelte dallo scanner possono non essere ancora in catalogo
    return rpc('import_commit', { p_target: String(b.target), p_rows: list, p_replace: !!b.replace, p_add: b.addToCollection ?? 'none' }); }],
  // riepilogo ed esportazioni
  ['GET', '/stats', () => stats()],
  // prezzi Cardmarket (euro) delle stampe della collezione o del mazzo; force=true li riscarica tutti
  ['POST', '/prices/collection', async ({ body: b }) => {
    const ids: string[] = []; // a pagine: Supabase restituisce al massimo 1000 righe per volta
    for (let from = 0; ; from += 1000) { const r = rows(await supabase.from('collection_items').select('printing_id').order('id').range(from, from + 999)); ids.push(...r.map((x: Any) => x.printing_id)); if (r.length < 1000) break; }
    return refreshPrintingPrices(ids, b?.force ? 0 : b?.maxAgeH ?? 20);
  }],
  ['POST', '/prices/deck/:id', async ({ p, body: b }) => refreshPrintingPrices((await rpc('deck_get', { p_id: int(p[0]) })).rows.map((r: Any) => r.printing_id), b?.force ? 0 : b?.maxAgeH ?? 20)],
  ['GET', '/export/collection.csv', async () => {
    const cell = (x: Any) => '"' + String(x ?? '').replace(/"/g, '""') + '"', r = await rpc('collection_list');
    return file('collezione.csv', 'text/csv', '﻿' + ['nome,set,numero,qta,assegnate,libere,lingua,finitura,condizione',
      ...r.map((x: Any) => [cell(x.name), x.set_code, cell(x.collector_number), x.qty, x.assigned, x.free, x.lang, x.finish, x.condition].join(','))].join('\n'));
  }],
  // lista dei desideri
  ['GET', '/wishlist', () => rpc('wishlist_list')],
  // aggiunta manuale: da una stampa scelta nella ricerca (printing_id) o da una carta già in catalogo (oracle_id)
  // any=true: qualsiasi stampa (printing_id serve solo a mettere la carta in catalogo)
  ['POST', '/wishlist', async ({ body: b }) => {
    let o = b.oracle_id;
    if (b.printing_id) { await ensurePrintings([b.printing_id]); o = (rows(await supabase.from('printings').select('oracle_id').eq('id', b.printing_id).single()) as Any).oracle_id; }
    if (!o) throw fail(400, 'Serve printing_id oppure oracle_id');
    await rpc('wishlist_add', { p_oracle: o, p_qty: int(b.qty ?? 1), p_priority: b.priority ?? null, p_note: b.note ?? null, p_printing: b.any ? null : b.printing_id ?? null });
    await refreshPrices([o]).catch(() => {}); // il prezzo è facoltativo: se Scryfall non risponde, la voce resta senza
    return { ok: true };
  }],
  // cambia la stampa voluta di una voce (printing_id null = qualsiasi), poi ricalcola il prezzo
  ['POST', '/wishlist/:id/printing', async ({ p, body: b }) => {
    if (b?.printing_id) await ensurePrintings([b.printing_id]);
    await rpc('wishlist_set_printing', { p_id: int(p[0]), p_printing: b?.printing_id ?? null });
    const w = rows(await supabase.from('wishlist').select('oracle_id').eq('id', int(p[0])).single()) as Any;
    await refreshPrices([w.oracle_id]).catch(() => {}); return { ok: true };
  }],
  ['POST', '/wishlist/from-deck/:id', async ({ p }) => { const r = await rpc('wishlist_from_deck', { p_id: int(p[0]) }); await refreshPrices().catch(() => {}); return r; }],
  ['POST', '/wishlist/prices', () => refreshPrices()],
  ['PATCH', '/wishlist/:id', async ({ p, body: b }) => {
    const patch: Any = {};
    if (b.qty_wanted !== undefined) patch.qty_wanted = int(b.qty_wanted);
    if ('priority' in b) patch.priority = b.priority ?? null;
    if ('note' in b) patch.note = b.note || null;
    const r = rows(await supabase.from('wishlist').update(patch).eq('id', int(p[0])).select('id'));
    if (!r.length) throw fail(404, 'Voce non trovata'); return { ok: true };
  }],
  ['DELETE', '/wishlist/:id', async ({ p }) => { rows(await supabase.from('wishlist').delete().eq('id', int(p[0]))); return { ok: true }; }],
  ['POST', '/wishlist/:id/purchase', async ({ p, body: b }) => { await ensurePrintings([b.printing_id]); return rpc('wishlist_purchase', { p_id: int(p[0]), p: b }); }],
  ['GET', '/export/wishlist.txt', async () => file('lista-desideri.txt', 'text/plain',
    (await rpc('wishlist_list')).filter((r: Any) => r.to_buy > 0).map((r: Any) => `${r.to_buy} ${r.name}`).join('\n'))],
];
const table = R.map(([m, path, f]) => ({ m, re: new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$'), f }));

export async function route(path: string, method: string, body: Any) {
  const [p, qs] = path.split('?'), query = new URLSearchParams(qs ?? '');
  for (const r of table) { const m = r.m === method && p.match(r.re); if (m) return r.f({ body: body ?? {}, query, p: m.slice(1).map(decodeURIComponent) }); }
  throw fail(404, `Operazione sconosciuta: ${method} ${p}`);
}

// salva un file generato nel browser (download)
export function saveFile(f: FileOut) {
  const a = document.createElement('a'), url = URL.createObjectURL(new Blob([f.text], { type: f.type + ';charset=utf-8' }));
  a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
