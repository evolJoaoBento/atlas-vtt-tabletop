// Checks that the private Atlas members Tabletop reaches for still exist in a built Atlas (its main.js).
// Usage: node scripts/check-atlas-members.mjs [path to atlas-vtt/main.js]   (default: the sibling vault install)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
process.exit(missing === 0 ? 0 : 1);
