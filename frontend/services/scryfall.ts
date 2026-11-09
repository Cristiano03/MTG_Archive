// Scryfall dal browser: catalogo (carte e stampe salvate su Supabase), legalità, prezzi, riconoscimento delle liste in testo.
import { supabase, rpc, rows } from './supabase';

const SF = 'https://api.scryfall.com';
export const sleep = (ms: number) => new Promise(f => setTimeout(f, ms));
const fail = (status: number, msg: string) => Object.assign(new Error(msg), { status });
// Scryfall risponde 429 se si fanno troppe richieste di fila: si aspetta (quanto indica, o un po' di più ogni volta) e si riprova
async function sfFetch(url: string, init?: RequestInit) {
  for (let k = 0; ; k++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || k === 3) return r;
    await sleep((Number(r.headers.get('Retry-After')) || k + 1) * 1000);
  }
}
export const sfGet = async (u: string): Promise<any> => {
  const r = await sfFetch(SF + u, { headers: { Accept: 'application/json' } });
  if (r.status === 404) return null; if (!r.ok) throw fail(502, r.status === 429 ? 'Scryfall è sovraccarico: riprova tra un minuto' : 'Scryfall ' + r.status); return r.json();
};
// /cards/collection: fino a 75 identificatori per volta
export async function sfCollection(identifiers: object[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    if (i) await sleep(120);
    const r = await sfFetch(SF + '/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifiers: identifiers.slice(i, i + 75) }) });
    if (!r.ok) throw fail(502, r.status === 429 ? 'Scryfall è sovraccarico: riprova tra un minuto' : 'Scryfall ' + r.status);
    out.push(...(await r.json()).data);
  }
  return out;
}

// Il catalogo condiviso lo scrive solo il database, scaricando i dati da Scryfall: il sito passa soltanto gli identificativi
// (75 per volta, come /cards/collection di Scryfall). Vedi catalog_fetch e catalog_refresh in supabase/schema.sql.
async function inBatches<T>(ids: string[], f: (part: string[]) => Promise<T>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 75) out.push(await f(ids.slice(i, i + 75)));
  return out;
}
export async function catalogFetch(ids: string[]) {
  const r = await inBatches([...new Set(ids.filter(Boolean))], part => rpc<{ added: number; missing: string[] }>('catalog_fetch', { p_ids: part }));
  return { added: r.reduce((t, x) => t + x.added, 0), missing: r.flatMap(x => x.missing) };
}
// Le stampe scelte (ricerca, scanner, liste) entrano nel catalogo prima di essere usate.
export async function ensurePrintings(ids: string[]) {
  const want = [...new Set(ids.filter(Boolean))]; if (!want.length) return;
  const have = new Set<string>();
  for (let i = 0; i < want.length; i += 100)
    rows(await supabase.from('printings').select('id').in('id', want.slice(i, i + 100))).forEach((r: any) => have.add(r.id));
  const missing = want.filter(id => !have.has(id)); if (!missing.length) return;
  if ((await catalogFetch(missing)).missing.length) throw fail(404, 'Stampa non trovata su Scryfall');
}
// aggiorna la legalità Commander (e i dati di mana) delle carte che ti riguardano; se fallisce, i dati restano vecchi e la validazione lo segnala
export async function refreshLegality() {
  try {
    const r = await inBatches(await rpc<string[]>('my_oracles'), part => rpc<{ updated: number }>('catalog_refresh', { p_oracles: part }));
    return { updated: r.reduce((t, x) => t + x.updated, 0) };
  } catch (e: any) { throw fail(e.status === 429 ? 429 : 502, 'Aggiornamento fallito: ' + e.message); }
}
// Prezzo di riferimento: Scryfall (EUR, media Cardmarket) della stampa predefinita; è una stima, con data e fonte.
// Voci con una stampa scelta: il prezzo di quella stampa. Voci "qualsiasi stampa": il prezzo della stampa più economica.
export const eurOf = (c: any): number | null => { const x = c?.prices?.eur ?? c?.prices?.eur_foil; return x == null ? null : Number(x); };
export function cheapest(prints: any[]) {
  return prints.filter(c => eurOf(c) != null).sort((a, b) => eurOf(a)! - eurOf(b)!)[0] ?? null;
}
export async function refreshPrices(oracleIds?: string[]) {
  let list = rows(await supabase.from('wishlist').select('id, oracle_id, printing_id')) as any[];
  if (oracleIds) list = list.filter(w => oracleIds.includes(w.oracle_id));
  if (!list.length) return { updated: 0 };
  const p: { id: number; eur: number | null; source: string }[] = [], label = (c: any) => `${c.set.toUpperCase()} ${c.collector_number}`;
  const chosen = list.filter(w => w.printing_id), any = list.filter(w => !w.printing_id);
  if (chosen.length) {
    const found = await sfCollection(chosen.map(w => ({ id: w.printing_id })));
    for (const w of chosen) { const c = found.find(x => x.id === w.printing_id); if (c) p.push({ id: w.id, eur: eurOf(c), source: eurOf(c) == null ? `Cardmarket: nessun prezzo per ${label(c)}` : `Cardmarket, ${label(c)}` }); }
  }
  if (any.length) {
    const prints = await printsOfCards([...new Set(any.map(w => w.oracle_id))]);
    for (const w of any) { const c = cheapest(prints.filter(x => (x.oracle_id ?? x.card_faces?.[0]?.oracle_id) === w.oracle_id)); if (c) p.push({ id: w.id, eur: eurOf(c), source: `Cardmarket, stampa più economica (${label(c)})` }); }
  }
  return rpc<{ updated: number }>('wishlist_set_prices', { p });
}

