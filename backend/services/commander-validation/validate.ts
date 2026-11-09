// Validazione Commander calcolata dal catalogo salvato (non memorizzata: dipende dai dati del momento).
export type VC = { oracle_id: string; name: string; type_line: string; color_identity: string[]; oracle_text: string; keywords: string[];
  commander_legality: string | null; updated_at: Date; qty: number; is_commander: boolean };
const canCmd = (c: VC) => (/Legendary/.test(c.type_line) && /Creature/.test(c.type_line)) || /can be your commander/i.test(c.oracle_text);
const pairOk = (a: VC, b: VC) => {
  const k = (c: VC, x: string) => c.keywords.includes(x), bg = (c: VC) => /Background/.test(c.type_line);
  if ((k(a, 'Choose a Background') && bg(b) && canCmd(a)) || (k(b, 'Choose a Background') && bg(a) && canCmd(b))) return true;
  return canCmd(a) && canCmd(b) && ((k(a, 'Partner') && k(b, 'Partner')) || (k(a, 'Friends forever') && k(b, 'Friends forever')));
};
const limit = (c: VC) => {
  if (/Basic Land/.test(c.type_line) || /any number of cards named/i.test(c.oracle_text)) return Infinity;
  const m = c.oracle_text.match(/up to (\w+) cards named/i); return m ? ({ seven: 7, nine: 9 } as any)[m[1].toLowerCase()] ?? 1 : 1;
};
export function validateDeck(rows: VC[], archived: boolean) {
  const issues: { text: string; incomplete?: boolean }[] = [], cmds = rows.filter(r => r.is_commander);
  const need = new Map<string, { c: VC; q: number }>();
  for (const r of rows) { const e = need.get(r.oracle_id); if (e) e.q += r.qty; else need.set(r.oracle_id, { c: r, q: r.qty }); }
  const count = [...need.values()].reduce((t, e) => t + e.q, 0);
  if (!cmds.length) issues.push({ text: 'Comandante mancante' });
  if (cmds.length === 1 && !canCmd(cmds[0])) issues.push({ text: `${cmds[0].name} non può essere comandante` });
  if (cmds.length === 2 && !pairOk(cmds[0], cmds[1])) issues.push({ text: 'Combinazione di comandanti non consentita' });
  if (cmds.length > 2) issues.push({ text: 'Più di 2 comandanti' });
  if (count < 100) issues.push({ text: `Mancano ${100 - count} carte per arrivare a 100`, incomplete: true });
  if (count > 100) issues.push({ text: `Troppe carte: ${count}/100` });
  const ci = new Set(cmds.flatMap(c => c.color_identity)); let oldest = Date.now();
  for (const { c, q } of need.values()) {
    oldest = Math.min(oldest, new Date(c.updated_at).getTime());
    if (q > limit(c)) issues.push({ text: `Duplicato illegale: ${c.name} ×${q}` });
    if (cmds.length && c.color_identity.some(x => !ci.has(x))) issues.push({ text: `${c.name} fuori identità di colore` });
    if (c.commander_legality === 'banned') issues.push({ text: `${c.name} è bandita` });
    else if (c.commander_legality === 'not_legal') issues.push({ text: `${c.name} non legale in Commander` });
  }
  const stale = Date.now() - oldest > 7 * 864e5;
  const status = archived ? 'archiviato' : !count ? 'bozza' : !issues.length ? 'valido' : issues.every(i => i.incomplete) ? 'incompleto' : 'non valido';
  return { status, count, issues, stale, certified: status === 'valido' && !stale };
}
