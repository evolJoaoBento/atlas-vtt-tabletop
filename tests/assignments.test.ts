import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assignments, readAssignments } from '../src/assignments';

test('readAssignments drops malformed entries and clamps values', () => {
  const data = readAssignments({ 'm.md': { a: { mini: 'x.glb', scale: 99, turn: -90 }, b: { mini: '' }, c: null }, bad: 3 });
  assert.deepEqual(data, { 'm.md': { a: { mini: 'x.glb', scale: 4, turn: 270 } } });
});

test('a mini keeps a round or square base, and anything else is no base', () => {
  const data = readAssignments({ 'm.md': { a: { mini: 'x.glb', base: 'round' }, b: { mini: 'y.glb', base: 'square' }, c: { mini: 'z.glb', base: 'hexagon' }, d: { mini: 'w.glb', base: 'none' } } });
  assert.equal(data['m.md'].a.base, 'round');
  assert.equal(data['m.md'].b.base, 'square');
  assert.equal('base' in data['m.md'].c, false);
  assert.equal('base' in data['m.md'].d, false);
  const a = new Assignments();
  a.set('m.md', 't', { mini: 'x.glb', scale: 1, turn: 0, base: 'square' });
  assert.equal(a.get('m.md', 't').base, 'square');
  a.set('m.md', 't', { mini: 'x.glb', scale: 1, turn: 0, base: 'none' });
  assert.equal('base' in a.get('m.md', 't'), false);
  // The base follows a renamed GLB with the rest of the placement.
  a.set('m.md', 't', { mini: 'minis/x.glb', scale: 1, turn: 0, base: 'round' });
  a.rename('minis/x.glb', 'minis/y.glb');
  assert.deepEqual(a.get('m.md', 't'), { mini: 'minis/y.glb', scale: 1, turn: 0, base: 'round' });
});

test('set, get, remove; empty maps go', () => {
  const a = new Assignments();
  const seen = [];
  a.onChange((m) => seen.push(m));
  a.set('m.md', 't1', { mini: 'x.glb', scale: 1, turn: 0 });
  assert.equal(a.get('m.md', 't1').mini, 'x.glb');
  a.remove('m.md', 't1');
  assert.equal(a.get('m.md', 't1'), null);
  assert.deepEqual(a.toJSON(), {});
  assert.deepEqual(seen, ['m.md', 'm.md']);
});

test('rename follows maps, folders and GLBs', () => {
  const a = new Assignments({ 'maps/a.md': { t: { mini: 'minis/orc.glb', scale: 1, turn: 0 } } });
  a.rename('maps', 'scenes');
  a.rename('minis/orc.glb', 'minis/big orc.glb');
  assert.deepEqual(a.toJSON(), { 'scenes/a.md': { t: { mini: 'minis/big orc.glb', scale: 1, turn: 0 } } });
  a.rename('nothing', 'else');
});

test('deleting a GLB or map removes its placements, prefix-safe', () => {
  const a = new Assignments({
    'a.md': { t: { mini: 'm/orc.glb', scale: 1, turn: 0 }, u: { mini: 'm/orc.glb2', scale: 1, turn: 0 } },
    'b.md': { t: { mini: 'm/elf.glb', scale: 1, turn: 0 } },
  });
  a.deleted('m/orc.glb');
  assert.deepEqual(Object.keys(a.forMap('a.md')), ['u']);
  a.deleted('b.md');
  assert.deepEqual(Object.keys(a.toJSON()), ['a.md']);
});
