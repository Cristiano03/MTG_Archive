import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fail } from '../../services/api';
import Search from '../../components/Search';
import Icon from '../../components/Icon';
import Stepper from '../../components/Stepper';
import ActionBar from '../../components/ActionBar';
import Sheet from '../../components/Sheet';
import Camera, { type CameraHandle } from './Camera';
import { readCard, loadOcr, stopOcr } from './ocr';
import { cleanOcrName, nameCertain, parseFooter, pickPrinting, similarity } from './recognize';
import { img, matchName, printingsOf, type SfCard } from './catalog';

// Una carta acquisita: niente entra nella collezione finché non la confermi.
type Item = { key: string; card: SfCard; qty: number; finish: string; nameOk: boolean; printOk: boolean; ocr: string };
type Act = { type: 'add' | 'inc'; key: string };
type Found = { card: SfCard; nameOk: boolean; printOk: boolean; ocr: string } | { suggestions: string[]; ocr: string };
const KEY = 'mtg-scan-session';
const loadSession = (): Item[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const saveSession = (x: Item[]) => { try { localStorage.setItem(KEY, JSON.stringify(x)); } catch { /* storage non disponibile */ } };
const slim = (c: SfCard): SfCard => ({ id: c.id, oracle_id: c.oracle_id, name: c.name, printed_name: c.printed_name, set: c.set, set_name: c.set_name, collector_number: c.collector_number, lang: c.lang, finishes: c.finishes, image_uris: c.image_uris, card_faces: c.card_faces?.map(f => ({ image_uris: f.image_uris })) });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const newItem = (card: SfCard, nameOk: boolean, printOk: boolean, ocr: string): Item =>
  ({ key: Math.random().toString(36).slice(2), card: slim(card), qty: 1, finish: card.finishes?.includes('nonfoil') ? 'nonfoil' : card.finishes?.[0] ?? 'nonfoil', nameOk, printOk, ocr });
const FIN_IT: Record<string, string> = { nonfoil: 'normale', foil: 'foil', etched: 'etched' };
const cardName = (c: SfCard) => c.printed_name && c.printed_name !== c.name ? `${c.printed_name} (${c.name})` : c.name;

export default function Scanner() {
  const cam = useRef<CameraHandle>(null);
  const [mode, setMode] = useState<'single' | 'continuous'>('single'), [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>(loadSession), hist = useRef<Act[]>([]);
  const [single, setSingle] = useState<Item | { suggestions: string[]; ocr: string } | null>(null); // scheda della scansione singola
  const [review, setReview] = useState(false); // lista finale della scansione continua
  const [toast, setToast] = useState<{ text: string; warn: boolean } | null>(null);
  const paused = useRef(false); paused.current = !!single || review; // con una scheda aperta la fotocamera non acquisisce
  useEffect(() => saveSession(items), [items]);
  useEffect(() => {
    setStatus('Preparo il riconoscimento (la prima volta scarica qualche MB)…');
    loadOcr().then(() => { setReady(true); setStatus(''); }).catch(e => { console.warn(e); setStatus('Il riconoscimento del testo non si è caricato: la prima volta serve Internet. Riapri Scansiona per riprovare.'); });
    return () => { stopOcr(); };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); }, [toast]);

  // un fotogramma: nome (OCR + catalogo) e, separatamente, stampa (set e numero in basso)
  const recognizeOnce = async () => {
    const video = cam.current?.video; if (!video || !video.videoWidth) return null;
    const r = await readCard(video), ocr = cleanOcrName(r.nameText);
    if (ocr.replace(/[^A-Za-zÀ-ÿ]/g, '').length < 3) return null;
    return { ocr, conf: r.nameConf, footer: parseFooter(r.footerText) };
  };
  const resolve = async (ocr: string, conf: number, footer: ReturnType<typeof parseFooter>): Promise<Found> => {
    setStatus(`Letto “${ocr}”, cerco nel catalogo…`);
    const m = await matchName(ocr);
    if (!m.card) return { suggestions: m.suggestions, ocr };
    const prints = await printingsOf(m.card.oracle_id, footer.lang ?? m.card.lang).catch(() => [] as SfCard[]);
    const { printing, certain } = prints.length ? pickPrinting(prints, footer) : { printing: m.card, certain: false };
    return { card: printing, nameOk: nameCertain(m.sim, conf), printOk: certain, ocr };
  };

  // --- scansione singola: scatto -> scheda della carta -> conferma
  const shoot = async () => {
    if (busy || !ready) return; setBusy(true);
    try {
      const r = await recognizeOnce();
      if (!r) setStatus('Nome non leggibile: avvicina la carta e allinea il nome al riquadro tratteggiato.');
      else { const f = await resolve(r.ocr, r.conf, r.footer); setStatus(''); setSingle('card' in f ? newItem(f.card, f.nameOk, f.printOk, f.ocr) : f); navigator.vibrate?.(40); }
    } catch (e: any) { setStatus('Errore: ' + e.message); }
    setBusy(false);
  };
  const addSingle = async (it: Item) => {
    try {
      await api('/import/commit', 'POST', { target: 'collection', rows: [{ printing_id: it.card.id, qty: it.qty, finish: it.finish }] });
      setSingle(null); setToast({ text: `✓ ${it.qty > 1 ? it.qty + '× ' : ''}${it.card.name} aggiunta alla collezione`, warn: false });
    } catch (e) { fail(e); }
  };
  const pickName = async (name: string, ocr: string) => {
    const m = await matchName(name).catch(() => null); if (!m?.card) return;
    const prints = await printingsOf(m.card.oracle_id).catch(() => [m.card!]);
    setSingle(newItem(prints[0] ?? m.card, true, false, ocr));
  };

  // --- scansione continua: aggiunge quando la stessa lettura si ripete due volte e la carta è cambiata
  const addToSession = useCallback((card: SfCard, nameOk: boolean, printOk: boolean, ocr: string) => {
    setItems(cur => {
      const fin = card.finishes?.includes('nonfoil') ? 'nonfoil' : card.finishes?.[0] ?? 'nonfoil';
      const same = cur.find(i => i.card.id === card.id && i.finish === fin && i.nameOk === nameOk);
      if (same) { hist.current.push({ type: 'inc', key: same.key }); return cur.map(i => i === same ? { ...i, qty: i.qty + 1 } : i); }
      const it = newItem(card, nameOk, printOk, ocr); hist.current.push({ type: 'add', key: it.key }); return [...cur, it];
    });
    setToast({ text: (nameOk ? '✓ ' : '⚠ ') + card.name + (nameOk && printOk ? '' : ' (da controllare)'), warn: !(nameOk && printOk) });
    navigator.vibrate?.(60);
  }, []);
  useEffect(() => {
    if (mode !== 'continuous' || !ready) return;
    let alive = true, prev = '', lastAdded = '', armed = true;
    (async () => {
      while (alive) {
        if (document.hidden || paused.current) { await sleep(500); continue; }
        try {
          const r = await recognizeOnce();
          if (!r) { prev = ''; armed = true; setStatus('Passa le carte una alla volta: vengono acquisite da sole.'); }
          else if (prev && similarity(prev, r.ocr) >= 0.8) {
            if (armed || similarity(lastAdded, r.ocr) < 0.6) {
              setBusy(true); const f = await resolve(r.ocr, r.conf, r.footer); setBusy(false); setStatus('');
              if ('card' in f) addToSession(f.card, f.nameOk, f.printOk, f.ocr); else setToast({ text: `⚠ “${r.ocr}” non riconosciuta: riprova`, warn: true });
              lastAdded = r.ocr; armed = false;
            } else setStatus('Stessa carta: cambiala, oppure tocca +1 per un’altra copia.');
          } else prev = r.ocr;
        } catch (e: any) { setStatus('Errore: ' + e.message); setBusy(false); await sleep(1500); }
        await sleep(600);
      }
    })();
    return () => { alive = false; };
  }, [mode, ready, addToSession]);

  const undo = () => {
    const a = hist.current.pop(); if (!a) return;
    setItems(cur => a.type === 'add' ? cur.filter(i => i.key !== a.key) : cur.map(i => i.key === a.key ? { ...i, qty: Math.max(1, i.qty - 1) } : i));
    setToast({ text: 'Ultima scansione annullata', warn: false });
  };
  const plusLast = () => { const last = items[items.length - 1]; if (!last) return; hist.current.push({ type: 'inc', key: last.key }); upd(last.key, { qty: last.qty + 1 }); setToast({ text: `+1 ${last.card.name}`, warn: false }); };
  const upd = (key: string, p: Partial<Item>) => setItems(cur => cur.map(i => i.key === key ? { ...i, ...p } : i));
  const del = (key: string) => setItems(cur => cur.filter(i => i.key !== key));
  const pending = items.filter(i => !i.nameOk || !i.printOk), total = items.reduce((t, i) => t + i.qty, 0);
  const commitAll = async () => {
    setBusy(true);
    try {
      const r = await api('/import/commit', 'POST', { target: 'collection', rows: items.map(i => ({ printing_id: i.card.id, qty: i.qty, finish: i.finish })) });
      setItems([]); hist.current = []; setReview(false); setToast({ text: `✓ ${r.imported} copie aggiunte alla collezione`, warn: false });
    } catch (e) { fail(e); }
    setBusy(false);
  };

  return <>
    <div className="seg" role="radiogroup" aria-label="Modalità">
      <button role="radio" aria-checked={mode === 'single'} className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>Una carta</button>
      <button role="radio" aria-checked={mode === 'continuous'} className={mode === 'continuous' ? 'on' : ''} onClick={() => setMode('continuous')}>Di seguito</button></div>
    <Camera ref={cam} reserve={250}>{toast && <div className="scan-toast" role="status" style={toast.warn ? { background: 'rgba(140, 80, 0, .9)' } : undefined}>{toast.text}</div>}</Camera>
    <p className="m" style={{ textAlign: 'center', minHeight: 40, margin: '8px 0 0', fontSize: 14.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} aria-live="polite">
      {status || (mode === 'single' ? 'Allinea il nome della carta al riquadro tratteggiato e scatta.' : 'Passa le carte una alla volta: vengono acquisite da sole.')}</p>

    {mode === 'single'
      ? <ActionBar className="scan"><span style={{ flex: 1 }} /><button className="shutter" aria-label={busy ? 'Riconoscimento in corso' : 'Scatta'} disabled={busy || !ready} onClick={shoot}><Icon name="camera" /></button><span style={{ flex: 1 }} /></ActionBar>
      : <ActionBar className="scan">
        <button className="icon" aria-label="Annulla l'ultima scansione" disabled={!items.length} onClick={undo}><Icon name="undo" /></button>
        <button className="b" style={{ flex: 1 }} disabled={!items.length} onClick={() => setReview(true)}><Icon name="check" />Ho finito{total ? ` (${total})` : ''}</button>
        <button className="icon" aria-label="Un'altra copia dell'ultima carta" disabled={!items.length} onClick={plusLast}><Icon name="plus" /></button>
      </ActionBar>}

    {single && 'card' in single && <SingleSheet it={single} onChange={p => setSingle({ ...single, ...p })} onAdd={() => addSingle(single)} onClose={() => setSingle(null)} />}
    {single && !('card' in single) && <Sheet title="Carta non riconosciuta" onClose={() => setSingle(null)} actions={<button onClick={() => setSingle(null)}>Riprova lo scatto</button>}>
      <p style={{ marginTop: 0 }}>Ho letto “{single.ocr}”. {single.suggestions.length ? 'Forse è una di queste:' : 'Cercala per nome:'}</p>
      {single.suggestions.length > 0 && <div className="list">{single.suggestions.map(n => <div key={n} className="item tap" onClick={() => pickName(n, single.ocr)}><div className="g"><div className="name">{n}</div></div><Icon name="next" /></div>)}</div>}
      <Search mode="prints" action="Scegli" onPick={c => setSingle(newItem(c, true, true, single.ocr))} />
    </Sheet>}

    {review && <Sheet title={`Carte acquisite (${total})`} onClose={() => setReview(false)}
      actions={<><button onClick={() => setReview(false)}>Continua</button><button className="b" disabled={busy || pending.length > 0 || !items.length} onClick={commitAll}><Icon name="check" />Aggiungi {total}</button></>}>
      {pending.length > 0 && <div className="card wa" style={{ marginTop: 0 }}><b>{pending.length} da controllare</b><p style={{ margin: '4px 0 0' }}>Verifica nome e stampa, poi tocca Confermo.</p>
        {pending.some(i => i.nameOk) && <button style={{ marginTop: 10 }} onClick={() => setItems(cur => cur.map(i => i.nameOk ? { ...i, printOk: true } : i))}>Accetta le stampe proposte</button>}</div>}
      {items.length ? <div className="list">{[...items].reverse().map(i => <ItemRow key={i.key} it={i} upd={p => upd(i.key, p)} del={() => del(i.key)} />)}</div> : <p className="m">Nessuna carta.</p>}
      {items.length > 0 && <button className="ghost d" style={{ width: '100%' }} onClick={() => { if (confirm('Svuotare l’elenco delle carte acquisite? La collezione non cambia.')) { setItems([]); hist.current = []; setReview(false); } }}>Svuota l’elenco</button>}
    </Sheet>}
  </>;
}

// Scheda della carta riconosciuta (scansione singola)
function SingleSheet({ it, onChange, onAdd, onClose }: { it: Item; onChange: (p: Partial<Item>) => void; onAdd: () => void; onClose: () => void }) {
  const [prints, setPrints] = useState<SfCard[] | null>(null), [fixing, setFixing] = useState(false);
  useEffect(() => { printingsOf(it.card.oracle_id, it.card.lang).then(setPrints).catch(() => setPrints([it.card])); }, [it.card.oracle_id]);
  const ok = it.nameOk && it.printOk;
  return <Sheet title={ok ? 'Carta riconosciuta' : 'Controlla la carta'} onClose={onClose}
    actions={<><button onClick={onClose}>Annulla</button><button className="b" onClick={onAdd}><Icon name="check" />Aggiungi{it.qty > 1 ? ` ${it.qty}` : ''}</button></>}>
    {fixing ? <><Search mode="prints" autoFocus action="Usa" onPick={c => { onChange({ card: slim(c), nameOk: true, printOk: true, finish: c.finishes?.[0] ?? 'nonfoil' }); setFixing(false); }} />
      <button className="ghost" onClick={() => setFixing(false)}>Torna alla carta</button></> : <>
      <img className="big-card" alt="" src={img(it.card, true)} />
      <h3 style={{ textAlign: 'center', margin: '0 0 2px' }}>{cardName(it.card)}</h3>
      <p className="m" style={{ textAlign: 'center', margin: '0 0 10px' }}>{it.card.set_name} · {it.card.set.toUpperCase()} {it.card.collector_number}</p>
      {!it.nameOk && <p className="wa" style={{ margin: '0 0 8px' }}>Lettura incerta (“{it.ocr}”): controlla che sia la carta giusta.</p>}
      {!it.printOk && <p className="wa" style={{ margin: '0 0 8px' }}>Edizione non letta con certezza: scegli quella giusta.</p>}
      <div className="filters">
        <select aria-label="Edizione" value={it.card.id} onChange={e => { const p = prints?.find(x => x.id === e.target.value); if (p) onChange({ card: slim(p), printOk: true, finish: p.finishes.includes(it.finish) ? it.finish : p.finishes[0] }); }}>
          {(prints ?? [it.card]).map(p => <option key={p.id} value={p.id}>{p.set_name} ({p.set.toUpperCase()} {p.collector_number}) {p.lang}</option>)}</select>
        <select aria-label="Finitura" value={it.finish} onChange={e => onChange({ finish: e.target.value })}>{(it.card.finishes?.length ? it.card.finishes : ['nonfoil']).map(f => <option key={f} value={f}>{FIN_IT[f] ?? f}</option>)}</select></div>
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <Stepper value={it.qty} label="Copie" onMinus={() => onChange({ qty: Math.max(1, it.qty - 1) })} onPlus={() => onChange({ qty: it.qty + 1 })} />
        <button onClick={() => setFixing(true)}><Icon name="edit" />Non è questa</button></div>
    </>}
  </Sheet>;
}

function ItemRow({ it, upd, del }: { it: Item; upd: (p: Partial<Item>) => void; del: () => void }) {
  const [prints, setPrints] = useState<SfCard[] | null>(null), [fixing, setFixing] = useState(false);
  const loadPrints = () => { if (!prints) printingsOf(it.card.oracle_id, it.card.lang).then(setPrints).catch(() => setPrints([it.card])); };
  useEffect(() => { if (!it.printOk) loadPrints(); }, []); // su iPhone il menu si apre subito: le stampe devono essere già pronte
  const ok = it.nameOk && it.printOk;
  return <>
    <div className="item">
      <img className="thumb l" alt="" src={img(it.card)} />
      <div className="g"><div className="name">{cardName(it.card)}</div>
        <div className="meta"><span>{it.card.set.toUpperCase()} {it.card.collector_number}</span>{it.card.lang !== 'en' && <span>{it.card.lang}</span>}</div>
        <div className="meta">{ok ? <span className="ok">confermata</span> : <>{!it.nameOk && <span className="wa">nome incerto: letto “{it.ocr}”</span>}{!it.printOk && <span className="wa">stampa da scegliere</span>}</>}</div></div>
      <Stepper value={it.qty} onMinus={() => upd({ qty: Math.max(1, it.qty - 1) })} onPlus={() => upd({ qty: it.qty + 1 })} label={'Copie di ' + it.card.name} /></div>
    <div className="itemx">
      <div className="filters">
        <select aria-label="Stampa" value={it.card.id} onFocus={loadPrints} onChange={e => { const p = prints?.find(x => x.id === e.target.value); if (p) upd({ card: slim(p), printOk: true, finish: p.finishes.includes(it.finish) ? it.finish : p.finishes[0] }); }}>
          {(prints ?? [it.card]).map(p => <option key={p.id} value={p.id}>{p.set_name} ({p.set.toUpperCase()} {p.collector_number}) {p.lang}</option>)}</select>
        <select aria-label="Finitura" value={it.finish} onChange={e => upd({ finish: e.target.value })}>{(it.card.finishes?.length ? it.card.finishes : ['nonfoil']).map(f => <option key={f} value={f}>{FIN_IT[f] ?? f}</option>)}</select></div>
      <div className="bar">{!ok && <button className="b" onClick={() => upd({ nameOk: true, printOk: true })}><Icon name="check" />Confermo</button>}
        <button onClick={() => setFixing(!fixing)}><Icon name="edit" />Correggi</button><button className="icon d" aria-label="Togli dall'elenco" onClick={del}><Icon name="trash" /></button></div>
      {fixing && <Search mode="prints" autoFocus action="Usa" onPick={c => { upd({ card: slim(c), nameOk: true, printOk: true, finish: c.finishes?.[0] ?? 'nonfoil' }); setFixing(false); }} />}
    </div></>;
}
