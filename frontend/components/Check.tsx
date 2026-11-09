// Cerchio di selezione (modalità "Seleziona").
export default function Check({ on }: { on: boolean }) {
  return <span className={'check' + (on ? ' on' : '')} aria-hidden="true">{on && <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17l9-10" /></svg>}</span>;
}
