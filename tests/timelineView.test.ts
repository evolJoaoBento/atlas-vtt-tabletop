import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Shot } from '../src/cutscene/cutsceneData';
import { gapBefore, mapLabel, timeAt, xAt } from '../src/cutscene/timelineView';

const at = (ms: number): Pick<Shot, 'at'> => ({ at: ms });

test('timeAt reads back what xAt placed', () => {
  assert.equal(timeAt(xAt(1234, 80, 40), 80, 40), 1234);
  assert.equal(timeAt(xAt(0, 80, 0), 80, 0), 0);
  assert.equal(timeAt(xAt(61000, 40, 500), 40, 500), 61000);
});

test('timeAt never goes before the start', () => {
  assert.equal(timeAt(-5, 80, 0), 0);
  assert.equal(timeAt(-500, 80, 100), 0);
});

test('80 pixels are a second by default, and scrolling shifts the time', () => {
  assert.equal(timeAt(80), 1000);
  assert.equal(xAt(2000), 160);
  assert.equal(timeAt(0, 80, 160), 2000);
  assert.equal(xAt(2000, 80, 160), 0);
});

test('gapBefore: the shot a transition leads into, for a moment strictly between two shots', () => {
  const shots = [at(0), at(2000), at(4000)];
  assert.equal(gapBefore(shots, 1000), 1);
  assert.equal(gapBefore(shots, 3000), 2);
  assert.equal(gapBefore(shots, 2001), 2);
});

test('gapBefore: before the first, on a shot, after the last and with fewer than two shots there is none', () => {
  const shots = [at(1000), at(2000)];
  assert.equal(gapBefore(shots, 500), -1);
  assert.equal(gapBefore(shots, 1000), -1);
  assert.equal(gapBefore(shots, 2000), -1);
  assert.equal(gapBefore(shots, 9000), -1);
  assert.equal(gapBefore([at(0)], 100), -1);
  assert.equal(gapBefore([], 100), -1);
});

test('mapLabel: the file name without its folders or extension', () => {
  assert.equal(mapLabel('maps/Docks.atlasmap'), 'Docks');
  assert.equal(mapLabel('Docks.atlasmap'), 'Docks');
  assert.equal(mapLabel('a/b/Old Town.v2.atlasmap'), 'Old Town.v2');
  assert.equal(mapLabel(''), '');
});
