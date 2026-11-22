import assert from 'node:assert/strict';
import { test } from 'node:test';
import { savedRollsAccess, SAVED_ROLLS_OPEN_KEY } from '../src/dice/savedRollsAccess';

type Settings = Record<string, unknown>;

/** Atlas's collection settings as the bridge hands them, with the version Atlas says it is. */
function fakeAtlas(options: { version?: string | null; collection?: string | null; settings?: Settings; fails?: boolean } = {}) {
  const settings: Settings = { ...(options.settings ?? {}) };
  const written: Array<{ id: string; change: Settings }> = [];
  const listeners = new Set<(id: string) => void>();
  const writing: number[] = [];
  const stored = new Map<string, unknown>();
  const access = savedRollsAccess({
    bridge: {
      version: () => (options.version === undefined ? '0.18.0' : options.version),
      collectionFor: () => (options.collection === undefined ? 'c1' : options.collection),
      collectionSettings: () => settings,
      updateCollectionSettings: async (id, change) => {
        if (options.fails) throw new Error('disk');
        written.push({ id, change: { ...change } });
        Object.assign(settings, change);
        for (const listener of [...listeners]) listener(id);
        return true;
      },
    },
    mapPath: () => 'atlas-vtt/collections/c1/scenes/a.md',
    changed: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    storage: { load: (key) => stored.get(key), save: (key, value) => { stored.set(key, value); } },
    writing: (_id, on) => writing.push(on ? 1 : -1),
    menu: () => {},
    icon: () => {},
    warn: () => {},
  });
  return { access, settings, written, listeners, writing, stored };
}

test('saved rolls are read from the map\'s collection, as Atlas reads them', () => {
  const { access } = fakeAtlas({ settings: { dicePresets: [{ id: 'a', name: 'Sword', formula: '+3', look: { dice: [{ count: 1, sides: 8 }], crit: 'natural' } }, { id: 'bad', name: '' }] } });
  assert.deepEqual(access.shelf()?.presets.map((preset) => preset.id), ['a']);
});

test('an Atlas older than 0.18, or a map in no collection, offers no saved rolls', () => {
  assert.equal(fakeAtlas({ version: '0.17.3' }).access.shelf(), null);
  assert.equal(fakeAtlas({ version: null }).access.shelf(), null);
  assert.equal(fakeAtlas({ collection: null }).access.shelf(), null);
});

test('a change is written to the collection through Atlas, and the board\'s own reload is told to wait', async () => {
  const { access, written, writing, settings } = fakeAtlas();
  await access.write({ dicePresets: [{ id: 'a', name: 'Sword', formula: '+3' }] as never });
  assert.deepEqual(written.map((entry) => entry.id), ['c1']);
  assert.deepEqual(settings.dicePresets, [{ id: 'a', name: 'Sword', formula: '+3' }]);
  assert.deepEqual(writing, [1, -1]);
});

test('a write Atlas refuses rejects, and the board is told to read again', async () => {
  const { access, writing } = fakeAtlas({ fails: true });
  await assert.rejects(access.write({ dicePresets: [] }));
  assert.deepEqual(writing, [1, -1]);
  await assert.rejects(fakeAtlas({ collection: null }).access.write({ dicePresets: [] }));
});

test('only changes of this collection are heard, until stopped', async () => {
  const { access, listeners } = fakeAtlas();
  let heard = 0;
  const stop = access.onChange(() => { heard++; });
  for (const listener of [...listeners]) { listener('other'); listener('c1'); }
  assert.equal(heard, 1);
  stop();
  assert.equal(listeners.size, 0);
});

test('whether the panel stands open is kept by this device, under Atlas\'s own key', () => {
  const { access, stored } = fakeAtlas();
  assert.equal(access.isOpen(), false);
  access.setOpen(true);
  assert.equal(stored.get(SAVED_ROLLS_OPEN_KEY), true);
  assert.equal(access.isOpen(), true);
  assert.equal(SAVED_ROLLS_OPEN_KEY, 'atlas-vtt-dice-tray-presets-open');
});
