import Icon from './Icon';
// Quantità con pulsanti grandi (44 pt) per il pollice.
export default function Stepper({ value, onMinus, onPlus, label }: { value: number; onMinus: () => void; onPlus: () => void; label?: string }) {
  return <span className="stepper" role="group" aria-label={label ?? 'Quantità'}>
    <button aria-label="Togli uno" onClick={e => { e.stopPropagation(); onMinus(); }}><Icon name="minus" /></button>
    <output>{value}</output>
    <button aria-label="Aggiungi uno" onClick={e => { e.stopPropagation(); onPlus(); }}><Icon name="plus" /></button></span>;
}
