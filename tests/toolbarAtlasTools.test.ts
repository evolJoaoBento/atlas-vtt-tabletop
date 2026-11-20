import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atlasNewerThanChecked, atlasPlayToolButtons, atlasToolButtons, boardKey } from '../src/board/atlasTools';

const key = (init: Partial<KeyboardEvent> & { key: string }) => ({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...init }) as KeyboardEvent;
const DEFAULTS = { lootRoller: 'l', assets: 'a', palette: 'Space' };
const idle = { carrying: false, typing: false, hotkeys: DEFAULTS };

test("atlasToolButtons keeps Atlas's order and drops what the GM hid", () => {
  assert.deepEqual(atlasToolButtons({ order: ['move', 'dice', 'loot', 'assets', 'palette'], hidden: new Set() }), ['loot', 'assets', 'palette']);
  assert.deepEqual(atlasToolButtons({ order: ['palette', 'assets', 'loot'], hidden: new Set(['assets']) }), ['palette', 'loot']);
});

test('atlasPlayToolButtons keeps only loot and assets in Atlas order (palette lives in its own rightmost slot)', () => {
  assert.deepEqual(atlasPlayToolButtons({ order: ['move', 'loot', 'assets', 'palette'], hidden: new Set() }), ['loot', 'assets']);
  assert.deepEqual(atlasPlayToolButtons({ order: ['palette', 'assets', 'loot'], hidden: new Set(['palette']) }), ['assets', 'loot']);
  assert.deepEqual(atlasPlayToolButtons({ order: ['assets', 'loot'], hidden: new Set(['assets']) }), ['loot']);
});

test('Space opens the palette, but not while a token is carried', () => {
  assert.equal(boardKey(key({ key: ' ' }), idle), 'palette');
  assert.equal(boardKey(key({ key: ' ' }), { ...idle, carrying: true }), null);
});

test('Shift+A opens the asset manager; A alone pans the camera', () => {
  assert.equal(boardKey(key({ key: 'A', shiftKey: true }), idle), 'assets');
  assert.equal(boardKey(key({ key: 'a' }), idle), null);
});

test('L opens the random tables', () => {
  assert.equal(boardKey(key({ key: 'l' }), idle), 'loot');
});

test('nothing while typing in a field', () => {
  for (const event of [key({ key: ' ' }), key({ key: 'l' }), key({ key: 'A', shiftKey: true })]) assert.equal(boardKey(event, { ...idle, typing: true }), null);
});

test('a key rebound in Atlas wins', () => {
  const hotkeys = { lootRoller: 'g', assets: 'b', palette: 'Mod+k' };
  assert.equal(boardKey(key({ key: 'g' }), { ...idle, hotkeys }), 'loot');
  assert.equal(boardKey(key({ key: 'l' }), { ...idle, hotkeys }), null);
  assert.equal(boardKey(key({ key: 'B', shiftKey: true }), { ...idle, hotkeys }), 'assets');
  assert.equal(boardKey(key({ key: 'k', ctrlKey: true }), { ...idle, hotkeys }), 'palette');
});

test('atlasNewerThanChecked compares with the version the tables were checked against', () => {
  assert.equal(atlasNewerThanChecked('0.15.1'), true);
  assert.equal(atlasNewerThanChecked('0.16.0-beta.1'), true);
  assert.equal(atlasNewerThanChecked('0.15.0'), false);
  assert.equal(atlasNewerThanChecked('0.14.1'), false);
  assert.equal(atlasNewerThanChecked('0.11.4'), false);
  assert.equal(atlasNewerThanChecked(null), false);
});
