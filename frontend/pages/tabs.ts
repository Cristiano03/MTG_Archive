// Sezioni dell'app. h Home, c Collezione, s Scansiona (solo telefono), d Mazzi, w Desideri; i Importa, u Account e p Privacy si aprono da pulsanti.
export type Tab = 'h' | 'c' | 's' | 'd' | 'w' | 'i' | 'u' | 'p';
// come aprire la sezione: Collezione con un filtro (copie libere / nei mazzi) o con la ricerca pronta per aggiungere; Mazzi con un nuovo mazzo
export type Preset = 'free' | 'asg' | 'add' | 'new' | `deck:${number}`;
export type Go = (t: Tab, preset?: Preset) => void;
