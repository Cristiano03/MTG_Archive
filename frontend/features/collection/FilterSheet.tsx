import Sheet from '../../components/Sheet';
import { ManaToggles, type ColorFilter, type Sort, type SortKey } from '../../components/CardTools';
type Any = any;
export type Filters = { rar: string; st: string; deck: string; min: string; max: string; foil: string };
const RAR: [string, string][] = [['common', 'Comune'], ['uncommon', 'Non comune'], ['rare', 'Rara'], ['mythic', 'Mitica']];
const SORTS: [SortKey, string][] = [['price', 'Prezzo'], ['name', 'Nome'], ['recent', 'Data di aggiunta'], ['cmc', 'Costo di mana'], ['qty', 'Numero di copie'], ['value', 'Valore totale'], ['set', 'Edizione']];

// Filtri e ordinamento della collezione sul telefono: tutto a tocchi (pulsanti e schede), niente menu a tendina tranne il mazzo.
export default function FilterSheet({ f, setF, color, setColor, sort, setSort, decks, count, active, onReset, onClose }: {
  f: Filters; setF: (f: Filters) => void; color: ColorFilter; setColor: (c: ColorFilter) => void; sort: Sort; setSort: (s: Sort) => void;
  decks: Any[]; count: number; active: number; onReset: () => void; onClose: () => void }) {
  const rars = f.rar ? f.rar.split(',') : [];
  const togRar = (r: string) => setF({ ...f, rar: (rars.includes(r) ? rars.filter(x => x !== r) : [...rars, r]).join(',') });
  const playable = color.by === 'playable';
  return <Sheet title="Filtri e ordinamento" sub={active ? `${active} ${active === 1 ? 'filtro attivo' : 'filtri attivi'}` : 'Nessun filtro attivo'} onClose={onClose}
    actions={<><button onClick={onReset}>Azzera</button><button className="b" onClick={onClose}>Mostra {count} {count === 1 ? 'carta' : 'carte'}</button></>}>
    <h4 className="lbl first">Identità di colore</h4>
    <ManaToggles value={color} onChange={setColor} />
    <div className="seg" style={{ marginTop: 10 }}>
      <button className={!playable ? 'on' : ''} onClick={() => setColor({ ...color, by: 'identity' })}>Contengono</button>
      <button className={playable ? 'on' : ''} onClick={() => setColor({ ...color, by: 'playable' })}>Giocabili nel mazzo</button></div>
    <p className="m explain"><b>Contengono:</b> i colori scelti (almeno uno o tutti, con due o più colori), anche insieme ad altri.<br /><b>Giocabili:</b> rientrano nell’identità, incolori incluse.</p>

    <h4 className="lbl">Rarità</h4>
    <div className="pillrow">{RAR.map(([k, l]) => <button key={k} className={'pchip' + (rars.includes(k) ? ' on' : '')} onClick={() => togRar(k)}>{l}</button>)}</div>

    <h4 className="lbl">Stato copie</h4>
    <div className="seg">{([['', 'Tutte'], ['free', 'Libere'], ['asg', 'Nei mazzi']] as const).map(([k, l]) => <button key={k} className={f.st === k ? 'on' : ''} onClick={() => setF({ ...f, st: k })}>{l}</button>)}</div>
    <div className="pillrow">
      <button className={'pchip' + (f.min === '2' && !f.max ? ' on' : '')} onClick={() => setF({ ...f, min: f.min === '2' && !f.max ? '' : '2', max: '' })}>Più di una copia</button>
      <button className={'pchip' + (f.foil ? ' on' : '')} onClick={() => setF({ ...f, foil: f.foil ? '' : '1' })}>Solo foil</button></div>

    <h4 className="lbl">Ordina per</h4>
    <div className="pillrow">{SORTS.map(([k, l]) => <button key={k} className={'pchip' + (sort.key === k ? ' on' : '')} onClick={() => setSort({ key: k, desc: ['recent', 'qty', 'price', 'value'].includes(k) })}>{l}</button>)}</div>
    <div className="seg" style={{ marginTop: 10 }}>
      <button className={sort.desc ? 'on' : ''} onClick={() => setSort({ ...sort, desc: true })}>Dal più alto</button>
      <button className={!sort.desc ? 'on' : ''} onClick={() => setSort({ ...sort, desc: false })}>Dal più basso</button></div>

    <h4 className="lbl">Mazzo</h4>
    <select value={f.deck} onChange={e => setF({ ...f, deck: e.target.value })}><option value="">Con o senza mazzo</option><option value="none">In nessun mazzo</option>
      {decks.length > 0 && <optgroup label="Nel mazzo">{decks.map(d => <option key={d.id} value={'in:' + d.id}>Nel mazzo {d.name}</option>)}</optgroup>}
      {decks.length > 0 && <optgroup label="Non nel mazzo">{decks.map(d => <option key={d.id} value={'out:' + d.id}>Non nel mazzo {d.name}</option>)}</optgroup>}</select>
    <h4 className="lbl">Copie per stampa</h4>
    <div className="filters"><input type="number" inputMode="numeric" min={1} placeholder="almeno" aria-label="Almeno" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} />
      <input type="number" inputMode="numeric" min={1} placeholder="al massimo" aria-label="Al massimo" value={f.max} onChange={e => setF({ ...f, max: e.target.value })} /></div>
  </Sheet>;
}
