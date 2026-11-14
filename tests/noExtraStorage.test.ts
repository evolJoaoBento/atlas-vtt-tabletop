import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The tests run from the repository root (`npm test`).
const source = (path: string): string => readFileSync(path, 'utf8');
const SETTERS = /\b(setWallMaterial|setWallHeight|setWallWidth|setWindow|setDoorProp|setDoorFlip|rotateDoor|mirrorDoor|setLightHeight)\(/;

test("what the GM sets in 3D on a wall, a door or a light is kept nowhere but on Atlas's own record", () => {
  const data = source('src/board/boardData.ts');
  assert.doesNotMatch(data, SETTERS, "Tabletop's data keeps a wall's, a door's or a light's 3D setting");
  assert.doesNotMatch(data, /^\s+(wallMaterial|wallHeight|wallWidth|windowOf|doorProp|doorFlip|lightHeight|usedMaterials)\(mapPath/m, "Tabletop's data answers for a wall's or a light's 3D setting");
  const view = source('src/board/BoardView.ts');
  assert.doesNotMatch(view, /boardData\.(wallMaterial|wallHeight|wallWidth|windowOf|doorProp|doorFlip|lightHeight|usedMaterials|setWallMaterial|setWallHeight|setWallWidth|setWindow|setDoor|rotateDoor|mirrorDoor|setLightHeight)/, "the board view asks Tabletop's data for a 3D setting of a record");
  assert.match(view, /writer\.setWallExtras\(/, "a wall's settings are written through Atlas's store");
  assert.match(view, /writer\.setLightHeight\(/, "a light's height is written through Atlas's store");
  for (const path of ['src/boardLook.ts', 'src/boardLayers.ts']) {
    assert.doesNotMatch(source(path), /data\.(wallMaterial|wallHeight|wallWidth|windowOf|doorProp|doorFlip|lightHeight|usedMaterials)\(/, `${path} asks Tabletop's data for a 3D setting of a record`);
  }
});
