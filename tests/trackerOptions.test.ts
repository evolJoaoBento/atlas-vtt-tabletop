import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setAtlasLanguage } from '../src/atlasPort/atlasText';
import { trackerCompact, trackerOptionEntries, type TrackerSettings } from '../src/board/trackerOptions';

setAtlasLanguage('en');

/** A stand-in for Atlas's settings service with its own switches. */
function atlasSettings(initial: { compact?: boolean; banner?: boolean } = {}): TrackerSettings & { state: { compact: boolean; banner: boolean } } {
  const state = { compact: initial.compact ?? false, banner: initial.banner ?? true };
  return {
    state,
    showsCompactInitiative: () => state.compact,
    setCompactInitiative: (on) => { state.compact = on; },
    initiativeTurnOptions: () => ({ banner: state.banner, movesOnTurn: false }),
    setInitiativeTurnOptions: (changes) => { if (changes.banner !== undefined) state.banner = changes.banner; },
  };
}
const items = (settings: TrackerSettings | null) => trackerOptionEntries(settings).filter((entry) => entry.type === 'item') as Array<Extract<ReturnType<typeof trackerOptionEntries>[number], { type: 'item' }>>;

test('Atlas 0.18 gives the options menu a Compact view row and a Turn banner row, with its texts and icons', () => {
  const [compact, banner] = items(atlasSettings());
  assert.equal(compact!.label, 'Compact view');
  assert.equal(compact!.icon, 'list');
  assert.match(compact!.description!, /plain list without portraits/);
  assert.equal(compact!.checked, false);
  assert.equal(banner!.label, 'Turn banner');
  assert.equal(banner!.icon, 'flag');
  assert.match(banner!.description!, /Names whose turn it is/);
  assert.equal(banner!.checked, true);
});

test('choosing a row writes Atlas\'s own setting, and the check follows it', () => {
  const settings = atlasSettings();
  items(settings)[0]!.onClick();
  assert.equal(settings.state.compact, true);
  assert.equal(items(settings)[0]!.checked, true);
  items(settings)[1]!.onClick();
  assert.equal(settings.state.banner, false);
  assert.equal(items(settings)[1]!.checked, false);
  items(settings)[1]!.onClick();
  assert.equal(settings.state.banner, true);
});

test('the compact view reads Atlas\'s setting: off unless it says true', () => {
  assert.equal(trackerCompact(null), false);
  assert.equal(trackerCompact({}), false);
  assert.equal(trackerCompact(atlasSettings({ compact: true })), true);
  assert.equal(trackerCompact({ showsCompactInitiative: () => { throw new Error('gone'); } }), false);
});

test('an Atlas without a setting leaves its row out; with neither, no menu at all', () => {
  const noCompact: TrackerSettings = { initiativeTurnOptions: () => ({ banner: true }), setInitiativeTurnOptions: () => {} };
  assert.deepEqual(items(noCompact).map((entry) => entry.label), ['Turn banner']);
  const noBanner: TrackerSettings = { showsCompactInitiative: () => false, setCompactInitiative: () => {} };
  assert.deepEqual(items(noBanner).map((entry) => entry.label), ['Compact view']);
  // A reader without its writer is no switch.
  assert.deepEqual(items({ showsCompactInitiative: () => false }), []);
  assert.deepEqual(trackerOptionEntries({}), []);
  assert.deepEqual(trackerOptionEntries(null), []);
});
