import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fail } from '../../services/api';
import Icon from '../../components/Icon';
import { Spine, Pips } from '../../components/Mana';
import Menu from '../../components/Menu';
import { toast } from '../../components/Toast';
import DeckView from './DeckView';
import type { Go } from '../../pages/tabs';
type Any = any;

// Elenco dei mazzi: schede con costa colorata, comandante e avanzamento verso le 100 carte.
export default function DeckList({ creating: startCreating, openId, go }: { creating?: boolean; openId?: number; go: Go }) {
  const [list, setList] = useState<Any[]>([]), [open, setOpen] = useState<number | null>(null), [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(!!startCreating), [name, setName] = useState(''), [mode, setMode] = useState<'physical' | 'virtual'>('physical');
  const openRef = useRef<number | null>(null); useEffect(() => { openRef.current = open; }, [open]);
  const load = useCallback(() => api('/decks').then(x => { setList(x); setLoaded(true); }).catch(fail), []);
  useEffect(() => { load(); }, [load]);
  // il mazzo aperto è una voce della cronologia: funzionano il tasto/gesto "indietro" del telefono e del browser
  useEffect(() => {
    const onPop = (e: PopStateEvent) => { const id = e.state?.deck; if (id && Number(id) === openRef.current) return; setOpen(id ? Number(id) : null); if (!id) load(); window.scrollTo({ top: 0 }); };
    addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop);
  }, [load]);
  const openDeck = (id: number) => { history.pushState({ deck: id }, ''); setOpen(id); window.scrollTo({ top: 0 }); };
  const closeDeck = () => { if (history.state?.deck) history.back(); else { setOpen(null); load(); window.scrollTo({ top: 0 }); } };
  // dalla Home si può aprire direttamente un mazzo
  useEffect(() => { if (openId) openDeck(openId); }, [openId]); // eslint-disable-line
  if (open !== null) return <DeckView id={open} back={closeDeck} go={go} />;
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim()) return;
    try { const d = await api('/decks', 'POST', { name: name.trim(), mode }); setCreating(false); setName(''); openDeck(Number(d.id)); } catch (err) { fail(err); }
  };
  const refresh = async () => { try { const r = await api('/catalog/refresh', 'POST'); toast(`Legalità aggiornata per ${r.updated} carte`); } catch (e) { fail(e); } };
  const act = list.filter(d => !d.archived), arch = list.filter(d => d.archived);
  const run = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { fail(e); } load(); };
  const rename = (d: Any) => { const n = prompt('Nuovo nome del mazzo', d.name)?.trim(); if (n && n !== d.name) run(() => api('/decks/' + d.id, 'PATCH', { name: n })); };
  const remove = (d: Any) => { if (confirm(`Eliminare “${d.name}”?${d.mode === 'physical' ? ' Le copie tornano libere in collezione.' : ''} Non si può annullare.`)) run(() => api('/decks/' + d.id, 'DELETE')); };
  const Deck = (d: Any) => {
    const miss = d.mode === 'physical' ? Math.max(0, d.cards - d.assigned) : 0;
    const cs = ['W', 'U', 'B', 'R', 'G'].filter(c => d.ci?.includes(c)), glow = (cs.length ? cs : ['C']).map(c => `var(--mana-${c.toLowerCase()})`);
    return <div className="deck" key={d.id} style={{ '--glow': glow.length === 1 ? glow[0] + ', ' + glow[0] : glow.join(', ') } as React.CSSProperties} role="button" tabIndex={0} onClick={() => openDeck(Number(d.id))} onKeyDown={e => e.key === 'Enter' && openDeck(Number(d.id))}>
      <Spine ci={d.ci} />
      <div style={{ paddingRight: 40 }}><h4>{d.name}</h4>
        <div className="meta"><Pips ci={d.ci} /><span>{d.commanders || 'Senza comandante'}</span></div></div>
      <div className="meta" style={{ marginTop: 8 }}><span className="t m">{d.mode === 'physical' ? 'fisico' : 'virtuale'}</span>
        {d.mode === 'physical' && !d.archived && (miss ? <span className="t wa">{miss === 1 ? 'manca 1 copia' : `mancano ${miss} copie`}</span> : d.cards > 0 && <span className="t ok">assemblabile</span>)}
        <span style={{ marginLeft: 'auto' }} className="num">{d.cards}<small> / 100</small></span></div>
      <div className={'progress' + (d.cards === 100 ? ' full' : d.cards > 100 ? ' over' : '')}><span style={{ width: Math.min(100, d.cards) + '%' }} /></div>
      <div className="menu-at" onClick={e => e.stopPropagation()}><Menu label={'Opzioni di ' + d.name} className="icon ghost" items={[
        { icon: 'edit', label: 'Rinomina', onClick: () => rename(d) },
        { icon: 'archive', label: d.archived ? 'Riattiva' : 'Archivia', sub: d.archived ? 'Riassegna le copie libere' : 'Libera tutte le copie del mazzo', onClick: () => run(() => api(`/decks/${d.id}/archive`, 'POST', { archived: !d.archived })) },
        'sep',
        { icon: 'trash', label: 'Elimina mazzo', tone: 'danger', onClick: () => remove(d) },
      ]}><Icon name="dots" /></Menu></div></div>;
  };
  return <>
    {creating ? <form className="card" onSubmit={create}><b>Nuovo mazzo</b>
      <input style={{ marginTop: 10 }} autoFocus placeholder="Nome del mazzo" aria-label="Nome del mazzo" maxLength={120} value={name} onChange={e => setName(e.target.value)} />
      <div className="seg" role="radiogroup" aria-label="Tipo di mazzo" style={{ margin: '10px 0 6px' }}>
        <button type="button" role="radio" aria-checked={mode === 'physical'} className={mode === 'physical' ? 'on' : ''} onClick={() => setMode('physical')}>Fisico</button>
        <button type="button" role="radio" aria-checked={mode === 'virtual'} className={mode === 'virtual' ? 'on' : ''} onClick={() => setMode('virtual')}>Virtuale</button></div>
      <p className="m" style={{ margin: 0, fontSize: 14 }}>{mode === 'physical' ? 'Riserva le copie che possiedi: non potranno finire in un altro mazzo fisico.' : 'Una lista di prova: non riserva copie, serve a pianificare.'}</p>
      <div className="bar" style={{ marginBottom: 0 }}><button className="b" type="submit" disabled={!name.trim()}><Icon name="check" />Crea e apri</button><button type="button" className="ghost" onClick={() => setCreating(false)}>Annulla</button></div></form>
      : <div className="quick" style={{ marginTop: 4 }}><button className="b" onClick={() => setCreating(true)}><Icon name="plus" />Nuovo mazzo</button><button onClick={() => go('i')}><Icon name="text" />Importa lista</button></div>}
    {act.length > 0 && <div className="decks">{act.map(Deck)}</div>}
    {loaded && !list.length && !creating && <div className="card empty"><b>Nessun mazzo</b><p className="m">Crea un mazzo e aggiungi le carte, oppure incolla la lista di un mazzo (anche da Moxfield).</p></div>}
    {arch.length > 0 && <details><summary>Archiviati ({arch.length})</summary><div className="decks">{arch.map(Deck)}</div></details>}
    {loaded && list.length > 0 && <p className="m" style={{ fontSize: 14, margin: '16px 2px' }}>La legalità usa i dati di Scryfall. <button className="ghost small" style={{ padding: 0 }} onClick={refresh}>Aggiorna la banlist</button></p>}
  </>;
}
