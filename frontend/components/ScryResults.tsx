import { useEffect, useState, type ReactNode } from 'react';
import { scry } from '../services/api';
import { eurOf } from '../services/scryfall';
import { eur } from './Price';
import { useCardPreview } from './CardPreview';
type Any = any;
const img = (c: Any) => c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small;
// Risultati di Scryfall per il testo scritto nella ricerca della pagina, con i pulsanti per aggiungere (actions).
// mode 'prints' = ogni stampa (collezione), 'cards' = una riga per carta (mazzi, desideri).
// expanded/below: contenuto aperto sotto una riga (es. la scelta della stampa)
export default function ScryResults({ q, mode, title, actions, limit = 8, expanded, below }: { q: string; mode: 'prints' | 'cards'; title: string; actions: (c: Any) => ReactNode; limit?: number; expanded?: string | null; below?: (c: Any) => ReactNode }) {
  const [r, setR] = useState<Any[] | null>(null), [all, setAll] = useState(false);
  const { bind, preview } = useCardPreview();
  const query = q.trim();
  useEffect(() => {
    setAll(false);
    if (query.length < 2) { setR(null); return; }
    // le risposte arrivano in ordine sparso: vale solo quella dell'ultimo testo scritto
    let live = true; const t = setTimeout(() => scry(query, mode).then(x => live && setR(x)).catch(() => live && setR([])), 300);
    return () => { live = false; clearTimeout(t); };
  }, [query, mode]);
  if (query.length < 2) return null;
  const list = r ? (all ? r : r.slice(0, limit)) : [];
  return <div className="list found">
    <div className="listhead">{title}{!r && <span className="n">cerco…</span>}</div>
    {r && !r.length && <div className="item"><span className="m">Nessuna carta su Scryfall per “{query}”. Prova con il nome inglese.</span></div>}
    {list.map(c => [<div className="item" key={c.id}>
      <img className="thumb" alt="" loading="lazy" src={img(c)} {...bind(img(c))} />
      <div className="g"><div className="name">{c.name}</div>
        <div className="meta"><span>{c.set.toUpperCase()} {c.collector_number}</span>{eurOf(c) != null && <span>{eur(eurOf(c))}</span>}</div></div>
      <div className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}>{actions(c)}</div></div>,
      expanded === c.id && below ? <div className="itemx" key={c.id + '-x'}>{below(c)}</div> : null])}
    {r && r.length > limit && !all && <button className="item ghost" style={{ justifyContent: 'center', minHeight: 48 }} onClick={() => setAll(true)}>Mostra tutte ({r.length})</button>}
    {preview}
  </div>;
}
