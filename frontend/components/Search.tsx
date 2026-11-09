import { useEffect, useState } from 'react';
import { scry } from '../services/api';
import Icon from './Icon';
type Any = any;
// Ricerca su Scryfall. query: se presente la ricerca parte da sola (es. per cambiare stampa della stessa carta).
export default function Search({ mode, onPick, query, autoFocus, action = 'Aggiungi' }:
  { mode: 'prints' | 'cards' | 'cmd'; onPick: (c: Any) => void; query?: string; autoFocus?: boolean; action?: string }) {
  const [q, setQ] = useState(''), [r, setR] = useState<Any[] | null>(null);
  const eff = query ?? q;
  useEffect(() => {
    if (eff.length < 2) { setR(null); return; }
    // le risposte arrivano in ordine sparso: vale solo quella dell'ultimo testo scritto
    let live = true; const t = setTimeout(() => scry(eff + (mode === 'cmd' ? ' is:commander' : ''), mode === 'prints' ? 'prints' : 'cards').then(x => live && setR(x)).catch(() => live && setR([])), query ? 0 : 350);
    return () => { live = false; clearTimeout(t); };
  }, [eff, mode, query]);
  return <div>
    {query === undefined && <div className="search"><Icon name="search" />
      <input type="search" enterKeyHint="search" autoFocus={autoFocus} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        placeholder={mode === 'cmd' ? 'Nome del comandante' : 'Nome della carta, anche parziale'} value={q} onChange={e => setQ(e.target.value)} /></div>}
    {r && r.length === 0 && <p className="m">Nessuna carta trovata. Prova con meno lettere o con il nome inglese.</p>}
    {r && r.length > 0 && <div className="list">{r.map(c => <div className="item tap" key={c.id} onClick={() => onPick(c)}>
      <img className="thumb" alt="" loading="lazy" src={c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small} />
      <div className="g"><div className="name">{c.name}</div><div className="meta"><span>{c.set_name}</span><span>{c.set.toUpperCase()} {c.collector_number}</span>{c.lang !== 'en' && <span>{c.lang}</span>}</div></div>
      <button className="b icon" aria-label={action + ' ' + c.name} onClick={e => { e.stopPropagation(); onPick(c); }}><Icon name={query ? 'check' : 'plus'} /></button></div>)}</div>}
  </div>;
}
