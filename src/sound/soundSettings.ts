/** The groups of board sounds the player can switch on or off one by one. */
export type SoundGroup = 'dice' | 'minis' | 'spells' | 'conditions' | 'turns' | 'fog' | 'doors' | 'water';

export const SOUND_GROUPS: readonly SoundGroup[] = ['dice', 'minis', 'spells', 'conditions', 'turns', 'fog', 'doors', 'water'];

/** The loudest a single sound can be set to, as a multiple of its normal level (200%). */
export const MAX_SOUND_LEVEL = 2;

/** What the player chose for board sounds: one master volume, a mute, an on/off per group and a level per sound. */
export interface SoundSettings {
  volume: number;
  muted: boolean;
  groups: Record<SoundGroup, boolean>;
  /** A multiplier (0 to 2) for single sounds by id, for those not left at 1. */
  levels: Readonly<Record<string, number>>;
}

/** The multiplier chosen for the sound `id`: 1 unless set. */
export function soundLevel(settings: Pick<SoundSettings, 'levels'>, id: string): number {
  const level = settings.levels[id];
  return typeof level === 'number' ? level : 1;
}

/** The defaults, frozen: shared by every reader, so nothing may change them (a copy is made to change one). */
export const DEFAULT_SOUND_SETTINGS: SoundSettings = Object.freeze({
  volume: 0.6,
  muted: false,
  groups: Object.freeze({ dice: true, minis: true, spells: true, conditions: true, turns: true, fog: true, doors: true, water: true }),
  levels: Object.freeze({}),
});

/** Reads stored sound settings; anything missing or malformed takes its default, and the volume is held to 0..1. */
export function readSoundSettings(raw: unknown): SoundSettings {
  const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const volume = typeof source.volume === 'number' && Number.isFinite(source.volume)
    ? Math.min(1, Math.max(0, source.volume))
    : DEFAULT_SOUND_SETTINGS.volume;
  const stored = source.groups !== null && typeof source.groups === 'object' ? (source.groups as Record<string, unknown>) : {};
  const groups = { ...DEFAULT_SOUND_SETTINGS.groups };
  for (const group of SOUND_GROUPS) {
    if (typeof stored[group] === 'boolean') groups[group] = stored[group] as boolean;
  }
  // A level of exactly 1 is the same as none, and anything that is not a number is dropped.
  const levels: Record<string, number> = {};
  const storedLevels = source.levels !== null && typeof source.levels === 'object' ? (source.levels as Record<string, unknown>) : {};
  for (const [id, level] of Object.entries(storedLevels)) {
    if (typeof level === 'number' && Number.isFinite(level) && level !== 1) levels[id] = Math.min(MAX_SOUND_LEVEL, Math.max(0, level));
  }
  return { volume, muted: typeof source.muted === 'boolean' ? source.muted : DEFAULT_SOUND_SETTINGS.muted, groups, levels };
}
