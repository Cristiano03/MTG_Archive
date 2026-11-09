// Logica pura del riconoscimento (testabile senza browser né fotocamera).

// Rettangolo guida della carta (proporzioni 63×88 mm) dentro un'area w×h, in frazioni 0..1.
export function guideRect(w: number, h: number) {
  const A = 63 / 88; let gh = 0.92 * h, gw = gh * A;
  if (gw > 0.9 * w) { gw = 0.9 * w; gh = gw / A; }
  return { x: (w - gw) / 2 / w, y: (h - gh) / 2 / h, w: gw / w, h: gh / h };
}
// Zone della carta (frazioni della carta): barra del nome e riga in basso a sinistra con set e numero.
export const TITLE = { x: 0.04, y: 0.025, w: 0.74, h: 0.085 };
export const FOOTER = { x: 0.03, y: 0.895, w: 0.5, h: 0.08 };

const LETTERS = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
// Dal testo OCR della barra del nome tiene la riga più "da nome" e ripulisce i caratteri spuri.
export function cleanOcrName(text: string) {
  const lines = text.split('\n').map(l => l.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ',\- ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(l => (l.match(LETTERS) ?? []).length >= 3);
  if (!lines.length) return '';
  const best = lines.sort((a, b) => (b.match(LETTERS) ?? []).length - (a.match(LETTERS) ?? []).length)[0];
  // toglie parole di 1 lettera ai bordi (spesso pezzi di simboli di mana letti come lettere)
  return best.replace(/^(\S\s)+/, '').replace(/(\s\S)+$/, '').replace(/^[-,' ]+|[-,' ]+$/g, '').trim();
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
// Somiglianza 0..1 (Levenshtein normalizzata) ignorando maiuscole, accenti, spazi e punteggiatura.
export function similarity(a: string, b: string) {
  const x = norm(a), y = norm(b); if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}
// Per una carta a due facce conta la somiglianza con la faccia più vicina.
export const nameSimilarity = (ocr: string, name: string) => Math.max(similarity(ocr, name), ...name.split(' // ').map(n => similarity(ocr, n)));

// Riga in basso delle carte moderne, es. "0123/0281 R" + "MKM • EN": set, numero e lingua se leggibili.
export function parseFooter(text: string) {
  const t = text.toUpperCase().replace(/[|]/g, '/');
  const num = t.match(/\b0*(\d{1,4})\s*\/\s*\d{1,4}\b/) ?? t.match(/\b[CURMSLTP]\s+0*(\d{1,4})\b/) ?? t.match(/\b0*(\d{3,4})\b/);
  const set = t.match(/\b([A-Z0-9]{3,5})\s*[•·*.\-]?\s*(EN|IT|DE|FR|ES|PT|JA|JP|ZH|KO|RU)\b/);
  return { number: num ? String(Number(num[1])) : undefined, set: set ? set[1].toLowerCase() : undefined, lang: set ? set[2].toLowerCase().replace('jp', 'ja') : undefined };
}

// Sceglie la stampa: prima set+numero letti, poi solo set, altrimenti la più recente (da verificare).
export function pickPrinting<P extends { set: string; collector_number: string; lang: string }>(prints: P[], f: { set?: string; number?: string; lang?: string }) {
  const sameLang = (p: P) => !f.lang || p.lang === f.lang;
  const exact = prints.find(p => p.set === f.set && p.collector_number.replace(/^0+/, '') === f.number && sameLang(p))
    ?? prints.find(p => p.set === f.set && p.collector_number.replace(/^0+/, '') === f.number);
  if (exact) return { printing: exact, certain: true };
  const inSet = prints.filter(p => p.set === f.set);
  if (inSet.length) return { printing: inSet.find(sameLang) ?? inSet[0], certain: inSet.length === 1 };
  return { printing: prints.find(sameLang) ?? prints[0], certain: false };
}

// Il nome è "certo" solo se l'OCR è affidabile e molto vicino al nome trovato.
export const nameCertain = (sim: number, ocrConfidence: number) => sim >= 0.85 && ocrConfidence >= 55;
