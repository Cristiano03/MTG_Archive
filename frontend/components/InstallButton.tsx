import { useEffect, useState } from 'react';
// Mostra "Installa app" dove il browser lo consente (Chrome/Edge/Android); su iPhone spiega come fare.
export default function InstallButton() {
  const [ev, setEv] = useState<any>(null), [done, setDone] = useState(false);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEv(e); };
    addEventListener('beforeinstallprompt', h); addEventListener('appinstalled', () => setDone(true));
    return () => removeEventListener('beforeinstallprompt', h);
  }, []);
  if (standalone || done) return null;
  if (ev) return <div className="card">Puoi installare il sito come app.<div className="bar"><button className="b" onClick={async () => { ev.prompt(); await ev.userChoice; setEv(null); }}>Installa app</button></div></div>;
  if (ios && location.protocol === 'https:') return <div className="card m">Per installarla su iPhone: tocca <b>Condividi</b> e poi <b>Aggiungi alla schermata Home</b>.</div>;
  return null;
}
