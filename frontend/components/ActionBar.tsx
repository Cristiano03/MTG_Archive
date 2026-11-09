import type { ReactNode } from 'react';
// Azioni principali della pagina: restano in basso, sopra le schede, dove arriva il pollice.
export default function ActionBar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'actionbar ' + className}>{children}</div>;
}
