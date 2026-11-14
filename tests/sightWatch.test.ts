import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostShows, SightWatch, withoutHost } from '../src/board/sightWatch';

// The reader polls with the window's timers, as in Obsidian.
(globalThis as { window?: unknown }).window ??= globalThis;

const store = (state: Record<string, unknown>) => ({ getState: () => state, subscribe: () => () => undefined });
const view = (state: Record<string, unknown>, renderer: unknown = {}) => ({ viewId: 'v1', atlasStore: store(state) as never, renderer });
const MAP = { path: 'a.atlasmap', lighting: { enabled: true }, level: 'ground' };

test("Atlas's tab answers for the board only while it holds the board's map, loaded, on the level the board shows", () => {
  assert.equal(hostShows(view({ mapPath: 'a.atlasmap', mapLoaded: true, viewedLevel: 'ground' }), MAP), true);
  assert.equal(hostShows(view({ mapPath: 'a.atlasmap', mapLoaded: true }), MAP), true);
  assert.equal(hostShows(view({ mapPath: 'b.atlasmap', mapLoaded: true }), MAP), false);
  assert.equal(hostShows(view({ mapPath: 'a.atlasmap', isMapLoading: true }), MAP), false);
  assert.equal(hostShows(view({ mapPath: 'a.atlasmap', viewedLevel: 'upper' }), MAP), false);
  assert.equal(hostShows(null, MAP), false);
});

test('without it a scene saved lit shows players nothing, one saved unlit no sight', () => {
  assert.deepEqual(withoutHost(MAP), { kind: 'pending' });
  assert.deepEqual(withoutHost({ ...MAP, lighting: { enabled: false } }), { kind: 'unlit' });
  assert.deepEqual(withoutHost(null), { kind: 'unlit' });
});

test('a lit scene whose Atlas tab has no lighting to read is pending, for players and the point of view alike', () => {
  const answers: unknown[] = [];
  const watch = new SightWatch((players, pov) => answers.push([players.kind, pov?.kind ?? null]));
  const host = view({ mapPath: 'a.atlasmap', mapLoaded: true, lighting: { enabled: true }, objects: { tokens: {} } });
  watch.follow(host, MAP, null);
  watch.follow(host, MAP, 'tok');
  watch.follow(null, MAP, 'tok');
  watch.dispose();
  assert.deepEqual(answers, [['pending', null], ['pending', 'pending'], ['pending', 'pending']]);
});
