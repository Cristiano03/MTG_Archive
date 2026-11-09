// Anteprima locale del sito, senza Supabase: database temporaneo (pg-supabase.ts) con una collezione e dei mazzi di esempio
// presi da Scryfall, e il sito in modalità anteprima (VITE_DEMO=1) che manda le operazioni qui invece che a Supabase.
// Serve a provare la grafica con dati veri. Uso: npm run anteprima, poi apri http://127.0.0.1:5174
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { start, root } from './pg-supabase.js';
import { installMock } from './mock-supabase.js';

const PORT = 5180, uid = randomUUID();
const h = await start();
await h.pool.query(`insert into auth.users values($1,'anteprima@locale')`, [uid]);
await installMock(h, () => uid);
const { route } = await import('../frontend/services/routes.js');
const api = (path: string, method = 'GET', body?: unknown) => route(path, method, body);

// dati di esempio: una collezione, un mazzo fisico, uno virtuale, qualche desiderio
console.log('Preparo i dati di esempio da Scryfall…');
const COLL = `4 Sol Ring
2 Arcane Signet
1 Command Tower
12 Island
9 Swamp
1 Atraxa, Praetors' Voice
1 Lightning Bolt
1 Counterspell
1 Swords to Plowshares
1 Cultivate
1 Rhystic Study
1 Smothering Tithe
1 Cyclonic Rift
1 Demonic Tutor
1 Llanowar Elves
2 Lightning Greaves
1 Swiftfoot Boots
1 Talisman of Dominance
1 Dimir Signet
1 Thought Vessel
1 Mind Stone
1 Fellwar Stone
1 Reliquary Tower
1 Path to Exile
1 Kodama's Reach`;
const prev = (await api('/import/preview', 'POST', { text: COLL })).rows.filter((r: any) => r.printing_id);
await api('/import/commit', 'POST', { target: 'collection', rows: prev.map((r: any) => ({ printing_id: r.printing_id, qty: r.qty })) });
const DECK = `Commander
1 Yuriko, the Tiger's Shadow
Deck
1 Sol Ring
1 Arcane Signet
1 Command Tower
1 Counterspell
1 Rhystic Study
1 Cyclonic Rift
1 Demonic Tutor
1 Dimir Signet
1 Talisman of Dominance
1 Thought Vessel
1 Brainstorm
1 Ponder
1 Preordain
1 Ninja of the Deep Hours
1 Ingenious Infiltrator
1 Fatal Push
8 Island
7 Swamp`;
const d1 = await api('/decks', 'POST', { name: 'Yuriko Ninja', mode: 'physical' });
const dp = (await api('/import/preview', 'POST', { text: DECK })).rows.filter((r: any) => r.printing_id);
await api('/import/commit', 'POST', { target: d1.id, replace: true, addToCollection: 'none', rows: dp.map((r: any) => ({ printing_id: r.printing_id, qty: r.qty, section: r.section })) });
const d2 = await api('/decks', 'POST', { name: 'Atraxa Superfriends', mode: 'virtual' });
const vp = (await api('/import/preview', 'POST', { text: "Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n1 Smothering Tithe\n1 Swords to Plowshares\n1 Cultivate\n1 Doubling Season\n1 The Chain Veil" })).rows.filter((r: any) => r.printing_id);
await api('/import/commit', 'POST', { target: d2.id, replace: true, rows: vp.map((r: any) => ({ printing_id: r.printing_id, qty: r.qty, section: r.section })) });
await api(`/wishlist/from-deck/${d1.id}`, 'POST');
await api('/catalog/refresh', 'POST').catch(() => {});
await api('/prices/collection', 'POST', {}).catch(() => {});
console.log('Dati pronti.');

createServer((q, s) => {
  let body = '';
  q.on('data', c => body += c);
  q.on('end', async () => {
    s.setHeader('Content-Type', 'application/json');
    try { const { path, method, body: b } = JSON.parse(body || '{}'); s.end(JSON.stringify({ ok: await api(path, method, b) ?? null })); }
    catch (e: any) { s.end(JSON.stringify({ error: { message: e.message, status: e.status ?? 500, data: e.data } })); }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Operazioni dell'anteprima su http://127.0.0.1:${PORT}`));

const vite = spawn(join(root, 'node_modules', '.bin', 'vite'), ['--port', '5174'], { cwd: join(root, 'frontend'), stdio: 'inherit', env: { ...process.env, VITE_DEMO: '1' } });
const stop = async () => { vite.kill(); await h.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
