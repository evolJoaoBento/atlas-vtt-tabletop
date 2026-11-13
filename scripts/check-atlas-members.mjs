// Checks that the private Atlas members Tabletop reaches for still exist in a built Atlas (its main.js).
// Usage: node scripts/check-atlas-members.mjs [path to atlas-vtt/main.js]   (default: the sibling vault install)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { compareIds, extractAtlasIds } from './atlasIds.mjs';

const file = resolve(process.argv[2] ?? '../../atlas-vtt/main.js');
if (!existsSync(file)) throw new Error(`No Atlas build at ${file}; pass its main.js.`);
const source = readFileSync(file, 'utf8');

// [name, where Tabletop uses it]
const MEMBERS = [
  ['serviceManager', 'atlasDice.ts, atlasPreview.ts'],
  ['atlasStore', 'atlasDice.ts'],
  ['getState', 'atlasDice.ts (store)'],
  ['getToolController', 'atlasDice.ts'],
  ['getDiceTool', 'atlasDice.ts'],
  ['getDiceRules', 'atlasDice.ts'],
  ['getAssetService', 'atlasDice.ts'],
  ['getCollectionForMap', 'atlasDice.ts'],
  ['getCollectionSettings', 'atlasDice.ts'],
  ['getEventBus', 'atlasDice.ts'],
  ['dice-rolled', 'atlasDice.ts (event)'],
  ['getNotePreviewUIManager', 'atlasPreview.ts'],
  ['showOrCreatePreview', 'atlasPreview.ts'],
  ['hidePreview', 'atlasPreview.ts'],
  ['atlas-vtt:send-map-to-player-view', 'BoardView.ts (command)'],
  // Atlas 0.11's Mosaic Canvas, where huge maps are read through its tiles (atlasMosaic.ts).
  ['getMapImage', 'atlasMosaic.ts (the renderer of a map view)'],
  ['this.deps.service', 'atlasMosaic.ts (the tile service: open, overview, close)'],
  // The toolbar tools shared with Atlas (atlasBridge.ts).
  ['settingsService', 'atlasBridge.ts (plugin member)'],
  ['globalAssetManager', 'atlasBridge.ts (plugin member)'],
  ['getToolbarLayout', 'atlasBridge.ts (settings service)'],
  ['getHotkeys', 'atlasBridge.ts (settings service)'],
  ['updateCollectionSettings', 'atlasBridge.ts (asset service)'],
  ['setCommandPaletteOpen', 'BoardView.ts (Atlas palette page hand-off)'],
  ['atlas-vtt:generate-dungeon', 'shims/handOffs.tsx (command)'],
  // The one Atlas host the boards edit through (packages/atlas-host).
  ['tabMetaStore', 'atlas-host (the scene tabs of the Atlas view)'],
  ['switchToTab', 'atlas-host (bring up a scene tab)'],
  ['onLoadFile', 'atlas-host (open a map as a scene tab of the one view)'],
  ['loadIfDeferred', 'atlas-host (wake a deferred Atlas tab)'],
  ['setSceneLighting', 'tokenWriter.ts (the light level and its colour)'],
  ['getLaserPointerSettings', 'atlasBridge.ts (settings service)'],
  ['setLaserPointerSettings', 'atlasBridge.ts (settings service)'],
  ['getDiceVolume', 'atlasBridge.ts (settings service)'],
];
// Members Tabletop reads defensively and that a given Atlas may not have; reported, not failed.
const OPTIONAL = new Set(['atlas-vtt:send-map-to-player-view', 'this.deps.service']);

let missing = 0;
for (const [name, where] of MEMBERS) {
  const id = name.replace(/^atlas-vtt:/, '');
  const found = source.includes(name) || source.includes(id);
  if (!found) {
    const optional = OPTIONAL.has(name);
    if (!optional) missing += 1;
    console.log(`${optional ? 'warn' : 'MISSING'}  ${name}  (${where})`);
  }
}
console.log(missing === 0 ? `All ${MEMBERS.length} members found in ${file}` : `${missing} member(s) missing from ${file}`);

// Parity: every toolbar tool, palette entry and asset tab Atlas has must have a row in src/parity, and the other way round.
const bundled = await build({ entryPoints: ['src/parity/index.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'error' });
const parity = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const ids = extractAtlasIds(source);
let drift = 0;
for (const [name, found, rows] of [['toolbar', ids.toolbar, parity.ATLAS_TOOLBAR], ['palette', ids.palette, parity.ATLAS_PALETTE], ['asset tabs', ids.assetTabs, parity.ATLAS_ASSET_TABS]]) {
  if (found.length === 0) { console.log(`MISSING  ${name}: no ids found in the build (the catalog's shape changed?)`); drift += 1; continue; }
  const { unlisted, gone } = compareIds(found, rows.map((row) => row.id));
  for (const id of unlisted) console.log(`NEW in Atlas: ${id} (${name}): add a row to src/parity`);
  for (const id of gone) console.log(`GONE from Atlas: ${id} (${name}): drop its row from src/parity`);
  drift += unlisted.length + gone.length;
}
console.log(drift === 0 ? `Parity tables match Atlas (checked against ${parity.ATLAS_CHECKED_VERSION})` : `${drift} parity difference(s)`);
process.exit(missing === 0 && drift === 0 ? 0 : 1);
