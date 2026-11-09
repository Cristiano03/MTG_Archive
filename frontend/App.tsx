import { useEffect, useState } from 'react';
import type { Preset, Tab } from './pages/tabs';
import Icon from './components/Icon';
import HomePage from './pages/HomePage';
import CollectionPage from './pages/CollectionPage';
import DecksPage from './pages/DecksPage';
import Wishlist from './features/wishlist/Wishlist';
import Account from './features/account/Account';
import ImportPage from './pages/ImportPage';
import Toaster from './components/Toast';
import ScannerPage from './pages/ScannerPage';
import AuthPage from './pages/AuthPage';
import Privacy from './pages/PrivacyPage';
import Sheet from './components/Sheet';
import { supabase, configured } from './services/supabase';
import { DEMO } from './services/api';
import { refreshOnOpen } from './services/autoRefresh';
import { applyTheme, currentTheme, isTheme } from './services/theme';
// il tema salvato nell'account vale su ogni dispositivo: dopo l'accesso prende il posto di quello del browser
const themeFrom = (u?: { user_metadata?: Record<string, unknown> } | null) => { const t = u?.user_metadata?.theme; if (isTheme(t) && t !== currentTheme()) applyTheme(t); };

// navigazione: in basso sul telefono (Scansiona al centro, solo lì c'è la fotocamera), in alto sul computer
const TABS: { k: Tab; label: string; icon: string; mobile?: boolean }[] = [
  { k: 'h', label: 'Home', icon: 'home' },
  { k: 'c', label: 'Collezione', icon: 'cards' },
  { k: 's', label: 'Scansiona', icon: 'scan', mobile: true },
  { k: 'd', label: 'Mazzi', icon: 'decks' },
  { k: 'w', label: 'Desideri', icon: 'heart' },
];
const SUB: Tab[] = ['i', 'u', 'p']; // pagine che si aprono da un pulsante, con la freccia per tornare indietro
const TITLE: Record<Tab, string> = { h: 'Commander Archive', c: 'Collezione', s: 'Scansiona', d: 'Mazzi', w: 'Lista dei desideri', i: 'Importa una lista', u: 'Account', p: 'Privacy' };

export default function App() {
  // undefined = verifica in corso, null = non collegato
  const [user, setUser] = useState<string | null | undefined>(undefined), [recovery, setRecovery] = useState(false);
  // la sessione la gestisce Supabase Auth (resta salvata nel browser e si rinnova da sola)
  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => { themeFrom(data.session?.user); setUser(data.session?.user.email ?? null); }).catch(() => setUser(null));
    // dal link "Password dimenticata" arriva una sessione di recupero: prima si sceglie la nuova password
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => { if (e === 'PASSWORD_RECOVERY') setRecovery(true); if (e === 'SIGNED_IN') themeFrom(s?.user); setUser(s?.user.email ?? null); });
    const h = () => { supabase.auth.signOut().catch(() => {}); setUser(null); }; addEventListener('auth:required', h);
    return () => { sub.subscription.unsubscribe(); removeEventListener('auth:required', h); };
  }, []);
  if (DEMO) return <Main email="anteprima@locale" onLogout={() => {}} />;
  if (!configured) return <div className="auth"><div className="auth-box"><b>Configurazione mancante</b><p className="m">Il sito è stato compilato senza VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY in frontend/.env (vedi docs/firebase-supabase.md).</p></div></div>;
  if (user === undefined) return <div className="auth"><p className="m">Caricamento…</p></div>;
  if (recovery) return <AuthPage recovery onDone={u => { setRecovery(false); setUser(u); }} />;
  if (user === null) return <AuthPage onDone={setUser} />;
  return <Main email={user} onLogout={() => setUser(null)} />;
}

