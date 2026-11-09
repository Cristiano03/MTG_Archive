// L'applicazione del server, usata sia in locale (api/server.ts) sia su Netlify (netlify/functions/api.ts).
import express from 'express';
import { errorHandler, w } from './http.js';
import { router as collection } from './collection.routes.js';
import { router as decks } from './decks.routes.js';
import { router as catalog } from './catalog.routes.js';
import { router as imports } from './import.routes.js';
import { router as reports } from './reports.routes.js';
import { router as wishlist } from './wishlist.routes.js';
import { ensureMigrated } from '../database/migrate.js';
import { requireAuth, register, login, logout, me, signupStatus, changePassword } from '../services/auth.js';

export const API_VERSION = 8; // aumenta quando il sito ha bisogno di funzioni nuove del server
export const app = express();
app.set('trust proxy', true);
// su Netlify/Firebase le richieste arrivano come /api/... (o /.netlify/functions/api/...): si toglie il prefisso
app.use((q, _s, n) => { q.url = q.url.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '').replace(/^\/api(?=\/|$)/, '') || '/'; n(); });
app.use(express.json({ limit: '5mb' }));
// le risposte del server non vanno mai messe in cache (né dal browser né dalla CDN di Firebase/Netlify)
app.use((_q, s, n) => { s.set('Cache-Control', 'private, no-store'); n(); });
app.get('/health', (_q, s) => s.json({ ok: true, version: API_VERSION }));
app.use(w(async (_q, _s) => { await ensureMigrated(); }) as any, (_q, _s, n) => n());
app.get('/auth/status', w(signupStatus));
app.post('/auth/register', w(register));
app.post('/auth/login', w(login));
app.post('/auth/logout', logout);
app.get('/auth/me', w(me));
app.use(requireAuth);
app.post('/auth/password', w(changePassword));
app.use(collection, decks, catalog, imports, reports, wishlist);
app.use(errorHandler);
