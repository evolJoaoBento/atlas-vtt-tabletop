import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { readMap, type BoardPin } from '../src/board/mapModel';
import { canBeReadable, pinMenuEntries } from '../src/board/pinMenu';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';

const mapText = (pins: Record<string, unknown>): string => JSON.stringify({ version: 1, state: { objects: { tokens: {}, pins } } });
const pin = (over: Partial<BoardPin> = {}): BoardPin => ({ id: 'p', x: 0, y: 0, notePath: 'Notes/Crypt.md', icon: 'pin', label: null, hex: false, ...over });

test('a pin is read readable by players where Atlas marked it so, and not otherwise', () => {
  const map = readMap('m.atlasmap', mapText({ a: { id: 'a', kind: 'pin', x: 1, y: 2, notePath: 'Notes/A.md', readable: true }, b: { id: 'b', kind: 'pin', x: 3, y: 4, notePath: 'Notes/B.md' } }));
  assert.deepEqual(map.pins.map((each) => [each.id, each.readable === true]), [['a', true], ['b', false]]);
});

test('Readable by players is offered, as Atlas offers it, only for a pin linking a note', () => {
  assert.equal(canBeReadable('Notes/Crypt.md'), true);
  assert.equal(canBeReadable('Notes/Crypt.md#The altar'), true);
  assert.equal(canBeReadable(null), false);
  assert.equal(canBeReadable('#heading only'), false);
  assert.equal(canBeReadable('maps/Cellar.atlasmap'), false);
  assert.equal(canBeReadable('maps/Cellar.atlasmap#scene'), false);
  assert.equal(canBeReadable('atlas-vtt/collections/c1/encounters/Goblins.md'), false);
  assert.equal(canBeReadable('atlas-vtt/collections/c1/encounters/Goblins.json'), true);
  assert.deepEqual(pinMenuEntries(pin({ notePath: 'maps/Cellar.atlasmap' }), () => undefined), []);
});

test('the pin menu ticks Readable by players and toggles it', () => {
  const set: boolean[] = [];
  const [off] = pinMenuEntries(pin(), (readable) => set.push(readable));
  assert.equal(off?.type === 'item' && off.label, 'Readable by players');
  assert.equal(off?.type === 'item' && off.checked, false);
  if (off?.type === 'item') off.onClick();
  const [on] = pinMenuEntries(pin({ readable: true }), (readable) => set.push(readable));
  assert.equal(on?.type === 'item' && on.checked, true);
  if (on?.type === 'item') on.onClick();
  assert.deepEqual(set, [true, false]);
});

test('readable goes through Atlas (updateNotePin) when it holds the map, and is refused on one it does not', async () => {
  const calls: unknown[] = [];
  const view: AtlasView = {
    viewId: 'v',
    atlasStore: { getState: () => ({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false, updateNotePin: (id: string, changes: Record<string, unknown>) => { calls.push([id, changes]); } }) as AtlasSceneState, subscribe: () => () => {} },
  };
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await writer.setPinReadable('m.atlasmap', 'p', true);
  await writer.setPinReadable('m.atlasmap', 'p', false);
  assert.deepEqual(calls, [['p', { readable: true }], ['p', { readable: undefined }]]);
  await assert.rejects(writer.setPinReadable('other.atlasmap', 'p', true), NotHeldError);
  assert.equal(calls.length, 2);
});
