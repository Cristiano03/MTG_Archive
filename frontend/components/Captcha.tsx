import { useEffect, useRef } from 'react';
// Protezione anti-bot (Cloudflare Turnstile) per registrazione, accesso e recupero password. È facoltativa: si attiva mettendo
// VITE_TURNSTILE_SITE_KEY in frontend/.env e la chiave segreta in Supabase (Authentication → Attack Protection), vedi docs/sicurezza.md.
export const CAPTCHA_KEY = (import.meta.env?.VITE_TURNSTILE_SITE_KEY as string | undefined) || '';
declare global { interface Window { turnstile?: any } }
let loading: Promise<void> | null = null;
const load = () => loading ??= new Promise((ok, ko) => {
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
  s.onload = () => ok(); s.onerror = () => { loading = null; ko(new Error('Verifica anti-bot non caricata')); };
  document.head.appendChild(s);
});
// onToken riceve il codice da passare a Supabase (captchaToken); reset cambia a ogni tentativo, perché un codice vale una volta sola
export default function Captcha({ onToken, reset }: { onToken: (t: string) => void; reset: number }) {
  const box = useRef<HTMLDivElement>(null), id = useRef<string | null>(null);
  useEffect(() => {
    if (!CAPTCHA_KEY) return;
    let live = true;
    load().then(() => { if (live && box.current && window.turnstile && id.current === null)
      id.current = window.turnstile.render(box.current, { sitekey: CAPTCHA_KEY, language: 'it', callback: onToken, 'expired-callback': () => onToken('') }); }).catch(() => {});
    return () => { live = false; if (id.current !== null) window.turnstile?.remove(id.current); id.current = null; };
  }, []);
  useEffect(() => { if (reset && id.current !== null) { window.turnstile?.reset(id.current); onToken(''); } }, [reset]);
  return CAPTCHA_KEY ? <div ref={box} style={{ minHeight: 65 }} /> : null;
}
