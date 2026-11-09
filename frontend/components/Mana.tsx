// Identità di colore: pallini (W U B R G, C = incolore) e costa verticale stile deckbox.
const ORDER = ['W', 'U', 'B', 'R', 'G'];
const sort = (ci: string[] = []) => ORDER.filter(c => ci.includes(c));
export function Pips({ ci }: { ci?: string[] }) {
  const s = sort(ci); const list = s.length ? s : ['C'];
  return <span className="pips" aria-label={'Identità: ' + (s.join('') || 'incolore')}>{list.map(c => <span key={c} className={'pip ' + c} />)}</span>;
}
export function Spine({ ci }: { ci?: string[] }) {
  const s = sort(ci), cols = (s.length ? s : ['C']).map(c => `var(--mana-${c.toLowerCase()})`);
  const bg = cols.length === 1 ? cols[0] : `linear-gradient(to bottom, ${cols.map((c, i) => `${c} ${(i / cols.length) * 100}% ${((i + 1) / cols.length) * 100}%`).join(', ')})`;
  return <span className="spine" style={{ background: bg }} aria-hidden="true" />;
}
