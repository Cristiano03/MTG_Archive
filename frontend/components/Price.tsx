import Icon from './Icon';
// Valore in euro ai prezzi di riferimento Cardmarket (pubblicati da Scryfall), con data e copie senza prezzo.
export const eur = (x: any) => x == null ? '' : Number(x).toLocaleString('it', { style: 'currency', currency: 'EUR' });
export type Value = { eur: number; unpriced: number; oldest: string | null; never: number };
// prezzi da aggiornare: mai scaricati o più vecchi di 20 ore
export const stalePrices = (v?: Value) => !!v && (v.never > 0 || !v.oldest || Date.now() - new Date(v.oldest).getTime() > 20 * 3600e3);
export function ValueCard({ title, v, busy, onRefresh }: { title: string; v?: Value; busy: boolean; onRefresh: () => void }) {
  if (!v) return null;
  return <div className="card"><b>{title}</b>
    <div className="count">{busy && !v.oldest ? '…' : eur(v.eur)}</div>
    <p className="m" style={{ margin: '4px 0 10px', fontSize: 14 }}>
      Prezzi di riferimento Cardmarket in euro (tramite Scryfall){v.oldest ? `, aggiornati il ${new Date(v.oldest).toLocaleDateString('it')}` : ''}. È una stima, non un prezzo garantito.
      {v.unpriced > 0 && ` ${v.unpriced === 1 ? '1 copia senza prezzo' : `${v.unpriced} copie senza prezzo`} (non contate).`}</p>
    <button disabled={busy} onClick={onRefresh}><Icon name="refresh" />{busy ? 'Aggiornamento prezzi…' : 'Aggiorna prezzi'}</button></div>;
}
