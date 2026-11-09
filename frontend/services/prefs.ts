import { useState } from 'react';
// Preferenze di visualizzazione ricordate su questo dispositivo (ordinamento ecc.). Se lo storage non è disponibile, valgono per la sessione.
export function usePref<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem('pref.' + key); if (!s) return init; const x = JSON.parse(s);
    // oggetti (es. ordinamento): si uniscono ai valori iniziali; valori semplici (es. 'list' / 'grid'): solo se dello stesso tipo
    if (init && typeof init === 'object') return x && typeof x === 'object' ? { ...init, ...x } : init;
    return typeof x === typeof init ? x : init; } catch { return init; } });
  return [v, (x: T) => { setV(x); try { localStorage.setItem('pref.' + key, JSON.stringify(x)); } catch { /* ignorato */ } }];
}
