import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submenuSide } from '../src/board/atlasMenu';

test('a submenu opens to the right while there is room, else to the left, and deeper ones keep going the same way', () => {
  // A menu in the middle of a 1000 px window: a 200 px submenu fits to its right.
  assert.equal(submenuSide({ left: 400, right: 600 }, 200, 1000, 'right'), 'right');
  // Near the right edge: it flips left.
  assert.equal(submenuSide({ left: 780, right: 980 }, 200, 1000, 'right'), 'left');
  // The submenu that flipped left, at 576–776: its own submenu keeps going left, never back over the menu that opened it.
  assert.equal(submenuSide({ left: 576, right: 776 }, 200, 1000, 'left'), 'left');
  // Out of room on the left too: back to the right only then.
  assert.equal(submenuSide({ left: 100, right: 300 }, 200, 1000, 'left'), 'right');
  // No room either side: the side with more.
  assert.equal(submenuSide({ left: 350, right: 750 }, 400, 1000, 'right'), 'left');
});
