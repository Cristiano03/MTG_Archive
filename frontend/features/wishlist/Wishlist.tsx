import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, fail, download } from '../../services/api';
import Search from '../../components/Search';
import Icon from '../../components/Icon';
import Stepper from '../../components/Stepper';
import PrintPicker from '../../components/PrintPicker';
import ScryResults from '../../components/ScryResults';
import Menu from '../../components/Menu';
import { toast } from '../../components/Toast';
import { useCardPreview } from '../../components/CardPreview';
import { eur } from '../../components/Price';
import { useWide } from '../../components/useWide';
import CardDetail, { idFromImage } from '../card/CardDetail';
import { usePricesUpdated } from '../../services/autoRefresh';
type Any = any;
const PRIO: [string, string][] = [['', 'Nessuna'], ['1', 'Alta'], ['2', 'Media'], ['3', 'Bassa']];

// Lista dei desideri: in cima la ricerca per aggiungere (poi si sceglie la stampa, o "qualsiasi");
// righe compatte con quantità; un tocco apre priorità, nota, stampa, "Ho comprato" e rimozione.
export default function Wishlist() {
  const [rows, setRows] = useState<Any[]>([]), [loaded, setLoaded] = useState(false), [open, setOpen] = useState<number | null>(null);
  const [q, setQ] = useState(''), [choosing, setChoosing] = useState<Any | null>(null), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'buy' | 'print' | null>(null);
  const { bind, preview } = useCardPreview();
  // telefono: toccare una riga apre la scheda della carta con le opzioni della lista
  const isWide = useWide(), [det, setDet] = useState<number | null>(null);
  const load = useCallback(() => api('/wishlist').then(x => { setRows(x); setLoaded(true); }).catch(fail), []);
  useEffect(() => { load(); }, [load]);
  usePricesUpdated(load);
  const act = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { fail(e); } load(); };
  const patch = (r: Any, p: Any) => act(() => api('/wishlist/' + r.id, 'PATCH', p));
  const remove = (r: Any) => confirm(`Togliere ${r.name} dalla lista?`) && act(async () => { await api('/wishlist/' + r.id, 'DELETE'); setOpen(null); toast(`${r.name} tolta dalla lista`); });
  // aggiunta: si sceglie la carta, la ricerca si svuota, poi si sceglie la stampa (o "qualsiasi")
  const pickCard = (c: Any) => { setChoosing(c); setQ(''); };
  const add = async (p: Any | null) => {
    if (!choosing) return; setBusy(true);
    await act(() => api('/wishlist', 'POST', p ? { printing_id: p.id, qty: 1 } : { printing_id: choosing.id, any: true, qty: 1 }));
    toast(`${choosing.name} nella lista${p ? ` (${p.set.toUpperCase()} ${p.collector_number})` : ''}`); setChoosing(null); setBusy(false);
  };
  const setPrint = (r: Any, p: Any | null) => act(async () => { await api(`/wishlist/${r.id}/printing`, 'POST', { printing_id: p?.id ?? null }); setMode(null); });
  const toBuy = rows.reduce((t, r) => t + r.to_buy, 0), cost = rows.reduce((t, r) => t + (r.price_ref ? r.to_buy * Number(r.price_ref) : 0), 0);
  const toggle = (r: Any) => { setDet(r.id); setMode(null); }; // scheda della carta con le opzioni della lista (telefono e computer)

  const closeDet = () => { if (matchMedia('(min-width: 900px)').matches) setDet(null); else history.back(); };
  // scheda della carta con le opzioni della lista: pannello a sinistra sul computer, a tutto schermo sul telefono
  const detailOf = (id: number, inline: boolean) => { const r = rows.find(x => x.id === id); if (!r) return null;
      return <CardDetail key={r.id} inline={inline} printingId={r.printing_id ?? idFromImage(r.image)} name={r.name} ctx="wish" onClose={() => { setDet(null); setMode(null); }} onChanged={load}
        panel={<section className="panel">
          <div className="ph"><b>Nella lista dei desideri</b><small className={r.to_buy ? 'wa' : 'ok'}>{r.to_buy ? `da comprare ${r.to_buy}` : 'coperta dalle copie libere'}</small></div>
          <div className="qtyrow" style={{ margin: '6px 0' }}><div className="g"><b>Copie desiderate</b>{r.owned > 0 && <small className="m" style={{ display: 'block' }}>Ne hai {r.owned}, {r.free} {r.free === 1 ? 'libera' : 'libere'}</small>}</div>
            <Stepper value={r.qty_wanted} label={'Copie desiderate di ' + r.name} onPlus={() => patch(r, { qty_wanted: r.qty_wanted + 1 })} onMinus={() => r.qty_wanted > 1 && patch(r, { qty_wanted: r.qty_wanted - 1 })} /></div>
          <h4 className="lbl" style={{ marginTop: 10 }}>Priorità</h4>
          <div className="pillrow" style={{ marginTop: 0 }}>{PRIO.map(([v, l]) => <button key={v} className={'pchip' + (String(r.priority ?? '') === v ? ' on' : '')} onClick={() => patch(r, { priority: v ? Number(v) : null })}>{l}</button>)}</div>
          <div className="kvlist links" style={{ padding: 0, marginTop: 10 }}>
            <button onClick={() => setMode(mode === 'print' ? null : 'print')}><span>Stampa</span><span>{r.printing_id ? `${r.set_code?.toUpperCase()} · #${r.collector_number}` : 'Qualsiasi'}</span><Icon name={mode === 'print' ? 'close' : 'next'} /></button>
            <div className="notein"><span>Nota</span><input key={r.id} defaultValue={r.note ?? ''} placeholder="Aggiungi" maxLength={500} onBlur={e => e.target.value !== (r.note ?? '') && patch(r, { note: e.target.value })} /></div>
            {r.price_ref != null && <div><span>Prezzo di riferimento</span><span>{eur(r.price_ref)}</span></div>}</div>
          {mode === 'print' && <PrintPicker oracleId={r.oracle_id} name={r.name} onPick={p => setPrint(r, p)} onCancel={() => setMode(null)} />}
          {mode === 'buy' && <Purchase r={r} done={m => { setMode(null); toast(m); load(); closeDet(); }} />}
        </section>}
        bar={<><button className="icon sq" aria-label={'Togli ' + r.name + ' dalla lista'} onClick={() => { if (confirm(`Togliere ${r.name} dalla lista?`)) act(async () => { await api('/wishlist/' + r.id, 'DELETE'); toast(`${r.name} tolta dalla lista`); closeDet(); }); }}><Icon name="trash" /></button>
          <button className="b" onClick={() => setMode(mode === 'buy' ? null : 'buy')}><Icon name="check" />{mode === 'buy' ? 'Annulla acquisto' : 'Ho comprato'}</button></>} />; };
  const side = isWide ? rows.find(x => x.id === det) ?? rows[0] ?? null : null;
  return <div className={isWide ? 'colgrid' : undefined}>
    {side && <aside className="dside">{detailOf(side.id, true)}</aside>}
    <div className="colmain">
    <div className="toolbar">
      <div className="row"><div className="search"><Icon name="search" />
        <input type="search" enterKeyHint="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Aggiungi una carta alla lista" aria-label="Cerca una carta da aggiungere alla lista" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button className="clear" aria-label="Cancella la ricerca" onClick={() => setQ('')}><Icon name="close" /></button>}</div>
        <Menu label="Altro" items={[
          { icon: 'download', label: 'Esporta la lista', sub: 'Testo: “2 Sol Ring”', onClick: () => download('/export/wishlist.txt') },
        ]}><Icon name="dots" /></Menu></div>
    </div>
    {q.trim().length >= 2 && <ScryResults q={q} mode="cards" title="Scegli la carta" actions={c => <button className="b small" onClick={() => pickCard(c)}>Scegli</button>}
      bar={(c, close) => <><button className="wide" onClick={() => { close(); pickCard(c); }}><Icon name="edit" />Scegli la stampa</button>
        <button className="b" onClick={() => act(async () => { await api('/wishlist', 'POST', { printing_id: c.id, any: true, qty: 1 }); toast(`${c.name} nella lista`); setQ(''); close(); })}><Icon name="heart" />Aggiungi alla lista</button></>} />}
    {choosing && <PrintPicker oracleId={choosing.oracle_id ?? choosing.card_faces?.[0]?.oracle_id} name={choosing.name} busy={busy} onPick={add} onCancel={() => setChoosing(null)} />}

    {rows.length > 0 && <div className="card" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span className="num" style={{ fontSize: 34 }}>{toBuy}</span><span>{toBuy === 1 ? 'copia da comprare' : 'copie da comprare'}</span>
      {cost > 0 && <span className="m" style={{ marginLeft: 'auto' }}>circa <b style={{ color: 'var(--ink)' }}>{eur(cost)}</b></span>}</div>}

    {rows.length > 0 && <div className="list flat">{rows.map(r => <Fragment key={r.id}>
      <div className={'item tap' + (isWide && side?.id === r.id ? ' cur' : '')} onClick={() => toggle(r)}>
        {r.image ? <img className="thumb" alt="" loading="lazy" src={r.image} {...bind(r.image)} /> : <span className="thumb" />}
        <div className="g"><div className="name">{r.name}</div>
          <div className="meta"><span className={r.to_buy ? 'wa' : 'ok'}>{r.to_buy ? `da comprare ${r.to_buy}` : 'coperta dalle copie libere'}</span>
            <span>{r.printing_id ? `${r.set_code?.toUpperCase()} ${r.collector_number}` : 'qualsiasi stampa'}</span>
            {r.price_ref != null && <span className="price">{eur(r.price_ref)}</span>}
            {r.priority && <span className="t m">priorità {PRIO.find(p => p[0] === String(r.priority))?.[1].toLowerCase()}</span>}</div></div>
        <Stepper value={r.qty_wanted} label={'Copie desiderate di ' + r.name} onPlus={() => patch(r, { qty_wanted: r.qty_wanted + 1 })}
          onMinus={() => r.qty_wanted > 1 ? patch(r, { qty_wanted: r.qty_wanted - 1 }) : remove(r)} /></div>
      {open === r.id && <div className="itemx">
        {r.owned > 0 && <p className="m" style={{ margin: '4px 0 8px', fontSize: 14 }}>Ne hai {r.owned}, {r.free} {r.free === 1 ? 'libera' : 'libere'}.</p>}
        {r.price_source && <p className="m" style={{ margin: '4px 0 8px', fontSize: 14 }}>{r.price_source}, {new Date(r.price_at).toLocaleDateString('it')}</p>}
        <div className="filters">
          <label className="field">Priorità<select value={r.priority ?? ''} onChange={e => patch(r, { priority: e.target.value ? Number(e.target.value) : null })}>{PRIO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field">Nota<input defaultValue={r.note ?? ''} onBlur={e => e.target.value !== (r.note ?? '') && patch(r, { note: e.target.value })} /></label></div>
        <div className="bar" style={{ marginBottom: 0, flexWrap: 'nowrap' }}>
          <button style={{ flex: 1 }} className={mode === 'buy' ? 'soft' : 'b'} onClick={() => setMode(mode === 'buy' ? null : 'buy')}><Icon name="check" />Ho comprato</button>
          <button style={{ flex: 1 }} className={mode === 'print' ? 'soft' : ''} onClick={() => setMode(mode === 'print' ? null : 'print')}><Icon name="edit" />Stampa</button>
          <button className="icon d" aria-label={'Togli ' + r.name} onClick={() => remove(r)}><Icon name="trash" /></button></div>
        {mode === 'buy' && <Purchase r={r} done={m => { setMode(null); setOpen(null); toast(m); load(); }} />}
        {mode === 'print' && <PrintPicker oracleId={r.oracle_id} name={r.name} onPick={p => setPrint(r, p)} onCancel={() => setMode(null)} />}</div>}
    </Fragment>)}</div>}
    {loaded && !rows.length && !choosing && q.trim().length < 2 && <div className="card empty"><b>Lista vuota</b><p className="m">Scrivi qui sopra il nome di una carta che cerchi, oppure apri un mazzo incompleto e usa “Mancanti → Mettile nella lista dei desideri”.</p></div>}
    {preview}
    {!isWide && det && detailOf(det, false)}
  </div></div>;
}

