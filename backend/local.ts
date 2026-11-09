// Avvio locale SENZA Docker: PostgreSQL incorporato + API + frontend, con un solo comando (npm start).
// I dati restano in backend/.data/postgres anche dopo lo spegnimento.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..');
const dataDir = join(here, '.data', 'postgres'), PG_PORT = 5433;

// 1. file .env: creati una sola volta con chiavi casuali
const env = (file: string) => Object.fromEntries((existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n')
  .map(l => l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m![1], m![2]]));
const beFile = join(here, '.env'), feFile = join(root, 'frontend', '.env');
const be = env(beFile);
if (!be.SESSION_SECRET || !be.DB_PASSWORD || !be.DATABASE_URL?.includes(':' + PG_PORT + '/')) {
  be.DB_PASSWORD ||= randomBytes(12).toString('hex');
  be.SESSION_SECRET ||= randomBytes(32).toString('hex'); // firma dei cookie di accesso
  delete be.API_KEY; // non più usata: l'accesso ora è con email e password
  be.DATABASE_URL = `postgres://mtg:${be.DB_PASSWORD}@127.0.0.1:${PG_PORT}/mtg`;
  be.PORT ||= '3000';
  writeFileSync(beFile, Object.entries(be).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}
const fe = env(feFile);
if (fe.API_URL !== `http://127.0.0.1:${be.PORT}` || fe.API_KEY) writeFileSync(feFile, `API_URL=http://127.0.0.1:${be.PORT}\n`);
Object.assign(process.env, be);
process.env.BACKUP_DIR ??= join(here, '.data', 'backups'); // copie automatiche giornaliere

// 2. PostgreSQL incorporato (al primo avvio scarica i binari e crea database e schema)
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'mtg', password: be.DB_PASSWORD, port: PG_PORT, persistent: true, onLog: () => {} });
const first = !existsSync(join(dataDir, 'PG_VERSION'));
if (first) { mkdirSync(dirname(dataDir), { recursive: true }); console.log('Primo avvio: preparo il database…'); await pg.initialise(); }
await pg.start();
if (first) { await pg.createDatabase('mtg'); console.log('Database creato.'); } // lo schema lo crea il server all'avvio
console.log(`PostgreSQL attivo su 127.0.0.1:${PG_PORT}`);

// 3. API (stesso processo) e frontend Vite (processo figlio)
await import('./api/server.js');
const vite = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const web = spawn(vite, [], { cwd: join(root, 'frontend'), stdio: 'inherit', shell: process.platform === 'win32' });

let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; console.log('\nSpengo…'); web.kill(); await pg.stop().catch(() => {}); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
web.on('exit', stop);
