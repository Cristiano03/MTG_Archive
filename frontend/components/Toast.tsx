import { useEffect, useState } from 'react';
// Conferme brevi ("Aggiunta Sol Ring") che spariscono da sole, senza spostare la pagina.
export const toast = (text: string, tone?: 'er') => dispatchEvent(new CustomEvent('toast', { detail: { text, tone } }));
export default function Toaster() {
  const [t, setT] = useState<{ text: string; tone?: string; k: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    const h = (e: Event) => { const d = (e as CustomEvent).detail; setT({ ...d, k: Date.now() }); clearTimeout(timer); timer = window.setTimeout(() => setT(null), 2600); };
    addEventListener('toast', h); return () => { removeEventListener('toast', h); clearTimeout(timer); };
  }, []);
  return t ? <div key={t.k} className={'toast ' + (t.tone ?? '')} role="status">{t.text}</div> : null;
}
