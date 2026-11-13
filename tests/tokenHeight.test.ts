import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMapState } from '../src/board/mapModel';
import { liftOf } from '../src/board/tokenHeight';

const feet5 = { unitDistance: 5 };

test("a token's height in squares, by Atlas's rule: up and down, none where a square spans no distance", () => {
  assert.equal(liftOf({ elevation: 10 }, feet5), 2);
  assert.equal(liftOf({ elevation: -5 }, feet5), -1);
  assert.equal(liftOf({ elevation: 7.5 }, feet5), 1.5);
  assert.equal(liftOf({ elevation: 10 }, { unitDistance: 0 }), 0);
  assert.equal(liftOf({}, feet5), 0);
  assert.equal(liftOf({ elevation: 'x' }, feet5), 0);
  assert.ok(Number.isFinite(liftOf({ elevation: 1e9 }, feet5)), 'held to Atlas\'s greatest height');
  assert.equal(liftOf({ elevation: 1e9 }, feet5), 20_000);
});

test("the board reads a token's height and its own speed from Atlas's store", () => {
  const state = (token: Record<string, unknown>) => ({
    mapPath: 'm.atlasmap', backgroundImage: null, grid: { size: 70 },
    objects: { tokens: { t: { id: 't', kind: 'token', x: 0, y: 0, ...token } } },
  });
  const read = (token: Record<string, unknown>) => readMapState('m.atlasmap', state(token)).tokens[0]!;
  assert.deepEqual([read({ elevation: 10, speed: 30 }).elevation, read({ elevation: 10, speed: 30 }).speed], [10, 30]);
  for (const junk of [{ elevation: 'x', speed: -5 }, { elevation: Number.NaN, speed: 0 }, {}]) {
    assert.deepEqual([read(junk).elevation, read(junk).speed], [0, null], JSON.stringify(junk));
  }
});
