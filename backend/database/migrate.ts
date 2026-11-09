// Crea o aggiorna lo schema. Viene eseguito una volta all'avvio (in locale) o alla prima richiesta (su Netlify).
import { pool, tx, log } from './pool.js';
import { SCHEMA, UPGRADES } from './schema.js';
import { dedupeCommanders } from '../services/inventory/decks.js';
export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(424242)'); // evita che due avvii simultanei aggiornino lo schema insieme
    await c.query(SCHEMA);
    for (const s of UPGRADES) await c.query(s);
  } finally { await c.query('select pg_advisory_unlock(424242)').catch(() => {}); c.release(); }
  // correzione dati: comandanti registrati anche tra le carte normali
  const fixed = await tx(async c => { const d = await dedupeCommanders(c); if (d.length) await log(c, 'fix.commander_duplicates', { decks: d }); return d; });
  if (fixed.length) console.log(`Tolte le copie doppie dei comandanti in ${fixed.length} mazzi.`);
}
let once: Promise<void> | null = null;
// per Netlify: esegue migrate() una sola volta per istanza, alla prima richiesta
export const ensureMigrated = () => (once ??= migrate().catch(e => { once = null; throw e; }));
