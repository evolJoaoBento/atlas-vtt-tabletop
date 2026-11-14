import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extrasOf, mergeExtra, readLightHeight, readWallExtra } from '../src/board/recordExtras';
import { readLights, readWalls } from '../src/board/walls';

const wall = (id: string, tabletop?: unknown, more: Record<string, unknown> = {}) => ({ id, kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, ...(tabletop !== undefined ? { tabletop } : {}), ...more });

test("what the GM set on a wall in 3D is read off Atlas's own record, key by key, within the bounds the board always held", () => {
  assert.deepEqual(readWallExtra({ v: 1, height: 2.5, width: 0.3, material: 'Materials/stone', window: { bottom: 1, top: 2 }, prop: 'Props/door.glb', hinge: true, side: true }),
    { height: 2.5, width: 0.3, material: 'Materials/stone', window: { bottom: 1, top: 2 }, prop: 'Props/door.glb', hinge: true, side: true });
  // A height of none (flat on the floor) is one; a width of none is not.
  assert.deepEqual(readWallExtra({ v: 1, height: 0, width: 0 }), { height: 0 });
  // Junk is ignored key by key, never thrown on; a field with nothing left reads as none.
  assert.deepEqual(readWallExtra({ v: 1, height: -1, width: 'wide', material: 7, window: { bottom: 2, top: 1 }, prop: '', hinge: 'yes', spell: 'measure_1', extra: { a: 1 } }), null);
  assert.deepEqual(readWallExtra({ height: Number.NaN, window: { bottom: 0, top: 1.5 } }), { window: { bottom: 0, top: 1.5 } });
  for (const junk of [undefined, null, 'x', 7, [], { v: 1 }]) assert.equal(readWallExtra(junk), null);
});

test("a light's height is its record's, a carried light's its token's", () => {
  assert.equal(readLightHeight({ v: 1, height: 3 }, 'height'), 3);
  assert.equal(readLightHeight({ v: 1, lightHeight: 0 }, 'lightHeight'), 0);
  assert.equal(readLightHeight({ v: 1, height: 3 }, 'lightHeight'), null);
  for (const junk of [undefined, 'x', { height: -1 }, { height: '3' }, { height: Number.POSITIVE_INFINITY }]) assert.equal(readLightHeight(junk, 'height'), null);
});

test('a change is laid over the field as it is: other keys stay (a spell\'s own), a key given as null goes, and a field with nothing left goes whole', () => {
  assert.deepEqual(mergeExtra({ v: 1, height: 2, spell: 'measure_1' }, { height: null, material: 'M' }), { v: 1, spell: 'measure_1', material: 'M' });
  assert.deepEqual(mergeExtra(undefined, { height: 3 }), { v: 1, height: 3 });
  assert.deepEqual(mergeExtra('junk', { width: 0.2 }), { v: 1, width: 0.2 });
  assert.equal(mergeExtra({ v: 1, height: 2 }, { height: null }), undefined);
  assert.equal(mergeExtra(undefined, { height: null }), undefined);
  // The field as it was is never changed in place.
  const kept = { v: 1, height: 2 };
  mergeExtra(kept, { height: 5 });
  assert.deepEqual(kept, { v: 1, height: 2 });
});

test('the map as read carries its extras: on each wall, each placed light, and each light a token carries', () => {
  const walls = readWalls({ a: wall('a', { v: 1, height: 3, material: 'M' }), b: wall('b'), c: wall('c', 'junk') });
  assert.deepEqual(walls.map((each) => each.extra ?? null), [{ height: 3, material: 'M' }, null, null]);
  const emission = { bright: 10, dim: 20, color: '#ffffff', intensity: 1, animation: 'none' };
  const lights = readLights(
    { l1: { id: 'l1', x: 0, y: 0, emission, tabletop: { v: 1, height: 4 } }, l2: { id: 'l2', x: 0, y: 0, emission } },
    { t1: { id: 't1', x: 0, y: 0, light: emission, tabletop: { v: 1, lightHeight: 1.5, height: 9 } }, t2: { id: 't2', x: 0, y: 0, light: emission } },
  );
  assert.deepEqual(lights.map((light) => [light.id, light.ownHeight ?? null]), [['l1', 4], ['l2', null], ['t1', 1.5], ['t2', null]]);
});

test("the board asks one place for a wall's or a light's extras: the record's, else what data.json still holds of a map not moved yet", () => {
  const walls = readWalls({
    a: wall('a', { v: 1, height: 3, material: 'Stone', window: { bottom: 1, top: 2 } }),
    d: wall('d', { v: 1, prop: 'Props/door.glb', hinge: true }, { type: 'door' }),
    old: wall('old'),
  });
  const lights = readLights({ l1: { id: 'l1', x: 0, y: 0, emission: { bright: 1, dim: 2, color: '#ffffff', intensity: 1, animation: 'none' }, tabletop: { v: 1, height: 4 } } }, {});
  const legacy = { wallHeights: { a: 9, old: 1.5 }, wallWidths: { old: 0.4 }, wallMaterials: { old: 'Wood', gone: 'Brick' }, windows: { old: { bottom: 0.5, top: 1 } }, doorProps: { old: 'Props/gate.glb' }, doorFlips: { old: { side: true as const } }, lightHeights: { l1: 7, l9: 2 } };
  const extras = extrasOf({ walls, lights }, legacy);
  assert.deepEqual([extras.wallHeight('a'), extras.wallMaterial('a'), extras.windowOf('a'), extras.wallWidth('a')], [3, 'Stone', { bottom: 1, top: 2 }, null]);
  assert.deepEqual([extras.doorProp('d'), extras.doorFlip('d')], ['Props/door.glb', { hinge: true, side: false }]);
  // Not on the record: what data.json holds.
  assert.deepEqual([extras.wallHeight('old'), extras.wallWidth('old'), extras.wallMaterial('old'), extras.windowOf('old'), extras.doorProp('old'), extras.doorFlip('old')],
    [1.5, 0.4, 'Wood', { bottom: 0.5, top: 1 }, 'Props/gate.glb', { hinge: false, side: true }]);
  assert.deepEqual([extras.lightHeight('l1'), extras.lightHeight('l9'), extras.lightHeight('none')], [4, 2, null]);
  // Each material once, the records' first; one painted on a wall Atlas no longer has is not used.
  assert.deepEqual(extras.usedMaterials(), ['Stone', 'Wood']);
  // No map, no legacy: nothing, and nothing throws.
  const none = extrasOf(null);
  assert.deepEqual([none.wallHeight('a'), none.doorFlip('a'), none.lightHeight('l'), none.usedMaterials()], [null, { hinge: false, side: false }, null, []]);
});
