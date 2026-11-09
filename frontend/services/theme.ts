// Temi di colore. Ogni tema dà i valori dei colori di base; il resto (bordi dei campi, menu, sfumature) si ricava da questi nel CSS.
// La scelta si salva nel browser (per aprire subito il sito con i colori giusti) e nell'account Supabase (user_metadata.theme),
// così si ritrova su ogni dispositivo dopo l'accesso.
export type ThemeId = 'basalto' | 'seiji' | 'ardesia' | 'brace' | 'ametista';
type T = { name: string; desc: string; app: string; surface: string; control: string; border: string; text: string; text2: string; text3: string; accent: string; pressed: string; onAccent: string };
export const THEMES: Record<ThemeId, T> = {
  basalto: { name: 'Basalto', desc: 'Pietra e vetro, neutro', app: '#22262A', surface: '#2B2F33', control: '#32363A', border: '#3A3E42', text: '#E4E7EA', text2: '#A7ABAD', text3: '#72767A', accent: '#E1E1E2', pressed: '#C8C8CA', onAccent: '#22262A' },
  seiji: { name: 'Seiji', desc: 'Grigio caldo e verde celadon', app: '#2B2B2B', surface: '#333534', control: '#3B3E3C', border: '#444845', text: '#E6EAE3', text2: '#BED2C3', text3: '#90A1A2', accent: '#BED2C3', pressed: '#A8BFAF', onAccent: '#2B2B2B' },
  ardesia: { name: 'Ardesia', desc: 'Blu ardesia, freddo', app: '#0E1217', surface: '#1C2328', control: '#343E43', border: '#2A3338', text: '#E1E6EA', text2: '#A6B7BF', text3: '#57666D', accent: '#A6B7BF', pressed: '#8FA1AA', onAccent: '#0E1217' },
  brace: { name: 'Brace', desc: 'Nero caldo e arancio', app: '#11100E', surface: '#1C1B19', control: '#221F1E', border: '#2A2826', text: '#EEEBE9', text2: '#ABABAB', text3: '#575757', accent: '#DE7B4C', pressed: '#C96A3E', onAccent: '#FFFFFF' },
  ametista: { name: 'Ametista', desc: 'Neutro con sottotono violaceo', app: '#0D0C11', surface: '#17151D', control: '#211E29', border: '#2A2633', text: '#EEEBF5', text2: '#ABA5BA', text3: '#6F6A7D', accent: '#D4CCF2', pressed: '#BDB3E3', onAccent: '#17132A' },
};
export const DEFAULT_THEME: ThemeId = 'ardesia';
const KEY = 'mtg.theme';
export const isTheme = (x: unknown): x is ThemeId => typeof x === 'string' && x in THEMES;
let current: ThemeId = DEFAULT_THEME;
export const currentTheme = () => current;

export function applyTheme(id: ThemeId) {
  const t = THEMES[id] ?? THEMES[DEFAULT_THEME], s = document.documentElement.style; current = id;
  const set = (k: string, v: string) => s.setProperty(k, v);
  set('--paper', t.app); set('--sheet', t.surface); set('--sunk', t.control); set('--line', t.border);
  set('--ink', t.text); set('--ink-2', t.text2); set('--ink-3', t.text3);
  set('--arcane', t.accent); set('--arcane-press', t.pressed); set('--arcane-ink', t.onAccent);
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', t.app));
  try { localStorage.setItem(KEY, id); } catch { /* navigazione privata: resta solo per questa visita */ }
  dispatchEvent(new Event('theme:changed'));
}
// all'avvio: l'ultimo tema usato in questo browser (o Ardesia)
export function initTheme() {
  let id: unknown; try { id = localStorage.getItem(KEY); } catch { id = null; }
  applyTheme(isTheme(id) ? id : DEFAULT_THEME);
}
