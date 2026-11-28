import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, type SoundId } from '../src/sound/catalog';
import { findSounds, soundKinds, soundsOfKind } from '../src/sound/soundFiles';
import { SOUND_GROUPS } from '../src/sound/soundSettings';

test('the kinds list every sound once, in the settings order', () => {
  const kinds = soundKinds();
  assert.deepEqual(kinds.map(({ kind }) => kind), SOUND_GROUPS.filter((group) => soundsOfKind(group).length > 0));
  assert.equal(kinds.reduce((sum, { count }) => sum + count, 0), Object.keys(CATALOG).length);
  for (const { kind, count } of kinds) {
    assert.ok(count > 0);
    for (const id of soundsOfKind(kind)) assert.equal(CATALOG[id].group, kind);
  }
  assert.equal(soundsOfKind('all').length, Object.keys(CATALOG).length);
});

test('a search finds sounds by name, by when they play and by file name, in every word', () => {
  assert.deepEqual(findSounds('all', ''), soundsOfKind('all'));
  assert.deepEqual(findSounds('doors', '   '), soundsOfKind('doors'));
  assert.ok(findSounds('all', 'DOOR opens').includes('door.open' as SoundId));
  assert.ok(!findSounds('all', 'door opens').includes('door.shut' as SoundId));
  assert.deepEqual(findSounds('all', 'dice.caught'), ['dice.caught']);
  assert.ok(findSounds('all', 'cocked edge').includes('dice.caught' as SoundId));
  assert.deepEqual(findSounds('minis', 'door'), []);
  assert.deepEqual(findSounds('all', 'zzz-no-such-sound'), []);
});
