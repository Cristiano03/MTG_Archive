import DeckList from '../features/decks/DeckList';
import type { Go, Preset } from './tabs';
export default function DecksPage({ preset, go }: { preset?: Preset; go: Go }) { return <DeckList creating={preset === 'new'} go={go} />; }
