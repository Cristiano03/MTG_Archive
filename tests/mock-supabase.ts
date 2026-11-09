// Finto client Supabase per le prove e per l'anteprima locale: fa ciò che fa PostgREST
// (ogni chiamata è una transazione con il ruolo "authenticated" e l'utente collegato) sul PostgreSQL di pg-supabase.ts.
import type { Q, start } from './pg-supabase.js';
type H = Awaited<ReturnType<typeof start>>;

export async function installMock(h: H, uidOf: () => string) {
const err = (e: any) => ({ data: null, error: { code: e.code, message: e.message, details: e.detail || null } });

// --- finto client: rpc e le poche query sulle tabelle usate dal sito
const { supabase } = await import('../frontend/services/supabase.js');
// Il database scarica il catalogo da Scryfall (catalog_fetch, catalog_refresh): qui la risposta vera di Scryfall si prepara prima
const SF = async (ids: object[]) => {
  if (!ids.length) return;
  const r = await globalThis.fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ identifiers: ids }) });
  if (r.ok) await h.sfPut((await r.json()).data);
};
(supabase as any).rpc = async (fn: string, args: any) => {
  try {
    if (fn === 'catalog_fetch') await SF((args.p_ids ?? []).map((id: string) => ({ id })));
    if (fn === 'catalog_refresh') await SF([...(args.p_printings ?? []).map((id: string) => ({ id })), ...(args.p_oracles ?? []).map((oracle_id: string) => ({ oracle_id }))]);
  } catch { /* senza rete il catalogo resta com'è */ }
  return h.rpc(uidOf(), fn, args ?? {}).then(data => ({ data, error: null }), err);
};
(supabase as any).from = (table: string) => {
  const st: any = { op: 'select', cols: '*', where: [], payload: null, single: false, order: null, range: null };
  const b: any = {
    select(cols = '*') { st.cols = cols; return b; }, insert(v: any) { st.op = 'insert'; st.payload = v; return b; },
    update(v: any) { st.op = 'update'; st.payload = v; return b; }, delete() { st.op = 'delete'; st.cols = null; return b; },
    eq(c: string, v: any) { st.where.push([c, '=', v]); return b; }, in(c: string, v: any[]) { st.where.push([c, 'in', v]); return b; },
    or(expr: string) { st.or = expr; return b; },
    order(c: string) { st.order = c; return b; }, range(a: number, z: number) { st.range = [a, z]; return b; }, single() { st.single = true; return b; },
    then(res: any, rej: any) { return h.as(uidOf(), q => run(q, table, st)).then(data => {
      if (!st.single) return { data, error: null };
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }, err).then(res, rej); },
  };
  return b;
};
  async function run(q: Q, t: string, st: any) {
  const p: any[] = [], arg = (v: any) => { p.push(v); return '$' + p.length; };
  const conds = st.where.map(([c, o, v]: any) => o === 'in' ? `${c} = any(${arg(v)})` : `${c} = ${arg(v)}`);
  if (st.or) conds.push('(' + st.or.split(',').map((t: string) => { const [c, op, ...rest] = t.split('.'); const v = rest.join('.').replace(/^"|"$/g, '');
    return op === 'is' ? `${c} is null` : `${c} ${({ lt: '<', gt: '>', eq: '=' } as any)[op]} ${arg(v)}`; }).join(' or ') + ')');
  const where = conds.length ? ' where ' + conds.join(' and ') : '';
  const cols = st.cols === 'id, cards(*)' ? 'printings.id, (select row_to_json(c) from cards c where c.oracle_id=printings.oracle_id) cards' : st.cols;
  if (st.op === 'select') return q(`select ${cols} from ${t}${where}${st.order ? ' order by ' + st.order : ''}${st.range ? ` offset ${st.range[0]} limit ${st.range[1] - st.range[0] + 1}` : ''}`, p);
  if (st.op === 'insert') { const k = Object.keys(st.payload); return q(`insert into ${t}(${k}) values(${k.map(x => arg(st.payload[x]))}) returning ${cols}`, p); }
  if (st.op === 'update') { const k = Object.keys(st.payload), set = k.map(x => `${x} = ${arg(st.payload[x])}`).join(', '); return q(`update ${t} set ${set}${where.replace(/\$(\d+)/g, (_, n) => '$' + (+n + 0))} returning ${cols}`, reorder(p, k.length)); }
  return q(`delete from ${t}${where}`, p);
}
// nell'update i parametri del where sono stati aggiunti prima di quelli del set: si rimettono in ordine
  function reorder(p: any[], nSet: number) { const w = p.slice(0, p.length - nSet), s = p.slice(p.length - nSet); return [...w, ...s]; }

// Scryfall rifiuta l'User-Agent predefinito di Node (i browser mandano il loro): se ne aggiunge uno
const nodeFetch = globalThis.fetch;
globalThis.fetch = ((u: any, o: any = {}) => nodeFetch(u, { ...o, headers: { 'User-Agent': 'mtg-manager-test/1.0', ...(o.headers ?? {}) } })) as typeof fetch;
}
