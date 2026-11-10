import { useEffect, useState } from 'react';
import { api, fail } from '../../services/api';
import { sfGet } from '../../services/scryfall';
import { useCardPreview } from '../../components/CardPreview';
import { toast } from '../../components/Toast';
import Icon from '../../components/Icon';
import CardDetail from '../card/CardDetail';
type Any = any;

// Carte consigliate per il comandante, prese da EDHREC (nessuna API ufficiale: i file JSON pubblici che usa il loro sito,
// leggibili dal browser). Si caricano solo quando le chiedi; una copia resta in memoria per la sessione.
const EDH = 'https://json.edhrec.com/pages/commanders/';
const front = (n: string) => n.split(' // ')[0].trim();
const slugOf = (n: string) => front(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’,.!?:"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const img = (id: string, size = 'small') => `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;
// categorie di EDHREC (tag) con il nome in italiano; quelle sconosciute tengono il nome inglese
const LABEL: Record<string, string> = { topcards: 'Più usate', highsynergycards: 'Sinergia alta', newcards: 'Nuove', highliftcards: 'Sorprese', gamechangers: 'Game changer',
  creatures: 'Creature', instants: 'Istantanei', sorceries: 'Stregonerie', utilityartifacts: 'Artefatti', manaartifacts: 'Artefatti mana', enchantments: 'Incantesimi',
  planeswalkers: 'Planeswalker', battles: 'Battaglie', utilitylands: 'Terre utili', lands: 'Terre' };
type Rec = { id: string; name: string; inclusion: number; synergy: number };
type Data = { slug: string; decks: number; lists: { tag: string; label: string; cards: Rec[] }[] };
const memo = new Map<string, Promise<Data | null>>();

async function fetchPage(slug: string, base = EDH): Promise<Any | null> {
  const r = await fetch(base + slug + '.json');
  if (r.status === 404 || r.status === 403) return null; // EDHREC risponde 403 per le pagine che non esistono
  if (!r.ok) throw new Error('EDHREC ' + r.status);
  const j = await r.json();
  return j?.container?.json_dict?.cardlists ? j : null; // alcune pagine rimandano altrove ({"redirect": …})
}
// due comandanti (partner, background): EDHREC li mette in ordine alfabetico; si prova anche l'altro ordine
const slugsOf = (names: string[]) => { const parts = names.map(slugOf); return parts.length > 1 ? [[...parts].sort().join('-'), [...parts].sort().reverse().join('-')] : parts; };
function load(names: string[]): Promise<Data | null> {
  const tries = slugsOf(names), key = tries[0];
  if (!memo.has(key)) memo.set(key, (async () => {
    for (const slug of tries) {
      const j = await fetchPage(slug); if (!j) continue;
      const lists = (j.container.json_dict.cardlists as Any[]).map(l => ({ tag: l.tag as string, label: LABEL[l.tag] ?? l.header,
        cards: (l.cardviews as Any[]).filter(c => c.id && c.name).map(c => ({ id: c.id, name: c.name, synergy: c.synergy ?? 0,
          inclusion: c.potential_decks ? c.num_decks / c.potential_decks : 0 })) })).filter(l => l.cards.length);
      return { slug, decks: j.container.json_dict.card?.num_decks ?? 0, lists };
    }
    return null;
  })().catch(e => { memo.delete(key); throw e; }));
  return memo.get(key)!;
}

// Mazzo medio di EDHREC: le 100 carte più tipiche, con la stampa esatta (id Scryfall) e il comandante segnato ("c")
async function averageDeck(names: string[]): Promise<{ printing_id: string; qty: number; section: string }[] | null> {
  for (const slug of slugsOf(names)) {
    const r = await fetch('https://json.edhrec.com/pages/average-decks/' + slug + '.json');
    if (r.status === 404 || r.status === 403) continue; if (!r.ok) throw new Error('EDHREC ' + r.status);
    const rows = ((await r.json())?.archidekt ?? []) as Any[];
    if (rows.length) return rows.filter(x => x.u && x.q > 0).map(x => ({ printing_id: x.u, qty: x.q, section: x.c === 'c' ? 'cmd' : 'main' }));
  }
  return null;
}

const pct = (x: number) => Math.round(x * 100) + '%';
export default function Suggestions({ commanders, inDeck, add, openDeck }: { commanders: string[]; inDeck: Set<string>; add: (c: Any) => void; openDeck: (id: number) => void }) {
  const [on, setOn] = useState(false), [data, setData] = useState<Data | null | undefined>(), [err, setErr] = useState('');
  const [tag, setTag] = useState('topcards'), [all, setAll] = useState(false), [owned, setOwned] = useState<Map<string, number>>(new Map());
  const [open, setOpen] = useState<Any | null>(null), [making, setMaking] = useState(false);
  const { bind, preview } = useCardPreview();
  const key = commanders.join('|');
  useEffect(() => { setData(undefined); setErr(''); setAll(false); }, [key]);
  useEffect(() => {
    if (!on || !commanders.length) return;
    let live = true;
    load(commanders).then(x => { if (live) { setData(x); if (x && !x.lists.some(l => l.tag === tag)) setTag(x.lists[0]?.tag ?? ''); } })
      .catch(() => live && setErr('EDHREC non risponde: riprova tra poco.'));
    // copie libere in collezione, per nome (le carte di EDHREC non hanno l'oracle_id)
    api('/collection').then((rows: Any[]) => { if (!live) return; const m = new Map<string, number>();
      for (const r of rows) { const n = front(r.name).toLowerCase(); m.set(n, (m.get(n) ?? 0) + r.free); } setOwned(m); }).catch(() => {});
    return () => { live = false; };
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!commanders.length) return null;
  if (!on) return <div className="list sugg">
    <div className="listhead">Consigliate da EDHREC</div>
    <button className="item ghost" style={{ justifyContent: 'center', minHeight: 52 }} onClick={() => setOn(true)}><Icon name="search" size={18} />Mostra le carte più giocate con {commanders.join(' + ')}</button>
  </div>;

  const list = data?.lists.find(l => l.tag === tag), cards = (list?.cards ?? []).filter(c => !inDeck.has(front(c.name).toLowerCase()));
  const shown = all ? cards : cards.slice(0, 12);
  const openCard = async (c: Rec) => { try { const s = await sfGet('/cards/' + c.id); if (s) setOpen(s); } catch { toast('Scryfall non risponde'); } };
  // crea un nuovo mazzo virtuale con il mazzo medio (non tocca questo mazzo né la collezione) e lo apre
  const makeAverage = async () => {
    setMaking(true);
    try {
      const rows = await averageDeck(commanders);
      if (!rows) { toast('EDHREC non ha un mazzo medio per questo comandante'); return; }
      const deck = await api('/decks', 'POST', { name: `${commanders.map(n => front(n).split(',')[0]).join(' + ')} · mazzo medio EDHREC`, mode: 'virtual' });
      await api('/import/commit', 'POST', { target: deck.id, replace: true, addToCollection: 'none', rows: rows.map(r => ({ ...r, exact: true })) });
      toast('Mazzo medio creato come mazzo virtuale'); openDeck(Number(deck.id));
    } catch (e) { fail(e); } finally { setMaking(false); }
  };
  const freeOf = (c: Rec) => owned.get(front(c.name).toLowerCase()) ?? 0;
  return <div className="list sugg">
    <div className="listhead">Consigliate da EDHREC{data === undefined && !err && <span className="n">carico…</span>}
      {data && <a className="n" href={'https://edhrec.com/commanders/' + data.slug} target="_blank" rel="noopener noreferrer">{data.decks.toLocaleString('it-IT')} mazzi ↗</a>}</div>
    {err && <div className="item"><span className="er">{err}</span></div>}
    {data === null && <div className="item"><span className="m">EDHREC non ha una pagina per {commanders.join(' + ')}.</span></div>}
    {data && <div className="item"><div className="g"><div className="name">Mazzo medio</div><div className="meta"><span>le 100 carte più tipiche, come nuovo mazzo virtuale</span></div></div>
      <button className="soft small" disabled={making} onClick={makeAverage}>{making ? 'Creo…' : 'Crea'}</button></div>}
    {data && <div className="item sugg-tags">{data.lists.map(l => <button key={l.tag} className={'pchip' + (l.tag === tag ? ' on' : '')} onClick={() => { setTag(l.tag); setAll(false); }}>{l.label}</button>)}</div>}
    {data && list && !cards.length && <div className="item"><span className="m">Le hai già tutte nel mazzo.</span></div>}
    {shown.map(c => { const free = freeOf(c);
      return <div className="item tap" key={c.id} onClick={e => { if (!(e.target as HTMLElement).closest('button')) openCard(c); }}>
        <img className="thumb" alt="" loading="lazy" src={img(c.id)} {...bind(img(c.id, 'normal'))} />
        <div className="g"><div className="name">{c.name}</div>
          <div className="meta"><span>nel {pct(c.inclusion)} dei mazzi</span>
            {Math.abs(c.synergy) >= 0.01 && <span className={c.synergy > 0 ? 'ok' : 'm'}>sinergia {c.synergy > 0 ? '+' : ''}{pct(c.synergy)}</span>}
            {free > 0 && <span className="ok">{free === 1 ? '1 libera' : `${free} libere`} in collezione</span>}</div></div>
        <button className="b icon" aria-label={'Aggiungi ' + c.name} onClick={() => add({ id: c.id, name: c.name })}><Icon name="plus" /></button></div>; })}
    {cards.length > 12 && !all && <button className="item ghost" style={{ justifyContent: 'center', minHeight: 48 }} onClick={() => setAll(true)}>Mostra tutte ({cards.length})</button>}
    {preview}
    {open && <CardDetail card={open} ctx="search" onClose={() => setOpen(null)}
      bar={<button className="b wide" onClick={() => { add(open); history.back(); }}><Icon name="plus" />Aggiungi al mazzo</button>} />}
  </div>;
}
