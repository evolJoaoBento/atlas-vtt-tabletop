import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readMap } from '../src/board/mapModel';

const fixture = (name: string): string => readFileSync(`tests/fixtures/${name}`, 'utf8');
const wrap = (state: Record<string, unknown>): string => JSON.stringify({ version: 1, state: { objects: { tokens: {}, pins: {} }, ...state } });

test('reads tokens and pins from a real map', () => {
  const map = readMap('m.atlasmap', fixture('dungeon.atlasmap'));
  assert.equal(map.path, 'm.atlasmap');
  assert.equal(map.background, 'atlas-vtt/assets/dotmm-l1-player-map.webp');
  assert.equal(map.tokens.length, 8);
  assert.equal(map.pins.length, 6);
  const kestrel = map.tokens.find((token) => token.name === 'Kestrel Vane')!;
  assert.deepEqual(kestrel.hp, { current: 34, max: 44 });
  assert.deepEqual(kestrel.conditions, ['dnd5e-exhaustion', 'dnd5e-poisoned']);
  assert.deepEqual(kestrel.conditionValues, { 'dnd5e-exhaustion': 2 });
  assert.equal(kestrel.kind, 'character');
  const bandit = map.tokens.find((token) => token.name === 'Bandit (spy at the peephole)')!;
  assert.equal(bandit.hidden, true);
  assert.equal(bandit.rotation, 180);
  assert.equal(bandit.instanceNumber, 1);
  const pin = map.pins[0]!;
  assert.deepEqual(pin, { id: 'pin_1792170000001_area-1000', x: 1063.6, y: 1374.7, notePath: 'DotMM Full Test/Adventure/Level 1 - Dungeon Level.md#1. Entry Well', icon: 'number', label: '1', hex: false });
  assert.deepEqual(map.tokenSettings, { showNameplates: true, showHPBars: true, showStressBars: false, showInstanceBadges: true, hiddenResources: ['stress'] });
});

test('token defaults', () => {
  const map = readMap('m', wrap({ objects: { tokens: {
    a: { id: 'a', x: 1, y: 2, kind: 'character', hp: 30 },
    b: { id: 'b', x: 0, y: 0, kind: 'character', statblockPath: 'b.md', statblockName: 'Goblin' },
    c: { id: 'c', x: 0, y: 0, kind: 'character', statblockPath: 'c.md' },
    d: { id: 'd', x: 0, y: 0, kind: 'npc' },
  }, pins: {} } }));
  const [a, b, c, d] = map.tokens;
  assert.equal(a!.size, 1);
  assert.deepEqual(a!.hp, { current: 30, max: 100 });
  assert.equal(a!.showRing, true);
  assert.equal(a!.ringColor, '#ffffff');
  assert.equal(a!.name, null);
  assert.equal(a!.hidden, false);
  assert.equal(b!.name, 'Goblin');
  assert.equal(c!.name, 'Unknown Creature');
  assert.equal(d!.kind, 'token');
});

test('resources keep only those with a maximum, in order', () => {
  const map = readMap('m', fixture('dungeon.atlasmap'));
  const thorin = map.tokens.find((token) => token.name === 'Thorin Ashdelve')!;
  assert.deepEqual(thorin.resources, [{ key: 'ac', current: 18, max: 18 }, { key: 'inspiration', current: 1, max: 1 }]);
});

test('grid', () => {
  assert.equal(readMap('m', fixture('arena-hex.atlasmap')).grid.type, 'hex-vertical');
  const off = readMap('m', wrap({ grid: { enabled: false, size: 50, type: 'hex-horizontal', color: '#00FFFF' } })).grid;
  assert.equal(off.enabled, false);
  assert.equal(off.type, 'hex-horizontal');
  assert.equal(off.color, null);
  const none = readMap('m', wrap({})).grid;
  assert.equal(none.size, 70);
  assert.equal(none.snap, true);
  assert.equal(none.type, 'square');
});

test('rejects non-maps', () => {
  assert.throws(() => readMap('m', '{"state":{}}'), /not an Atlas map/);
  assert.throws(() => readMap('m', 'nope'), /not an Atlas map/);
});
