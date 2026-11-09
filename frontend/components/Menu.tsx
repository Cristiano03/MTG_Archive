import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
// Menu a tendina: si apre sotto il pulsante, o sopra se sotto non c'è spazio (es. nella barra in basso).
export type MenuItem = { icon: string; label: string; sub?: string; onClick: () => void; tone?: 'danger'; hidden?: boolean } | 'sep';
export default function Menu({ items, label, children, className = 'icon' }: { items: MenuItem[]; label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false), [pos, setPos] = useState<React.CSSProperties>({});
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect(), h = pop.current.offsetHeight, w = pop.current.offsetWidth, gap = 6;
    const below = innerHeight - r.bottom, up = below < h + gap + 12 && r.top > below;
    const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
    setPos(up ? { left, bottom: innerHeight - r.top + gap, maxHeight: r.top - gap - 12 } : { left, top: r.bottom + gap, maxHeight: below - gap - 12 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', close, true); addEventListener('keydown', esc); addEventListener('resize', () => setOpen(false), { once: true });
    return () => { removeEventListener('pointerdown', close, true); removeEventListener('keydown', esc); };
  }, [open]);
  const visible = items.filter(i => i === 'sep' || !i.hidden);
  return <>
    <button ref={btn} className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>{children}</button>
    {open && createPortal(<div ref={pop} className="menu" role="menu" style={{ visibility: pos.left === undefined ? 'hidden' : 'visible', ...pos }} onClick={e => e.stopPropagation()}>
      {visible.map((it, i) => it === 'sep' ? <div key={i} className="menu-sep" role="separator" /> :
        <button key={i} role="menuitem" className={'menu-item' + (it.tone === 'danger' ? ' danger-text' : '')} onClick={() => { setOpen(false); it.onClick(); }}>
          <Icon name={it.icon} /><span className="g">{it.label}{it.sub && <small>{it.sub}</small>}</span></button>)}
    </div>, document.body)}
  </>;
}
