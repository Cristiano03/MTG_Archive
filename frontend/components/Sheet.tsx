import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
// Scheda che sale dal basso (come su iOS): il contenuto scorre dentro, le azioni restano in fondo, vicino al pollice.
export default function Sheet({ title, sub, head, children, actions, onClose }: { title: string; sub?: string; head?: ReactNode; children: ReactNode; actions?: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k);
    return () => { document.body.style.overflow = prev; removeEventListener('keydown', k); };
  }, [onClose]);
  return createPortal(<div className="sheet-wrap" onClick={onClose}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="sheet-grip" aria-hidden="true" />
      <div className="sheet-head"><div className="g">{head ?? <><h2 className="sheet-title">{title}</h2>{sub && <p className="m sheet-sub">{sub}</p>}</>}</div>
        <button className="icon" aria-label="Chiudi" onClick={onClose}><Icon name="close" /></button></div>
      <div className="sheet-body">{children}</div>
      {actions && <div className="sheet-actions">{actions}</div>}
    </div></div>, document.body);
}
