import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDiceSettings } from '../src/dice/diceSettings';

test('the dice settings default to the brief: 0.6 squares, tolerance 0.1, the default pack', () => {
  assert.deepEqual(readDiceSettings(undefined), { dieSquares: 0.6, tolerance: 0.1, motionThreshold: 1, shadows: true, highlight: true, highlightColor: '#ffd54a', pack: 'Texture-Pack-Default', autoRoll: false, sheetPinned: false });
});

test('auto roll is off (dice are laid for a manual throw) unless a saved setting turns it on', () => {
  assert.equal(readDiceSettings({}).autoRoll, false);
  assert.equal(readDiceSettings({ autoRoll: true }).autoRoll, true);
  assert.equal(readDiceSettings({ autoRoll: 'yes' }).autoRoll, false);
});

test('a pinned stat sheet drawer is kept across reloads, and is not pinned unless a saved setting says so', () => {
  assert.equal(readDiceSettings({}).sheetPinned, false);
  assert.equal(readDiceSettings({ sheetPinned: true }).sheetPinned, true);
  assert.equal(readDiceSettings(JSON.parse(JSON.stringify(readDiceSettings({ sheetPinned: true })))).sheetPinned, true);
  assert.equal(readDiceSettings({ sheetPinned: 'yes' }).sheetPinned, false);
});

test('saved dice settings are read field by field; a wrong field falls back alone', () => {
  const read = readDiceSettings({ dieSquares: 1, tolerance: 7, motionThreshold: 'fast', shadows: false, highlightColor: 'yellow', pack: 'Bone', colors: [{ name: ' Fire ', color: '#ff0000' }, { color: '#00ff00' }, { name: 'Bad', color: 'red' }] });
  assert.equal(read.dieSquares, 1);
  assert.equal(read.tolerance, 0.1);
  assert.equal(read.motionThreshold, 1);
  assert.equal(read.shadows, false);
  assert.equal(read.highlightColor, '#ffd54a');
  assert.equal(read.pack, 'Bone');
  // The dice's colours are Atlas's (its dice set colours and dice look): a saved colour list of Tabletop's own is dropped.
  assert.equal('colors' in read, false);
});

