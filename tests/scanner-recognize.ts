// Test della logica pura dello scanner: npx tsx tests/scanner-recognize.ts
import assert from 'node:assert/strict';
import { cleanOcrName, similarity, nameSimilarity, parseFooter, pickPrinting, guideRect, nameCertain } from '../frontend/features/scanner/recognize.ts';
const t = (n: string, f: () => void) => { try { f(); console.log('ok  ', n); } catch (e: any) { console.log('FAIL', n, '\n     ', e.message); process.exitCode = 1; } };
t('pulizia nome con simboli di mana', () => assert.equal(cleanOcrName('Sol Ring  1 }\n'), 'Sol Ring'));
t('pulizia sceglie la riga giusta', () => assert.equal(cleanOcrName('~ .\nRhystic Study 2 U\n'), 'Rhystic Study'));
t('pulizia testo vuoto', () => assert.equal(cleanOcrName('| . 1\n'), ''));
t('accenti e virgole', () => assert.equal(cleanOcrName("Zoraline, Cosmos Caller"), 'Zoraline, Cosmos Caller'));
t('somiglianza con errori OCR', () => assert.ok(similarity('Rhvstic Studv', 'Rhystic Study') >= 0.8));
t('somiglianza nomi diversi', () => assert.ok(similarity('Sol Ring', 'Arcane Signet') < 0.4));
t('carte a due facce', () => assert.ok(nameSimilarity('Delver of Secrets', 'Delver of Secrets // Insectile Aberration') > 0.95));
t('footer moderno', () => assert.deepEqual(parseFooter('0123/0281 R\nMKM • EN  JOHN DOE'), { number: '123', set: 'mkm', lang: 'en' }));
t('footer italiano', () => assert.deepEqual(parseFooter('R 0042\nFDN • IT'), { number: '42', set: 'fdn', lang: 'it' }));
t('footer illeggibile', () => assert.deepEqual(parseFooter('~~'), { number: undefined, set: undefined, lang: undefined }));
const P = [{ id: 'a', set: 'cmm', collector_number: '400', lang: 'en' }, { id: 'b', set: 'c21', collector_number: '263', lang: 'en' }, { id: 'c', set: 'c21', collector_number: '263', lang: 'it' }];
t('stampa esatta da set+numero+lingua', () => assert.deepEqual(pickPrinting(P, { set: 'c21', number: '263', lang: 'it' }), { printing: P[2], certain: true }));
t('stampa sconosciuta = più recente, da verificare', () => assert.deepEqual(pickPrinting(P, {}), { printing: P[0], certain: false }));
t('guida dentro il riquadro con proporzioni carta', () => { const g = guideRect(1920, 1080); assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.w <= 1 && g.y + g.h <= 1); assert.ok(Math.abs((g.w * 1920) / (g.h * 1080) - 63 / 88) < 0.001); });
t('certezza nome', () => { assert.equal(nameCertain(0.95, 80), true); assert.equal(nameCertain(0.7, 90), false); assert.equal(nameCertain(0.95, 30), false); });
