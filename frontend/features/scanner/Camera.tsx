import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { guideRect, TITLE } from './recognize';
// Fotocamera posteriore con sagoma della carta e della barra del nome da allineare.
export type CameraHandle = { video: HTMLVideoElement | null };
// reserve: spazio da lasciare libero sotto la fotocamera (barra delle azioni, schede): così non si deve mai scorrere.
export default forwardRef<CameraHandle, { reserve?: number; children?: ReactNode }>(function Camera({ reserve = 250, children }, ref) {
  const box = useRef<HTMLDivElement>(null), [avail, setAvail] = useState({ w: 360, h: 400 });
  useLayoutEffect(() => {
    const m = () => { const el = box.current; if (!el) return; const r = el.getBoundingClientRect();
      setAvail({ w: el.parentElement?.clientWidth ?? r.width, h: Math.max(220, window.innerHeight - r.top - reserve) }); };
    m(); addEventListener('resize', m); return () => removeEventListener('resize', m);
  }, [reserve]);
  const v = useRef<HTMLVideoElement>(null), [err, setErr] = useState(''), [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null), [torch, setTorch] = useState(false);
  useImperativeHandle(ref, () => ({ get video() { return v.current; } }), []);
  useEffect(() => {
    let stream: MediaStream | null = null, alive = true;
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Fotocamera non disponibile: serve HTTPS (o localhost) e un browser recente.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(s => { if (!alive) { s.getTracks().forEach(t => t.stop()); return; } stream = s; setTrack(s.getVideoTracks()[0]); if (v.current) { v.current.srcObject = s; v.current.play().catch(() => {}); } })
      .catch(e => setErr(e.name === 'NotAllowedError' ? 'La fotocamera è bloccata. Su iPhone: Impostazioni › Safari › Fotocamera › Consenti, poi ricarica la pagina.'
        : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'Nessuna fotocamera trovata su questo dispositivo.' : 'La fotocamera non si apre: ' + (e.message || e.name)));
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  const canTorch = !!(track as any)?.getCapabilities?.().torch;
  const toggleTorch = async () => { try { await track!.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { /* non supportato */ } };
  if (err) return <div ref={box} className="card er">{err}</div>;
  const g = dim ? guideRect(dim.w, dim.h) : null;
  const maxW = dim ? Math.min(avail.w, 860, (avail.h * dim.w) / dim.h) : undefined;
  return <div ref={box} style={{ position: 'relative', width: maxW, maxHeight: avail.h, margin: '0 auto', overflow: 'hidden', borderRadius: 10 }}>
    <video ref={v} playsInline muted autoPlay style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, background: '#000' }}
      onLoadedMetadata={e => setDim({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })} />
    {g && <div style={{ position: 'absolute', left: g.x * 100 + '%', top: g.y * 100 + '%', width: g.w * 100 + '%', height: g.h * 100 + '%', border: '2px solid #fff', borderRadius: 12, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: TITLE.x * 100 + '%', top: TITLE.y * 100 + '%', width: TITLE.w * 100 + '%', height: TITLE.h * 100 + '%', border: '2px dashed #9b86ff', borderRadius: 4 }} /></div>}
    {canTorch && <button onClick={toggleTorch} style={{ position: 'absolute', right: 8, bottom: 8 }}>{torch ? 'Torcia off' : 'Torcia'}</button>}
    {children}
  </div>;
});
