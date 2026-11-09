import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, fail } from '../../services/api';
import { sfGet, printsOfCards } from '../../services/scryfall';
import Icon from '../../components/Icon';
import Menu from '../../components/Menu';
import Sheet from '../../components/Sheet';
import { toast } from '../../components/Toast';
import { eur } from '../../components/Price';
import { Card3D, ColorTags, COLOR_IT, ManaText, SplitName, big, glow, imgOf, sortCi } from '../../components/CardArt';
import EditSheet from '../collection/EditSheet';
type Any = any;
const FIN_IT: Record<string, string> = { nonfoil: 'Normale', foil: 'Foil', etched: 'Etched' };
const LANG_IT: Record<string, string> = { en: 'Inglese', it: 'Italiano', ja: 'Giapponese', de: 'Tedesco', fr: 'Francese', es: 'Spagnolo', pt: 'Portoghese', ru: 'Russo', ko: 'Coreano', zhs: 'Cinese', zht: 'Cinese trad.' };
const RAR_IT: Record<string, string> = { common: 'Comune', uncommon: 'Non comune', rare: 'Rara', mythic: 'Mitica', special: 'Speciale', bonus: 'Bonus' };
const LEG_IT: Record<string, string> = { legal: 'Legale', not_legal: 'Non legale', banned: 'Bandita', restricted: 'Limitata' };
const priceOf = (c: Any, finish = 'nonfoil') => { const p = c?.prices ?? {}; const x = finish === 'nonfoil' ? p.eur ?? p.eur_foil : p.eur_foil ?? p.eur; return x == null ? null : Number(x); };
export const langIt = (l: string) => LANG_IT[l] ?? l.toUpperCase();

// id Scryfall dall'indirizzo dell'immagine (…/small/front/a/b/<id>.jpg), per le righe che non hanno la stampa (es. desideri "qualsiasi stampa")
export const idFromImage = (src?: string | null) => src?.match(/\/([0-9a-f-]{36})\.(?:jpg|png)/)?.[1];
export type CardCtx = 'collection' | 'deck' | 'wish' | 'search';