// Prezzi di riferimento Cardmarket in euro (Scryfall li pubblica per ogni stampa, normale e foil): li scarica il database.
// Si aggiornano solo le stampe senza prezzo o con prezzo più vecchio di maxAgeH ore (0 = tutte).
export async function refreshPrintingPrices(ids: string[], maxAgeH = 20) {
  const want = [...new Set(ids.filter(Boolean))], old = new Date(Date.now() - maxAgeH * 3600e3).toISOString(), todo: string[] = [];
  for (let i = 0; i < want.length; i += 100) {
    let q = supabase.from('printings').select('id').in('id', want.slice(i, i + 100));
    if (maxAgeH > 0) q = q.or(`price_at.is.null,price_at.lt."${old}"`);
    todo.push(...rows(await q).map((r: any) => r.id));
  }
  const r = await inBatches(todo, part => rpc<{ updated: number }>('catalog_refresh', { p_printings: part }));
  return { updated: r.reduce((t, x) => t + x.updated, 0) };
}

// Tutte le stampe cartacee di un gruppo di carte (per oracle_id), a gruppi di 15 carte per ricerca.
export async function printsOfCards(oracleIds: string[]) {
  const out: any[] = [];
  for (let i = 0; i < oracleIds.length; i += 15) {
    const q = 'game:paper (' + oracleIds.slice(i, i + 15).map(o => 'oracleid:' + o).join(' or ') + ')';
    let url: string | null = '/cards/search?' + new URLSearchParams({ q, unique: 'prints', order: 'released', dir: 'desc' });
    while (url) { const j: any = await sfGet(url); if (!j) break; out.push(...j.data); url = j.has_more ? j.next_page.replace(SF, '') : null; if (url) await sleep(100); }
  }
  return out;
}

// ---------- liste in testo (Moxfield, Archidekt, nomi italiani…)
type Row = { line: string; qty?: number; name?: string; set?: string; cn?: string; section?: string; status: 'ok' | 'fuzzy' | 'err'; msg?: string;
  printing_id?: string; card_name?: string; set_code?: string; collector_number?: string; image?: string };
function parseList(text: string) {
  const out: Row[] = []; let sec = 'main';
  for (let l of text.split('\n')) {
    l = l.trim(); if (!l) continue;
    // intestazioni di sezione come le scrivono Moxfield, Archidekt e simili: "Commander", "// Commander", "Commander (1)", "Deck:"…
    const head = l.replace(/^\/\/\s*/, '').replace(/\s*\(\d+\)\s*$/, '').replace(/:$/, '').trim();
    if (/^commanders?$/i.test(head)) { sec = 'cmd'; continue; }
    if (/^(mainboard|main|deck|the deck|cards?)$/i.test(head)) { sec = 'main'; continue; }
    if (/^(sideboard|maybeboard|considering|tokens?|companions?)$/i.test(head)) { sec = 'skip'; continue; } // il compagno sta fuori dalle 100
    if (l.startsWith('//') || l.startsWith('#')) continue; // commenti
    if (sec === 'skip') continue;
    const raw = l; l = l.replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\^[^^]*\^/g, '').replace(/\s+\*[FE]\*$/, '');
    const m = l.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\((\w+)\)(?:\s+(\S+))?)?$/);
    if (!m) { out.push({ line: raw, status: 'err', msg: 'Riga non interpretabile' }); continue; }
    out.push({ line: raw, qty: +m[1], name: m[2].trim(), set: m[3]?.toLowerCase(), cn: m[4], section: sec, status: 'err', msg: 'Non risolta' });
  }
  return out;
}
export async function previewImport(text: string) {
  const list = parseList(text); if (list.length > 600) throw fail(400, 'Massimo 600 righe per volta');
  const todo = list.filter(r => r.name), found: any[] = [];
  const fill = (r: Row, c: any, st: 'ok' | 'fuzzy', msg?: string) => { Object.assign(r, { status: st, msg, printing_id: c.id, card_name: c.name, set_code: c.set, collector_number: c.collector_number, image: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small }); found.push(c); };
  const f = (x: string) => x.split(' // ')[0].toLowerCase();
  for (let i = 0; i < todo.length; i += 75) {
    const b = todo.slice(i, i + 75);
    const data = await sfCollection(b.map(x => x.set && x.cn ? { set: x.set, collector_number: x.cn } : { name: x.name }));
    for (const row of b) { const c = data.find((c: any) => row.set && row.cn ? c.set === row.set && c.collector_number === row.cn : f(c.name) === f(row.name!)); if (c) fill(row, c, 'ok'); }
    await sleep(120);
  }
  const pending = todo.filter(r => !r.printing_id); // nome approssimato o italiano: 5 ricerche alla volta
  for (let i = 0; i < pending.length; i += 5) await Promise.all(pending.slice(i, i + 5).map(async row => {
    try {
      let c = await sfGet('/cards/named?fuzzy=' + encodeURIComponent(row.name!));
      if (!c) c = (await sfGet('/cards/search?q=' + encodeURIComponent(`lang:it "${row.name}"`)))?.data?.[0];
      if (c) fill(row, c, 'fuzzy', 'Interpretata come ' + c.name); else row.msg = 'Carta non riconosciuta';
    } catch (e: any) { row.msg = e.message; }
  }));
  await catalogFetch(found.map(c => c.id)); // solo catalogo, nessun effetto sull'inventario
  return { rows: list };
}
