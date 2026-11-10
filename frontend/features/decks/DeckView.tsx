import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCardPreview } from '../../components/CardPreview';
import { eur, stalePrices } from '../../components/Price';
import { api, apiText, download, fail } from '../../services/api';
import { copyText } from '../../services/clipboard';
import { usePref } from '../../services/prefs';
import Icon from '../../components/Icon';
import Stepper from '../../components/Stepper';
import SelBar from '../../components/SelBar';
import ScryResults from '../../components/ScryResults';
import { toast } from '../../components/Toast';
import { Spine, Pips } from '../../components/Mana';
import { ManaCost, ManaToggles, NO_COLOR, SortChip, matchColor, sortCards, type ColorFilter, type Sort } from '../../components/CardTools';
import DeckText from './DeckText';
import Suggestions from './Suggestions';
import Check from '../../components/Check';
import Menu from '../../components/Menu';
import type { Go } from '../../pages/tabs';
import { useWide } from '../../components/useWide';
import CardDetail from '../card/CardDetail';
import { refreshDeckOnce, usePricesUpdated } from '../../services/autoRefresh';
import { Card3D, big, glow } from '../../components/CardArt';
type Any = any;
// gruppi per tipo, come nei deckbuilder (una creatura artefatto sta tra le creature)
const GROUPS: [string, RegExp][] = [['Creature', /Creature/], ['Planeswalker', /Planeswalker/], ['Battaglie', /Battle/], ['Terre', /Land/],
  ['Istantanei', /Instant/], ['Stregonerie', /Sorcery/], ['Artefatti', /Artifact/], ['Incantesimi', /Enchantment/]];
const groupOf = (c: Any) => GROUPS.find(([, re]) => re.test(c.type_line ?? ''))?.[0] ?? 'Altro';
const canCommand = (c: Any) => (/Legendary/.test(c.type_line ?? '') && /Creature/.test(c.type_line ?? '')) || /can be your commander/i.test(c.oracle_text ?? c.card_faces?.[0]?.oracle_text ?? '');

