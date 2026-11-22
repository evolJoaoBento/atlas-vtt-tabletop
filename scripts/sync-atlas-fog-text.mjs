import { readFileSync, writeFileSync } from 'node:fs';
// Usage: node scripts/sync-atlas-fog-text.mjs [path to an Atlas 0.18 source checkout] (default ../atlas-vtt-0.18-ref)
// Writes src/atlasPort/atlasTextFog.ts: the fog tool's texts (and the toolbar words they share) in Tabletop's languages.
const ref = `${process.argv[2] ?? '../atlas-vtt-0.18-ref'}/src/app/i18n/locales`;
function load(lang, file) {
  let src = readFileSync(`${ref}/${lang}/${file}.ts`, 'utf8');
  src = src.replace(/^import .*$/gm, '').replace(/export const (\w+)(?:: [\w<>, ]+)? =/, 'const $1 =').replace(/\}\s*as const satisfies[^;]*;?/, '}');
  const name = /const (\w+) =/.exec(src)[1];
  return new Function(`${src}; return ${name};`)();
}
const toolbarKeys = ['toolbar.fogTool', 'toolbar.fogEraser', 'toolbar.brush', 'toolbar.lasso', 'toolbar.rectangle', 'toolbar.snap', 'toolbar.constrain', 'toolbar.gmView', 'toolbar.sessionView', 'toolbar.peek'];
// The turn banner's words and the tracker options menu's rows (initiative.ts) and the placeholder name it falls back on (token.ts).
const initiativeKeys = ['initiative.bannerTurn', 'initiative.bannerRound', 'initiative.combatStarted', 'initiative.combatEnded', 'initiative.side.players', 'initiative.side.opponents',
  'initiative.compact', 'initiative.compactHint', 'initiative.turnBanner', 'initiative.turnBannerHint', 'initiative.options', 'initiative.resetNumbers', 'initiative.resetNumbersHint', 'initiative.clear'];
const tokenKeys = ['token.unknownCreature'];
// The dice tray's saved rolls (diceRoll.ts): the panel's words, as the board's panel shows them.
const diceKeys = ['diceRoll.presetsTitle', 'diceRoll.presetEdit', 'diceRoll.presetEditShort', 'diceRoll.presetActions', 'diceRoll.presetRoll', 'diceRoll.presetDelete', 'diceRoll.presetName', 'diceRoll.presetFormula', 'diceRoll.presetSave', 'diceRoll.presetNeedsName', 'diceRoll.presetNeedsFormula', 'diceRoll.presetsSaveFailed', 'diceRoll.rowDone',
  'diceRoll.die', 'diceRoll.presetRollsAtOnce', 'diceRoll.presetPin', 'diceRoll.presetUnpin', 'diceRoll.presetRowFull', 'diceRoll.rowTitle', 'diceRoll.rowStandard', 'diceRoll.rowPlace', 'diceRoll.rowRemove',
  'diceRoll.rowAddDie', 'diceRoll.rowAddDieCaption', 'diceRoll.rowNotADie', 'diceRoll.rowFaces', 'diceRoll.rowPresent', 'diceRoll.rowEdit'];
const out = {};
const keys = new Set();
for (const lang of ['en', 'ru', 'zh']) {
  const fog = load(lang, 'fog'); const toolbar = load(lang, 'toolbar');
  out[lang] = {};
  for (const [k, v] of Object.entries(fog)) { out[lang][k] = v; keys.add(k); }
  for (const k of toolbarKeys) if (toolbar[k] !== undefined) { out[lang][k] = toolbar[k]; keys.add(k); }
  const initiative = load(lang, 'initiative'); const token = load(lang, 'token');
  for (const k of initiativeKeys) if (initiative[k] !== undefined) { out[lang][k] = initiative[k]; keys.add(k); }
  for (const k of tokenKeys) if (token[k] !== undefined) { out[lang][k] = token[k]; keys.add(k); }
  const dice = load(lang, 'diceRoll');
  for (const k of diceKeys) if (dice[k] !== undefined) { out[lang][k] = dice[k]; keys.add(k); }
}
const body = `// Generated from Atlas 0.18's src/app/i18n/locales/{en,ru,zh}/{fog,toolbar,initiative,token,diceRoll}.ts (AGPL-3.0): the fog tool's bars and notices, the
// toolbar words they share, the turn banner's words and the dice tray's saved rolls. The synced snapshot (the floor, 0.15) lacks them; a synced text of the same key wins (atlasText.ts).
import type { AtlasMessage } from './atlasText';

export const ATLAS_TEXT_FOG: Readonly<Record<string, Readonly<Record<string, AtlasMessage>>>> = ${JSON.stringify(out, null, 2)};

export const ATLAS_FOG_TEXT_KEYS = ${JSON.stringify([...keys].sort(), null, 2)} as const;
`;
writeFileSync('src/atlasPort/atlasTextFog.ts', body);
console.log([...keys].length, Object.keys(out.ru).length, Object.keys(out.zh).length);
