import { pool } from '../../database/pool.js';
import { err } from '../errors.js';
import { validateDeck } from './validate.js';
export { validateDeck };

export async function validateById(id: number, uid: number) {
  const d = (await pool.query('select archived from decks where id=$1 and user_id=$2', [id, uid])).rows[0];
  if (!d) throw err(404, 'Mazzo non trovato');
  const rows = (await pool.query(`select c.oracle_id,c.name,c.type_line,c.color_identity,c.oracle_text,c.keywords,c.commander_legality,c.updated_at,dc.qty,dc.is_commander
    from deck_cards dc join cards c on c.oracle_id=dc.oracle_id where dc.deck_id=$1`, [id])).rows;
  return validateDeck(rows, d.archived);
}
