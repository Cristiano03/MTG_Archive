import { useState } from 'react';
import { download, fail } from '../../services/api';
import { supabase, rpc } from '../../services/supabase';
import Icon from '../../components/Icon';
import { toast } from '../../components/Toast';
import { MIN_PW } from '../../pages/AuthPage';
import type { Go } from '../../pages/tabs';
// Account: dati dell'accesso, cambio password, uscita (anche da tutti i dispositivi), esportazione dei dati ed eliminazione dell'account.
export default function Account({ email, onLogout, go }: { email: string; onLogout: () => void; go: Go }) {
  const [cur, setCur] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false), [confirmText, setConfirmText] = useState('');
  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (pw.length < MIN_PW) throw new Error(`La nuova password deve avere almeno ${MIN_PW} caratteri`);
      if (pw !== pw2) throw new Error('Le due password non coincidono');
      setBusy(true);
      // si verifica la password attuale prima di cambiarla
      const chk = await supabase.auth.signInWithPassword({ email, password: cur }); if (chk.error) throw new Error('La password attuale non è corretta');
      const { error } = await supabase.auth.updateUser({ password: pw }); if (error) throw error;
      setCur(''); setPw(''); setPw2(''); toast('Password cambiata');
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const logout = async (scope: 'local' | 'global') => {
    if (scope === 'global' && !confirm('Uscire da tutti i dispositivi (telefono, computer…)? Dovrai accedere di nuovo ovunque.')) return;
    await supabase.auth.signOut({ scope }).catch(() => {}); onLogout();
  };
  const remove = async () => {
    setBusy(true);
    try { await rpc('account_delete'); await supabase.auth.signOut().catch(() => {}); alert('Account e dati eliminati.'); onLogout(); }
    catch (e) { fail(e); setBusy(false); }
  };
  return <>
    <div className="card"><b>Accesso effettuato</b><p style={{ margin: '4px 0 12px', overflowWrap: 'anywhere' }}>{email}</p>
      <div className="bar" style={{ marginBottom: 0 }}><button onClick={() => logout('local')}><Icon name="back" />Esci</button>
        <button className="ghost" onClick={() => logout('global')}>Esci da tutti i dispositivi</button></div></div>

    <form className="card auth-form" onSubmit={change}><b>Cambia password</b>
      <label className="field"><span>Password attuale</span><input type="password" autoComplete="current-password" required value={cur} onChange={e => setCur(e.target.value)} /></label>
      <label className="field"><span>Nuova password</span><input type="password" autoComplete="new-password" minLength={MIN_PW} maxLength={72} required value={pw} onChange={e => setPw(e.target.value)} /><small>Almeno {MIN_PW} caratteri.</small></label>
      <label className="field"><span>Ripeti la nuova password</span><input type="password" autoComplete="new-password" maxLength={72} required value={pw2} onChange={e => setPw2(e.target.value)} /></label>
      <button className="b" type="submit" disabled={busy}>Cambia password</button></form>

    <div className="card"><b>I tuoi dati</b><p className="m" style={{ margin: '4px 0 10px', fontSize: 14 }}>Scarica in qualsiasi momento quello che hai inserito.</p>
      <div className="bar" style={{ marginBottom: 0 }}><button onClick={() => download('/export/collection.csv')}><Icon name="download" />Collezione (CSV)</button>
        <button onClick={() => download('/export/wishlist.txt')}><Icon name="download" />Lista dei desideri</button>
        <button className="ghost" onClick={() => go('p')}>Informativa sulla privacy</button></div></div>

    <div className="card er"><b>Elimina l’account</b>
      <p style={{ margin: '4px 0 10px', fontSize: 14 }}>Cancella per sempre l’account e tutti i suoi dati: collezione, mazzi, lista dei desideri. Non si può annullare.</p>
      {!del ? <button className="d" onClick={() => setDel(true)}><Icon name="trash" />Elimina l’account…</button> : <>
        <label className="field">Per confermare scrivi ELIMINA<input value={confirmText} onChange={e => setConfirmText(e.target.value)} autoCapitalize="characters" /></label>
        <div className="bar" style={{ marginBottom: 0 }}><button className="danger" disabled={busy || confirmText.trim().toUpperCase() !== 'ELIMINA'} onClick={remove}>Elimina tutto</button>
          <button className="ghost" onClick={() => { setDel(false); setConfirmText(''); }}>Annulla</button></div></>}
    </div>
  </>;
}
