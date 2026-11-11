import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { readMap, type BoardPin } from '../src/board/mapModel';
import { canBeReadable, pinMenuEntries } from '../src/board/pinMenu';
import { pinReadableInText, TokenWriter } from '../src/board/tokenWriter';

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

test('readable goes through Atlas (updateNotePin) when it holds the map, else into the file as Atlas writes it', async () => {
  const text = mapText({ p: { id: 'p', kind: 'pin', x: 0, y: 0, notePath: 'Notes/Crypt.md' } });
  const on = JSON.parse(pinReadableInText(text, 'p', true));
  assert.equal(on.state.objects.pins.p.readable, true);
  const off = JSON.parse(pinReadableInText(JSON.stringify(on), 'p', false));
  assert.equal('readable' in off.state.objects.pins.p, false);
  assert.throws(() => pinReadableInText(text, 'nope', true), /no pin nope/);
  const calls: unknown[] = [];
  const view: AtlasView = {
    viewId: 'v',
    atlasStore: { getState: () => ({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false, updateNotePin: (id: string, changes: Record<string, unknown>) => { calls.push([id, changes]); } }) as AtlasSceneState, subscribe: () => () => {} },
  };
  let written = '';
  const writer = new TokenWriter({ views: () => [view], process: async (_path, edit) => { written = edit(text); } });
  assert.equal(await writer.setPinReadable('m.atlasmap', 'p', true), 'atlas');
  assert.equal(await writer.setPinReadable('m.atlasmap', 'p', false), 'atlas');
  assert.deepEqual(calls, [['p', { readable: true }], ['p', { readable: undefined }]]);
  assert.equal(await writer.setPinReadable('other.atlasmap', 'p', true), 'file');
  assert.equal(JSON.parse(written).state.objects.pins.p.readable, true);
});
