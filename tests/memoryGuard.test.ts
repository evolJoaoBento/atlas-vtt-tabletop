import assert from 'node:assert/strict';
import { test } from 'node:test';
import { oldDevice, readMark, startMemory } from '../src/web/memoryGuard';
import { leaner, QUALITY } from '../src/board/quality';
import { feetPerSquare } from '../src/board/measure';

const DAY = 24 * 60 * 60 * 1000;

test('a page that died with the board up draws it leaner at each reload; a clean leave keeps the mode; days later it forgets', () => {
  const first = startMemory(null, 1000, false);
  assert.equal(first.mode, 'normal');
  assert.deepEqual(first.mark, { running: true, crashes: 0, last: 0 });
  // Killed for memory: the mark was never cleared.
  const second = startMemory(first.mark, 2000, false);
  assert.equal(second.mode, 'lean');
  const third = startMemory(second.mark, 3000, false);
  assert.equal(third.mode, 'leanest');
  assert.equal(startMemory(third.mark, 4000, false).mode, 'leanest');
  // Left cleanly: the same mode next time, not leaner.
  assert.equal(startMemory({ ...second.mark, running: false }, 5000, false).mode, 'lean');
  // Three days on without a death: as usual again.
  assert.equal(startMemory({ ...third.mark, running: false }, 3000 + 4 * DAY, false).mode, 'normal');
});

test('an old device starts lean, one death from the leanest', () => {
  assert.equal(startMemory(null, 0, true).mode, 'lean');
  assert.equal(startMemory({ running: true, crashes: 0, last: 0 }, 1, true).mode, 'leanest');
  assert.equal(oldDevice({ hardwareConcurrency: 2 }), true);
  assert.equal(oldDevice({ hardwareConcurrency: 6, deviceMemory: 2 }), true);
  assert.equal(oldDevice({ hardwareConcurrency: 8, deviceMemory: 8 }), false);
  assert.equal(oldDevice({}), false);
});

test('a mark not well formed reads as none or as clean', () => {
  assert.equal(readMark(null), null);
  assert.equal(readMark('{bad'), null);
  assert.deepEqual(readMark('{"running":"yes","crashes":-3,"last":"x"}'), { running: false, crashes: 0, last: 0 });
});

test('the lean modes cap textures and resolution; the leanest draws no layers', () => {
  const lean = leaner(QUALITY.low, 'lean');
  assert.equal(lean.textureSide, 4096);
  assert.equal(lean.maxPixelRatio, 1);
  assert.equal(lean.noLayers, undefined);
  const leanest = leaner(QUALITY.medium, 'leanest');
  assert.equal(leanest.textureSide, 2048);
  assert.ok(leanest.maxPixelRatio < 1);
  assert.equal(leanest.noLayers, true);
  assert.equal(leaner(QUALITY.low, 'normal'), QUALITY.low);
});

test("a spell's feet on any scale: feet, yards, metres as D&D counts them, five a square for the rest", () => {
  const scale = (unitType: string, unitDistance: number, mode = 'metric') => feetPerSquare({ mode, unitType, unitDistance, diagonalRule: 'alternating', bands: [] } as never);
  assert.equal(scale('feet', 5), 5);
  assert.equal(scale('feet', 10), 10);
  assert.equal(scale('meters', 1.5), 5);
  assert.equal(scale('meters', 3), 10);
  assert.equal(scale('yards', 1), 3);
  assert.equal(scale('units', 1), 5);
  assert.equal(scale('feet', 5, 'abstract'), 5);
  assert.equal(scale('feet', 0), 5);
});
