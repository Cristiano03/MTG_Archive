import { useEffect, useState } from 'react';
import { api, apiText, fail } from '../../services/api';
import Icon from '../../components/Icon';
type Any = any;
// Modifica del mazzo come testo: la lista attuale si può riscrivere o sostituire incollandone un'altra (es. da Moxfield).
export default function DeckText({ deck, done, cancel }: { deck: Any; done: (msg: string) => void; cancel: () => void }) {
  const [text, setText] = useState(''), [rows, setRows] = useState<Any[] | null>(null), [busy, setBusy] = useState(false);
  const [addMode, setAddMode] = useState<'missing' | 'all' | 'none'>('missing');
  const physical = deck.mode === 'physical' && !deck.archived;
  useEffect(() => { apiText(`/decks/${deck.id}/export?format=sections`).then(t => setText(t.trimEnd())).catch(() => {}); }, [deck.id]);
  const ok = (rows ?? []).filter(r => r.printing_id), bad = (rows ?? []).filter(r => !r.printing_id);
  const cmdInList = ok.some(r => r.section === 'cmd');
  const analyze = async () => { setBusy(true); try { setRows((await api('/import/preview', 'POST', { text })).rows); } catch (e) { fail(e); } setBusy(false); };
  const commit = async () => {
    if (!confirm(`Le carte di “${deck.name}” verranno sostituite con questa lista${cmdInList ? '' : ' (il comandante resta)'}. Continuare?`)) return;
    setBusy(true);
    try {
      const r = await api('/import/commit', 'POST', { target: deck.id, replace: true, addToCollection: physical ? addMode : 'none',
        rows: ok.map(x => ({ printing_id: x.printing_id, qty: x.qty, section: x.section, exact: !!(x.set && x.cn) })) });
      done(`Lista sostituita: ${r.imported} carte.${r.addedToCollection ? ` Aggiunte ${r.addedToCollection} copie alla collezione.` : ''}`);
    } catch (e) { fail(e); }
    setBusy(false);
  };
  return <div className="card"><b>Modifica la lista come testo</b>
    <p className="m" style={{ margin: '4px 0 10px' }}>Qui c'è la lista attuale: modificala, oppure cancellala e incolla una lista nuova (anche esportata da Moxfield o Archidekt). Confermando, sostituisce le carte del mazzo.</p>
    {!rows && <textarea style={{ minHeight: 260 }} value={text} onChange={e => setText(e.target.value)} aria-label="Lista del mazzo" autoCapitalize="off" autoCorrect="off" spellCheck={false} />}
    {rows && <>
      <p style={{ margin: '0 0 8px' }}><b className="ok">{ok.reduce((t, r) => t + r.qty, 0)} carte riconosciute</b>{bad.length > 0 && <>, <b className="er">{bad.length} righe con problemi</b> (verranno saltate)</>}.
        {!cmdInList && ' La lista non indica il comandante: resta quello attuale.'}</p>
      {bad.length > 0 && <div className="list">{bad.map((r, i) => <div className="item" key={i} style={{ minHeight: 48 }}><div className="g"><div className="name">{r.line}</div><div className="meta er">{r.msg}</div></div></div>)}</div>}
      {ok.some(r => r.status === 'fuzzy') && <details><summary>Nomi interpretati ({ok.filter(r => r.status === 'fuzzy').length})</summary>
        <div className="list">{ok.filter(r => r.status === 'fuzzy').map((r, i) => <div className="item" key={i} style={{ minHeight: 48 }}><div className="g"><div className="name">{r.card_name}</div><div className="meta wa">scritto “{r.name}”</div></div></div>)}</div></details>}
      {physical && <div style={{ marginTop: 10 }}><b>Collezione</b>
        <div className="list" role="radiogroup" aria-label="Collezione">{([
          ['missing', 'Aggiungi solo le copie che mancano', 'Le copie libere che hai già vengono usate; le altre entrano nella collezione.'],
          ['all', 'Aggiungi tutte le carte come copie nuove', 'Per un mazzo appena comprato: ogni carta della lista è una copia in più.'],
          ['none', 'Non toccare la collezione', 'Le carte che non hai risultano mancanti.'],
        ] as const).map(([k, t, d]) => <label key={k} className="item tap" style={{ display: 'flex' }}>
          <input type="radio" name="addmode" style={{ width: 22, height: 22, minHeight: 0, accentColor: 'var(--arcane)' }} checked={addMode === k} onChange={() => setAddMode(k)} />
          <div className="g"><div className="name">{t}</div><div className="meta">{d}</div></div></label>)}</div></div>}
    </>}
    <div className="bar" style={{ marginBottom: 0 }}>
      {!rows ? <><button className="b" disabled={busy || !text.trim()} onClick={analyze}>{busy ? 'Analisi…' : 'Analizza la lista'}</button><button className="ghost" onClick={cancel}>Annulla</button></>
        : <><button className="b" disabled={busy || !ok.length} onClick={commit}><Icon name="check" />Sostituisci le carte</button><button onClick={() => setRows(null)}>Modifica il testo</button></>}
    </div></div>;
}
