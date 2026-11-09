// Avvio del server su un computer (npm start / npm run dev:api): schema, backup automatici, completamento dati carte.
import { app } from './app.js';
import { migrate } from '../database/migrate.js';
import { scheduleBackups } from '../services/backup.js';
import { backfillCardData } from '../services/card-catalog/scryfall.js';
if (!process.env.SESSION_SECRET) throw new Error('Imposta SESSION_SECRET (almeno 32 caratteri)');
await migrate();
scheduleBackups();
app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => {
  console.log('API pronta');
  backfillCardData().then(n => n && console.log(`Costo di mana e colori completati per ${n} carte.`)).catch(e => console.warn('Completamento dati carte rimandato:', e.message));
});
