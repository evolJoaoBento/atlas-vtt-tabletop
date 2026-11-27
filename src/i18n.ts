/**
 * Tabletop's own words in Obsidian's language (Atlas follows Obsidian's language, so Tabletop's panels do too). English
 * is the base: a string without a translation shows in English. `t(key, { n: 3 })` fills `{n}` in the text. Pure.
 *
 * To add a language (only once Atlas has it): add its table to `TABLES` under its two-letter code, with the keys it translates
 * (the test checks every key exists in English and keeps its `{placeholders}`).
 */
import { setAtlasLanguage } from './atlasPort/atlasText';

const EN = {
  'fog.needsNewerAtlas': 'This needs a newer Atlas.',
  'lighting.title': 'Lighting: {mode}',
  'lighting.classic': 'Classic',
  'lighting.dusk': 'Painted: dusk',
  'lighting.day': 'Painted: day',
  'lighting.night': 'Painted: night',
  'lighting.ambient': 'Ambient light',
  'lighting.tint': 'Tint',
  'lighting.tintReset': 'Reset',
  'lighting.tintNone': 'None',
  'lighting.tintHint': "Colours the board's daylight (a warm gold, a cold blue). Atlas's lights keep their own colours. Reset takes it off.",
  'lighting.ambientHint': "Lower it and the map goes dark: Atlas's lights shine in it. Right-click a light's bulb to set how high it hangs.",
  'lighting.tilt': 'Miniature look',
  'lighting.tiltHint': 'Blurs the board towards its top and bottom edges and keeps a band across the middle sharp, so the table looks like a model (tilt-shift). Costs some frame rate.',
  'lighting.occlusion': 'Contact shadows',
  'lighting.occlusionHint': 'Darkens the creases where walls, minis and props meet the floor (ambient occlusion). Costs some frame rate.',
  'toolbar.more': 'More tools',
  'toolbar.measureOptions': 'Measure Tool Options',
  'toolbar.moveOptions': 'Move Tool Options',
  'toolbar.ruler': 'Ruler',
  'toolbar.circle': 'Circle',
  'toolbar.cone': 'Cone',
  'toolbar.measureModes': 'Measure modes',
  'toolbar.measureChoices': 'Measurements',
  'toolbar.measureKeep': 'Keep',
  'toolbar.measureKeepTip': 'Measurements stay on the map',
  'toolbar.measurePlayers': 'Players see it',
  'toolbar.measureClear': 'Clear',
  'toolbar.measureClearTip': 'Removes what is kept on this level',
  'toolbar.measureClearAllTip': 'Removes what is kept on this map',
  'toolbar.measureNothingKept': 'Nothing kept on this map',
  'toolbar.measureNothingKeptOnLevel': 'Nothing kept on this level',
  'toolbar.dragDistance': 'Distance while moving tokens',
  'toolbar.dragDistanceAlways': 'Always',
  'toolbar.dragDistanceCombat': 'In combat',
  'toolbar.dragDistanceNever': 'Never',
  'toolbar.measureRules': 'Measurement rules…',
  'toolbar.measureRulesAtlasOnly': "Open this map's collection Grid settings in Atlas",
  'toolbar.colour': 'Colour',
  'toolbar.ranges': 'Ranges',
  'toolbar.rangesTip': 'Click a token or a place to see its ranges',
  'toolbar.rangesNoRules': 'This game system has no ranges or movement steps',
  'measure.shape.ruler': 'Ruler',
  'measure.shape.circle': 'Circle',
  'measure.shape.cone': 'Cone',
  'measure.shape.square': 'Square',
  'measure.shape.line': 'Line',
  'measure.look': 'Look',
  'measure.effect': 'Effect',
  'measure.popover': 'Measurement',
  'measure.stopsAtWalls': 'Stops at walls',
  'measure.width': 'Width',
  'measure.narrower': 'Narrower',
  'measure.wider': 'Wider',
  'measure.selectTokens': 'Select tokens',
  'measure.noTokens': 'No tokens in it',
  'measure.needsNewerAtlas': 'Editing a kept measurement needs a newer Atlas.',
  'common.delete': 'Delete',
  'measure.effect.none': 'None',
  'measure.effect.fire': 'Fire',
  'measure.effect.frost': 'Frost',
  'measure.effect.lightning': 'Lightning',
  'measure.effect.mist': 'Mist',
  'measure.effect.radiance': 'Radiance',
  'measure.effect.shadow': 'Shadow',
  'color.default': 'Default',
  'color.white': 'White',
  'color.red': 'Red',
  'color.orange': 'Orange',
  'color.yellow': 'Yellow',
  'color.green': 'Green',
  'color.blue': 'Blue',
  'color.purple': 'Purple',
  'tabletopSettings.title': 'Tabletop Settings',
  'tabletopSettings.entry': 'Tabletop Settings',
  'tabletopSettings.walls': 'Walls and fog',
  'tabletopSettings.wallHeight': 'Default wall height',
  'tabletopSettings.wallHeightHint': 'Walls without a height of their own stand this many grid squares tall, and so does the fog painted in Atlas (0 lays the fog flat on the map).',
  'tabletopSettings.wallHeightAria': 'Default wall height in squares',
  'tabletopSettings.wallsReachNext': 'Walls reach the level above',
  'tabletopSettings.wallsReachNextHint': 'Walls stand up to the next level, less a millimetre, so floors meet without clipping; a wall set taller is cut there too. The top level keeps the default wall height.',
  'tabletopSettings.wallThickness': 'Wall thickness',
  'tabletopSettings.wallThicknessHint': 'In grid squares, more than none and at most two.',
  'tabletopSettings.wallThicknessAria': 'Wall thickness in squares',
  'tabletopSettings.wallEdges': 'Wall edges',
  'tabletopSettings.wallEdgesHint': 'Sharp is a plain box; Soft rounds the edges a little so they catch the light; Round is more pillowy. Walls are drawn with more triangles when rounded.',
  'tabletopSettings.wallEdgesAria': 'How round the edges of walls and doors are',
  'tabletopSettings.sharp': 'Sharp',
  'tabletopSettings.soft': 'Soft',
  'tabletopSettings.round': 'Round',
  'tabletopSettings.snapHeading': 'Snap to grid',
  'tabletopSettings.visibilityHeading': 'Visibility',
  'tabletopSettings.seeThrough': 'See-through walls',
  'tabletopSettings.seeThroughHint': 'Walls between the camera and what it looks at fade out, in a window round the point the camera turns about.',
  'tabletopSettings.windowSize': 'Window size',
  'tabletopSettings.windowSizeHint': 'How wide the see-through window is, in grid squares.',
  'tabletopSettings.squares': '{n} sq',
  'tabletopSettings.layers': 'Upper layers',
  'tabletopSettings.layersHint': 'How the layers above the one shown are drawn.',
  'tabletopSettings.layersAria': 'How the upper layers are drawn',
  'tabletopSettings.layersSolid': 'Solid',
  'tabletopSettings.layersFaded': 'Faded',
  'tabletopSettings.layersHidden': 'Hidden',
  'tabletopSettings.initiative': 'Initiative tracker',
  'tabletopSettings.initiativeHint': 'Shows the tracker on the board (I).',
  'tabletopSettings.lookHeading': 'Look',
  'tabletopSettings.grade': 'Cinematic grade',
  'tabletopSettings.gradeHint': 'A little warmer, richer colour with darker corners. Costs some frame rate.',
  'tabletopSettings.depthOfField': 'Depth of field',
  'tabletopSettings.depthOfFieldHint': 'Keeps the point the camera turns round sharp and blurs what lies nearer or farther, as a camera lens does. Costs some frame rate.',
  'tabletopSettings.dofStrength': 'Intensity',
  'tabletopSettings.dofStrengthHint': 'How strongly depth of field blurs, and how soon past the focus the blur begins.',
  'tabletopSettings.dofCenter': 'Focus on the centre',
  'tabletopSettings.dofCenterHint': 'Focuses on whatever is in the middle of the screen, rather than on the point the camera turns round.',
  'tabletopSettings.halo': 'Flame halo',
  'tabletopSettings.haloHint': 'A bright glow round each light, as Atlas draws it; walls and shadows stop it as they stop the light.',
  'tabletopSettings.snapTokens': 'Snap tokens',
  'tabletopSettings.snapTokensHint': "The map's own Snap to grid (the same as Atlas's): a dropped token goes to the middle of its square. Off: it stays where it is dropped.",
  'tabletopSettings.snapProps': 'Snap props',
  'tabletopSettings.snapPropsHint': 'On its own, whatever the map snaps tokens to: a dropped prop goes to the middle of its square. Off: it stays where it is dropped.',
  'arTable.fineTune': 'Fine-tune the AR table',
  'soundSettings.entry': 'Sound Settings',
  'soundSettings.title': 'Sound Settings',
  'soundSettings.boardHeading': 'Board sounds',
  'soundSettings.kindsHeading': 'Kinds of sound',
  'soundSettings.volume': 'Sound volume',
  'soundSettings.volumeHint': 'How loud board sounds are, on this device.',
  'soundSettings.mute': 'Mute board sounds',
  'soundSettings.muteHint': 'Silences every board sound, on this device.',
  'soundSettings.diceLabel': 'Dice sounds',
  'soundSettings.dice': "As loud as Atlas plays its dice (Atlas's own Dice volume).",
  'soundSettings.each': 'Each sound',
  'soundSettings.eachHint': "How loud each sound is, its preview and your own files in its place: in Tabletop's plugin settings.",
  'soundSettings.open': 'Open',
  'soundSettings.group.minis': 'Mini sounds',
  'soundSettings.group.minisHint': 'Picking a mini up and putting it down.',
  'soundSettings.group.spells': 'Spell sounds',
  'soundSettings.group.spellsHint': 'Spells cast on the board.',
  'soundSettings.group.conditions': 'Condition sounds',
  'soundSettings.group.conditionsHint': 'A condition put on a token.',
  'soundSettings.group.turns': 'Turn sounds',
  'soundSettings.group.turnsHint': 'The horn when a turn begins.',
  'soundSettings.group.fog': 'Fog sounds',
  'soundSettings.group.fogHint': 'Fog being revealed.',
  'soundSettings.group.doors': 'Door sounds',
  'soundSettings.group.doorsHint': 'Doors opening, closing and locked; walls crumbling.',
  'soundSettings.group.water': 'Water sounds',
  'soundSettings.group.waterHint': 'Painted water, by how it moves.',
  'palette.appearance': 'Appearance settings',
  'arTable.none': 'no AR table on this map yet. A player sends one from their phone (AR menu, Send this table to the GM).',
  'dice.heading': 'Dice',
  'dice.autoRoll': 'Throw stat sheet rolls automatically',
  'dice.autoRollHint': 'Ticked, a roll from a stat sheet is thrown at once. Unticked, its dice are laid on the table and you throw them by hand.',
  'group.selected': '{n} selected',
  'group.rotateLeft': 'Rotate left {deg}°',
  'group.rotateRight': 'Rotate right {deg}°',
  'group.damage': 'Damage all',
  'group.heal': 'Heal all',
  'group.amount': 'HP amount',
  'group.clear': 'Clear selection',
  'open3d': 'Open in 3D',
  'atlasTools.needsAtlas': 'needs Atlas',
  'parity.newerAtlas': "Atlas {installed} is newer than the version these tools were checked against ({checked}): some of Atlas's newest tools may be missing on the board.",
} as const;

