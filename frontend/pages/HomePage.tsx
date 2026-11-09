import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Go } from './tabs';
import InstallButton from '../components/InstallButton';
import { useWide } from '../components/useWide';
import HomeMobile from './HomeMobile';
import { usePricesUpdated } from '../services/autoRefresh';
import { snapGet, snapSet } from '../services/snapshot';
type Any = any;

// Home (telefono e computer): riepilogo, collezione, mazzi e desideri chiesti tutti insieme.
// All'apertura si vedono subito gli ultimi dati salvati in questo browser, poi arrivano quelli aggiornati.
export default function HomePage({ go }: { go: Go }) {
  const [s, setS] = useState<Any>(() => snapGet('stats')), [err, setErr] = useState('');
  const [wish, setWish] = useState<Any[] | null>(() => snapGet('wish') ?? null);
  const [items, setItems] = useState<Any[]>(() => snapGet('items') ?? []), [decks, setDecks] = useState<Any[]>(() => snapGet('decks') ?? []);
  const isWide = useWide();
  const load = useCallback(() => Promise.all([
    api('/stats').then(x => { setS(x); setErr(''); snapSet('stats', x); }).catch((e: Any) => setErr(e.message)),
    api('/wishlist').then(x => { setWish(x); snapSet('wish', x); }).catch(() => setWish(w => w ?? [])),
    api('/collection').then(x => { setItems(x); snapSet('items', x); }).catch(() => {}),
    api('/decks').then(x => { setDecks(x); snapSet('decks', x); }).catch(() => {}),
  ]), []);
  useEffect(() => { load(); }, [load]);
  usePricesUpdated(load);
  if (!s) return err ? <div className="card er"><b>Dati non disponibili</b><p style={{ margin: '6px 0 10px' }}>{err}</p><button onClick={load}>Riprova</button></div> : <p className="m">Caricamento…</p>;
  // stessa Home su telefono e computer (sul computer su due colonne)
  return <><InstallButton /><HomeMobile s={s} wish={wish} items={items} decks={decks} reload={load} pricing={false} go={go} featured /></>;
}
