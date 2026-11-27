import { t } from '../i18n';
import { SOUND_GROUPS, type SoundGroup } from './soundSettings';

/** The kinds of board sound the player switches on or off one by one: every group but the dice, which are as loud as Atlas plays its dice. */
export const SWITCHED_SOUND_GROUPS: readonly Exclude<SoundGroup, 'dice'>[] = SOUND_GROUPS.filter((group): group is Exclude<SoundGroup, 'dice'> => group !== 'dice');

/** A group's name and what it covers, as the plugin's settings and the palette's Sound Settings both show them. */
export function soundGroupText(group: Exclude<SoundGroup, 'dice'>): { name: string; hint: string } {
  return { name: t(`soundSettings.group.${group}`), hint: t(`soundSettings.group.${group}Hint`) };
}
