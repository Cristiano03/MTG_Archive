import { Router } from 'express';
import { w } from './http.js';
export const router = Router();
import { tx } from '../database/pool.js';
import { previewImport } from '../services/card-catalog/import-text.js';
import { commitImport } from '../services/inventory/import-commit.js';
import { migrateHtmlBackup } from '../database/legacy-migration.js';
import { uidOf } from '../services/auth.js';

router.post('/import/preview', w(async (q, s) => s.json(await previewImport(String(q.body.text ?? '')))));
router.post('/import/commit', w(async (q, s) => s.json(await tx(c => commitImport(c, uidOf(q), q.body)))));
// migrazione una tantum dal backup JSON della versione HTML (solo su database vuoto)
router.post('/import/migrate', w(async (q, s) => s.json(await tx(c => migrateHtmlBackup(c, uidOf(q), q.body)))));
