import { useEffect, useState } from 'react';
import { printsOfCards, cheapest, eurOf } from '../services/scryfall';
import { eur } from './Price';
import { useCardPreview } from './CardPreview';
import Icon from './Icon';
type Any = any;
// Scelta della stampa di una carta: tutte le stampe cartacee (dalla più recente) con il prezzo Cardmarket in euro,
// più "Qualsiasi stampa", che usa il prezzo della stampa più economica. onPick(null) = qualsiasi.
export default function PrintPicker({ oracleId, name, onPick, onCancel, busy, any = true }: { oracleId: string; name: string; onPick: (c: Any | null) => void; onCancel: () => void; busy?: boolean; any?: boolean }) {
  const [prints, setPrints] = useState<Any[] | null>(null), [err, setErr] = useState('');
  const { bind, preview } = useCardPreview();
  useEffect(() => { printsOfCards([oracleId]).then(setPrints).catch(e => setErr(e.message)); }, [oracleId]);
  const low = prints && cheapest(prints);
  const img = (c: Any) => c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small;
  return <div className="card"><b>Quale stampa di {name}?</b>
    {err ? <p className="er">{err}</p> : !prints ? <p className="m">Cerco le stampe su Scryfall…</p> : <>
      <div className="list" style={{ marginTop: 8 }}>
        {any && <button className="item tap" disabled={busy} style={{ width: '100%', textAlign: 'left' }} onClick={() => onPick(null)}>
          <div className="g"><div className="name">Qualsiasi stampa</div><div className="meta">{low ? <span>la più economica: {eur(eurOf(low))} ({low.set.toUpperCase()} {low.collector_number})</span> : <span>prezzo non disponibile</span>}</div></div>
          <Icon name="next" /></button>}
        {prints.map(c => <button key={c.id} className="item tap" disabled={busy} style={{ width: '100%', textAlign: 'left' }} onClick={() => onPick(c)}>
          <img className="thumb" alt="" loading="lazy" src={img(c)} {...bind(img(c))} />
          <div className="g"><div className="name">{c.set_name}</div><div className="meta"><span>{c.set.toUpperCase()} {c.collector_number}</span><span>{c.released_at?.slice(0, 4)}</span>
            {eurOf(c) != null && <span className={c.id === low?.id ? 'ok' : ''}>{eur(eurOf(c))}</span>}</div></div>
          <Icon name="next" /></button>)}</div></>}
    <div className="bar" style={{ marginBottom: 0 }}><button className="ghost" onClick={onCancel}>Annulla</button></div>
    {preview}
  </div>;
}
