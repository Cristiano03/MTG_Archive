import { useState } from 'react';
import { supabase } from '../services/supabase';
import Captcha, { CAPTCHA_KEY } from '../components/Captcha';
import Privacy from './PrivacyPage';
// Accesso, registrazione e recupero della password con Supabase Auth. Ogni account ha la sua collezione e i suoi mazzi.
// I messaggi non dicono mai se un'email è registrata (né al recupero password), per non rivelare chi usa il sito.
const IT: [RegExp, string][] = [
  [/invalid login credentials/i, 'Email o password non corrette'], [/email not confirmed/i, 'Devi prima confermare l’email: apri il link che ti è arrivato per posta'],
  [/already registered|already exists/i, 'Non è stato possibile creare l’account con questa email. Se è tua, prova ad accedere o a recuperare la password.'],
  [/signups? not allowed|signup.*disabled/i, 'Le registrazioni sono chiuse'],
  [/password should be|weak password|pwned|leaked/i, 'Password troppo debole o troppo comune: usa almeno 10 caratteri, con lettere e numeri'], [/rate limit|too many/i, 'Troppi tentativi: riprova tra qualche minuto'],
  [/captcha/i, 'Completa la verifica anti-bot e riprova'], [/same.*password/i, 'La nuova password deve essere diversa da quella attuale'],
  [/invalid.*email|unable to validate email/i, 'Inserisci un indirizzo email valido'], [/failed to fetch|network/i, 'Supabase non raggiungibile: controlla la connessione'],
];
const it = (m: string) => IT.find(([re]) => re.test(m))?.[1] ?? m;
export const MIN_PW = 10;
type Mode = 'login' | 'register' | 'reset' | 'newpass';

