import { pool, tx, type C } from '../../database/pool.js';
import { err } from '../errors.js';

export const SF = { 'User-Agent': 'mtg-manager/1.0', Accept: 'application/json' };
export const sleep = (ms: number) => new Promise(f => setTimeout(f, ms));
export const sfGet = async (u: string): Promise<any> => { const r = await fetch('https://api.scryfall.com' + u, { headers: SF }); if (r.status === 404) return null; if (!r.ok) throw err(502, 'Scryfall ' + r.status); return r.json(); };
// costo di mana e colori della carta (per le carte a due facce si usa la faccia frontale)
export const mana = (s: any) => {
  const f = s.card_faces ?? [];
  return { cmc: s.cmc ?? f[0]?.cmc ?? null, mana_cost: s.mana_cost ?? f[0]?.mana_cost ?? null, colors: s.colors ?? f[0]?.colors ?? [] };
};
export async function upsertPrinting(c: C, s: any) {
  const f = s.card_faces ?? [], oid = s.oracle_id ?? f[0]?.oracle_id;
  const m = mana(s);
  await c.query(`insert into cards(oracle_id,name,type_line,color_identity,oracle_text,keywords,commander_legality,cmc,mana_cost,colors) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    on conflict(oracle_id) do update set commander_legality=excluded.commander_legality,cmc=excluded.cmc,mana_cost=excluded.mana_cost,colors=excluded.colors, updated_at=now()`,
    [oid, s.name, s.type_line ?? '', s.color_identity ?? [], s.oracle_text ?? f.map((x: any) => x.oracle_text).join('\n'), s.keywords ?? [], s.legalities?.commander, m.cmc, m.mana_cost, m.colors]);
  await c.query('insert into printings(id,oracle_id,set_code,collector_number,rarity,lang,image_small,finishes) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(id) do nothing',
    [s.id, oid, s.set, s.collector_number, s.rarity, s.lang, s.image_uris?.small ?? f[0]?.image_uris?.small, s.finishes ?? []]);
}
export async function ensurePrinting(c: C, id: string) {
  if ((await c.query('select 1 from printings where id=$1', [id])).rowCount) return;
  const s = await sfGet('/cards/' + encodeURIComponent(id)); if (!s) throw err(404, 'Stampa non trovata su Scryfall');
  await upsertPrinting(c, s);
}

// aggiorna la legalità Commander di tutte le carte in catalogo; se fallisce, i dati restano vecchi e la validazione lo segnala
export async function refreshLegality() {
  const ids = (await pool.query('select oracle_id from cards')).rows.map((r: any) => r.oracle_id); let n = 0;
  try {
    for (let i = 0; i < ids.length; i += 75) {
      const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'mtg-manager/1.0', Accept: 'application/json' },
        body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((oracle_id: string) => ({ oracle_id })) }) });
      if (!r.ok) throw new Error('Scryfall ' + r.status);
      for (const c of (await r.json() as any).data) { const m = mana(c);
        n += (await pool.query('update cards set commander_legality=$2,cmc=$3,mana_cost=$4,colors=$5,updated_at=now() where oracle_id=$1', [c.oracle_id ?? c.card_faces?.[0]?.oracle_id, c.legalities?.commander, m.cmc, m.mana_cost, m.colors])).rowCount ?? 0; }
      await new Promise(f => setTimeout(f, 120));
    }
    await pool.query(`insert into catalog_sync values('scryfall',now(),null,$1) on conflict(source) do update set last_ok=now(),last_error=null,detail=$1`, [{ updated: n }]);
    return { updated: n };
  } catch (e: any) {
    await pool.query(`insert into catalog_sync(source,last_error) values('scryfall',$1) on conflict(source) do update set last_error=$1`, [e.message]);
    throw err(502, 'Aggiornamento fallito: ' + e.message);
  }
}

// Completa costo di mana e colori delle carte salvate prima che esistessero questi campi (all'avvio, in background).
export async function backfillCardData() {
  const ids = (await pool.query('select oracle_id from cards where cmc is null or colors is null')).rows.map((r: any) => r.oracle_id); let n = 0;
  for (let i = 0; i < ids.length; i += 75) {
    const r = await fetch('https://api.scryfall.com/cards/collection', { method: 'POST', headers: { ...SF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ids.slice(i, i + 75).map((oracle_id: string) => ({ oracle_id })) }) });
    if (!r.ok) throw new Error('Scryfall ' + r.status);
    for (const c of (await r.json() as any).data) { const m = mana(c);
      n += (await pool.query('update cards set cmc=$2,mana_cost=$3,colors=$4 where oracle_id=$1', [c.oracle_id ?? c.card_faces?.[0]?.oracle_id, m.cmc, m.mana_cost, m.colors])).rowCount ?? 0; }
    await sleep(120);
  }
  return n;
}
