import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaSpots, insideRing } from '../src/board/areaGlow';
import { areaBudget } from '../src/board/lightRig';
import { flicker, readLights, type BoardLight } from '../src/board/walls';

const square = (x: number, y: number, side: number) => [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }];

test('a surface light is a few spots spread over it: one for a small pool, more for a long river, each inside it', () => {
  const pool = areaSpots(square(0, 0, 100), 4, 200);
  assert.equal(pool.spots.length, 1);
  assert.ok(Math.abs(pool.spots[0]!.x - 50) < 10 && Math.abs(pool.spots[0]!.y - 50) < 10, JSON.stringify(pool.spots));
  const river = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 100 }, { x: 0, y: 100 }];
  const spread = areaSpots(river, 4, 200);
  assert.equal(spread.spots.length, 4);
  for (const spot of spread.spots) assert.ok(insideRing(river, spot.x, spot.y));
  // Each part of the river lies within the spread of a spot; with fewer spots allowed, the spread is wider.
  assert.ok(spread.spread < 520, String(spread.spread));
  assert.ok(areaSpots(river, 1, 200).spread > spread.spread);
  assert.deepEqual(areaSpots([{ x: 0, y: 0 }, { x: 1, y: 1 }], 4, 10).spots, []);
});

test("the board's lamps for surface lights are shared out: the largest surfaces first, at least one each while any are left", () => {
  const light = (id: string, side: number): BoardLight => ({ id, x: 0, y: 0, bright: 5, dim: 20, color: '#ff8a3d', intensity: 1, animation: 'smoulder', angle: null, rotation: 0, hidden: false, darkness: false, activeBelowAmbient: null, tokenId: null, area: square(0, 0, side) });
  const torch: BoardLight = { ...light('torch', 1), area: undefined };
  const budget = areaBudget([light('small', 50), light('big', 500), torch, light('mid', 200)], 6);
  assert.deepEqual([budget.get('big'), budget.get('mid'), budget.get('small'), budget.get('torch')], [4, 1, 1, undefined]);
  const tight = areaBudget([light('small', 50), light('big', 500), light('mid', 200)], 2);
  assert.deepEqual([tight.get('big'), tight.get('mid'), tight.get('small')], [1, 1, 0]);
});

test("Atlas's surface lights are read with their outline and no beam; lava's smoulder is a slow breath", () => {
  const [glow, plain] = readLights({
    g: { id: 'g', x: 50, y: 50, emission: { bright: 5, dim: 20, color: '#ff8a3d', animation: 'smoulder', angle: 90 }, area: square(0, 0, 100) },
    p: { id: 'p', x: 0, y: 0, emission: { dim: 20, animation: 'torch' }, area: [{ x: 0, y: 0 }] },
  }, {});
  assert.deepEqual(glow!.area, square(0, 0, 100));
  assert.equal(glow!.angle, null);
  assert.equal(glow!.animation, 'smoulder');
  assert.equal(plain!.area, undefined);
  const samples = Array.from({ length: 40 }, (_, k) => flicker('smoulder', k * 0.25, 1));
  assert.ok(Math.min(...samples) > 0.75 && Math.max(...samples) < 1.1, JSON.stringify(samples));
  // Slow: a quarter second changes it by little.
  assert.ok(samples.every((value, k) => k === 0 || Math.abs(value - samples[k - 1]!) < 0.06));
});
