import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import Icon from '../../components/Icon';
import ActionBar from '../../components/ActionBar';
import CardDetail from '../card/CardDetail';
type Any = any;

export default function Import() {
  const [text, setText] = useState(''), [target, setTarget] = useState('collection'), [decks, setDecks] = useState<Any[]>([]);
  const [peek, setPeek] = useState<Any | null>(null), [rows, setRows] = useState<Any[] | null>(null), [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [addMode, setAddMode] = useState('missing');
  const physical = decks.find(d => String(d.id) === target && d.mode === 'physical' && !d.archived);
  useEffect(() => { api('/decks').then(setDecks).catch(() => {}); }, []);
  const ok = (rows ?? []).filter(r => r.printing_id);
  const run = async (f: () => Promise<void>) => { setBusy(true); setMsg(''); try { await f(); } catch (e: Any) { alert(e.message); } setBusy(false); };
  const analyze = () => run(async () => setRows((await api('/import/preview', 'POST', { text })).rows));
  const commit = () => run(async () => {
    const r = await api('/import/commit', 'POST', { target, addToCollection: physical ? addMode : 'none', rows: ok.map(x => ({ printing_id: x.printing_id, qty: x.qty, section: x.section, exact: !!(x.set && x.cn) })) });
    setMsg(target === 'collection' ? `Aggiunte ${r.imported} copie alla collezione.` : `Aggiunte ${r.imported} carte al mazzo.${r.addedToCollection ? ` ${r.addedToCollection} copie aggiunte anche alla collezione.` : ''}`); setRows(null); setText('');
  });
  return <>
    <p className="m" style={{ marginTop: 0 }}>Una carta per riga, con la quantità davanti. Vanno bene anche le liste esportate da Moxfield e Archidekt, e i nomi italiani.</p>
    <select value={target} onChange={e => { setTarget(e.target.value); setRows(null); }} aria-label="Dove importare"><option value="collection">Nella collezione</option>
      {decks.map(d => <option key={d.id} value={d.id}>Nel mazzo {d.name}</option>)}</select>
    {physical && <select style={{ marginTop: 8 }} value={addMode} onChange={e => setAddMode(e.target.value)} aria-label="Collezione">
      <option value="missing">Mazzo fisico: aggiungi alla collezione le copie che mancano</option>
      <option value="all">Mazzo fisico: aggiungi tutte le carte come copie nuove</option>
      <option value="none">Non toccare la collezione</option></select>}
    {target !== 'collection' && <p className="m" style={{ margin: '6px 0 0', fontSize: 14 }}>Le carte si aggiungono a quelle del mazzo. Per sostituirle, apri il mazzo e usa “Modifica come testo”.</p>}
    <textarea style={{ marginTop: 8 }} value={text} onChange={e => { setText(e.target.value); setRows(null); }} aria-label="Lista di carte" autoCapitalize="off" autoCorrect="off" spellCheck={false}
      placeholder={'4 Sol Ring\n1 Arcane Signet (CMM) 400\nCommander\n1 Zoraline, Cosmos Caller'} />
    {msg && <div className="card ok">{msg}</div>}
    {rows && <div className="card"><b>Anteprima</b><p style={{ margin: '4px 0' }}>{ok.length} riconosciute, {rows.length - ok.length} con problemi</p>
      <div className={target === 'collection' ? 'wa' : 'm'}>{target === 'collection' ? 'Le quantità verranno aggiunte alle copie che già possiedi.' : physical && addMode !== 'none' ? 'Le carte che non hai libere verranno aggiunte anche alla collezione.' : 'Le carte vanno nel mazzo; la collezione non cambia.'}</div>
      <div className="list">{rows.map((r, i) => <div className="item" key={i}>{r.image ? <img className="thumb" alt="" src={r.image} onClick={() => r.printing_id && setPeek(r)} /> : <span className="thumb" />}
        <div className="g">{r.qty ? r.qty + '× ' : ''}{r.card_name ?? r.name ?? r.line}{r.section === 'cmd' ? ' ★' : ''}<br />
          <small className={r.status === 'ok' ? 'ok' : r.status === 'fuzzy' ? 'wa' : 'er'}>{r.status === 'ok' ? '✔ riconosciuta' : r.msg}{r.set_code ? `, ${r.set_code.toUpperCase()} ${r.collector_number}` : ''}</small></div></div>)}</div>
      {peek && <CardDetail printingId={peek.printing_id} name={peek.card_name} ctx="search" bar={null} onClose={() => setPeek(null)} />}
      <small>Le righe con problemi vengono saltate: correggi il testo e analizza di nuovo.</small></div>}
    <ActionBar>{rows
      ? <><button onClick={() => setRows(null)}>Modifica</button><button className="b" disabled={busy || !ok.length} onClick={commit}><Icon name="check" />Importa {ok.length} righe</button></>
      : <button className="b" disabled={busy || !text.trim()} onClick={analyze}>{busy ? 'Analisi…' : 'Analizza la lista'}</button>}</ActionBar></>;
}
