import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { App } from 'obsidian';
import { MaterialLibrary, MINI_ZIP } from '../src/materials';

test("a HeroForge zip given to the materials says it is a mini, not that it lacks a colour map", async () => {
  const zip = zipSync({ 'Hero_Forge_Explorer_Demo.unity3d': new Uint8Array([1, 2, 3]) });
  const file = { name: 'Hero_Forge_Explorer_Demo_3D_Tabletop.zip', arrayBuffer: async () => zip.slice().buffer } as unknown as File;
  const library = new MaterialLibrary({} as App, () => 'materials');
  const { added, failed } = await library.import([file]);
  assert.deepEqual(added, []);
  assert.deepEqual(failed, [{ name: 'Hero_Forge_Explorer_Demo_3D_Tabletop.zip', reason: MINI_ZIP }]);
});
