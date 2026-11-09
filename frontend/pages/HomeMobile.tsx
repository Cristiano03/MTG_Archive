import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePricesUpdated } from '../services/autoRefresh';
import { api } from '../services/api';
import { sfCollection } from '../services/scryfall';
import type { Go } from './tabs';
import Icon from '../components/Icon';
import { eur } from '../components/Price';
import { Card3D, ColorTags, COLOR_ADJ, SplitName, big, glow, imgOf, sortCi } from '../components/CardArt';
import CardDetail from '../features/card/CardDetail';
type Any = any;
const COLS = ['W', 'U', 'B', 'R', 'G', 'C'];
const ago = (d: string) => { const n = Math.floor((Date.now() - new Date(d).getTime()) / 864e5); return n <= 0 ? 'aggiunta oggi' : n === 1 ? 'ieri' : n < 30 ? `${n} giorni fa` : new Date(d).toLocaleDateString('it'); };

// Home del telefono: valore, carte in evidenza (i comandanti dei mazzi), cosa sistemare, identità di colore, mazzi, desideri, ultime aggiunte.
export default function HomeMobile({ s, wish, pricing, go }: { s: Any; wish: Any[] | null; pricing: boolean; go: Go }) {
  const [items, setItems] = useState<Any[]>([]), [decks, setDecks] = useState<Any[]>([]), [feat, setFeat] = useState<Any[]>([]), [k, setK] = useState(0);
  const [col, setCol] = useState<string | null>(null), [card, setCard] = useState<Any | null>(null), [peek, setPeek] = useState<Any | null>(null);
  const load = () => Promise.all([api('/collection').then(setItems), api('/decks').then(setDecks)]).catch(() => {});
  useEffect(() => { load(); }, []);
  usePricesUpdated(useCallback(() => { load(); }, []));

  // in evidenza: i comandanti dei mazzi attivi (al massimo 3); senza mazzi, le carte di valore più alto
  useEffect(() => {
    const names = [...new Set(decks.filter(d => !d.archived && d.commanders).map(d => String(d.commanders).split(' + ')[0]))].slice(0, 3);
    if (names.length) { sfCollection(names.map(name => ({ name }))).then(cs => setFeat(cs.map(c => ({ id: c.id, name: c.name, img: imgOf(c), ci: c.color_identity, price: c.prices?.eur ?? c.prices?.eur_foil })))).catch(() => {}); return; }
    setFeat([...items].filter(i => i.price != null).sort((a, b) => b.price - a.price).slice(0, 3).map(i => ({ id: i.printing_id, name: i.name, img: big(i.image_small), ci: i.color_identity, price: i.price, item: i })));
  }, [decks, items]);

  // copie per colore dell'identità (una carta multicolore conta per ogni suo colore)
  const byColor = useMemo(() => {
    const m: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const i of items) { const ci: string[] = i.color_identity ?? []; if (!ci.length) m.C += i.qty; else ci.forEach(c => { if (c in m) m[c] += i.qty; }); }
    return m;
  }, [items]);
  const top = COLS.reduce((a, c) => byColor[c] > byColor[a] ? c : a, 'W'), sel = col ?? top, max = Math.max(1, ...COLS.map(c => byColor[c]));
  const recent = [...items].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
  const v = s.value, b = s.banlist, act = decks.filter(d => !d.archived);
  const wishN = (wish ?? []).reduce((t, r) => t + r.to_buy, 0), wishCost = (wish ?? []).reduce((t, r) => t + (r.price_ref ? r.to_buy * Number(r.price_ref) : 0), 0);
  const prob = s.problems as Any[], f = feat[k % Math.max(1, feat.length)];
  const status = (d: Any) => { const p = prob.find(x => x.id === d.id); return !p ? { t: 'Legale', c: 'ok' } : p.missing ? { t: `${p.missing} mancanti`, c: 'wa' } : { t: p.status, c: 'm' }; };
  const date = v?.oldest ? new Date(v.oldest).toLocaleDateString('it') : null, stale = b.stale || b.lastError;

  return <div className="mhome">
    <section className="mvalue">
      <div className="lbl">Valore della collezione</div>
      <div className="row"><div className="big">{pricing && !v?.oldest ? '…' : <>{eur(v?.eur ?? 0).replace(/\s?€$/, '')}<span className="cur"> €</span></>}</div></div>
      <div className="sub">{s.copies} copie{v?.unpriced ? ` · ${v.unpriced} senza prezzo` : ''}</div>
      <div className={'sub2' + (stale ? ' wa' : '')}>{date ? `Prezzi Cardmarket e banlist del ${date}` : 'Prezzi Cardmarket non ancora scaricati'}{stale ? ' · banlist da aggiornare' : ''}</div>
    </section>

    {f && <section className="featured" style={{ '--glow': glow(f.ci) } as React.CSSProperties}>
      {/* le carte restano le stesse e cambiano solo posto: davanti, dietro a destra (la prossima), dietro a sinistra (la precedente) */}
      <div className="fan" onClick={() => setK(k + 1)}>
        {feat.map((x, i) => { const n = feat.length, p = (i - (k % n) + n) % n, slot = p === 0 ? 'front' : p === 1 && n > 2 ? 'next' : 'prev';
          return <div key={x.name} className={'fslot ' + slot}><Card3D src={x.img} /></div>; })}
      </div>
      <div className="ftext" key={f.name} role="button" tabIndex={0} aria-label={'Apri ' + f.name} onClick={() => setPeek(f)}>
      <SplitName name={f.name} />
      <ColorTags ci={f.ci} />
      {f.price != null && <span className="pricechip">{eur(f.price)}</span>}
      {feat.length > 1 && <div className="dots">{feat.map((_, i) => <span key={i} className={i === k % feat.length ? 'on' : ''} />)}</div>}
      </div>
      <div className="hint">In evidenza · tocca la carta per scorrere, il nome per i dettagli</div>
    </section>}

    {prob.length > 0 && <button className="fixrow" onClick={() => go('d', prob.length === 1 ? `deck:${prob[0].id}` : undefined)}>
      <span className="orb" /><span className="g"><b>{prob.length === 1 ? '1 mazzo da sistemare' : `${prob.length} mazzi da sistemare`}</b>
        <small>{prob[0].name} · {prob[0].missing ? `mancano ${prob[0].missing} carte` : prob[0].status}</small></span><Icon name="next" /></button>}

    <section className="panel ident">
      <div className="ph"><b>Identità di colore</b><small>Tocca un colore</small></div>
      <div className="bignum">{byColor[sel]}<small> carte {COLOR_ADJ[sel][byColor[sel] === 1 ? 0 : 1]} · {s.copies ? Math.round(byColor[sel] / s.copies * 100) : 0}%</small></div>
      <div className="bars">{COLS.map(c => <button key={c} className={'bar-' + c + (c === sel ? ' on' : '')} style={{ flexGrow: 0.6 + byColor[c] / max * 3 }} aria-label={`${byColor[c]} carte ${COLOR_ADJ[c][1]}`} onClick={() => setCol(c)}>
        <span /><small>{c}</small></button>)}</div>
    </section>

    <div className="stat3">
      <button onClick={() => go('c')}><b>{s.copies}</b><small>Copie</small></button>
      <button onClick={() => go('c', 'free')}><b>{s.free}</b><small>Libere</small></button>
      <button onClick={() => go('c', 'asg')}><b>{s.assigned}</b><small>Nei mazzi</small></button>
    </div>

    <div className="sec"><h3>I tuoi mazzi</h3><button className="link" onClick={() => go('d')}>Vedi tutti</button></div>
    <div className="hscroll">
      {act.map(d => { const st = status(d); return <button key={d.id} className="deckcard" style={{ '--glow': glow(d.ci) } as React.CSSProperties} onClick={() => go('d', `deck:${d.id}`)}>
        <span className="dots2">{sortCi(d.ci).map(c => <i key={c} className={'pip ' + c} />)}</span>
        <b>{d.name}</b><small>{d.commanders || 'Senza comandante'}</small>
        <span className="foot"><span className="num">{d.cards} / 100</span><span className={'pill ' + st.c}>{st.c !== 'm' && <Icon name="check" size={13} />}{st.t}</span></span></button>; })}
      <button className="deckcard add" onClick={() => go('d', 'new')}><Icon name="plus" size={24} /><span>Nuovo mazzo</span></button>
    </div>

    <button className="fixrow plain" onClick={() => go('w')}><span className="roundico"><Icon name="heart" /></span>
      <span className="g"><b>Lista dei desideri</b><small>{!wish ? '…' : !wish.length ? 'Aggiungi le carte che cerchi' : `${wishN} ${wishN === 1 ? 'carta' : 'carte'} da comprare${wishCost > 0 ? ` · circa ${eur(wishCost)}` : ''}`}</small></span><Icon name="next" /></button>

    {recent.length > 0 && <>
      <div className="sec"><h3>Ultime aggiunte</h3><button className="link" onClick={() => go('c')}>Collezione</button></div>
      <div className="recent">{recent.map(i => <button key={i.id} onClick={() => setCard(i)}>
        <img className="thumb" src={i.image_small} alt="" loading="lazy" />
        <span className="g"><b>{i.name}</b><small>{i.set_code.toUpperCase()} · {ago(i.created_at)}</small></span>
        {i.price != null && <span className="pr">{eur(i.price)}</span>}</button>)}</div></>}

    {card && <CardDetail item={card} onClose={() => setCard(null)} onChanged={load} />}
    {peek && <CardDetail printingId={peek.id} name={peek.name} onClose={() => setPeek(null)} onChanged={load} />}
  </div>;
}