function Main({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('h'), [round, setRound] = useState(0), [preset, setPreset] = useState<Preset | undefined>(), [prev, setPrev] = useState<Tab>('h');
  // toccare di nuovo la sezione attiva riporta all'inizio (es. dal mazzo aperto all'elenco dei mazzi)
  const go = (t: Tab, p?: Preset) => {
    setPreset(p); if (SUB.includes(t)) setPrev(SUB.includes(tab) ? prev : tab);
    if (t === tab || history.state?.deck || p) { setRound(r => r + 1); if (history.state?.deck) history.replaceState(null, ''); }
    setTab(t); window.scrollTo({ top: 0 });
  };
  // da computer (schermo largo) la scansione non c'è: se era aperta si torna alla Home
  const [wide, setWide] = useState(() => matchMedia('(min-width: 900px)').matches);
  useEffect(() => { const m = matchMedia('(min-width: 900px)'), h = () => setWide(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  useEffect(() => { if (wide && tab === 's') setTab('h'); }, [wide, tab]);
  // prezzi e banlist si aggiornano da soli a ogni apertura del sito
  useEffect(() => { refreshOnOpen(); }, []);
  const sub = SUB.includes(tab), [adding, setAdding] = useState(false);
  // "+" in alto nella Home (telefono): tutti i modi di inserire carte e mazzi in un pannello
  const ADD: [string, string, string, () => void][] = [['scan', 'Scansiona', 'Con la fotocamera', () => go('s')], ['search', 'Cerca carta', 'Per nome o set', () => go('c', 'add')],
    ['text', 'Importa lista', 'Testo o file', () => go('i')], ['decks', 'Nuovo mazzo', 'Scegli un comandante', () => go('d', 'new')]];
  return <div className="shell">
    <header className={"top t-" + tab}>
      <button className="brand" onClick={() => go('h')}><img src="/icons/icon-192.png" alt="" />MTG Commander Archive</button>
      <nav className="nav" aria-label="Sezioni">{TABS.map(t => <button key={t.k} className={(tab === t.k ? 'on ' : '') + (t.mobile ? 'mobile-only' : '')} aria-current={tab === t.k ? 'page' : undefined} onClick={() => go(t.k)}><Icon name={t.icon} />{t.label}</button>)}</nav>
      {sub && <button className="icon ghost" aria-label="Indietro" onClick={() => go(prev)}><Icon name="back" /></button>}
      <div id="top-lead" className="top-lead m-only" />
      <h1>{TITLE[tab]}</h1>
      {tab === 'h' && <button className="icon" aria-label="Aggiungi" onClick={() => setAdding(true)}><Icon name="plus" /></button>}
      <div id="top-actions" className="top-actions" />
      <button className={'icon ghost acct' + (tab === 'u' ? ' on' : '')} aria-label="Account" title={email} onClick={() => go('u')}><Icon name="user" /></button>
    </header>
    <main className="page" key={tab + round}>
      {tab === 'h' ? <HomePage go={go} /> : tab === 'c' ? <CollectionPage preset={preset} go={go} /> : tab === 'd' ? <DecksPage preset={preset} go={go} />
        : tab === 'w' ? <Wishlist /> : tab === 'i' ? <ImportPage /> : tab === 'u' ? <Account email={email} onLogout={onLogout} go={go} /> : tab === 'p' ? <div className="card"><Privacy /></div> : <ScannerPage />}
    </main>
    <nav className="tabbar" aria-label="Sezioni">
      {TABS.map(t => <button key={t.k} className={(tab === t.k ? 'on ' : '') + (t.k === 's' ? 'scan' : '')} aria-current={tab === t.k ? 'page' : undefined} aria-label={t.label} onClick={() => go(t.k)}><Icon name={t.icon} /><span className="tl">{t.label}</span></button>)}
    </nav>
    {adding && <Sheet title="Aggiungi" sub="Come vuoi inserire le carte?" onClose={() => setAdding(false)}>
      <div className="addgrid">{ADD.map(([icon, l, sub], i) => <button key={l} className={i === 0 ? 'on' : ''} onClick={() => { setAdding(false); ADD[i][3](); }}>
        <Icon name={icon} /><b>{l}</b><small>{sub}</small></button>)}</div></Sheet>}
    <Toaster />
  </div>;
}
