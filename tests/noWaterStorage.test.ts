import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The tests run from the repository root (`npm test`).
const source = (path: string): string => readFileSync(path, 'utf8');

test("painted water is kept nowhere but in Atlas's liquids", () => {
  const data = source('src/board/boardData.ts');
  assert.doesNotMatch(data, /\b(setWater|setWaterMotion)\(/, "Tabletop's data keeps painted water");
  assert.doesNotMatch(data, /^\s+(water|waterMotion)\(mapPath/m, "Tabletop's data answers for a map's water");
  const view = source('src/board/BoardView.ts');
  assert.doesNotMatch(view, /boardData\.(water|waterMotion|setWater|setWaterMotion)\(/, "the board view asks Tabletop's data for water");
  assert.match(view, /writer\.replaceLiquids\(/, "a stroke is written to Atlas's liquids through its store");
  for (const path of ['src/boardLook.ts', 'src/boardLayers.ts']) {
    assert.doesNotMatch(source(path), /data\.(water|waterMotion)\(/, `${path} asks Tabletop's data for water`);
  }
});
