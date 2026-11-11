/** The groups of board sounds the player can switch on or off one by one. */
export type SoundGroup = 'dice' | 'minis' | 'spells' | 'conditions' | 'turns' | 'fog' | 'doors' | 'water';

export const SOUND_GROUPS: readonly SoundGroup[] = ['dice', 'minis', 'spells', 'conditions', 'turns', 'fog', 'doors', 'water'];

/** What the player chose for board sounds: one master volume, a mute and an on/off per group. */
export interface SoundSettings {
  volume: number;
  muted: boolean;
  groups: Record<SoundGroup, boolean>;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  volume: 0.6,
  muted: false,
  groups: { dice: true, minis: true, spells: true, conditions: true, turns: true, fog: true, doors: true, water: true },
};

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
  return { volume, muted: typeof source.muted === 'boolean' ? source.muted : DEFAULT_SOUND_SETTINGS.muted, groups };
}
