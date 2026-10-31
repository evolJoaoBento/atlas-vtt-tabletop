import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atlasPreviews, previewAnchor, type PreviewToken } from '../src/sheets/atlasPreview';
import type { MapViewLike } from '../src/dice/atlasDice';

const TOKEN: PreviewToken = {
  id: 't1', x: 120, y: 80, name: 'Goblin', instanceNumber: 2, statblockPath: 'Bestiary/Goblin.md', imagePath: 'tokens/goblin.png',
  showRing: true, ringColor: '#ff0000', resources: { hp: { current: 4, max: 7 }, stress: { current: 1, max: 3 }, ac: { current: 15, max: 15 } },
};

test("the token is handed to Atlas as the anchor of its window, with the vitals its statblock mirrors", () => {
  assert.deepEqual(previewAnchor(TOKEN), {
    id: 't1', notePath: 'Bestiary/Goblin.md', x: 120, y: 80, type: 'token', name: 'Goblin', instanceNumber: 2,
    hp: { current: 4, max: 7 }, stress: { current: 1, max: 3 }, imagePath: 'tokens/goblin.png', ringColor: '#ff0000', showRing: true,
  });
  // No name, no instance, no art, no vitals: none of them are made up.
  const bare = previewAnchor({ ...TOKEN, name: null, instanceNumber: null, imagePath: null, resources: {} });
  assert.deepEqual(Object.keys(bare).sort(), ['id', 'notePath', 'ringColor', 'showRing', 'type', 'x', 'y']);
});

function view(manager: unknown): MapViewLike {
  return { getViewType: () => 'atlas-vtt', serviceManager: { getNotePreviewUIManager: () => manager } };
}

test("Atlas's window opens and closes through the map view's preview manager", async () => {
  const calls: unknown[][] = [];
  const manager = {
    showOrCreatePreview: async (...args: unknown[]) => { calls.push(['show', ...args]); },
    hidePreview: (...args: unknown[]) => { calls.push(['hide', ...args]); },
  };
  const previews = atlasPreviews(view(manager))!;
  assert.ok(previews);
  const anchor = previewAnchor(TOKEN);
  await previews.show(anchor, 300, 200);
  previews.hide('t1');
  assert.deepEqual(calls, [['show', anchor, 300, 200, null], ['hide', 't1', false]]);
});

test('a view without the manager, or with a broken one, gives no window', () => {
  assert.equal(atlasPreviews(null), null);
  assert.equal(atlasPreviews({ getViewType: () => 'atlas-vtt' }), null);
  assert.equal(atlasPreviews(view(null)), null);
  assert.equal(atlasPreviews(view({ showOrCreatePreview: () => {} })), null, 'it must close too');
  const throwing: MapViewLike = { getViewType: () => 'atlas-vtt', serviceManager: { getNotePreviewUIManager: () => { throw new Error('gone'); } } };
  assert.equal(atlasPreviews(throwing), null);
  // A window that is already gone is no error.
  const gone = atlasPreviews(view({ showOrCreatePreview: async () => {}, hidePreview: () => { throw new Error('gone'); } }))!;
  assert.doesNotThrow(() => gone.hide('t1'));
});