// recovery: si arriva dal link dell'email "Password dimenticata" (c'è già una sessione temporanea): si sceglie la nuova password
export default function AuthPage({ onDone, recovery }: { onDone: (email: string) => void; recovery?: boolean }) {
  const [mode, setMode] = useState<Mode>(recovery ? 'newpass' : 'login'), [email, setEmail] = useState(''), [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [agree, setAgree] = useState(false), [err, setErr] = useState(''), [info, setInfo] = useState(''), [busy, setBusy] = useState(false), [privacy, setPrivacy] = useState(false);
  const [token, setToken] = useState(''), [tries, setTries] = useState(0);
  const go = (m: Mode) => { setMode(m); setErr(''); setInfo(''); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setInfo('');
    if ((mode === 'register' || mode === 'newpass') && pw !== pw2) { setErr('Le due password non coincidono'); return; }
    if ((mode === 'register' || mode === 'newpass') && pw.length < MIN_PW) { setErr(`La password deve avere almeno ${MIN_PW} caratteri`); return; }
    if (CAPTCHA_KEY && mode !== 'newpass' && !token) { setErr('Completa la verifica anti-bot'); return; }
    setBusy(true);
    const addr = email.trim().toLowerCase(), captchaToken = token || undefined;
    try {
      if (mode === 'login') { const { data, error } = await supabase.auth.signInWithPassword({ email: addr, password: pw, options: { captchaToken } }); if (error) throw error; onDone(data.user.email!); }
      else if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email: addr, password: pw, options: { emailRedirectTo: location.origin, captchaToken } }); if (error) throw error;
        // con la conferma via email attiva non c'è ancora una sessione
        if (data.session) onDone(data.user!.email!); else { setInfo('Ti abbiamo mandato un’email: apri il link per confermare l’account, poi accedi.'); setMode('login'); setPw(''); setPw2(''); }
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: location.origin, captchaToken }); if (error) throw error;
        setInfo('Se l’indirizzo è registrato, ti arriva un’email con il link per scegliere una nuova password.');
      } else {
        const { data, error } = await supabase.auth.updateUser({ password: pw }); if (error) throw error;
        history.replaceState(null, '', location.pathname); onDone(data.user.email!);
      }
    } catch (e: any) { setErr(it(e.message)); }
    setTries(t => t + 1); // il codice anti-bot vale una volta sola
    setBusy(false);
  };
  if (privacy) return <div className="auth"><div className="auth-box" style={{ maxWidth: 640 }}><Privacy /><button className="b" onClick={() => setPrivacy(false)}>Torna all’accesso</button></div></div>;
  const reg = mode === 'register', setsPw = reg || mode === 'newpass';
  const intro = { login: 'Accedi per vedere la tua collezione e i tuoi mazzi.', register: 'Crea il tuo account: la collezione e i mazzi saranno solo tuoi.',
    reset: 'Scrivi l’email del tuo account: ti mandiamo un link per scegliere una nuova password.', newpass: 'Scegli la nuova password del tuo account.' }[mode];
  return <div className="auth">
    <div className="auth-box">
      <img src="/icons/icon-192.png" alt="" width={64} height={64} style={{ borderRadius: 16, margin: '0 auto 12px' }} />
      <h1 className="auth-title">MTG Commander Archive</h1>
      <p className="m" style={{ textAlign: 'center', margin: '0 0 18px' }}>{intro}</p>
      {(mode === 'login' || reg) && <div className="seg" role="tablist">
        <button role="tab" aria-selected={!reg} className={!reg ? 'on' : ''} onClick={() => go('login')}>Accedi</button>
        <button role="tab" aria-selected={reg} className={reg ? 'on' : ''} onClick={() => go('register')}>Registrati</button></div>}
      <form onSubmit={submit} className="auth-form">
        {mode !== 'newpass' && <label className="field"><span>Email</span>
          <input type="email" inputMode="email" autoComplete={reg ? 'email' : 'username'} autoCapitalize="off" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {mode !== 'reset' && <label className="field"><span>{mode === 'newpass' ? 'Nuova password' : 'Password'}</span>
          <input type="password" autoComplete={setsPw ? 'new-password' : 'current-password'} required minLength={setsPw ? MIN_PW : undefined} maxLength={72} value={pw} onChange={e => setPw(e.target.value)} />
          {setsPw && <small>Almeno {MIN_PW} caratteri. Meglio una frase o un mix di lettere, numeri e simboli.</small>}</label>}
        {setsPw && <label className="field"><span>Ripeti la password</span>
          <input type="password" autoComplete="new-password" required maxLength={72} value={pw2} onChange={e => setPw2(e.target.value)} /></label>}
        {reg && <label style={{ alignItems: 'flex-start', fontSize: 14.5, fontWeight: 400 }}><input type="checkbox" required checked={agree} onChange={e => setAgree(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Ho letto l’<button type="button" className="ghost" style={{ padding: 0, minHeight: 0, display: 'inline', fontSize: 'inherit' }} onClick={() => setPrivacy(true)}>informativa sulla privacy</button>.</span></label>}
        {mode !== 'newpass' && <Captcha onToken={setToken} reset={tries} />}
        {err && <p className="er" role="alert" style={{ margin: 0 }}>{err}</p>}
        {info && <p className="ok" role="status" style={{ margin: 0 }}>{info}</p>}
        <button className="b" type="submit" disabled={busy || (reg && !agree)}>{busy ? 'Attendi…' : { login: 'Accedi', register: 'Crea account', reset: 'Mandami il link', newpass: 'Salva la nuova password' }[mode]}</button>
      </form>
      <div className="bar" style={{ justifyContent: 'center', marginBottom: 0 }}>
        {mode === 'login' && <button className="ghost small" onClick={() => go('reset')}>Password dimenticata?</button>}
        {mode === 'reset' && <button className="ghost small" onClick={() => go('login')}>Torna all’accesso</button>}
        <button className="ghost small" onClick={() => setPrivacy(true)}>Privacy</button>
      </div>
    </div></div>;
}