// Acquisto guidato: scegli la stampa comprata, quante e in che stato; entra nella collezione e scala dalla lista.
function Purchase({ r, done }: { r: Any; done: (m: string) => void }) {
  const [p, setP] = useState<Any>(null), [qty, setQty] = useState(Math.max(1, r.to_buy || r.qty_wanted)), [finish, setFinish] = useState('nonfoil'), [cond, setCond] = useState('NM'), [assign, setAssign] = useState(true);
  const go = async () => {
    try {
      const x = await api(`/wishlist/${r.id}/purchase`, 'POST', { printing_id: p.id, qty, finish, condition: cond, assign });
      done(`${x.added} ${x.added === 1 ? 'copia' : 'copie'} di ${r.name} in collezione${x.remaining ? `, ne restano ${x.remaining} in lista` : ''}${x.assignedTo.length ? `; assegnate a ${x.assignedTo.join(', ')}` : ''}`);
    } catch (e) { fail(e); }
  };
  if (!p) return <div style={{ marginTop: 8 }}><p className="m" style={{ margin: '0 0 6px' }}>Quale stampa hai comprato?</p><Search mode="prints" action="Scegli" query={`!"${r.name}"`} onPick={setP} /></div>;
  return <div className="card" style={{ marginBottom: 0 }}><p style={{ margin: '0 0 8px' }}><b>{p.set_name}</b>, {p.set.toUpperCase()} {p.collector_number} ({p.lang}) <button className="ghost small" onClick={() => setP(null)}>Cambia</button></p>
    <div className="filters"><Stepper value={qty} label="Copie comprate" onMinus={() => setQty(q => Math.max(1, q - 1))} onPlus={() => setQty(q => q + 1)} />
      <select aria-label="Finitura" value={finish} onChange={e => setFinish(e.target.value)}>{(p.finishes?.length ? p.finishes : ['nonfoil']).map((f: string) => <option key={f}>{f}</option>)}</select>
      <select aria-label="Condizione" value={cond} onChange={e => setCond(e.target.value)}>{['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'].map(c => <option key={c}>{c}</option>)}</select></div>
    <label className="m"><input type="checkbox" checked={assign} onChange={e => setAssign(e.target.checked)} /> Assegna ai mazzi fisici che la aspettano</label>
    <div className="bar" style={{ marginBottom: 0 }}><button className="b" onClick={go}><Icon name="check" />Conferma acquisto</button></div></div>;
}
