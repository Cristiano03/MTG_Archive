import { useState } from 'react';
// Preferenze di visualizzazione ricordate su questo dispositivo (ordinamento ecc.). Se lo storage non è disponibile, valgono per la sessione.
export function usePref<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem('pref.' + key); return s ? { ...init, ...JSON.parse(s) } : init; } catch { return init; } });
  return [v, (x: T) => { setV(x); try { localStorage.setItem('pref.' + key, JSON.stringify(x)); } catch { /* ignorato */ } }];
}
