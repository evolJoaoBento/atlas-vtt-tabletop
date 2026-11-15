import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLoadedAtlasView } from '../src/atlasPort/shims/boardLeaves';
import { saveOpenScene } from '../src/atlasPort/app/services/sceneRename';

const appWith = (view: unknown) => ({ workspace: { getLeavesOfType: (type: string) => (type === 'atlas-vtt' && view ? [{ view }] : []) } }) as never;

test("a scene renamed or moved from the board's asset manager is saved first by Atlas's own view, which holds the board's map", async () => {
  const saved: string[] = [];
  const atlas = {
    getTabMetaStore: () => ({ getState: () => ({ getTabByFilePath: (path: string) => (path === 'scenes/Keep.atlasmap' ? { id: 't1' } : null) }) }),
    saveMap: async () => { saved.push('saved'); },
  };
  assert.equal(getLoadedAtlasView(appWith(atlas)), atlas);
  await saveOpenScene(appWith(atlas), 'scenes/Keep.atlasmap');
  await saveOpenScene(appWith(atlas), 'scenes/Other.atlasmap');
  assert.deepEqual(saved, ['saved']);
  // No Atlas tab, or one that is no map view yet: nothing to save, and no throw.
  assert.equal(getLoadedAtlasView(appWith(null)), null);
  assert.equal(getLoadedAtlasView(appWith({ deferred: true })), null);
  await saveOpenScene(appWith(null), 'scenes/Keep.atlasmap');
});
