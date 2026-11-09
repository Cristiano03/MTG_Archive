import Collection from '../features/collection/Collection';
import type { Go, Preset } from './tabs';
export default function CollectionPage({ preset, go }: { preset?: Preset; go: Go }) { return <Collection preset={preset} go={go} />; }
