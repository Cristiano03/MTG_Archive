import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
// Scheda che sale dal basso (come su iOS): il contenuto scorre dentro, le azioni restano in fondo, vicino al pollice.
export default function Sheet({ title, children, actions, onClose }: { title: string; children: ReactNode; actions?: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k);
    return () => { document.body.style.overflow = prev; removeEventListener('keydown', k); };
  }, [onClose]);
  return createPortal(<div className="sheet-wrap" onClick={onClose}>
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="sheet-grip" aria-hidden="true" />
      <h2 className="sheet-title">{title}</h2>
      <div className="sheet-body">{children}</div>
      {actions && <div className="sheet-actions">{actions}</div>}
    </div></div>, document.body);
}
