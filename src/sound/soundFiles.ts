/**
 * What the Sound files window lists: the board's sounds by kind, and the ones a search finds. Kept apart from the window
 * so the lists are the same wherever they are read.
 */
import { CATALOG, type SoundId } from './catalog';
import { SOUND_INFO } from './soundInfo';
import { SOUND_GROUPS, type SoundGroup } from './soundSettings';

/** A kind of sound in the window's sidebar, or every sound at once. */
export type SoundFilesKind = SoundGroup | 'all';

const ALL_SOUNDS = Object.keys(CATALOG) as SoundId[];

/** The sounds of one kind (every sound for 'all'), in the catalog's order. */
export function soundsOfKind(kind: SoundFilesKind): SoundId[] {
  return kind === 'all' ? [...ALL_SOUNDS] : ALL_SOUNDS.filter((id) => CATALOG[id].group === kind);
}

/** The kinds that have sounds, in the settings' order, each with how many it has. */
export function soundKinds(): Array<{ kind: SoundGroup; count: number }> {
  return SOUND_GROUPS.map((kind) => ({ kind, count: soundsOfKind(kind).length })).filter(({ count }) => count > 0);
}

/**
 * The sounds of `kind` that every word of `query` finds in the sound's name, in when it plays or in its id (what its
 * file is called), whatever the case. An empty query finds them all.
 */
export function findSounds(kind: SoundFilesKind, query: string): SoundId[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  const sounds = soundsOfKind(kind);
  if (words.length === 0) return sounds;
  return sounds.filter((id) => {
    const text = `${SOUND_INFO[id].name} ${SOUND_INFO[id].when} ${id}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
