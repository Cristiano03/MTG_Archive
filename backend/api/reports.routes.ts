import { Router, type Response as Rs } from 'express';
import { w } from './http.js';
export const router = Router();
import { pool } from '../database/pool.js';
import { err, int } from '../services/errors.js';
import { snapshot, previewRestore, restore } from '../services/backup.js';
import { deckInfo } from '../services/inventory/decks.js';
import { validateById } from '../services/commander-validation/index.js';
import { uidOf } from '../services/auth.js';

router.get('/stats', w(async (q, s) => {
  const uid = uidOf(q), rows = async (sql: string) => (await pool.query(sql, [uid])).rows;
  const [tot] = await rows(`select coalesce(sum(i.qty),0)::int copies,count(*)::int prints,count(distinct p.oracle_id)::int uniq from collection_items i join printings p on p.id=i.printing_id where i.user_id=$1`);
  const [as] = await rows('select coalesce(sum(a.qty),0)::int n from deck_assignments a join decks d on d.id=a.deck_id where d.user_id=$1');
  const dist = (expr: string) => rows(`select ${expr} k,sum(i.qty)::int n from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id where i.user_id=$1 group by 1 order by 2 desc limit 12`);
  const decks = await rows(`select d.id,d.name,d.mode,d.archived,greatest(0,(select coalesce(sum(qty),0) from deck_cards where deck_id=d.id)-(select coalesce(sum(qty),0) from deck_assignments where deck_id=d.id))::int missing from decks d where d.user_id=$1`);
  const active = decks.filter((d: any) => !d.archived), problems: any[] = []; let valid = 0, invalid = 0, missing = 0;
  for (const d of active) {
    const v = await validateById(d.id, uid), m = d.mode === 'physical' ? d.missing : 0; missing += m;
    if (v.status === 'valido') valid++; else if (v.status === 'non valido') invalid++;
    if (v.status !== 'valido' || m) problems.push({ id: d.id, name: d.name, status: v.status, missing: m });
  }
  const [old] = await rows(`select min(c.updated_at) oldest from cards c where exists(select 1 from deck_cards dc join decks d on d.id=dc.deck_id where dc.oracle_id=c.oracle_id and d.user_id=$1)`);
  const [sync] = (await pool.query(`select last_ok,last_error from catalog_sync where source='scryfall'`)).rows;
  s.json({ copies: tot.copies, prints: tot.prints, unique: tot.uniq, assigned: as.n, free: tot.copies - as.n, activeDecks: active.length, valid, invalid, missing,
    problems, banlist: { lastOk: sync?.last_ok ?? null, lastError: sync?.last_error ?? null, oldest: old?.oldest ?? null, stale: !!old?.oldest && Date.now() - new Date(old.oldest).getTime() > 7 * 864e5 },
    recent: await rows(`select i.id,c.name,p.set_code,i.qty from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id where i.user_id=$1 order by i.created_at desc,i.id desc limit 5`),
    by: { colore: await dist(`coalesce(nullif(array_to_string(c.color_identity,''),''),'C')`), rarità: await dist('p.rarity'), set: await dist('upper(p.set_code)'), tipo: await dist(`split_part(c.type_line,' — ',1)`) } });
}));
const csvCell = (x: any) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
const attach = (s: Rs, name: string, type: string, body: string) => { s.setHeader('Content-Type', type + '; charset=utf-8'); s.setHeader('Content-Disposition', `attachment; filename="${name}"`); s.send(body); };
router.get('/export/collection.csv', w(async (q, s) => {
  const r = (await pool.query(`select c.name,p.set_code,p.collector_number,i.qty,coalesce(a.s,0)::int assigned,(i.qty-coalesce(a.s,0))::int free,i.lang,i.finish,i.condition
    from collection_items i join printings p on p.id=i.printing_id join cards c on c.oracle_id=p.oracle_id
    left join (select item_id,sum(qty) s from deck_assignments group by item_id) a on a.item_id=i.id where i.user_id=$1 order by c.name,p.set_code`, [uidOf(q)])).rows;
  attach(s, 'collezione.csv', 'text/csv', '\ufeff' + ['nome,set,numero,qta,assegnate,libere,lingua,finitura,condizione', ...r.map((x: any) => [csvCell(x.name), x.set_code, csvCell(x.collector_number), x.qty, x.assigned, x.free, x.lang, x.finish, x.condition].join(','))].join('\n'));
}));
router.get('/export/backup.json', w(async (q, s) => attach(s, `mtg-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(await snapshot(uidOf(q))))));
router.post('/backup/preview', w(async (q, s) => s.json(await previewRestore(uidOf(q), q.body))));
// sostituisce tutti i dati: il client deve passare confirm=true dopo aver visto l'anteprima
router.post('/backup/restore', w(async (q, s) => { if (q.query.confirm !== 'true') throw err(400, 'Conferma mancante'); s.json(await restore(uidOf(q), q.body)); }));
// Lista del mazzo in testo.
// format: 'plain' = "1 Sol Ring" (come l'esportazione in testo di Moxfield), 'moxfield' = "1 Sol Ring (CMM) 400" (con edizione),
//         'sections' = con le intestazioni Commander / Mainboard (si reimporta mantenendo il comandante).
// missing=1: solo le copie mancanti. inline=1: testo senza download (per copiarlo o modificarlo).
router.get('/decks/:id/export', w(async (q, s) => {
  const id = int(q.params.id), d = await deckInfo(pool, id, uidOf(q)), onlyMissing = q.query.missing === '1';
  const format = ['plain', 'moxfield', 'sections'].includes(String(q.query.format)) ? String(q.query.format) : 'plain';
  // edizione: quella della copia assegnata al mazzo, altrimenti quella che possiedi, altrimenti una qualsiasi in catalogo
  const ed = new Map<string, string>((await pool.query(`select distinct on (p.oracle_id) p.oracle_id,upper(p.set_code)||') '||p.collector_number e
      from printings p left join collection_items i on i.printing_id=p.id and i.user_id=$2
      left join deck_assignments a on a.item_id=i.id and a.deck_id=$1
      where p.oracle_id in (select oracle_id from deck_cards where deck_id=$1)
      order by p.oracle_id,(a.item_id is not null) desc,(i.id is not null) desc,p.set_code`, [id, uidOf(q)])).rows.map((r: any) => [r.oracle_id, '(' + r.e]));
  const keep = (c: any) => !onlyMissing || c.need > c.got;
  const line = (c: any) => `${onlyMissing ? c.need - c.got : c.need} ${c.name}${format === 'moxfield' && ed.has(c.oracle_id) ? ' ' + ed.get(c.oracle_id) : ''}`;
  const cmd = d.cards.filter((c: any) => c.is_commander && keep(c)).map(line), main = d.cards.filter((c: any) => !c.is_commander && keep(c)).map(line);
  const text = format === 'sections'
    ? [...(cmd.length ? ['Commander', ...cmd, ''] : []), ...(main.length ? ['Deck', ...main] : [])].join('\n')
    : [...cmd, ...main].join('\n');
  if (q.query.inline === '1') { s.type('text/plain; charset=utf-8').send(text); return; }
  attach(s, d.name.replace(/[^\w-]+/g, '_') + (onlyMissing ? '-mancanti' : '') + '.txt', 'text/plain', text + '\n');
}));