// Scheda della carta (telefono), la stessa in ogni sezione: carta grande in 3D, le tue copie, poi Carta / Stampe / Nei mazzi.
// ctx = sezione da cui si apre: le opzioni proprie della sezione arrivano da panel (riquadro sotto il prezzo) e bar (pulsanti in basso);
// in Collezione le copie si modificano, altrove si vedono soltanto.
// inline = pannello dentro la pagina (computer: a sinistra di mazzo e collezione), senza voce nella cronologia e senza freccia indietro
export default function CardDetail({ item: it, card: given, printingId, name: nm, ctx = 'collection', panel, bar, inline, onClose, onChanged }: {
  item?: Any; card?: Any; printingId?: string; name?: string; ctx?: CardCtx; panel?: ReactNode; bar?: ReactNode; inline?: boolean; onClose: () => void; onChanged?: () => void }) {
  const item = { name: nm ?? it?.name ?? given?.name ?? '', printing_id: printingId ?? it?.printing_id ?? given?.id, image_small: it?.image_small ?? imgOf(given, 'small'), color_identity: it?.color_identity ?? given?.color_identity, id: it?.id ?? 0 };
  const editable = ctx === 'collection';
  const [card, setCard] = useState<Any | null>(null), [shown, setShown] = useState<Any | null>(null), [err, setErr] = useState('');
  const [items, setItems] = useState<Any[]>([]), [decks, setDecks] = useState<Any[]>([]), [prints, setPrints] = useState<Any[] | null>(null);
  const [tab, setTab] = useState<'c' | 's' | 'd'>('c'), [edit, setEdit] = useState<Any | null>(null), [toDeck, setToDeck] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = () => Promise.all([api('/collection').then(setItems), api('/decks').then(setDecks)]).catch(() => {});
  useEffect(() => { load(); if (given?.oracle_id) { setCard(given); setShown(given); return; }
    (item.printing_id ? sfGet('/cards/' + item.printing_id) : sfGet('/cards/named?exact=' + encodeURIComponent(item.name))).then(c => { if (!c) throw new Error('Carta non trovata su Scryfall'); setCard(c); setShown(c); }).catch(e => setErr(e.message)); }, [item.printing_id]); // eslint-disable-line
  useEffect(() => { if (tab === 's' && !prints && card?.oracle_id) printsOfCards([card.oracle_id]).then(setPrints).catch(() => setPrints([])); }, [tab, card]);
  // la scheda è una voce della cronologia: il gesto "indietro" la chiude
  useEffect(() => {
    if (inline) return;
    history.pushState({ ...(history.state ?? {}), card: item.printing_id ?? 1 }, ''); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const pop = () => onClose(); addEventListener('popstate', pop);
    return () => { removeEventListener('popstate', pop); document.body.style.overflow = prev; };
  }, []); // eslint-disable-line
  const close = () => inline ? onClose() : history.back();
  const changed = () => { load(); onChanged?.(); };

  const mine = items.filter(i => i.name === item.name), copies = mine.reduce((t, i) => t + i.qty, 0), value = mine.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0);
  const deckName = (id: number) => decks.find(d => d.id === id)?.name;
  const inIds = [...new Set(mine.flatMap(i => i.in_decks ?? []))] as number[], used = mine.reduce((t, i) => t + i.assigned, 0);
  const ci: string[] = card?.color_identity ?? item.color_identity ?? [];
  const fits = decks.filter(d => !d.archived && !inIds.includes(d.id) && d.ci?.length && ci.every(c => d.ci.includes(c)));
  const c = shown ?? card, face = card?.card_faces?.[0], cm = c?.purchase_uris?.cardmarket ?? `https://www.cardmarket.com/it/Magic/Products/Search?searchString=${encodeURIComponent(item.name)}`;
  const canCmd = /Legendary.*Creature|can be your commander/i.test((card?.type_line ?? '') + ' ' + (card?.oracle_text ?? face?.oracle_text ?? ''));
  const showPrint = (p: Any) => { setShown(p); box.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
  const addCopy = async () => { try { await api('/collection', 'POST', { printing_id: c.id, qty: 1 }); toast(`+1 ${item.name} (${c.set.toUpperCase()})`); changed(); } catch (e) { fail(e); } };
  const addWish = async () => { try { await api('/wishlist', 'POST', { printing_id: c.id, qty: 1 }); toast(`${item.name} nella lista dei desideri`); } catch (e) { fail(e); } };
  const addToDeck = async (d: Any) => {
    const it = mine.find(i => i.free > 0) ?? mine[0]; if (!it) return;
    try { const r = await api(`/decks/${d.id}/add-items`, 'POST', { item_ids: [it.id] }); toast(r.added ? `Aggiunta a ${d.name}` : `${item.name} è già in ${d.name}`); setToDeck(false); changed(); } catch (e) { fail(e); }
  };
  const DeckCard = ({ d, tag }: { d: Any; tag: React.ReactNode }) => <div className="deckcard wide" style={{ '--glow': glow(d.ci) } as React.CSSProperties}>
    <span className="dots2">{sortCi(d.ci).map(x => <i key={x} className={'pip ' + x} />)}</span><b>{d.name}</b><small>{d.commanders || 'Senza comandante'}</small>
    <span className="corner"><span className="num">{d.cards} / 100</span>{tag}</span></div>;
  const texts: Any[] = card?.card_faces?.length && !card.oracle_text ? card.card_faces : card ? [card] : [];

  const view = <div className={'cdetail' + (inline ? ' inline' : '')} ref={box} style={{ '--glow': glow(ci), '--art': c ? `url("${imgOf(c, 'art_crop')}")` : 'none' } as React.CSSProperties}>
    <div className="cd-art" aria-hidden="true" />
    <div className="cd-top">
      {inline ? <span /> : <button className="icon sq" aria-label="Indietro" onClick={close}><Icon name="back" /></button>}
      <Menu label="Altro" className="icon sq" items={[
        { icon: 'open', label: 'Apri su Scryfall', onClick: () => window.open(c?.scryfall_uri ?? 'https://scryfall.com', '_blank', 'noopener') },
        { icon: 'euro', label: 'Apri su Cardmarket', onClick: () => window.open(cm, '_blank', 'noopener') },
        { icon: 'heart', label: 'Aggiungi ai desideri', onClick: addWish },
      ]}><Icon name="dots" /></Menu></div>

    <div className="cd-hero">
      <div className="cd-cardwrap"><span className="aura" /><Card3D src={c ? imgOf(c, 'large') : big(item.image_small, 'large')} className="cd-card" /></div>
      <SplitName name={item.name} />
      <ColorTags ci={ci} />
      <div className="cd-price">{priceOf(c) != null && <b>{eur(priceOf(c))}</b>}{shown && shown.id !== card?.id && <small>{shown.set.toUpperCase()} #{shown.collector_number}</small>}
        <a className="pillink" href={cm} target="_blank" rel="noopener noreferrer">Cardmarket <Icon name="open" size={13} /></a></div>
    </div>

    <div className="cd-body">
      {err && <p className="er">{err}</p>}
      {panel}
      {(editable || mine.length > 0) && <section className="panel">
        <div className="ph"><b>Le tue copie</b><small>{copies} {copies === 1 ? 'copia' : 'copie'}{value > 0 ? ` · ${eur(value)}` : ''}</small></div>
        {mine.map(i => <button key={i.id} className="copyrow" disabled={!editable} onClick={() => setEdit(i)}>
          <span className="qbox">{i.qty}×</span>
          <span className="g"><b>{FIN_IT[i.finish]} · {i.condition === 'M' ? 'MT' : i.condition} · {langIt(i.lang)}</b>
            <small>{i.assigned > 0 ? `Nel mazzo ${(i.decks ?? []).map(deckName).filter(Boolean).join(', ')}` : i.qty > 1 ? `${i.free} libere` : 'Libera'}{i.set_code !== c?.set ? ` · ${i.set_code.toUpperCase()}` : ''}</small></span>
          {i.price != null && <span className="pr">{eur(i.price)}</span>}{editable && <Icon name="next" />}</button>)}
        {editable && <button className="copyrow add" disabled={!c} onClick={addCopy}><Icon name="plus" /><span className="g"><b>Aggiungi una copia</b>{shown && shown.id !== item.printing_id && <small>{shown.set_name}</small>}</span></button>}
      </section>}

      <div className="tabs3" role="tablist">{([['c', 'Carta'], ['s', 'Stampe'], ['d', 'Nei mazzi']] as const).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'c' && card && <>
        <section className="panel oracle">{texts.map((f: Any, n: number) => <div key={n}>
          {texts.length > 1 && <b className="facename">{f.name} {f.mana_cost && <ManaText text={f.mana_cost} />}</b>}
          {(f.oracle_text ?? '').split('\n').map((l: string, j: number) => <p key={j}><ManaText text={l} /></p>)}
          {f.flavor_text && <p className="flavor">{f.flavor_text}</p>}</div>)}</section>
        <h3>Dettagli</h3>
        <div className="stat3 tight">
          <div><b>{card.cmc ?? '—'}</b><small>Valore di mana</small></div>
          <div><b>{card.power != null ? `${card.power} / ${card.toughness}` : face?.power != null ? `${face.power} / ${face.toughness}` : card.loyalty ?? '—'}</b><small>{card.loyalty ? 'Fedeltà' : 'Forza / Cost.'}</small></div>
          <div><b>{RAR_IT[c.rarity] ?? c.rarity}</b><small>Rarità</small></div></div>
        <div className="panel kvlist">
          <div><span>Costo di mana</span><span>{(card.mana_cost || face?.mana_cost) ? <ManaText text={card.mana_cost || face.mana_cost} /> : '—'}</span></div>
          <div><span>Tipo</span><span>{card.type_line}</span></div>
          <div><span>Set</span><span>{c.set_name} · #{c.collector_number}</span></div>
          {c.artist && <div><span>Artista</span><span>{c.artist}</span></div>}</div>
        <h3>Legalità</h3>
        <div className="panel"><div className="ph"><b>Commander</b></div>
          <div className="pills"><span className={'pill ' + (card.legalities?.commander === 'legal' ? 'ok' : 'er')}><Icon name={card.legalities?.commander === 'legal' ? 'check' : 'close'} size={13} />{LEG_IT[card.legalities?.commander] ?? '—'}</span>
            {canCmd && <span className="pill m"><Icon name="user" size={13} />Può essere comandante</span>}</div></div>
      </>}

      {tab === 's' && <>
        <h3 className="tight">Stampe</h3>
        <p className="m sub">{prints ? `${prints.length} ${prints.length === 1 ? 'versione' : 'versioni'}` : 'Cerco le stampe…'} · ne possiedi {copies} {copies === 1 ? 'copia' : 'copie'}</p>
        {prints && <div className="panel printlist">{prints.map(p => { const own = mine.filter(i => i.printing_id === p.id).reduce((t, i) => t + i.qty, 0);
          return <button key={p.id} className={'copyrow' + (shown?.id === p.id ? ' on' : '')} onClick={() => showPrint(p)}>
            <img className="thumb" src={imgOf(p, 'small')} alt="" loading="lazy" />
            <span className="g"><b>{p.set_name}</b><small>{p.set.toUpperCase()} · #{p.collector_number} · {p.lang.toUpperCase()} · {(p.finishes ?? []).map((x: string) => x === 'nonfoil' ? 'Non foil' : FIN_IT[x]).join(' / ')}</small></span>
            <span className="side">{priceOf(p) != null && <span className="pr">{eur(priceOf(p))}</span>}{own > 0 && <span className="pill ok"><Icon name="check" size={12} />×{own}</span>}</span></button>; })}</div>}
        <p className="m hintp">Tocca una stampa per vederla in alto e aggiornare il prezzo.</p>
      </>}

      {tab === 'd' && <>
        <h3 className="tight">Nei tuoi mazzi</h3>
        <p className="m sub">{used} {used === 1 ? 'copia usata' : 'copie usate'} · {copies - used} {copies - used === 1 ? 'libera' : 'libere'}</p>
        {inIds.length ? inIds.map(id => { const d = decks.find(x => x.id === id); return d && <DeckCard key={id} d={d} tag={<span className="pill m"><Icon name="check" size={13} />{String(d.commanders).split(' + ').includes(item.name) ? 'Comandante' : 'Nel mazzo'}</span>} />; })
          : <p className="m">Non è in nessun mazzo.</p>}
        {fits.length > 0 && <><h3>Potrebbe entrare in</h3><p className="m sub">Mazzi compatibili con l’identità {sortCi(ci).map(x => COLOR_IT[x]).join('-') || 'incolore'}</p>
          {fits.map(d => <DeckCard key={d.id} d={d} tag={<span className="pill m">{100 - d.cards > 0 ? `${100 - d.cards} posti liberi` : 'completo'}</span>} />)}</>}
      </>}
    </div>

    {bar !== undefined ? bar && <div className="cd-bar">{bar}</div> : <div className="cd-bar">
      <button className="icon sq" aria-label="Aggiungi ai desideri" onClick={addWish}><Icon name="heart" /></button>
      <button className="b" disabled={!mine.length} onClick={() => setToDeck(true)}><Icon name="plus" />Aggiungi a un mazzo</button></div>}

    {edit && <EditSheet item={edit} decks={decks} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); changed(); }} />}
    {toDeck && <Sheet title="Aggiungi a un mazzo" sub={item.name} onClose={() => setToDeck(false)}>
      {decks.some(d => !d.archived) ? <div className="list">{decks.filter(d => !d.archived).map(d => <button key={d.id} className="item" onClick={() => addToDeck(d)}>
        <div className="g"><div className="name">{d.name}</div><div className="meta"><span>{d.commanders || 'Senza comandante'}</span><span>{d.cards}/100</span></div></div><Icon name="next" /></button>)}</div>
        : <p className="m">Non hai ancora mazzi: creane uno dalla sezione Mazzi.</p>}</Sheet>}
  </div>;
  return inline ? view : createPortal(view, document.body);
}
