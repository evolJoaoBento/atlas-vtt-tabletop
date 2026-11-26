import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smallPicture, type PictureTools } from '../src/board/smallPicture';

const tools = (size: { width: number; height: number } | null, decodes = true): PictureTools & { asked: Array<[number, number]> } => {
  const asked: Array<[number, number]> = [];
  return {
    asked,
    fetchBlob: async () => new Blob([new Uint8Array(4)]),
    size: async () => size,
    ...(decodes ? { decode: async (_blob: Blob, width: number, height: number) => { asked.push([width, height]); return { width, height, close() {} } as unknown as ImageBitmap; } } : {}),
  };
};

test('a map larger than the board draws it is decoded straight to that size, its own size kept for the layout', async () => {
  const t = tools({ width: 8192, height: 6144 });
  const picture = await smallPicture('blob:map', 4096, t);
  assert.deepEqual(t.asked, [[4096, 3072]]);
  assert.deepEqual([picture?.width, picture?.height], [8192, 6144]);
});

test('a map that fits, one of unknown size, or a browser that cannot decode smaller is read as before (null)', async () => {
  assert.equal(await smallPicture('blob:map', 4096, tools({ width: 4000, height: 2000 })), null);
  assert.equal(await smallPicture('blob:map', 4096, tools(null)), null);
  assert.equal(await smallPicture('blob:map', 4096, tools({ width: 9000, height: 9000 }, false)), null);
});
