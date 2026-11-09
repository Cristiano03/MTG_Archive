// Icone a tratto, disegnate per l'app (24×24).
const P: Record<string, string> = {
  home: 'M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z',
  cards: 'M8.5 4.5h9a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 7 19V6a1.5 1.5 0 0 1 1.5-1.5zM4.5 7.5V18M10 8h6v5h-6z',
  scan: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M9 7.5h6v9H9z',
  decks: 'M6 7h12v13H6zM8 4h8M7.5 7V5.5h9V7M9 11h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  filter: 'M4 6h16M7 12h10M10 18h4',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  undo: 'M9 7 4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-2',
  camera: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.4-2h5.6l1.4 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  check: 'M5 12.5 10 17l9-10',
  refresh: 'M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  edit: 'M5 19h4L19 9l-4-4L5 15zM13 7l4 4',
  sortup: 'M7 19V5M3.5 8.5 7 5l3.5 3.5M13 7h7M13 12h5M13 17h3',
  sortdown: 'M7 5v14M3.5 15.5 7 19l3.5-3.5M13 7h3M13 12h5M13 17h7',
  text: 'M5 6h14M5 10h14M5 14h10M5 18h7',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  select: 'M4 6.5 6 8.5 9.5 5M4 13.5 6 15.5 9.5 12M13 7h7M13 14h7M13 20h7M4 20h.01',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  open: 'M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4',
  archive: 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  close: 'M6 6l12 12M18 6 6 18',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  euro: 'M17 6.5A6.5 6.5 0 1 0 17 17.5M4 10.5h9M4 13.5h9',
  cart: 'M4 5h2l2 10h10l2-7H7.5M10 19.5h.01M17 19.5h.01',
    heart: 'M12 19.5s-7-4.3-7-9.3A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.2c0 5-7 9.3-7 9.3z',
};
export type IconName = keyof typeof P;
export default function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={name === 'more' || name === 'dots' ? 3.2 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ico"><path d={P[name]} /></svg>;
}
