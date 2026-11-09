import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, download, fail } from '../../services/api';
import Search from '../../components/Search';
import Icon from '../../components/Icon';
import Stepper from '../../components/Stepper';
import Check from '../../components/Check';
import Sheet from '../../components/Sheet';
import Menu from '../../components/Menu';
import SelBar from '../../components/SelBar';
import ScryResults from '../../components/ScryResults';
import PrintPicker from '../../components/PrintPicker';
import { toast } from '../../components/Toast';
import { useCardPreview } from '../../components/CardPreview';
import { eur } from '../../components/Price';
import { Pips } from '../../components/Mana';
import { ManaCost, ManaToggles, NO_COLOR, SortChip, matchColor, sortCards, type ColorFilter, type Sort } from '../../components/CardTools';
import { usePref } from '../../services/prefs';
import type { Go, Preset } from '../../pages/tabs';
type Any = any;
const COND = ['M', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'], FIN = ['nonfoil', 'foil', 'etched'];
const FIN_IT: Record<string, string> = { nonfoil: 'normale', foil: 'foil', etched: 'etched' };
const RAR_IT: Record<string, string> = { common: 'comune', uncommon: 'non comune', rare: 'rara', mythic: 'mitica' };
const EMPTY = { rar: '', st: '', deck: '', min: '', max: '' };
const SORTS = ['name', 'price', 'value', 'qty', 'cmc', 'set', 'recent'] as const;
const wide = () => matchMedia('(min-width: 900px)').matches;

// Collezione. Operazioni frequenti a un tocco: cercare (la stessa casella propone le stampe da aggiungere),
// cambiare quantità, filtrare per colore, selezionare. Il resto nel pannello Filtri e nel menu "⋯".
export default function Collection({ preset, go }: { preset?: Preset; go: Go }) {
  const [items, setItems] = useState<Any[]>([]), [decks, setDecks] = useState<Any[]>([]), [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState(''), [color, setColor] = useState<ColorFilter>(NO_COLOR), [sort, setSort] = usePref<Sort>('sort.collection', { key: 'name', desc: false });
  // dalla Home si arriva con un filtro già scelto (copie libere / nei mazzi)
  const [f, setF] = useState({ ...EMPTY, st: preset === 'free' || preset === 'asg' ? preset : '' }), [showF, setShowF] = useState(false);
  const [edit, setEdit] = useState<number | null>(null), [draft, setDraft] = useState<Any>({}), [pick, setPick] = useState(false);
  const [sel, setSel] = useState<Set<number> | null>(null); // null = modalità normale
  // cambio di stampa in blocco: null = chiuso, sets null = ricerca in corso
  const [prints, setPrints] = useState<{ sets: Any[] | null; err?: string } | null>(null), [busyPrint, setBusyPrint] = useState(false);
  const [toDeck, setToDeck] = useState(false), [nd, setNd] = useState({ name: '', mode: 'physical' }), [printsOf, setPrintsOf] = useState<string | null>(null);
  const { bind, preview } = useCardPreview(); // anteprima grande sopra la miniatura
  const toggle = (id: number) => setSel(cur => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const load = useCallback(() => api('/collection').then(x => { setItems(x); setLoaded(true); return x; }).catch(fail), []);
  const loadDecks = () => api('/decks').then(setDecks).catch(() => {});
  // prezzi mancanti o più vecchi di 20 ore: si aggiornano da soli una volta, poi si ricarica l'elenco
  useEffect(() => { load().then(x => { if (x?.some((i: Any) => !i.price_at || Date.now() - new Date(i.price_at).getTime() > 20 * 3600e3)) api('/prices/collection', 'POST', {}).then(load).catch(() => {}); }); loadDecks(); }, [load]);

  const active = (color.col.length && color.by === 'identity' ? 1 : 0) + (f.rar ? 1 : 0) + (f.st ? 1 : 0) + (f.deck ? 1 : 0) + (f.min || f.max ? 1 : 0);
  const qq = q.trim().toLowerCase();
  const shown = sortCards(items.filter(i => {
    if (qq && !i.name.toLowerCase().includes(qq)) return false;
    if (!matchColor(i, color)) return false;
    if (f.rar && i.rarity !== f.rar) return false;
    // quantità: copie della riga (della stampa), almeno / al massimo
    if (f.min !== '' && i.qty < Number(f.min) || f.max !== '' && i.qty > Number(f.max)) return false;
    if (f.st === 'free' && i.free <= 0 || f.st === 'asg' && i.assigned <= 0 || f.st === 'zero' && i.free > 0) return false;
    // mazzo: '' = ogni, 'none' = in nessun mazzo, 'in:ID' / 'out:ID' = nel mazzo / non nel mazzo (anche virtuale)
    const inDecks: number[] = i.in_decks ?? i.decks, [how, did] = f.deck.split(':');
    if (f.deck === 'none' && inDecks.length) return false;
    if (how === 'in' && !inDecks.includes(Number(did)) || how === 'out' && inDecks.includes(Number(did))) return false;
    return true;
  }), sort);
  const copies = shown.reduce((t, i) => t + i.qty, 0), freeN = shown.reduce((t, i) => t + Math.max(0, i.free), 0), asgN = shown.reduce((t, i) => t + i.assigned, 0), shownValue = shown.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0);

  const chg = async (i: Any, d: number) => {
    const qty = i.qty + d; if (qty <= 0 && !confirm(`Togliere ${i.name} dalla collezione?`)) return;
    try { await api('/collection/' + i.id, 'PATCH', { qty }); }
    catch (e: Any) { if (e.status === 409 && confirm('Questa copia è in un mazzo. Toglierla anche dal mazzo? Lì risulterà mancante.')) await api('/collection/' + i.id, 'PATCH', { qty, release: true }).catch(fail); else if (e.status !== 409) fail(e); }
    load();
  };
  const add = async (c: Any) => {
    try { await api('/collection', 'POST', { printing_id: c.id, qty: 1 }); toast(`+1 ${c.name} (${c.set.toUpperCase()} ${c.collector_number})`); load(); } catch (e) { fail(e); }
  };
  const open = (i: Any) => { setEdit(edit === i.id ? null : i.id); setPick(false); setDraft({ lang: i.lang, finish: i.finish, condition: i.condition, note: i.note ?? '' }); };
  const save = async (i: Any, patch: Any) => {
    try { const r = await api(`/collection/${i.id}/attrs`, 'PATCH', patch); toast(r.merged ? 'C’era già una riga identica: unite.' : 'Salvato'); setEdit(null); load(); } catch (e) { fail(e); }
  };
  const removeRows = async (ids: number[]) => {
    const rows = items.filter(i => ids.includes(i.id)), n = rows.reduce((t, i) => t + i.qty, 0);
    if (!confirm(`Rimuovere dalla collezione ${rows.length === 1 ? rows[0].name : `${rows.length} carte`} (${n} ${n === 1 ? 'copia' : 'copie'})?`)) return false;
    try { await api('/collection/bulk-delete', 'POST', { ids }); }
    catch (e: Any) {
      if (e.status !== 409) { fail(e); return false; }
      const names = e.data?.assigned ?? [];
      if (!confirm(`Queste carte sono in un mazzo: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}.\nRimuoverle anche dai mazzi? Lì risulteranno mancanti.`)) return false;
      try { await api('/collection/bulk-delete', 'POST', { ids, release: true }); } catch (e2) { fail(e2); return false; }
    }
    toast(`Rimoss${rows.length === 1 ? 'a' : 'e'} ${rows.length === 1 ? rows[0].name : `${rows.length} carte`}`); load(); return true;
  };
  // le carte selezionate vanno nel mazzo scelto (vedi deck_add_items)
  const addToDeck = async (d: Any) => {
    if (!sel?.size) return;
    try {
      const r = await api(`/decks/${d.id}/add-items`, 'POST', { item_ids: [...sel] });
      const parts = [r.added && (r.added === 1 ? '1 copia aggiunta' : `${r.added} copie aggiunte`), r.updated && `${r.updated} con la nuova stampa`, r.skipped && `${r.skipped} già presenti`].filter(Boolean);
      toast(`${d.name}: ${parts.join(', ') || 'nessuna modifica'}`);
      setToDeck(false); setSel(null); load(); loadDecks();
    } catch (e) { fail(e); }
  };
  // nuovo mazzo creato dal pannello "Al mazzo": poi le carte selezionate ci entrano come in un mazzo esistente
  const createAndAdd = async (e: React.FormEvent) => {
    e.preventDefault(); const name = nd.name.trim(); if (!name) return;
    try { const d = await api('/decks', 'POST', { name, mode: nd.mode }); setNd({ name: '', mode: nd.mode }); await addToDeck(d); } catch (err) { fail(err); }
  };
  const openPrints = async () => {
    if (!sel?.size) return; setPrints({ sets: null });
    try { setPrints({ sets: await api('/collection/common-sets', 'POST', { item_ids: [...sel] }) }); } catch (e: Any) { setPrints({ sets: [], err: e.message }); }
  };
  const applyPrint = async (x: Any) => {
    if (!confirm(`Passare ${x.changes.length === 1 ? '1 riga' : `${x.changes.length} righe`} all'edizione ${x.set_name} (${x.set.toUpperCase()})?${x.all ? '' : ` Le carte che non ci sono (${x.total - x.cards}) restano come sono.`} Lingua, finitura e condizione restano.`)) return;
    setBusyPrint(true);
    try {
      const r = await api('/collection/set-printings', 'POST', { changes: x.changes });
      toast(`${r.changed === 1 ? '1 riga passata' : `${r.changed} righe passate`} a ${x.set_name}${r.merged ? `, ${r.merged} unite` : ''}`);
      setPrints(null); setSel(null); load();
    } catch (e) { fail(e); }
    setBusyPrint(false);
  };
  const refreshPrices = async () => { try { const r = await api('/prices/collection', 'POST', { force: true }); toast(`Prezzi aggiornati (${r.updated})`); load(); } catch (e) { fail(e); } };
  const allShown = sel && shown.length > 0 && shown.every(i => sel.has(i.id));

  return <>
    <div className="toolbar">
      <div className="row">
        <div className="search"><Icon name="search" />
          <input type="search" enterKeyHint="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus={preset === 'add' || (wide() && !preset)}
            placeholder="Cerca carte" aria-label="Cerca nella collezione o aggiungi una carta" value={q} onChange={e => setQ(e.target.value)} />
          {q && <button className="clear" aria-label="Cancella la ricerca" onClick={() => setQ('')}><Icon name="close" /></button>}</div>
        <button className={'icon' + (active ? ' soft' : '')} aria-label={`Filtri${active ? ` (${active} attivi)` : ''}`} title="Filtri" onClick={() => setShowF(true)}><Icon name="filter" />{active + (color.col.length ? 1 : 0) > 0 && <span className="badge dot m-only">{active + (color.col.length ? 1 : 0)}</span>}</button>
        <button className={'icon' + (sel ? ' soft' : '')} aria-label="Seleziona più carte" title="Seleziona" aria-pressed={!!sel} disabled={!items.length} onClick={() => { setSel(sel ? null : new Set()); setEdit(null); }}><Icon name="select" /></button>
        <Menu label="Altro" items={[
          { icon: 'text', label: 'Importa una lista', sub: 'Incolla un elenco di carte (anche da Moxfield)', onClick: () => go('i') },
          { icon: 'scan', label: 'Scansiona le carte', hidden: wide(), onClick: () => go('s') },
          { icon: 'refresh', label: 'Aggiorna i prezzi', sub: 'Cardmarket, in euro', onClick: refreshPrices },
          { icon: 'download', label: 'Esporta la collezione (CSV)', onClick: () => download('/export/collection.csv') },
        ]}><Icon name="dots" /></Menu>
      </div>
      <div className="row chips">
        <ManaToggles value={color} onChange={setColor} />
        <span className="vsep d-only" />
        <span className="d-only sortwrap"><SortChip value={sort} onChange={setSort} keys={[...SORTS]} /></span>
      </div>
    </div>

    {sel && <div className="selinfo">{sel.size} {sel.size === 1 ? 'selezionata' : 'selezionate'}
      <button onClick={() => setSel(allShown ? new Set() : new Set(shown.map(i => i.id)))}>{allShown ? 'Nessuna' : 'Tutte quelle mostrate'}</button></div>}
    {loaded && items.length > 0 && <p className="m summary" style={{ margin: '6px 2px', fontSize: 14 }}><span className="g">
      {shown.length} {shown.length === 1 ? 'stampa' : 'stampe'} · {copies} {copies === 1 ? 'copia' : 'copie'}
      {f.st === 'free' ? ` (${freeN} ${freeN === 1 ? 'libera' : 'libere'})` : f.st === 'asg' ? ` (${asgN} nei mazzi)` : ''}{shownValue > 0 && ` · ${eur(shownValue)}`}
      {(active > 0 || color.col.length > 0) && <> · <button className="ghost small" style={{ padding: 0, minHeight: 0 }} onClick={() => { setF(EMPTY); setColor(NO_COLOR); }}>azzera filtri</button></>}</span>
      <span className="m-only sortlink"><Icon name="sortdown" /><SortChip value={sort} onChange={setSort} keys={[...SORTS]} /></span></p>}
    {sort.key === 'cmc' && items.length > 0 && items.every(i => i.cmc == null) && <p className="wa" style={{ margin: '4px 2px 8px' }}>Il costo di mana non è ancora disponibile: si scarica con «Aggiorna la banlist» nella pagina Mazzi.</p>}

    {shown.length > 0 && <div className="list grid2 flat">{shown.map(i => <Fragment key={i.id}>
      <div className={'item tap' + (sel?.has(i.id) ? ' selected' : '') + (edit === i.id ? ' open' : '')} onClick={() => sel ? toggle(i.id) : open(i)} aria-pressed={sel ? sel.has(i.id) : undefined}>
        {sel && <Check on={sel.has(i.id)} />}
        <img className="thumb" alt="" loading="lazy" src={i.image_small} {...bind(i.image_small)} />
        <div className="g"><div className="name">{i.name}</div>
          <div className="meta">{i.mana_cost ? <ManaCost cost={i.mana_cost} /> : <Pips ci={i.color_identity} />}<span>{i.set_code.toUpperCase()} {i.collector_number}</span>
            {i.finish !== 'nonfoil' && <span className="wa">{FIN_IT[i.finish]}</span>}{i.lang !== 'en' && <span>{i.lang}</span>}</div>
          <div className="meta">{i.assigned > 0 ? <span>{i.free} {i.free === 1 ? 'libera' : 'libere'} · {i.assigned} nei mazzi</span> : <span>tutte libere</span>}
            {i.price != null && <span className="price d-only">{eur(i.price)}{i.qty > 1 && <span className="m" style={{ fontWeight: 400 }}> · {eur(i.price * i.qty)}</span>}</span>}</div></div>
        <div className="side-r">{i.price != null && <span className="price m-only">{eur(i.price)}</span>}
          {sel ? <span className="num" style={{ fontSize: 22 }}>×{i.qty}</span> : <Stepper value={i.qty} onMinus={() => chg(i, -1)} onPlus={() => chg(i, 1)} label={'Copie di ' + i.name} />}</div></div>
      {edit === i.id && !sel && <div className="itemx">
        <div className="filters" style={{ marginTop: 6 }}>
          <label className="field">Finitura<select value={draft.finish} onChange={e => setDraft({ ...draft, finish: e.target.value })}>{FIN.map(x => <option key={x} value={x}>{FIN_IT[x]}</option>)}</select></label>
          <label className="field">Condizione<select value={draft.condition} onChange={e => setDraft({ ...draft, condition: e.target.value })}>{COND.map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="field">Lingua<input value={draft.lang} onChange={e => setDraft({ ...draft, lang: e.target.value })} placeholder="en, it…" /></label>
          <label className="field">Nota<input value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></label></div>
        <div className="bar" style={{ marginBottom: 0 }}><button className="b" onClick={() => save(i, draft)}>Salva</button><button onClick={() => setPick(!pick)}><Icon name="edit" />Cambia stampa</button>
          <button className="icon d" aria-label={'Rimuovi ' + i.name} onClick={async () => { if (await removeRows([i.id])) setEdit(null); }}><Icon name="trash" /></button>
          <button className="ghost" style={{ marginLeft: 'auto' }} onClick={() => setEdit(null)}>Chiudi</button></div>
        {pick && <Search mode="prints" query={`!"${i.name}"`} action="Usa" onPick={c => save(i, { printing_id: c.id })} />}</div>}
    </Fragment>)}</div>}

    {q.trim().length >= 2 && !sel && <ScryResults q={q} mode="cards" title="Aggiungi alla collezione" expanded={printsOf}
      below={c => <PrintPicker any={false} oracleId={c.oracle_id ?? c.card_faces?.[0]?.oracle_id} name={c.name} onPick={p => p && add(p)} onCancel={() => setPrintsOf(null)} />}
      actions={c => <><button className={'small' + (printsOf === c.id ? ' soft' : '')} onClick={() => setPrintsOf(printsOf === c.id ? null : c.id)}>Stampe</button>
        <button className="b icon" aria-label={`Aggiungi ${c.name} (${c.set.toUpperCase()} ${c.collector_number})`} onClick={() => add(c)}><Icon name="plus" /></button></>} />}
    {loaded && !items.length && !q && <div className="card empty"><b>La collezione è vuota</b><p className="m">Scrivi il nome di una carta nella casella in alto e toccala per aggiungerla, oppure:</p>
      <div className="bar"><button onClick={() => go('i')}><Icon name="text" />Importa una lista</button>{!wide() && <button onClick={() => go('s')}><Icon name="scan" />Scansiona</button>}</div></div>}
    {loaded && items.length > 0 && !shown.length && !q && <p className="m" style={{ textAlign: 'center' }}>Nessuna carta con questi filtri.</p>}
    {preview}

    {sel && <SelBar actions={[
      { icon: 'close', label: 'Fine', onClick: () => setSel(null) },
      { icon: 'decks', label: 'Al mazzo', tone: 'b', disabled: !sel.size, onClick: () => setToDeck(true) },
      { icon: 'edit', label: 'Stampa', disabled: !sel.size, onClick: openPrints },
      { icon: 'trash', label: 'Rimuovi', tone: 'danger', disabled: !sel.size, onClick: async () => { if (await removeRows([...sel])) setSel(null); } },
    ]} />}

    {showF && <Sheet title="Filtri e ordinamento" onClose={() => setShowF(false)} actions={<><button onClick={() => { setF(EMPTY); setColor(NO_COLOR); }}>Azzera</button><button className="b" onClick={() => setShowF(false)}>Mostra {shown.length}</button></>}>
      <div className="filters" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}>Colori<ManaToggles value={color} onChange={setColor} /></div>
        <label className="field">Il colore è<select value={color.by} onChange={e => setColor({ ...color, by: e.target.value as ColorFilter['by'] })}><option value="colors">quello della carta</option><option value="identity">l’identità di colore</option></select></label>
        <label className="field">Con più colori<select value={color.all ? 'all' : 'any'} onChange={e => setColor({ ...color, all: e.target.value === 'all' })}><option value="any">almeno uno</option><option value="all">tutti</option></select></label>
        <label className="field">Rarità<select value={f.rar} onChange={e => setF({ ...f, rar: e.target.value })}><option value="">Tutte</option>{Object.entries(RAR_IT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Copie<select value={f.st} onChange={e => setF({ ...f, st: e.target.value })}><option value="">Tutte</option><option value="free">Con copie libere</option><option value="asg">In un mazzo fisico</option><option value="zero">Senza copie libere</option></select></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}>Mazzo<select value={f.deck} onChange={e => setF({ ...f, deck: e.target.value })}><option value="">Con o senza mazzo</option><option value="none">In nessun mazzo</option>
          {decks.length > 0 && <optgroup label="Nel mazzo">{decks.map(d => <option key={d.id} value={'in:' + d.id}>Nel mazzo {d.name}</option>)}</optgroup>}
          {decks.length > 0 && <optgroup label="Non nel mazzo">{decks.map(d => <option key={d.id} value={'out:' + d.id}>Non nel mazzo {d.name}</option>)}</optgroup>}</select></label>
        <label className="field">Copie per stampa: almeno<input type="number" inputMode="numeric" min={1} value={f.min} onChange={e => setF({ ...f, min: e.target.value })} /></label>
        <label className="field">al massimo<input type="number" inputMode="numeric" min={1} value={f.max} onChange={e => setF({ ...f, max: e.target.value })} /></label>
        <div className="field" style={{ gridColumn: '1 / -1' }}>Ordina per<div className="chips" style={{ margin: 0, padding: 0 }}><SortChip value={sort} onChange={setSort} keys={[...SORTS]} /></div></div>
      </div>
    </Sheet>}

    {prints && <Sheet title={`Cambia stampa (${sel?.size ?? 0} ${sel?.size === 1 ? 'carta' : 'carte'})`} onClose={() => setPrints(null)} actions={<button onClick={() => setPrints(null)}>Annulla</button>}>
      {!prints.sets ? <p className="m">Cerco le edizioni su Scryfall…</p> : prints.err ? <p className="er">{prints.err}</p> : !prints.sets.length
        ? <p className="m" style={{ marginTop: 0 }}>Nessuna edizione contiene almeno due delle carte selezionate.</p>
        : <><p className="m" style={{ marginTop: 0 }}>Lingua, finitura e condizione restano; le righe che diventano uguali vengono unite.</p>
          {([['Contengono tutte le carte', prints.sets.filter(x => x.all)], ['Solo alcune carte: le altre restano come sono', prints.sets.filter(x => !x.all)]] as const).map(([title, list]) => list.length > 0 && <div className="list" key={title}>
            <div className="listhead">{title}</div>
            {list.map((x: Any) => <button key={x.set} className="item" disabled={busyPrint || x.current} onClick={() => applyPrint(x)}>
              <div className="g"><div className="name">{x.set_name}</div><div className="meta"><span>{x.set.toUpperCase()}</span><span>{x.released_at?.slice(0, 4)}</span>
                {!x.all && <span className="wa">{x.cards} di {x.total} carte</span>}{x.current && <span className="ok">stampa attuale</span>}</div></div>
              <Icon name="next" /></button>)}</div>)}
          {!prints.sets.some(x => x.all) && <p className="m" style={{ fontSize: 14 }}>Nessuna edizione contiene tutte le carte selezionate (succede spesso con le terre base, stampate in un'altra edizione).</p>}</>}
    </Sheet>}

    {toDeck && sel && <Sheet title={`Aggiungi ${sel.size === 1 ? '1 carta' : `${sel.size} carte`} a un mazzo`} onClose={() => setToDeck(false)} actions={<button onClick={() => setToDeck(false)}>Annulla</button>}>
      {decks.some(d => !d.archived) && <div className="list">{decks.filter(d => !d.archived).map(d => <button key={d.id} className="item" onClick={() => addToDeck(d)}>
        <div className="g"><div className="name">{d.name}</div><div className="meta"><Pips ci={d.ci} /><span>{d.mode === 'physical' ? 'fisico' : 'virtuale'}</span><span>{d.cards}/100</span>{d.commanders && <span>{d.commanders}</span>}</div></div>
        <Icon name="next" /></button>)}</div>}
      <form className="card" onSubmit={createAndAdd}><b>Oppure in un nuovo mazzo</b>
        <div className="seg" role="radiogroup" aria-label="Tipo di mazzo" style={{ marginTop: 8 }}>{([['physical', 'Fisico'], ['virtual', 'Virtuale']] as const).map(([k, l]) =>
          <button type="button" key={k} role="radio" aria-checked={nd.mode === k} className={nd.mode === k ? 'on' : ''} onClick={() => setNd({ ...nd, mode: k })}>{l}</button>)}</div>
        <div className="bar" style={{ margin: 0, flexWrap: 'nowrap' }}><input placeholder="Nome del mazzo" aria-label="Nome del nuovo mazzo" maxLength={120} value={nd.name} onChange={e => setNd({ ...nd, name: e.target.value })} />
          <button className="b" type="submit" disabled={!nd.name.trim()}><Icon name="plus" />Crea</button></div></form>
      <p className="m" style={{ fontSize: 14 }}>Ogni carta entra con la stampa selezionata: una copia, oppure tutte le copie selezionate per le terre base. Nei mazzi fisici le copie selezionate vengono riservate al mazzo.</p>
    </Sheet>}</>;
}
