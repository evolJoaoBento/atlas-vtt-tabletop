import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssetService } from '../src/atlasPort/shims/assetService';

// Before any Atlas view has loaded (Atlas's tab deferred, or the board opened first) there is no running asset service:
// the copies of Atlas's panels get an empty one, and what they call on it at mount must be there.
test("without Atlas's running service the stand-in initialises and lists nothing", async () => {
  const none = AssetService.getInstance();
  assert.equal(typeof none.initialize, 'function');
  await assert.doesNotReject(async () => { await (none.initialize as () => Promise<void>)(); });
  assert.deepEqual(await (none.getCollections as () => Promise<unknown[]>)(), []);
  assert.equal((none.getDefaultCollectionId as () => string)(), 'default');
  assert.equal(none.getCollectionForMap('maps/a.atlasmap'), null);
});

test('an app whose Atlas has no loaded view gets the same stand-in', async () => {
  const app = { workspace: { getLeavesOfType: () => [] }, plugins: { plugins: {}, manifests: {} } };
  const none = AssetService.getInstance(app as never);
  await assert.doesNotReject(async () => { await (none.initialize as () => Promise<void>)(); });
});
