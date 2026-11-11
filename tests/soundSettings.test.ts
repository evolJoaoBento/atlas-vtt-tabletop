import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SOUND_SETTINGS, readSoundSettings, SOUND_GROUPS } from '../src/sound/soundSettings';

test('plugin data saved without sound loads the defaults', () => {
  assert.deepEqual(readSoundSettings(undefined), DEFAULT_SOUND_SETTINGS);
  assert.equal(DEFAULT_SOUND_SETTINGS.volume, 0.6);
});

test('saved { muted: true } loads muted with the other defaults', () => {
  const read = readSoundSettings({ muted: true });
  assert.equal(read.muted, true);
  assert.equal(read.volume, DEFAULT_SOUND_SETTINGS.volume);
  assert.deepEqual(read.groups, DEFAULT_SOUND_SETTINGS.groups);
});

test('loading settings never changes the defaults', () => {
  const read = readSoundSettings({});
  read.volume = 0.1;
  read.groups.dice = false;
  assert.equal(DEFAULT_SOUND_SETTINGS.volume, 0.6);
  assert.equal(DEFAULT_SOUND_SETTINGS.groups.dice, true);
  assert.ok(Object.isFrozen(DEFAULT_SOUND_SETTINGS));
  assert.ok(Object.isFrozen(DEFAULT_SOUND_SETTINGS.groups));
  assert.ok(SOUND_GROUPS.every((group) => DEFAULT_SOUND_SETTINGS.groups[group]));
});

test('the web player reads its stored choice, and falls back when storage is missing or broken', async () => {
  const { loadStoredSound, SOUND_STORAGE_KEY } = await import('../src/web/soundControl');
  const stored = loadStoredSound({ getItem: (key) => (key === SOUND_STORAGE_KEY ? '{"volume":0.2,"muted":true}' : null) });
  assert.equal(stored.volume, 0.2);
  assert.equal(stored.muted, true);
  assert.deepEqual(loadStoredSound(null), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(loadStoredSound({ getItem: () => { throw new Error('blocked'); } }), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(loadStoredSound({ getItem: () => 'not json' }), DEFAULT_SOUND_SETTINGS);
});
