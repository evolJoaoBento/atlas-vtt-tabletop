import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fogAreas } from '../src/board/fog';
import { cloudFrame, cloudNoise } from '../src/board/fogCloud';

const areas = fogAreas([
  { id: 'a', type: 'rectangle', timestamp: 1, isErasing: false, offsetX: 0, offsetY: 0, x: 140, y: 70, width: 700, height: 350 },
]);

test('the cloud\'s frame is the fog with room around it for its soft edge, eight texels a square', () => {
  const frame = cloudFrame(areas, 70)!;
  // Two squares of room on every side.
  assert.deepEqual([frame.minX, frame.minY, frame.width, frame.height], [0, -70, 980, 630]);
  assert.deepEqual([frame.texWidth, frame.texHeight], [112, 72]);
  assert.equal(cloudFrame([], 70), null);
});

test('a huge map\'s cloud texture stays within 1024 texels a side, keeping its shape', () => {
  const big = fogAreas([{ id: 'a', type: 'rectangle', timestamp: 1, isErasing: false, offsetX: 0, offsetY: 0, x: 0, y: 0, width: 20000, height: 5000 }]);
  const frame = cloudFrame(big, 70)!;
  assert.equal(frame.texWidth, 1024);
  assert.ok(Math.abs(frame.texWidth / frame.texHeight - frame.width / frame.height) < 0.02);
});

test('the edge noise tiles and spans soft values', () => {
  const size = 64;
  const noise = cloudNoise(size, 7);
  let min = 255, max = 0, edge = 0;
  for (let y = 0; y < size; y++) {
    edge = Math.max(edge, Math.abs(noise[y * size]! - noise[y * size + size - 1]!), Math.abs(noise[y]! - noise[(size - 1) * size + y]!));
    for (let x = 0; x < size; x++) { min = Math.min(min, noise[y * size + x]!); max = Math.max(max, noise[y * size + x]!); }
  }
  assert.ok(edge < 40, String(edge));
  assert.ok(min < 60 && max > 195, `${min}..${max}`);
});
