import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinGlyph, pinTone, pinTitle, pinShownName } from '../src/board/pinIcons';
import { readMap } from '../src/board/mapModel';

test('pin tones are Atlas\'s dark-theme colours', () => {
  assert.equal(pinTone('treasure'), '#e3b341');
  assert.equal(pinTone('quest'), '#8b8cf0');
  assert.equal(pinTone('location'), '#5cb860');
});

test('unknown icons are pins; legacy ids are remapped', () => {
  assert.equal(pinTone('no-such-icon'), '#e5534b');
  assert.equal(pinTone('coins'), pinTone('treasure'));
  assert.equal(pinGlyph('coins'), pinGlyph('treasure'));
});

test('number and letter pins have no glyph', () => {
  assert.equal(pinGlyph('number'), null);
  assert.equal(pinGlyph('letter'), null);
  assert.match(pinGlyph('treasure')!, /^M/);
});

test('a pin\'s title is its note heading, else the note name, else its label', () => {
  assert.equal(pinTitle({ notePath: 'Adventure/Level 1.md#1. Entry Well', label: '1' }), '1. Entry Well');
  assert.equal(pinTitle({ notePath: 'Tables/Wandering Monsters.md', label: null }), 'Wandering Monsters');
  assert.equal(pinTitle({ notePath: null, label: 'A' }), 'A');
  assert.equal(pinTitle({ notePath: null, label: null }), '');
});

test('a pin floats its name only where "show name" is on (Atlas 0.14, as Connect sends it)', () => {
  const named = { notePath: 'Notes/Hall.md', label: '1', name: 'The Great Hall' };
  assert.equal(pinShownName({ ...named }), '');
  assert.equal(pinShownName({ ...named, showName: false }), '');
  assert.equal(pinShownName({ ...named, showName: true }), 'The Great Hall');
  assert.equal(pinShownName({ notePath: 'Notes/Hall.md#Entry', label: '1', name: null, showName: true }), 'Entry');
  assert.equal(pinShownName({ notePath: null, label: '1', name: null, showName: true }), '');
});

test('a map read keeps a pin\'s showName', () => {
  const pin = (extra: object) => ({ id: 'p', kind: 'pin', x: 1, y: 2, notePath: 'N/A.md', name: 'A', ...extra });
  const text = JSON.stringify({ version: 1, state: { background: 'bg.png', grid: { size: 70, enabled: true, visible: true }, objects: { tokens: {}, walls: {}, pins: { a: pin({ id: 'a', showName: true }), b: pin({ id: 'b' }) } } } });
  const pins = readMap('m.atlasmap', text).pins;
  assert.equal(pins.find((p) => p.id === 'a')?.showName, true);
  assert.equal(pins.find((p) => p.id === 'b')?.showName, undefined);
});
