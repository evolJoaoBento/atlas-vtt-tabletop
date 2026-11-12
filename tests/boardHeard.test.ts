import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardHeard } from '../src/sound/boardHeard';

test('a board is heard while it is in front of the GM, or while the players\' window it drives is in view', () => {
  const cases: Array<[string, { onScreen: boolean; hidden: boolean }, { hidden: boolean } | null, boolean]> = [
    ['in front, window shown, no players\' window', { onScreen: true, hidden: false }, null, true],
    ['tab behind another, no players\' window', { onScreen: false, hidden: false }, null, false],
    ['window hidden, no players\' window', { onScreen: true, hidden: true }, null, false],
    ['tab behind another, players\' window in view', { onScreen: false, hidden: false }, { hidden: false }, true],
    ['window hidden, players\' window in view', { onScreen: true, hidden: true }, { hidden: false }, true],
    ['window hidden, players\' window hidden too', { onScreen: true, hidden: true }, { hidden: true }, false],
    ['in front, players\' window hidden', { onScreen: true, hidden: false }, { hidden: true }, true],
    ['tab behind, players\' window hidden', { onScreen: false, hidden: false }, { hidden: true }, false],
  ];
  for (const [name, board, players, heard] of cases) assert.equal(boardHeard(board, players), heard, name);
});
