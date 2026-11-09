import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Go, Preset, Tab } from './tabs';
import Icon from '../components/Icon';
import InstallButton from '../components/InstallButton';
import { eur, stalePrices } from '../components/Price';
import { toast } from '../components/Toast';
import { useWide } from '../components/useWide';
import HomeMobile from './HomeMobile';
import { usePricesUpdated } from '../services/autoRefresh';
type Any = any;
const LABEL: Record<string, string> = { colore: 'Identità di colore', rarità: 'Rarità', set: 'Espansioni', tipo: 'Tipi' };
const RAR_IT: Record<string, string> = { common: 'comuni', uncommon: 'non comuni', rare: 'rare', mythic: 'mitiche', special: 'speciali', bonus: 'bonus' };
const wide = () => matchMedia('(min-width: 900px)').matches;

// Home: valore della collezione, azioni rapide, riepiloghi che portano alla sezione giusta, cosa c'è da sistemare.
export default function HomePage({ go }: { go: Go }) {
  const [s, setS] = useState<Any>(), [err, setErr] = useState('');
  const [wish, setWish] = useState<Any[] | null>(null), isWide = useWide();
  const load = () => api('/stats').then(x => { setS(x); setErr(''); return x; }).catch((e: Any) => { setErr(e.message); });
  // prezzi della collezione: si aggiornano da soli se mancano o hanno più di 20 ore, poi si ricalcola il valore
  const pricing = false;
  const loadWish = () => api('/wishlist').then(setWish).catch(() => setWish([]));
  useEffect(() => { loadWish(); load(); }, []);
  usePricesUpdated(useCallback(() => { load(); loadWish(); }, [])); // eslint-disable-line
  if (!s) return err ? <div className="card er"><b>Dati non disponibili</b><p style={{ margin: '6px 0 10px' }}>{err}</p><button onClick={load}>Riprova</button></div> : <p className="m">Caricamento…</p>;
  // sul telefono la Home ha la grafica del prototipo
  // stessa Home su telefono e computer; sul computer niente carte in evidenza e due colonne
  return <><InstallButton /><HomeMobile s={s} wish={wish} pricing={pricing} go={go} featured /></>;
}
