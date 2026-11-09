import Icon from './Icon';
// Ordinamento (crescente/decrescente) e filtro per colore, condivisi da Collezione e Mazzi.
export type SortKey = 'name' | 'cmc' | 'qty' | 'set' | 'recent' | 'price' | 'value';
export type Sort = { key: SortKey; desc: boolean };
export type ColorFilter = { col: string[]; all: boolean; by: 'colors' | 'identity' };
export const NO_COLOR: ColorFilter = { col: [], all: false, by: 'colors' };
const LABEL: Record<SortKey, string> = { name: 'Nome', cmc: 'Costo di mana', qty: 'Quantità', set: 'Espansione', recent: 'Aggiunte di recente', price: 'Prezzo', value: 'Valore totale' };
const COLS = ['W', 'U', 'B', 'R', 'G', 'C'];
const COL_IT: Record<string, string> = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde', C: 'Incolore' };

type Card = { name: string; price?: number | null; cmc?: number | null; colors?: string[]; color_identity?: string[]; type_line?: string; qty?: number; need?: number; set_code?: string; created_at?: string };
// prezzo: di una copia; valore totale: copie × prezzo
const val = (c: Card, k: SortKey): string | number => k === 'price' ? c.price! : k === 'value' ? c.price! * (c.qty ?? c.need ?? 0) : k === 'name' ? c.name : k === 'cmc' ? (c.cmc ?? 99) : k === 'qty' ? (c.qty ?? c.need ?? 0) : k === 'set' ? (c.set_code ?? '') : (c.created_at ?? '');
export function sortCards<T extends Card>(list: T[], s: Sort): T[] {
  const dir = s.desc ? -1 : 1;
  return [...list].sort((a, b) => {
    if (s.key === 'cmc' && (a.cmc == null) !== (b.cmc == null)) return a.cmc == null ? 1 : -1; // costo non ancora noto: sempre in fondo
    if ((s.key === 'price' || s.key === 'value') && (a.price == null) !== (b.price == null)) return a.price == null ? 1 : -1; // senza prezzo: sempre in fondo
    const x = val(a, s.key), y = val(b, s.key);
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'it');
    return r !== 0 ? r * dir : a.name.localeCompare(b.name, 'it'); // a parità, per nome
  });
}
export function matchColor(c: Card, f: ColorFilter) {
  if (!f.col.length) return true;
  // le terre non hanno colore stampato: per loro conta l'identità di colore (Isola = blu); quelle senza identità restano incolori
  const land = !c.colors?.length && /\bLand\b/.test(c.type_line ?? '');
  const a = (f.by === 'identity' || land ? c.color_identity : c.colors) ?? [];
  const has = (x: string) => x === 'C' ? a.length === 0 : a.includes(x);
  return f.all ? f.col.every(has) : f.col.some(has);
}

export function SortControl({ value, onChange, keys }: { value: Sort; onChange: (s: Sort) => void; keys: SortKey[] }) {
  return <div className="sortctl">
    <select aria-label="Ordina per" value={value.key} onChange={e => onChange({ key: e.target.value as SortKey, desc: ['recent', 'qty', 'price', 'value'].includes(e.target.value) })}>
      {keys.map(k => <option key={k} value={k}>{LABEL[k]}</option>)}</select>
    <button className="icon" aria-label={value.desc ? 'Ordine decrescente: tocca per crescente' : 'Ordine crescente: tocca per decrescente'} onClick={() => onChange({ ...value, desc: !value.desc })}>
      <Icon name={value.desc ? 'sortdown' : 'sortup'} /></button>
  </div>;
}
// pallini dei colori da toccare (filtro rapido, sempre in vista)
export function ManaToggles({ value, onChange }: { value: ColorFilter; onChange: (f: ColorFilter) => void }) {
  const toggle = (c: string) => onChange({ ...value, col: value.col.includes(c) ? value.col.filter(x => x !== c) : [...value.col, c] });
  return <div className="mana-toggles" role="group" aria-label="Filtra per colore">{COLS.map(c =>
    <button key={c} data-c={c} className={value.col.includes(c) ? 'on' : ''} aria-pressed={value.col.includes(c)} aria-label={COL_IT[c]} title={COL_IT[c]} onClick={() => toggle(c)}><span className={'pip ' + c} /></button>)}</div>;
}
// ordinamento compatto per la barra degli strumenti: un solo menu con criterio e direzione (↑ crescente, ↓ decrescente)
const SHORT: Record<SortKey, string> = { name: 'Nome', cmc: 'Costo', qty: 'Copie', set: 'Edizione', recent: 'Recenti', price: 'Prezzo', value: 'Valore' };
const DESC_FIRST: SortKey[] = ['recent', 'qty', 'price', 'value'];
export function SortChip({ value, onChange, keys }: { value: Sort; onChange: (s: Sort) => void; keys: SortKey[] }) {
  return <select aria-label="Ordina per" title={`Ordina per ${LABEL[value.key].toLowerCase()}, ${value.desc ? 'decrescente' : 'crescente'}`} value={value.key + (value.desc ? ':d' : ':a')}
    onChange={e => { const [k, d] = e.target.value.split(':'); onChange({ key: k as SortKey, desc: d === 'd' }); }}>
    {keys.flatMap(k => (DESC_FIRST.includes(k) ? [true, false] : [false, true]).map(desc =>
      <option key={k + desc} value={k + (desc ? ':d' : ':a')}>{SHORT[k]} {desc ? '↓' : '↑'}</option>))}</select>;
}
export function ColorControl({ value, onChange, showBy = true }: { value: ColorFilter; onChange: (f: ColorFilter) => void; showBy?: boolean }) {
  const toggle = (c: string) => onChange({ ...value, col: value.col.includes(c) ? value.col.filter(x => x !== c) : [...value.col, c] });
  return <div className="colorctl">
    <div className="mana-toggles" role="group" aria-label="Colori">{COLS.map(c =>
      <button key={c} className={value.col.includes(c) ? 'on' : ''} aria-pressed={value.col.includes(c)} aria-label={COL_IT[c]} onClick={() => toggle(c)}><span className={'pip ' + c} /></button>)}</div>
    {value.col.length > 0 && <div className="filters">
      {showBy && <select aria-label="Tipo di colore" value={value.by} onChange={e => onChange({ ...value, by: e.target.value as ColorFilter['by'] })}>
        <option value="colors">Colore della carta</option><option value="identity">Identità di colore</option></select>}
      <select aria-label="Corrispondenza" value={value.all ? 'all' : 'any'} onChange={e => onChange({ ...value, all: e.target.value === 'all' })}>
        <option value="any">Almeno uno dei colori</option><option value="all">Tutti i colori scelti</option></select></div>}
  </div>;
}

// Costo di mana compatto: {2}{W}{U} -> pallini
export function ManaCost({ cost }: { cost?: string | null }) {
  if (!cost) return null;
  const syms = cost.split(' // ')[0].match(/\{[^}]+\}/g) ?? [];
  return <span className="manacost" aria-label={'Costo ' + cost}>{syms.map((t, i) => {
    const s = t.slice(1, -1);
    return /^[WUBRGC]$/.test(s) ? <span key={i} className={'pip ' + s} /> : <span key={i} className="pip num">{s.replace('/', '')}</span>;
  })}</span>;
}
