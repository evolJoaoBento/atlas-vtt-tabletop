import type { ATLAS_FOG_TEXT_KEYS } from './atlasTextFog';
/**
 * The keys of Atlas's own texts the board's copies of Atlas's panels use. `npm run sync:atlas` copies exactly these, in every
 * language Atlas speaks, into `atlasTextData.ts`. Add a key here, then run the sync.
 */
export const ATLAS_TEXT_KEYS = [
  'toolbarEdit.assets.label',
  'toolbarEdit.assets.description',
  'toolbarEdit.palette.label',
  'toolbarEdit.palette.description',
  'hotkey.assets',
  'hotkey.palette',
  'hotkey.lootRoller',
  'hotkey.help',
  'toolbar.lootRoller',
  'toolbar.assetManager',
  'toolbar.commandPalette',
  'common.delete',
] as const;

/** The fog tool's texts are Atlas 0.18's, the synced snapshot lacks them: `atlasTextFog.ts` has them (generated from 0.18). */
export type AtlasTextKey = typeof ATLAS_TEXT_KEYS[number] | typeof ATLAS_FOG_TEXT_KEYS[number];
