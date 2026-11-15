import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIE_COLOURS, dieBody, lookBody, readDiceLook } from '../src/dice/diceLook';

test("Atlas's dice look is read as Atlas keeps it; anything else is its default (light, medieval)", () => {
  assert.deepEqual(readDiceLook({ colour: 'dark', font: 'scifi' }), { colour: 'dark', font: 'scifi' });
  assert.deepEqual(readDiceLook({ colour: 'pink', font: 7 }), { colour: 'light', font: 'medieval' });
  assert.deepEqual(readDiceLook(null), { colour: 'light', font: 'medieval' });
});

test("a die's body is Atlas's: light keeps the pack's own colour, dark and accent give the bodies Atlas resolves", () => {
  assert.equal(lookBody({ colour: 'light', font: 'medieval' }, '#123456'), null);
  assert.equal(lookBody({ colour: 'dark', font: 'medieval' }, '#123456'), '#1f1e21');
  assert.equal(lookBody({ colour: 'accent', font: 'scifi' }, '#123456'), '#123456');
  // A theme that reports no accent (or none that reads as a colour): Obsidian's default accent, as Atlas falls back.
  assert.equal(lookBody({ colour: 'accent', font: 'scifi' }, null), '#8a5cf5');
  assert.equal(lookBody({ colour: 'accent', font: 'scifi' }, 'hsl(258, 88%, 66%)'), '#8a5cf5');
});

test("a dice set group's colour wins over the look; one that is no #rrggbb is not a colour", () => {
  const dark = { colour: 'dark' as const, font: 'medieval' as const };
  assert.equal(dieBody('#b91c1c', dark, null), '#b91c1c');
  assert.equal(dieBody('red', dark, null), '#1f1e21');
  assert.equal(dieBody(undefined, { colour: 'light', font: 'medieval' }, null), null);
});

test("the picker offers Atlas's dice set colours, named as Atlas names them", () => {
  assert.equal(DIE_COLOURS.length, 12);
  assert.deepEqual(DIE_COLOURS[0], { name: 'Crimson', color: '#b91c1c' });
  assert.deepEqual(DIE_COLOURS.at(-1), { name: 'Black', color: '#1f1e21' });
});
