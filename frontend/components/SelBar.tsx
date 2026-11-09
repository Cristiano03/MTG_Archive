import Icon from './Icon';
// Azioni sulle carte selezionate: in basso al posto della barra delle sezioni, tutte in vista.
export type SelAction = { icon: string; label: string; onClick: () => void; tone?: 'b' | 'danger'; disabled?: boolean };
export default function SelBar({ actions }: { actions: SelAction[] }) {
  return <nav className="selbar" aria-label="Azioni sulle carte selezionate">{actions.map(a =>
    <button key={a.label} className={a.tone ?? ''} disabled={a.disabled} onClick={a.onClick}><Icon name={a.icon} />{a.label}</button>)}</nav>;
}
