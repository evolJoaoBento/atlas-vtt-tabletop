import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupFollow, groupLanding, type GroupMember } from '../src/board/groupMove';
import type { BoardGrid } from '../src/board/mapModel';

const grid: BoardGrid = { enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null, lineType: 'solid', numbers: null, numberOpacity: 0.8 };
const members = new Map<string, GroupMember>([
  ['a', { origin: { x: 105, y: 105 }, size: 1 }],
  ['b', { origin: { x: 245, y: 105 }, size: 1 }],
  ['big', { origin: { x: 70, y: 280 }, size: 1.5 }],
]);

test('every member moves by what the held token moved', () => {
  const moved = groupFollow(members, 'a', { x: 135, y: 175 }, 1000, 1000);
  assert.deepEqual(moved.get('a'), { x: 135, y: 175 });
  assert.deepEqual(moved.get('b'), { x: 275, y: 175 });
  assert.deepEqual(moved.get('big'), { x: 100, y: 350 });
});

test('members stay on the board, and the held token goes where the pointer put it', () => {
  const moved = groupFollow(members, 'a', { x: 900, y: 900 }, 600, 600);
  assert.deepEqual(moved.get('a'), { x: 900, y: 900 });
  assert.deepEqual(moved.get('b'), { x: 600, y: 600 });
});

test('each member lands snapped by its own size', () => {
  const landed = groupLanding(members, 'a', { x: 140, y: 140 }, grid, 1000, 1000);
  assert.deepEqual(landed.get('a'), { x: 175, y: 175 });
  assert.deepEqual(landed.get('b'), { x: 315, y: 175 });
  assert.deepEqual(landed.get('big'), { x: 140, y: 350 });
});

test('a held token not in the group moves nothing', () => {
  assert.equal(groupFollow(members, 'zzz', { x: 1, y: 1 }, 100, 100).size, 0);
});
