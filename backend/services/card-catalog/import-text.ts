import { tx } from '../../database/pool.js';
import { err } from '../errors.js';
import { SF, sleep, sfGet, upsertPrinting } from './scryfall.js';

type Row = { line: string; qty?: number; name?: string; set?: string; cn?: string; section?: string; status: 'ok' | 'fuzzy' | 'err'; msg?: string;
  printing_id?: string; card_name?: string; set_code?: string; collector_number?: string; image?: string };
function parseList(text: string) {
  const rows: Row[] = []; let sec = 'main';
  for (let l of text.split('\n')) {
    l = l.trim(); if (!l) continue;
    // intestazioni di sezione come le scrivono Moxfield, Archidekt e simili: "Commander", "// Commander", "Commander (1)", "Deck:"…
    const head = l.replace(/^\/\/\s*/, '').replace(/\s*\(\d+\)\s*$/, '').replace(/:$/, '').trim();
    if (/^commanders?$/i.test(head)) { sec = 'cmd'; continue; }
    if (/^(mainboard|main|deck|the deck|cards?)$/i.test(head)) { sec = 'main'; continue; }
    if (/^(sideboard|maybeboard|considering|tokens?|companions?)$/i.test(head)) { sec = 'skip'; continue; } // il compagno sta fuori dalle 100
    if (l.startsWith('//') || l.startsWith('#')) continue; // commenti
    if (sec === 'skip') continue;
    const raw = l; l = l.replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\^[^^]*\^/g, '').replace(/\s+\*[FE]\*$/, '');
    const m = l.match(/^(\d+)\s*x?\s+(.+?)(?:\s+\((\w+)\)(?:\s+(\S+))?)?$/);
    if (!m) { rows.push({ line: raw, status: 'err', msg: 'Riga non interpretabile' }); continue; }
    rows.push({ line: raw, qty: +m[1], name: m[2].trim(), set: m[3]?.toLowerCase(), cn: m[4], section: sec, status: 'err', msg: 'Non risolta' });
  }
  return rows;
}
export async function previewImport(text: string) {
  const rows = parseList(text); if (rows.length > 600) throw err(400, 'Massimo 600 righe per volta');
  const todo = rows.filter(r => r.name), found: any[] = [];
  const fill = (r: Row, c: any, st: 'ok' | 'fuzzy', msg?: string) => { Object.assign(r, { status: st, msg, printing_id: c.id, card_name: c.name, set_code: c.set, collector_number: c.collector_number, image: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small }); found.push(c); };
  const f = (x: string) => x.split(' // ')[0].toLowerCase();
  for (let i = 0; i < todo.length; i += 75) {
    const b = todo.slice(i, i + 75);
    const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { ...SF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: b.map(x => x.set && x.cn ? { set: x.set, collector_number: x.cn } : { name: x.name }) }) });
    if (!r.ok) throw err(502, 'Scryfall ' + r.status);
    const j: any = await r.json();
    for (const row of b) { const c = j.data.find((c: any) => row.set && row.cn ? c.set === row.set && c.collector_number === row.cn : f(c.name) === f(row.name!)); if (c) fill(row, c, 'ok'); }
    await sleep(120);
  }
  const pending = todo.filter(r => !r.printing_id); // nome approssimato o italiano: 5 ricerche alla volta
  for (let i = 0; i < pending.length; i += 5) await Promise.all(pending.slice(i, i + 5).map(async row => {
    try {
      let c = await sfGet('/cards/named?fuzzy=' + encodeURIComponent(row.name!));
      if (!c) c = (await sfGet('/cards/search?q=' + encodeURIComponent(`lang:it "${row.name}"`)))?.data?.[0];
      if (c) fill(row, c, 'fuzzy', 'Interpretata come ' + c.name); else row.msg = 'Carta non riconosciuta';
    } catch (e: any) { row.msg = e.message; }
  }));
  await tx(async c => { for (const x of found) await upsertPrinting(c, x); }); // solo catalogo, nessun effetto sull'inventario
  return { rows };
}
