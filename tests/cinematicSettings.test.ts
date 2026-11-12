import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CINEMATIC_SETTINGS, readCinematicSettings } from '../src/cutscene/cinematicSettings';

test('missing settings read as the defaults', () => {
  assert.deepEqual(readCinematicSettings(undefined), DEFAULT_CINEMATIC_SETTINGS);
  assert.deepEqual(DEFAULT_CINEMATIC_SETTINGS, { bars: true, aspect: 2.39, transition: 'fade', fadeMs: 600 });
});

test('bad fields take their default, and the fade length is clamped', () => {
  assert.deepEqual(readCinematicSettings({ aspect: 3, fadeMs: 99999, bars: false }), { bars: false, aspect: 2.39, transition: 'fade', fadeMs: 3000 });
  assert.equal(readCinematicSettings({ fadeMs: 1 }).fadeMs, 100);
  assert.equal(readCinematicSettings({ aspect: 1.85, transition: 'move' }).transition, 'move');
  assert.equal(readCinematicSettings({ aspect: 1.85 }).aspect, 1.85);
  assert.equal(readCinematicSettings({ transition: 'wipe', fadeMs: 'x' }).transition, 'fade');
});
