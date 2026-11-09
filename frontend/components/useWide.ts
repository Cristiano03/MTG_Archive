import { useEffect, useState } from 'react';
// true su tablet e computer (navigazione in alto), false sul telefono
const Q = '(min-width: 900px)';
export function useWide() {
  const [w, setW] = useState(() => matchMedia(Q).matches);
  useEffect(() => { const m = matchMedia(Q), h = () => setW(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  return w;
}
