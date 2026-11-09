// Ricerca su Scryfall per lo scanner: nome (inglese o italiano) e stampe disponibili.
import { nameSimilarity } from './recognize';
export type SfCard = { id: string; oracle_id: string; name: string; printed_name?: string; set: string; set_name: string; collector_number: string; lang: string;
  finishes: string[]; image_uris?: { small: string; normal: string }; card_faces?: { image_uris?: { small: string; normal: string } }[] };
const SF = 'https://api.scryfall.com';
const get = async (u: string) => { const r = await fetch(SF + u); if (r.status === 404) return null; if (!r.ok) throw new Error('Scryfall ' + r.status); return r.json(); };
export const img = (c: SfCard, big = false) => (big ? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal : c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small) ?? '';

export type NameMatch = { card: SfCard; sim: number; printed: string } | { card: null; suggestions: string[] };
export async function matchName(ocr: string): Promise<NameMatch> {
  const en: SfCard | null = await get('/cards/named?fuzzy=' + encodeURIComponent(ocr));
  if (en) return { card: en, sim: nameSimilarity(ocr, en.name), printed: en.name };
  const it = await get('/cards/search?' + new URLSearchParams({ q: `lang:it "${ocr.replace(/"/g, '')}"`, unique: 'prints', include_multilingual: 'true' }));
  const c: SfCard | undefined = it?.data?.[0];
  if (c) return { card: c, sim: nameSimilarity(ocr, c.printed_name ?? c.name), printed: c.printed_name ?? c.name };
  const ac = await get('/cards/autocomplete?q=' + encodeURIComponent(ocr.split(' ').slice(0, 3).join(' ')));
  return { card: null, suggestions: (ac?.data ?? []).slice(0, 5) };
}
const cache = new Map<string, SfCard[]>();
export async function printingsOf(oracleId: string, lang?: string): Promise<SfCard[]> {
  const k = oracleId + (lang ?? ''); if (cache.has(k)) return cache.get(k)!;
  const q = `oracleid:${oracleId}` + (lang && lang !== 'en' ? ` (lang:${lang} or lang:en)` : '');
  const out: SfCard[] = []; let url: string | null = '/cards/search?' + new URLSearchParams({ q, unique: 'prints', order: 'released', dir: 'desc', include_multilingual: lang && lang !== 'en' ? 'true' : 'false' });
  while (url && out.length < 250) { const j: any = await get(url); if (!j) break; out.push(...j.data); url = j.has_more ? j.next_page.replace(SF, '') : null; }
  cache.set(k, out); return out;
}
export async function cardByName(name: string): Promise<SfCard | null> { return get('/cards/named?exact=' + encodeURIComponent(name)); }
