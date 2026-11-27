import assert from 'node:assert/strict';
import { test } from 'node:test';
import { soundGroupText, SWITCHED_SOUND_GROUPS } from '../src/sound/soundGroupText';
import { SOUND_GROUPS } from '../src/sound/soundSettings';

test('every kind of board sound but the dice has a switch, a name and what it covers', () => {
  assert.deepEqual([...SWITCHED_SOUND_GROUPS], SOUND_GROUPS.filter((group) => group !== 'dice'));
  for (const group of SWITCHED_SOUND_GROUPS) {
    const text = soundGroupText(group);
    assert.match(text.name, /sounds$/);
    assert.ok(text.hint.length > 10 && !text.hint.startsWith('soundSettings.'), group);
  }
  assert.deepEqual(soundGroupText('doors'), { name: 'Door sounds', hint: 'Doors opening, closing and locked; walls crumbling.' });
});
