import { useRef, type ReactNode } from 'react';
// Grafica delle carte per il telefono: simboli ufficiali del mana (da Scryfall), etichette dei colori, carta in 3D che segue il dito.
export const SYM = (s: string) => `https://svgs.scryfall.io/card-symbols/${s.replace(/\//g, '')}.svg`;
export const ORDER = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_IT: Record<string, string> = { W: 'Bianco', U: 'Blu', B: 'Nero', R: 'Rosso', G: 'Verde', C: 'Incolore' };
export const COLOR_ADJ: Record<string, [string, string]> = { W: ['bianca', 'bianche'], U: ['blu', 'blu'], B: ['nera', 'nere'], R: ['rossa', 'rosse'], G: ['verde', 'verdi'], C: ['incolore', 'incolori'] };
export const sortCi = (ci: string[] = []) => ORDER.filter(c => ci.includes(c));
// immagine più grande a partire da quella piccola salvata nel catalogo
export const big = (src?: string | null, size: 'normal' | 'large' | 'art_crop' = 'normal') => src ? src.replace('/small/', `/${size}/`) : '';
export const imgOf = (c: any, size = 'normal') => c?.image_uris?.[size] ?? c?.card_faces?.[0]?.image_uris?.[size] ?? '';
// colori di una carta come sfumatura (per bagliori e sfondi)
export const glow = (ci: string[] = []) => { const s = sortCi(ci), l = (s.length ? s : ['C']).map(c => `var(--mana-${c.toLowerCase()})`); return l.length === 1 ? `${l[0]}, ${l[0]}` : l.join(', '); };

export function Sym({ s, size = 18 }: { s: string; size?: number }) {
  return <img className="sym" src={SYM(s)} width={size} height={size} alt={s} loading="lazy" />;
}
// testo con {W}{2}… al posto dei simboli; il testo di promemoria tra parentesi in corsivo
export function ManaText({ text }: { text: string }) {
  return <>{text.split(/(\{[^}]+\}|\([^)]*\))/g).map((t, i) => /^\{[^}]+\}$/.test(t) ? <Sym key={i} s={t.slice(1, -1)} size={16} />
    : /^\(.*\)$/.test(t) ? <i key={i} className="reminder">{t}</i> : t)}</>;
}
export function ColorTags({ ci }: { ci?: string[] }) {
  const s = sortCi(ci);
  return <span className="ctags">{(s.length ? s : ['C']).map(c => <span key={c} className={'ctag c-' + c}><Sym s={c} size={14} />{COLOR_IT[c]}</span>)}</span>;
}
// nome diviso come nel prototipo: "Atraxa" grande, "Praetors' Voice" sotto
export function SplitName({ name }: { name: string }) {
  const n = name.split(' // ')[0], k = n.indexOf(', ');
  return <div className="splitname"><b>{k > 0 ? n.slice(0, k) : n}</b>{k > 0 && <span>{n.slice(k + 2)}</span>}</div>;
}
// carta che si inclina seguendo il puntatore o il dito, con un riflesso; da ferma ondeggia piano
export function Card3D({ src, onClick, className = '', children }: { src: string; onClick?: () => void; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (rx: number, ry: number, mx: number, my: number) => { const s = ref.current?.style; if (!s) return;
    s.setProperty('--rx', rx + 'deg'); s.setProperty('--ry', ry + 'deg'); s.setProperty('--mx', mx + '%'); s.setProperty('--my', my + '%'); };
  const move = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return; const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) - .5, y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) - .5;
    el.classList.add('tilt'); set(-y * 20, x * 24, (x + .5) * 100, (y + .5) * 100);
  };
  const leave = () => { ref.current?.classList.remove('tilt'); set(0, 0, 50, 30); };
  return <div ref={ref} className={'card3d ' + className} onPointerMove={move} onPointerDown={move} onPointerLeave={leave} onPointerUp={leave} onPointerCancel={leave} onClick={onClick}>
    {src ? <img src={src} alt="" draggable={false} /> : <span className="card3d-empty" />}<span className="shine" />{children}</div>;
}
