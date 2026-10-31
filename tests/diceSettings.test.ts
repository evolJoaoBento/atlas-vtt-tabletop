import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorsText, DEFAULT_DICE_SETTINGS, readColorsText, readDiceSettings } from '../src/dice/diceSettings';

test('the dice settings default to the brief: 0.6 squares, tolerance 0.1, the default pack', () => {
  const { colors, ...rest } = readDiceSettings(undefined);
  assert.deepEqual(rest, { dieSquares: 0.6, tolerance: 0.1, motionThreshold: 1, shadows: true, highlight: true, highlightColor: '#ffd54a', pack: 'Texture-Pack-Default', autoRoll: false, sheetPinned: false });
  assert.deepEqual(colors, DEFAULT_DICE_SETTINGS.colors);
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
  assert.deepEqual(read.colors, [{ name: 'Fire', color: '#ff0000' }, { name: '#00ff00', color: '#00ff00' }]);
});

test('the colours as the settings tab lists them read back the same', () => {
  const colors = [{ name: 'Fire red', color: '#ff0000' }, { name: '#00ff00', color: '#00ff00' }];
  assert.equal(colorsText(colors), 'Fire red #ff0000\n#00ff00');
  assert.deepEqual(readColorsText(`${colorsText(colors)}\nno colour here\n  Sky #87CEEB  `), [...colors, { name: 'Sky', color: '#87CEEB' }]);
});
