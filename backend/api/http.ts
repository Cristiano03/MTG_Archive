import type { NextFunction, Request, Response } from 'express';
// avvolge una rotta asincrona: gli errori vanno al gestore. Se la funzione non risponde, si passa alla successiva.
export const w = (f: (q: Request, s: Response) => Promise<any>) => (q: Request, s: Response, n: NextFunction) => { f(q, s).then(() => { if (!s.headersSent) n(); }, n); };
export const errorHandler = (e: any, _q: Request, s: Response, _n: NextFunction) => {
  if (e.code === '23514') return s.status(409).json({ error: e.message });
  if (e.code === '22P02') return s.status(400).json({ error: 'Identificativo non valido' });
  if (!e.status) console.error(e);
  s.status(e.status ?? 500).json({ error: e.status ? e.message : 'Errore interno', ...(e.assigned && { assigned: e.assigned }) });
};