export type StringKey = keyof typeof EN;

/**
 * The translations of Tabletop's own words by language code; English is the base and needs none. Empty for now. Atlas
 * 0.12.0 speaks Russian and Chinese too: the copies of Atlas's panels take Atlas's own texts in those languages (`at`, in
 * src/atlasPort/atlasText.ts), and a table here for `ru` or `zh` would translate the rest of the board.
 */
export const TABLES: Record<string, Partial<Record<StringKey, string>>> = {};

export const ENGLISH: Readonly<Record<StringKey, string>> = EN;

/** The table a language code names: `pt-BR` and `pt_PT` are `pt`; a language without one is English. */
export function languageOf(code: string | null | undefined): string {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return base in TABLES ? base : 'en';
}

let current = 'en';

/**
 * Sets the language the next `t` speaks (Obsidian's, read once when the plugin loads), and the language of Atlas's own texts
 * in the board's copies of Atlas's panels (`at`), which Atlas has in more languages than Tabletop's table.
 */
export function setLanguage(code: string | null | undefined): void {
  current = languageOf(code);
  setAtlasLanguage(code);
}

export function language(): string {
  return current;
}

/** The string for `key` in the current language, `{name}` filled from `values`. */
export function t(key: StringKey, values: Readonly<Record<string, string | number>> = {}): string {
  const text = TABLES[current]?.[key] ?? EN[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
