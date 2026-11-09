import { Router } from 'express';
import { w } from './http.js';
export const router = Router();
import { tx } from '../database/pool.js';
import { ensurePrinting, refreshLegality } from '../services/card-catalog/scryfall.js';

router.post('/catalog/printings', w(async (q, s) => s.json(await tx(async c => { await ensurePrinting(c, q.body.id); return (await c.query('select c.*,p.id printing_id from printings p join cards c on c.oracle_id=p.oracle_id where p.id=$1', [q.body.id])).rows[0]; }))));

// aggiorna la legalità Commander di tutte le carte in catalogo
router.post('/catalog/refresh', w(async (_q, s) => s.json(await refreshLegality())));
