import { useState } from 'react';
import { api, fail } from '../../services/api';
import Sheet from '../../components/Sheet';
import Stepper from '../../components/Stepper';
import Search from '../../components/Search';
import Icon from '../../components/Icon';
import { toast } from '../../components/Toast';
type Any = any;
const COND = ['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const LANGS: [string, string][] = [['it', 'Italiano'], ['en', 'Inglese'], ['ja', 'Giapponese']];

// Modifica di una riga della collezione (telefono): stampa, finitura, condizione, lingua, quantità, nota; elimina.
export default function EditSheet({ item: i, decks, onClose, onSaved }: { item: Any; decks: Any[]; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState({ finish: i.finish, condition: i.condition, lang: i.lang, note: i.note ?? '' }), [qty, setQty] = useState(i.qty);
  const [pick, setPick] = useState(false), [note, setNote] = useState(!!i.note), [other, setOther] = useState(!LANGS.some(([k]) => k === i.lang)), [busy, setBusy] = useState(false);
  const deckNames = (i.decks ?? []).map((id: number) => decks.find(x => x.id === id)?.name).filter(Boolean);
  const setQtyApi = async (q: number) => {
    try { await api('/collection/' + i.id, 'PATCH', { qty: q }); return true; }
    catch (e: Any) {
      if (e.status !== 409) { fail(e); return false; }
      if (!confirm('Alcune copie sono in un mazzo. Toglierle anche dal mazzo? Lì risulteranno mancanti.')) return false;
      try { await api('/collection/' + i.id, 'PATCH', { qty: q, release: true }); return true; } catch (e2) { fail(e2); return false; }
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (qty !== i.qty && !(await setQtyApi(qty))) { setBusy(false); return; }
      const patch: Any = {}; (['finish', 'condition', 'lang', 'note'] as const).forEach(k => { if ((d[k] ?? '') !== (i[k] ?? '')) patch[k] = d[k]; });
      if (Object.keys(patch).length) { const r = await api(`/collection/${i.id}/attrs`, 'PATCH', patch); toast(r.merged ? 'C’era già una riga identica: unite.' : 'Salvato'); } else toast('Salvato');
      onSaved();
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const changePrint = async (c: Any) => { try { await api(`/collection/${i.id}/attrs`, 'PATCH', { printing_id: c.id }); toast(`Stampa cambiata: ${c.set_name}`); onSaved(); } catch (e) { fail(e); } };
  const remove = async () => { if (!confirm(`Togliere ${i.name} (${i.qty} ${i.qty === 1 ? 'copia' : 'copie'}) dalla collezione?`)) return; if (await setQtyApi(0)) { toast(`Rimossa ${i.name}`); onSaved(); } };

  return <Sheet title={i.name} onClose={onClose}
    head={<div className="edhead"><img className="thumb" src={i.image_small} alt="" /><div className="g"><b>{i.name}</b><small>{i.set_code.toUpperCase()} · {i.qty} {i.qty === 1 ? 'copia' : 'copie'}</small></div></div>}
    actions={<><button className="danger grow0" onClick={remove}><Icon name="trash" />Elimina</button><button className="b" disabled={busy} onClick={save}>Salva modifiche</button></>}>
    <div className="panel kvlist links">
      <button onClick={() => setPick(!pick)}><span>Stampa</span><span>{i.set_code.toUpperCase()} · #{i.collector_number}</span><Icon name={pick ? 'close' : 'next'} /></button></div>
    {pick && <Search mode="prints" query={`!"${i.name}"`} action="Usa" onPick={changePrint} />}

    <h4 className="lbl">Finitura</h4>
    <div className="seg">{(['nonfoil', 'foil', 'etched'] as const).map(f => <button key={f} className={d.finish === f ? 'on' : ''} onClick={() => setD({ ...d, finish: f })}>{f === 'nonfoil' ? 'Normale' : f === 'foil' ? 'Foil' : 'Etched'}</button>)}</div>
    <h4 className="lbl">Condizione</h4>
    <div className="pillrow">{COND.map(c => <button key={c} className={'pchip round' + (d.condition === c ? ' on' : '')} onClick={() => setD({ ...d, condition: c })}>{c === 'M' ? 'MT' : c}</button>)}</div>
    <h4 className="lbl">Lingua</h4>
    <div className="pillrow">{LANGS.map(([k, l]) => <button key={k} className={'pchip' + (!other && d.lang === k ? ' on' : '')} onClick={() => { setOther(false); setD({ ...d, lang: k }); }}>{l}</button>)}
      <button className={'pchip' + (other ? ' on' : '')} onClick={() => setOther(true)}>Altra…</button></div>
    {other && <input style={{ marginTop: 8 }} placeholder="Codice lingua (de, fr, es…)" maxLength={5} value={d.lang} onChange={e => setD({ ...d, lang: e.target.value.trim().toLowerCase() })} />}
    <div className="qtyrow"><div className="g"><h4 className="lbl" style={{ margin: 0 }}>Quantità</h4><small className="m">Copie con questi stessi dettagli</small></div>
      <Stepper value={qty} onMinus={() => setQty(Math.max(1, qty - 1))} onPlus={() => setQty(qty + 1)} /></div>
    <div className="panel kvlist links">
      <div><span>Mazzo</span><span>{deckNames.length ? deckNames.join(', ') : 'Nessuno'}</span></div>
      {note ? <div className="notein"><span>Nota</span><input autoFocus={!i.note} maxLength={500} placeholder="Scrivi una nota" value={d.note} onChange={e => setD({ ...d, note: e.target.value })} /></div>
        : <button onClick={() => setNote(true)}><span>Nota</span><span>Aggiungi</span><Icon name="next" /></button>}</div>
  </Sheet>;
}
