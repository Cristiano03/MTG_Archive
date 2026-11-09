import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Go, Preset, Tab } from './tabs';
import Icon from '../components/Icon';
import InstallButton from '../components/InstallButton';
import { eur, stalePrices } from '../components/Price';
import { toast } from '../components/Toast';
type Any = any;
const LABEL: Record<string, string> = { colore: 'Identità di colore', rarità: 'Rarità', set: 'Espansioni', tipo: 'Tipi' };
const RAR_IT: Record<string, string> = { common: 'comuni', uncommon: 'non comuni', rare: 'rare', mythic: 'mitiche', special: 'speciali', bonus: 'bonus' };
const wide = () => matchMedia('(min-width: 900px)').matches;

// Home: valore della collezione, azioni rapide, riepiloghi che portano alla sezione giusta, cosa c'è da sistemare.
export default function HomePage({ go }: { go: Go }) {
  const [s, setS] = useState<Any>(), [err, setErr] = useState('');
  const [pricing, setPricing] = useState(false), [wish, setWish] = useState<Any[] | null>(null);
  const load = () => api('/stats').then(x => { setS(x); setErr(''); return x; }).catch((e: Any) => { setErr(e.message); });
  // prezzi della collezione: si aggiornano da soli se mancano o hanno più di 20 ore, poi si ricalcola il valore
  const prices = async (force: boolean) => { setPricing(true); try { const r = await api('/prices/collection', 'POST', { force }); await load(); if (force) toast(`Prezzi aggiornati (${r.updated})`); } catch (e: Any) { if (force) toast(e.message, 'er'); } setPricing(false); };
  useEffect(() => { api('/wishlist').then(setWish).catch(() => setWish([])); load().then(x => { if (x?.copies > 0 && stalePrices(x.value)) prices(false); }); }, []);
  if (!s) return err ? <div className="card er"><b>Dati non disponibili</b><p style={{ margin: '6px 0 10px' }}>{err}</p><button onClick={load}>Riprova</button></div> : <p className="m">Caricamento…</p>;
  const refresh = async () => { try { const r = await api('/catalog/refresh', 'POST'); toast(`Legalità aggiornata per ${r.updated} carte`); } catch (e: Any) { toast(e.message, 'er'); } load(); };
  const Tile = ({ n, label, t, tone, p }: { n: Any; label: string; t: Tab; tone?: string; p?: Preset }) =>
    <button className="tile" onClick={() => go(t, p)}><span className={'n ' + (tone ?? '')}>{n}</span><span className="l">{label}</span></button>;
  const b = s.banlist, stale = b.stale || (!b.lastOk && s.activeDecks > 0), v = s.value;
  const wishN = (wish ?? []).reduce((t, r) => t + r.to_buy, 0), wishCost = (wish ?? []).reduce((t, r) => t + (r.price_ref ? r.to_buy * Number(r.price_ref) : 0), 0);
  const dist = (k: string, x: Any[]) => x.map((y: Any) => `${k === 'rarità' ? RAR_IT[y.k] ?? y.k : y.k} ${y.n}`).join(', ') || 'nessun dato';
  return <>
    <InstallButton />
    <div className="home"><div>
      <div className="hero">
        <div className="lbl">Valore della collezione</div>
        <div className="row"><div className="big">{pricing && !v?.oldest ? '…' : eur(v?.eur ?? 0)}</div>
          <button className="small" style={{ marginLeft: 'auto' }} disabled={pricing} onClick={() => prices(true)}><Icon name="refresh" />{pricing ? 'Aggiorno…' : 'Aggiorna'}</button></div>
        <div className="sub">{s.copies} copie · prezzi Cardmarket in euro{v?.oldest ? ` del ${new Date(v.oldest).toLocaleDateString('it')}` : ''}{v?.unpriced ? ` · ${v.unpriced} senza prezzo` : ''}</div>
      </div>

      <div className="quick">
        <button className="b" onClick={() => go('c', 'add')}><Icon name="plus" />Aggiungi carte</button>
        {!wide() ? <button onClick={() => go('s')}><Icon name="scan" />Scansiona</button> : <button onClick={() => go('w')}><Icon name="heart" />Desideri</button>}
        <button onClick={() => go('i')}><Icon name="text" />Importa lista</button>
        <button onClick={() => go('d', 'new')}><Icon name="decks" />Nuovo mazzo</button>
      </div>

      <div className="sec"><h3>Collezione</h3></div>
      <div className="tiles">
        <Tile n={s.copies} label="Copie" t="c" />
        <Tile n={s.unique} label="Carte diverse" t="c" />
        <Tile n={s.free} label="Copie libere" t="c" p="free" />
        <Tile n={s.assigned} label="Nei mazzi" t="c" p="asg" />
      </div>

      <div className="sec"><h3>Mazzi</h3></div>
      <div className="tiles">
        <Tile n={s.activeDecks} label="Mazzi attivi" t="d" />
        <Tile n={s.valid} label="Regolari" t="d" tone={s.valid ? 'ok' : ''} />
        <Tile n={s.invalid} label="Con errori" t="d" tone={s.invalid ? 'er' : ''} />
        <Tile n={s.missing} label="Copie mancanti" t="d" tone={s.missing ? 'wa' : ''} />
      </div>
      {s.problems.length > 0 && <div className="list">
        <div className="listhead">Da sistemare</div>
        {s.problems.map((d: Any) => <button className="item" key={d.id} onClick={() => go('d')}><div className="g"><div className="name">{d.name}</div>
          <div className="meta"><span className={d.status === 'non valido' ? 'er' : ''}>{d.status}</span>{d.missing > 0 && <span className="wa">{d.missing === 1 ? 'manca 1 copia' : `mancano ${d.missing} copie`}</span>}</div></div><Icon name="next" /></button>)}</div>}
    </div><div>

      <div className="sec"><h3>Lista dei desideri</h3></div>
      <div className="list"><button className="item" onClick={() => go('w')}><Icon name="heart" />
        <div className="g"><div className="name">{!wish ? '…' : !wish.length ? 'Lista vuota' : `${wishN} ${wishN === 1 ? 'copia' : 'copie'} da comprare`}</div>
          <div className="meta">{wishCost > 0 ? <span>circa {eur(wishCost)}</span> : <span>Aggiungi le carte che cerchi</span>}</div></div><Icon name="next" /></button></div>

      <div className={'card ' + (b.lastError ? 'er' : stale ? 'wa' : '')} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div className="g"><b>Banlist e legalità</b>
          <div className="m" style={{ fontSize: 14 }}>{b.lastOk ? 'Aggiornata il ' + new Date(b.lastOk).toLocaleDateString('it') : 'Mai aggiornata'}{b.lastError ? ` · ultimo tentativo fallito` : stale ? ' · dati vecchi' : ''}</div></div>
        <button className={stale ? 'b small' : 'small'} onClick={refresh}><Icon name="refresh" />Aggiorna</button></div>

      {s.recent.length > 0 && <div className="list">
        <div className="listhead">Aggiunte di recente</div>
        {s.recent.map((r: Any) => <div className="item" key={r.id} style={{ minHeight: 48 }}><div className="g"><div className="name">{r.name}</div></div>
          <span className="m" style={{ fontSize: 13.5 }}>{r.set_code.toUpperCase()} · {r.qty} {r.qty === 1 ? 'copia' : 'copie'}</span></div>)}</div>}
      <details><summary>Statistiche della collezione</summary><div className="card" style={{ marginTop: 0 }}>{Object.entries(s.by).map(([k, x]: [string, Any]) =>
        <p key={k} style={{ margin: '0 0 10px' }}><b>{LABEL[k] ?? k}</b><br /><small>{dist(k, x)}</small></p>)}</div></details>
    </div></div>
  </>;
}
