import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitTexture } from '../src/board/textures';

test('a map that fits keeps its size', () => {
  assert.deepEqual(fitTexture(4000, 3000), { width: 4000, height: 3000 });
  assert.deepEqual(fitTexture(8192, 8192), { width: 8192, height: 8192 });
});

test('a larger map is scaled down by its longest side, keeping its shape', () => {
  assert.deepEqual(fitTexture(16000, 9000), { width: 8192, height: 4608 });
  assert.deepEqual(fitTexture(9000, 18000), { width: 4096, height: 8192 });
  assert.deepEqual(fitTexture(100000, 10), { width: 8192, height: 1 });
});

test('a map background is a video by its file extension, whatever the case or a query after it', async () => {
  const { isVideoPath } = await import('../src/board/textures');
  for (const yes of ['maps/cave.webm', 'Maps/Cave.MP4', 'a.m4v', 'a.ogv', 'x/y.mov', 'cave.webm?v=2']) assert.equal(isVideoPath(yes), true, yes);
  for (const no of ['cave.png', 'cave.webp', 'cave.gif', 'webm', 'cave.webm.png', '']) assert.equal(isVideoPath(no), false, no);
});
