import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pinGlyph, pinTone, pinTitle } from '../src/board/pinIcons';

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
