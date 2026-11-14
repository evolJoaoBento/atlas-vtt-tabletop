import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

test("the scene stack's own UI and protocol are gone: floors are Atlas levels, and an older stack is only moved (`stackMigration.ts`)", () => {
  assert.equal(existsSync('src/layerModal.ts'), false, 'no modal that stacks a scene on another');
  const main = read('main.ts');
  assert.doesNotMatch(main, /LayerModal|Elevation layer…|stackOf\(/, 'no file menu item, no stack lookups in the plugin');
  const view = read('src/board/BoardView.ts');
  for (const gone of ['switchMember', 'rulerMenu', 'placeLayer', 'resetLayer', 'pickLayerBase', 'writer.transfer', 'tokensMoved', 'stackOf(', 'stackPaths', 'LayerModal']) {
    assert.equal(view.includes(gone), false, `the board view has no ${gone}`);
  }
  const data = read('src/board/boardData.ts');
  for (const gone of ['setLayer(', 'setPlacement(', 'stackOf(', 'placementOf(']) assert.equal(data.includes(gone), false, `Tabletop's data has no ${gone}`);
  // What the move reads stays.
  for (const kept of ['stacks()', 'layersOf(', 'layerOf(', 'clearLayer(', 'adoptStack(']) assert.equal(data.includes(kept), true, `Tabletop's data keeps ${kept}`);
  assert.doesNotMatch(read('src/board/tokenWriter.ts'), /async transfer\(|arrivingToken/, 'no token is carried between scenes of a stack');
  assert.doesNotMatch(read('src/connectContract.ts'), /tokensMoved/, 'Connect is told of no token moved between scenes');
  assert.doesNotMatch(read('src/board/board.ts'), /setAdjust\(|layerPlaced|layerReset|adjustingPath/, 'no scene is placed on the plane by hand');
  assert.doesNotMatch(read('src/boardLayers.ts'), /stackOf\(|layersOf\(/, 'players are sent levels, never a stack');
});
