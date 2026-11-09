// Account: password con scrypt (node:crypto), sessione in un cookie firmato (HttpOnly). Niente librerie esterne.
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { pool, tx, log } from '../database/pool.js';
import { err } from './errors.js';
const scrypt = promisify(_scrypt) as (p: string, s: Buffer, n: number) => Promise<Buffer>;
// '__session' è l'unico nome di cookie che Firebase Hosting inoltra al server
const COOKIE = '__session', DAYS = 60;
const secret = () => { const s = process.env.SESSION_SECRET; if (!s || s.length < 32) throw err(500, 'SESSION_SECRET mancante o troppo corto (servono almeno 32 caratteri)'); return s; };

export async function hashPassword(pw: string) { const salt = randomBytes(16); return `s1$${salt.toString('base64')}$${(await scrypt(pw, salt, 64)).toString('base64')}`; }
export async function checkPassword(pw: string, stored: string) {
  const [v, salt, hash] = stored.split('$'); if (v !== 's1') return false;
  const h = await scrypt(pw, Buffer.from(salt, 'base64'), 64), ref = Buffer.from(hash, 'base64');
  return h.length === ref.length && timingSafeEqual(h, ref);
}
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');
function setSession(q: Request, s: Response, uid: number) {
  const data = Buffer.from(JSON.stringify({ uid, exp: Date.now() + DAYS * 864e5 })).toString('base64url');
  const secure = q.secure || q.header('x-forwarded-proto') === 'https' || !!process.env.NETLIFY || !!process.env.K_SERVICE;
  s.cookie(COOKIE, `${data}.${sign(data)}`, { httpOnly: true, sameSite: 'lax', secure, maxAge: DAYS * 864e5, path: '/' });
}
function readSession(q: Request): number | null {
  const raw = (q.headers.cookie ?? '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1); if (!raw) return null;
  const [data, sig] = decodeURIComponent(raw).split('.'); if (!data || !sig) return null;
  const good = Buffer.from(sign(data)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  try { const p = JSON.parse(Buffer.from(data, 'base64url').toString()); return p.exp > Date.now() ? Number(p.uid) : null; } catch { return null; }
}
// tutte le rotte dei dati richiedono un utente collegato; l'id finisce in req.uid
export function requireAuth(q: Request, s: Response, n: NextFunction) {
  const uid = readSession(q); if (!uid) return s.status(401).json({ error: 'Accesso richiesto' });
  (q as any).uid = uid; n();
}
export const uidOf = (q: Request) => (q as any).uid as number;

// freno ai tentativi: dopo 5 errori dallo stesso indirizzo, 1 minuto di attesa (in memoria: vale per istanza)
const fails = new Map<string, { n: number; until: number }>();
const ip = (q: Request) => String(q.header('x-nf-client-connection-ip') ?? q.header('x-forwarded-for') ?? q.ip ?? '').split(',')[0].trim();
const throttle = (q: Request) => { const f = fails.get(ip(q)); if (f && f.until > Date.now()) throw err(429, 'Troppi tentativi: riprova tra un minuto'); };
const failed = (q: Request) => { const k = ip(q), f = fails.get(k) ?? { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + 60e3; f.n = 0; } fails.set(k, f); };
const normEmail = (e: any) => String(e ?? '').trim().toLowerCase();

export async function register(q: Request, s: Response) {
  throttle(q);
  const email = normEmail(q.body?.email), password = String(q.body?.password ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err(400, 'Inserisci un indirizzo email valido');
  if (password.length < 8) throw err(400, 'La password deve avere almeno 8 caratteri');
  const r = await tx(async c => {
    await c.query('lock table users in exclusive mode');
    const count = +(await c.query('select count(*) n from users')).rows[0].n;
    if (count > 0 && process.env.ALLOW_SIGNUP === 'false') throw err(403, 'Le registrazioni sono chiuse');
    if ((await c.query('select 1 from users where email=$1', [email])).rowCount) throw err(409, 'Esiste già un account con questa email');
    const uid = Number((await c.query('insert into users(email,password_hash) values($1,$2) returning id', [email, await hashPassword(password)])).rows[0].id);
    // il primo account eredita i dati creati prima che esistessero gli account
    if (count === 0) for (const t of ['collection_items', 'decks', 'wishlist', 'transactions']) await c.query(`update ${t} set user_id=$1 where user_id is null`, [uid]);
    await log(c, 'auth.register', { first: count === 0 }, uid);
    return { uid, first: count === 0 };
  });
  setSession(q, s, r.uid); s.json({ email, first: r.first });
}
export async function login(q: Request, s: Response) {
  throttle(q);
  const email = normEmail(q.body?.email), password = String(q.body?.password ?? '');
  const u = (await pool.query('select id,password_hash from users where email=$1', [email])).rows[0];
  if (!u || !(await checkPassword(password, u.password_hash))) { failed(q); throw err(401, 'Email o password non corrette'); }
  setSession(q, s, Number(u.id)); s.json({ email });
}
export function logout(_q: Request, s: Response) { s.clearCookie(COOKIE, { path: '/' }); s.json({ ok: true }); }
export async function me(q: Request, s: Response) {
  const uid = readSession(q); if (!uid) return s.status(401).json({ error: 'Accesso richiesto' });
  const u = (await pool.query('select email from users where id=$1', [uid])).rows[0]; if (!u) return s.status(401).json({ error: 'Account non trovato' });
  s.json({ email: u.email, signupOpen: process.env.ALLOW_SIGNUP !== 'false' });
}
export async function signupStatus(_q: Request, s: Response) {
  const count = +(await pool.query('select count(*) n from users')).rows[0].n;
  s.json({ hasUsers: count > 0, signupOpen: count === 0 || process.env.ALLOW_SIGNUP !== 'false' });
}
export async function changePassword(q: Request, s: Response) {
  const uid = uidOf(q), cur = String(q.body?.current ?? ''), next = String(q.body?.password ?? '');
  if (next.length < 8) throw err(400, 'La nuova password deve avere almeno 8 caratteri');
  const u = (await pool.query('select password_hash from users where id=$1', [uid])).rows[0];
  if (!u || !(await checkPassword(cur, u.password_hash))) throw err(401, 'La password attuale non è corretta');
  await pool.query('update users set password_hash=$2 where id=$1', [uid, await hashPassword(next)]); s.json({ ok: true });
}