// Pagina del mazzo: la ricerca filtra le carte del mazzo e propone quelle da aggiungere (anche come comandante);
// quantità a un tocco; azioni principali in vista, le altre nel menu "⋯".
export default function DeckView({ id, back, go }: { id: number; back: () => void; go: Go }) {
  const [d, setD] = useState<Any>(), [v, setV] = useState<Any>(), [text, setText] = useState(false);
  const [sort, setSort] = usePref<Sort>('sort.deck', { key: 'name', desc: false }), [color, setColor] = useState<ColorFilter>(NO_COLOR), [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string> | null>(null); // chiavi oracle_id|comandante; null = modalità normale
  // telefono: toccare una carta apre la sua scheda con le opzioni del mazzo
  const isWide = useWide(), [det, setDet] = useState<string | null>(null);
  // telefono: la freccia per tornare ai mazzi prende il posto del titolo nell'intestazione
  const [lead, setLead] = useState<HTMLElement | null>(null);
  useEffect(() => { setLead(document.getElementById('top-lead')); }, []);
  const keyOf = (c: Any) => c.oracle_id + '|' + (c.is_commander ? 1 : 0);
  const toggle = (k: string) => setSel(cur => { const n = new Set(cur); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const load = useCallback(async () => { try { const [a, b] = await Promise.all([api('/decks/' + id), api(`/decks/${id}/validation`)]); setD(a); setV(b); return a; } catch (e) { fail(e); } }, [id]);
  // prezzi delle carte del mazzo: si aggiornano da soli se mancano o hanno più di 20 ore, poi si ricalcola il valore
  // prezzi delle carte del mazzo: si aggiornano da soli la prima volta che il mazzo si apre (per ogni apertura del sito)
  const [pricing, setPricing] = useState(false);
  useEffect(() => { load().then(a => { if (a?.cards.length) { setPricing(!a.value?.oldest); refreshDeckOnce(id).then(ch => { setPricing(false); if (ch) load(); }); } }); }, [load, id]);
  usePricesUpdated(load);
  const act = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { fail(e); } load(); };
  const add = (c: Any, cmd = false) => act(async () => {
    const k = await api('/catalog/printings', 'POST', { id: c.id });
    await api(`/decks/${id}/cards`, 'POST', { oracle_id: k.oracle_id, delta: 1, is_commander: cmd, printing_id: c.id }); toast(cmd ? `${c.name} è il comandante` : `+1 ${c.name}`);
  });
  const dc = (c: Any, delta: number) => act(() => api(`/decks/${id}/cards`, 'POST', { oracle_id: c.oracle_id, delta, is_commander: c.is_commander }));
  const convert = () => act(async () => {
    const r = await api(`/decks/${id}/convert`, 'POST', {});
    if (r.converted) return toast('Ora è un mazzo fisico');
    if (!confirm('Mancano copie:\n' + r.missing.slice(0, 10).map((m: Any) => `${m.name} (${m.missing})`).join('\n') + '\n\nAssegno solo quelle che hai libere. Procedere?')) return;
    await api(`/decks/${id}/convert`, 'POST', { confirm: true }); toast('Ora è un mazzo fisico');
  });
  const toWish = () => act(async () => { const r = await api(`/wishlist/from-deck/${id}`, 'POST'); toast(r.cards ? `${r.cards} carte nella lista dei desideri` : 'Non manca niente da comprare'); });
  const collect = (c?: Any) => act(async () => {
    const r = await api(`/decks/${id}/collect`, 'POST', c ? { oracle_id: c.oracle_id } : {});
    toast(r.added ? `${r.added === 1 ? '1 copia aggiunta' : `${r.added} copie aggiunte`} alla collezione e al mazzo` : 'Non manca niente');
  });
  const copy = async (format: string) => { try { await copyText(apiText(`/decks/${id}/export?format=${format}`)); toast('Lista copiata'); } catch (e) { fail(e); } };
  const removeSelected = () => {
    if (!sel?.size) return;
    const rows = d.cards.filter((c: Any) => sel.has(keyOf(c)));
    if (!confirm(`Togliere dal mazzo ${rows.length === 1 ? rows[0].name : `${rows.length} carte`}?${d.mode === 'physical' ? ' Le copie tornano libere in collezione.' : ''}`)) return;
    act(async () => { await api(`/decks/${id}/cards/bulk-remove`, 'POST', { items: rows.map((c: Any) => ({ oracle_id: c.oracle_id, is_commander: c.is_commander })) }); setSel(null); toast(`${rows.length} ${rows.length === 1 ? 'carta tolta' : 'carte tolte'}`); });
  };
  const rename = () => { const n = prompt('Nuovo nome del mazzo', d?.name)?.trim(); if (n && n !== d?.name) act(() => api('/decks/' + id, 'PATCH', { name: n })); };
  // chiude la scheda: sul telefono è una voce della cronologia, sul computer è il pannello (torna al comandante)
  const closeDet = () => { if (matchMedia('(min-width: 900px)').matches) setDet(null); else history.back(); };
  const wishOne = (c: Any) => act(async () => { await api('/wishlist', 'POST', { printing_id: c.printing_id, any: true, qty: 1 }); toast(`${c.name} nella lista dei desideri`); });
  const removeOne = (c: Any) => { if (!confirm(`Togliere ${c.name} dal mazzo?${d?.mode === 'physical' ? ' Le copie tornano libere in collezione.' : ''}`)) return;
    act(async () => { await api(`/decks/${id}/cards/bulk-remove`, 'POST', { items: [{ oracle_id: c.oracle_id, is_commander: c.is_commander }] }); toast(`${c.name} tolta dal mazzo`); closeDet(); }); };
  const makeCmd = (c: Any) => act(async () => {
    await api(`/decks/${id}/cards/bulk-remove`, 'POST', { items: [{ oracle_id: c.oracle_id, is_commander: false }] });
    await api(`/decks/${id}/cards`, 'POST', { oracle_id: c.oracle_id, delta: 1, is_commander: true, printing_id: c.printing_id }); toast(`${c.name} è il comandante`); closeDet();
  });
  const { bind, preview } = useCardPreview(); // anteprima grande sopra la miniatura
  if (!d || !v) return <p className="m">Caricamento…</p>;

  const qq = q.trim().toLowerCase();
  const cmds = d.cards.filter((c: Any) => c.is_commander), main = d.cards.filter((c: Any) => !c.is_commander);
  const shown = sortCards(main.filter((c: Any) => matchColor(c, color) && (!qq || c.name.toLowerCase().includes(qq))), sort);
  const groups = GROUPS.map(([g]) => g).concat('Altro').map(g => [g, shown.filter((c: Any) => groupOf(c) === g)] as const).filter(([, l]) => l.length);
  const mainCount = main.reduce((t: number, c: Any) => t + c.need, 0), shownCount = shown.reduce((t: number, c: Any) => t + c.need, 0);
  const ci = [...new Set(cmds.flatMap((c: Any) => c.color_identity ?? []))] as string[];
  const dupes = new Set(cmds.map((c: Any) => c.oracle_id).filter((o: string) => main.some((m: Any) => m.oracle_id === o)));
  const status = v.status === 'valido' && v.stale ? 'valido, banlist da aggiornare' : v.status;
  const cls = v.status === 'valido' ? (v.stale ? 'wa' : 'ok') : v.status === 'non valido' ? 'er' : 'm';
  const problems = v.issues.filter((i: Any) => !i.incomplete);
  const physical = d.mode === 'physical' && !d.archived;
  const allKeys = [...cmds, ...shown].map(keyOf), allSel = sel && allKeys.length > 0 && allKeys.every(k => sel.has(k));

  // scheda della carta con le opzioni del mazzo: pannello a sinistra sul computer, finestra a tutto schermo sul telefono
  const detailOf = (k: string, inline: boolean) => { const c = d.cards.find((x: Any) => keyOf(x) === k); if (!c) return null; const miss = physical ? c.need - c.got : 0;
    return <CardDetail key={k} inline={inline} printingId={c.printing_id} name={c.name} ctx="deck" onClose={() => setDet(null)} onChanged={load}
      panel={<section className="panel">
        <div className="ph"><b>Nel mazzo {d.name}</b><small>{c.is_commander ? 'Comandante' : groupOf(c)}</small></div>
        {!c.is_commander && <div className="qtyrow" style={{ margin: '6px 0' }}><div className="g"><b>Copie nel mazzo</b><small className="m" style={{ display: 'block' }}>{physical ? `${c.got} riservate dalla tua collezione` : 'mazzo virtuale: non riserva copie'}</small></div>
          <Stepper value={c.need} onMinus={() => c.need > 1 ? dc(c, -1) : removeOne(c)} onPlus={() => dc(c, 1)} label={'Copie di ' + c.name} /></div>}
        {c.prints?.length > 0 && <p className="m" style={{ margin: '4px 0', fontSize: 14 }}>Stampe nel mazzo: {c.prints.map((x: Any) => `${x.set_code.toUpperCase()} #${x.collector_number} ×${x.qty}`).join(' · ')}</p>}
        {miss > 0 && <p className="wa" style={{ margin: '4px 0' }}>{miss === 1 ? 'Manca 1 copia' : `Mancano ${miss} copie`}: non ne hai libere in collezione.</p>}
        {!c.is_commander && dupes.has(c.oracle_id) && <p className="er" style={{ margin: '4px 0' }}>È già il comandante del mazzo.</p>}
        <div className="pillrow">
          {miss > 0 && <button className="pchip" onClick={() => collect(c)}><Icon name="plus" size={16} />Ce l’ho: aggiungila alla collezione</button>}
          {!c.is_commander && canCommand(c) && cmds.length < 2 && <button className="pchip" onClick={() => makeCmd(c)}><Icon name="user" size={16} />Rendi comandante</button>}</div>
      </section>}
      bar={<><button className="icon sq" aria-label="Aggiungi ai desideri" onClick={() => wishOne(c)}><Icon name="heart" /></button>
        <button className="danger wide" onClick={() => removeOne(c)}><Icon name="trash" />Togli dal mazzo</button></>} />; };
  // sul computer, senza una carta scelta, si vede il comandante
  const sideKey = det && d.cards.some((x: Any) => keyOf(x) === det) ? det : cmds[0] ? keyOf(cmds[0]) : main[0] ? keyOf(main[0]) : null;
  const Card = (c: Any) => <div className={'item' + ' tap' + (sel?.has(keyOf(c)) ? ' selected' : '')} key={keyOf(c)}
    onClick={sel ? () => toggle(keyOf(c)) : e => { if (!(e.target as HTMLElement).closest('button')) setDet(keyOf(c)); }}>
    {sel && <Check on={sel.has(keyOf(c))} />}
    <img className="thumb" alt="" loading="lazy" src={c.image} {...bind(c.image)} />
    <div className="g"><div className="name">{c.name}</div>
      <div className="meta">{c.mana_cost ? <ManaCost cost={c.mana_cost} /> : <Pips ci={c.color_identity} />}
        {c.prints?.length > 1 ? <span>{c.prints.map((x: Any) => `${x.set_code.toUpperCase()} ${x.collector_number} ×${x.qty}`).join(' · ')}</span>
          : c.set_code && <span>{c.set_code.toUpperCase()} {c.collector_number}</span>}
        {(c.price_eur ?? c.price_eur_foil) != null && <span className="price">{eur(c.price_eur ?? c.price_eur_foil)}</span>}
        {physical && c.got < c.need && <span className="wa">{c.need - c.got === 1 ? 'manca' : `mancano ${c.need - c.got}`}</span>}
        {!c.is_commander && dupes.has(c.oracle_id) && <span className="er">è già il comandante</span>}</div>
      {!sel && physical && c.got < c.need && <button className="inline-act" onClick={() => collect(c)}><Icon name="plus" size={16} />Ce l’ho: aggiungi alla collezione</button>}</div>
    {sel ? (c.need > 1 && <span className="num" style={{ fontSize: 22 }}>×{c.need}</span>) : c.is_commander
      ? <button className="icon d" aria-label={'Togli ' + c.name + ' come comandante'} onClick={() => confirm(`Togliere ${c.name} come comandante?`) && dc(c, -1)}><Icon name="trash" /></button>
      : <Stepper value={c.need} onMinus={() => dc(c, -1)} onPlus={() => dc(c, 1)} label={'Copie di ' + c.name} />}</div>;

  return <><div className="split deckgrid">
    {isWide && sideKey && <aside className="dside">{detailOf(sideKey, true)}</aside>}
    <div>
    <button className="ghost backlink d-only" onClick={back}><Icon name="back" />Mazzi</button>
    {!isWide && lead && createPortal(<button className="icon sq" aria-label="Torna ai mazzi" onClick={back}><Icon name="back" /></button>, lead)}
    {/* telefono: comandante in 3D con l'aura e sfondo sfumato nei suoi colori */}
    <div className="deckbg" style={{ '--glow': glow(ci) } as React.CSSProperties} />
    {/* illustrazione del comandante (o dei due comandanti) in cima allo sfondo, sfumata verso il basso */}
    {cmds.length > 0 && <div className="deckart" aria-hidden="true">{cmds.map((c: Any) => <i key={c.oracle_id} style={{ backgroundImage: `url("${big(c.image, 'art_crop')}")` }} />)}</div>}
    <section className="dhero" style={{ '--glow': glow(ci) } as React.CSSProperties}>
      <div className={'dcmd n' + cmds.length}><span className="aura" />
        {cmds.length ? cmds.map((c: Any) => <Card3D key={c.oracle_id} src={big(c.image, 'normal')} onClick={() => setDet(keyOf(c))} />)
          : <div className="empty-cmd">Nessun comandante: cercalo qui sotto e tocca “Comandante”</div>}</div>
      <h2>{d.name}</h2>
      <small>{cmds.map((c: Any) => c.name).join(' + ') || 'Senza comandante'}</small>
      <div className="pills"><span className={'pill ' + (cls === 'ok' ? 'ok' : cls === 'er' ? 'er' : cls === 'wa' ? 'wa' : 'm')}>{status}</span><span className="pill m">{d.mode === 'physical' ? 'fisico' : 'virtuale'}{d.archived ? ', archiviato' : ''}</span>
        {physical && <span className={'pill ' + (d.missing ? 'wa' : 'ok')}>{d.missing ? (d.missing === 1 ? 'manca 1 copia' : `mancano ${d.missing} copie`) : 'assemblabile'}</span>}
        {problems.length > 0 && <span className="pill er">{problems.length === 1 ? '1 problema' : `${problems.length} problemi`} di regole</span>}</div>
      <div className="dcount"><b>{v.count}</b>/ 100{d.value && <span>· {pricing && !d.value.oldest ? '…' : eur(d.value.eur)}</span>}</div>
      <div className="progress"><span style={{ width: Math.min(100, v.count) + '%' }} /></div>
    </section>
    <div className="actions">
      <button className="soft" title="Copia la lista negli appunti" onClick={() => copy('plain')}><Icon name="copy" />Copia</button>
      <button className={text ? 'soft' : ''} title="Modifica come testo" onClick={() => setText(t => !t)}><Icon name="text" />Testo</button>
      <Menu label="Carte mancanti" className="" items={[
        { icon: 'plus', label: `Le ho: aggiungile alla collezione${d.toCollect ? ` (${d.toCollect})` : ''}`, sub: 'Le copie vengono anche assegnate al mazzo', hidden: !(physical && d.toCollect > 0), onClick: () => { if (confirm(`Aggiungere ${d.toCollect} copie alla collezione?`)) collect(); } },
        { icon: 'heart', label: 'Mettile nella lista dei desideri', onClick: toWish },
        { icon: 'download', label: 'Esporta solo le mancanti', onClick: () => download(`/decks/${id}/export?format=plain&missing=1`) },
      ]}><Icon name="cart" />Mancanti{physical && d.missing ? <span className="badge">{d.missing}</span> : null}</Menu>
      <button onClick={() => setSel(sel ? null : new Set())} className={sel ? 'soft' : ''}><Icon name="select" />Seleziona</button>
      <Menu label="Altre azioni sul mazzo" className="" items={[
        { icon: 'download', label: 'Esporta in testo semplice', sub: '“1 Sol Ring”, come Moxfield', onClick: () => download(`/decks/${id}/export?format=plain`) },
        { icon: 'download', label: 'Esporta con le edizioni', sub: '“1 Sol Ring (CMM) 410”', onClick: () => download(`/decks/${id}/export?format=moxfield`) },
        'sep',
        { icon: 'edit', label: 'Rinomina', onClick: rename },
        { icon: 'check', label: 'Converti in fisico', sub: 'Riserva le copie che hai libere', hidden: d.mode !== 'virtual', onClick: convert },
        { icon: 'archive', label: d.archived ? 'Riattiva il mazzo' : 'Archivia', sub: d.archived ? 'Riassegna le copie libere' : 'Libera tutte le copie del mazzo', onClick: () => act(() => api(`/decks/${id}/archive`, 'POST', { archived: !d.archived })) },
        'sep',
        { icon: 'trash', label: 'Elimina mazzo', tone: 'danger', onClick: async () => { if (confirm(`Eliminare “${d.name}”? Le copie tornano libere. Non si può annullare.`)) { await api('/decks/' + id, 'DELETE').catch(fail); back(); } } },
      ]}><Icon name="dots" />Altro</Menu>
    </div>

    {text && <DeckText deck={d} cancel={() => setText(false)} done={m => { setText(false); toast(m); load(); }} />}

    <div className="toolbar inset">
      <div className="row"><div className="search"><Icon name="search" />
        <input type="search" enterKeyHint="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={cmds.length ? 'Cerca nel mazzo o aggiungi una carta' : 'Cerca il comandante o una carta'}
          aria-label="Cerca nel mazzo o aggiungi una carta" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button className="clear" aria-label="Cancella la ricerca" onClick={() => setQ('')}><Icon name="close" /></button>}</div></div>
      {main.length > 0 && <div className="row chips"><ManaToggles value={color} onChange={setColor} /><span className="vsep" /><SortChip value={sort} onChange={setSort} keys={['name', 'cmc', 'price', 'qty']} /></div>}
    </div>
    {sel && <div className="selinfo">{sel.size} {sel.size === 1 ? 'selezionata' : 'selezionate'}<button onClick={() => setSel(allSel ? new Set() : new Set(allKeys))}>{allSel ? 'Nessuna' : 'Tutte'}</button></div>}

    {q.trim().length >= 2 && !sel && <ScryResults q={q} mode="cards" title="Aggiungi al mazzo" actions={c => <>
      {canCommand(c) && cmds.length < 2 && <button className="soft small" onClick={() => add(c, true)}>Comandante</button>}
      <button className="b icon" aria-label={'Aggiungi ' + c.name} onClick={() => add(c)}><Icon name="plus" /></button></>}
      bar={(c, close) => <>{canCommand(c) && cmds.length < 2 && <button className="wide" onClick={() => { add(c, true); close(); }}><Icon name="user" />Comandante</button>}
        <button className="b" onClick={() => { add(c); close(); }}><Icon name="plus" />Aggiungi al mazzo</button></>} />}

    {(cmds.length > 0 || !qq) && <div className="list">
      <div className="listhead">Comandante{cmds.length === 2 ? 'i' : ''}</div>
      {cmds.map(Card)}
      {!cmds.length && <div className="item"><span className="m">Nessun comandante: cercalo nella casella qui sopra e tocca “Comandante”.</span></div>}
      {cmds.length === 1 && !sel && <div className="item" style={{ minHeight: 44 }}><span className="m" style={{ fontSize: 14 }}>Per un secondo comandante (partner, background) cercalo qui sopra.</span></div>}
    </div>}
    {sort.key === 'cmc' && main.length > 0 && main.every((c: Any) => c.cmc == null) && <p className="wa" style={{ margin: '4px 0 8px' }}>Il costo di mana di queste carte non è ancora disponibile: si scarica da solo insieme alla banlist, alla prossima apertura del sito.</p>}
    {groups.length > 0 ? <div className="list">{groups.map(([g, l]) => [
      <div className="listhead" key={'h' + g}>{g}<span className="n">{l.reduce((t: number, c: Any) => t + c.need, 0)}</span></div>, ...l.map(Card)])}</div>
      : <p className="m" style={{ textAlign: 'center' }}>{main.length ? (qq ? `Nel mazzo non c’è “${q.trim()}”.` : 'Nessuna carta di questi colori.') : 'Ancora nessuna carta: cercale nella casella qui sopra, oppure incolla una lista con “Modifica come testo”.'}</p>}
    {(qq || color.col.length > 0) && main.length > 0 && <p className="m" style={{ fontSize: 14 }}>{shownCount} di {mainCount} carte mostrate.</p>}
    {!qq && !sel && <Suggestions commanders={cmds.map((c: Any) => c.name)} inDeck={new Set(d.cards.map((c: Any) => c.name.split(' // ')[0].toLowerCase()))} add={add} openDeck={id => go('d', `deck:${id}`)} />}
  </div>

  <div className="side">
    <div className={'card ' + (problems.length ? 'er' : v.stale ? 'wa' : v.issues.length ? '' : 'ok')}><b>Regole Commander</b>
      {v.stale && <p className="wa" style={{ margin: '6px 0' }}>La banlist ha più di 7 giorni: la legalità non è certa. Si aggiorna da sola alla prossima apertura del sito.</p>}
      {v.issues.length ? <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>{v.issues.map((i: Any, k: number) => <li key={k} className={i.incomplete ? 'm' : 'er'} style={{ margin: '4px 0' }}>{i.text}</li>)}</ul>
        : <p className="ok" style={{ margin: '6px 0 0' }}>Nessun problema regolamentare.</p>}</div>
  </div></div>

  {preview}
  {!isWide && det && detailOf(det, false)}
  {sel && <SelBar actions={[
    { icon: 'close', label: 'Fine', onClick: () => setSel(null) },
    { icon: 'trash', label: 'Togli dal mazzo', tone: 'danger', disabled: !sel.size, onClick: removeSelected },
  ]} />}</>;
}
