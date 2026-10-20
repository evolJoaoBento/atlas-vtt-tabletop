import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDowned, readMap } from '../src/board/mapModel';

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
  assert.equal(kestrel.statblockPath, 'DotMM Full Test/Party/Kestrel Vane.md');
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
  assert.equal(a!.statblockPath, null);
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
  const numbered = readMap('m', wrap({ grid: { type: 'square', cellNumbers: 'letter-number', cellNumberOpacity: 0.5 } })).grid;
  assert.equal(numbered.numbers, 'letter-number');
  assert.equal(numbered.numberOpacity, 0.5);
  const oldHex = readMap('m', wrap({ grid: { type: 'hex-vertical', hexNumbers: 'column-row' } })).grid;
  assert.equal(oldHex.numbers, 'column-row');
  assert.equal(oldHex.numberOpacity, 0.8);
  assert.equal(readMap('m', wrap({ grid: { cellNumbers: 'roman' } })).grid.numbers, null);
  assert.deepEqual(readMap('m', wrap({ grid: { unitType: 'yards', unitDistance: 10 } })).rawGrid, { unitType: 'yards', unitDistance: 10 });
  const none = readMap('m', wrap({})).grid;
  assert.equal(none.size, 70);
  assert.equal(none.snap, true);
  assert.equal(none.type, 'square');
});

test('rejects non-maps', () => {
  assert.throws(() => readMap('m', '{"state":{}}'), /not an Atlas map/);
  assert.throws(() => readMap('m', 'nope'), /not an Atlas map/);
});

test('icon stamps are read from the drawings; strokes are left out', () => {
  const map = readMap('m', wrap({ objects: { tokens: {}, pins: {}, drawings: {
    a: { id: 'a', kind: 'drawing', type: 'icon', icon: 'flame', points: [{ x: 100, y: 200 }], color: '#ff0000', width: 70, opacity: 0.8 },
    b: { id: 'b', kind: 'drawing', type: 'pen', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#000', width: 3 },
    c: { id: 'c', kind: 'drawing', type: 'icon', icon: 'skull', points: [] },
    d: { id: 'd', kind: 'drawing', type: 'icon', icon: 'gem', points: [{ x: 1, y: 2 }] },
  } } }));
  assert.deepEqual(map.icons, [
    { id: 'a', icon: 'flame', x: 100, y: 200, color: '#ff0000', size: 70, opacity: 0.8 },
    { id: 'd', icon: 'gem', x: 1, y: 2, color: '#ffffff', size: 70, opacity: 1 },
  ]);
});

test('downed: a character at 0 HP or less, but 0/0 is no HP at all (Atlas)', () => {
  const map = readMap('m', wrap({ objects: { pins: {}, tokens: {
    a: { id: 'a', x: 0, y: 0, kind: 'character', hp: { current: 0, max: 9 } },
    b: { id: 'b', x: 0, y: 0, kind: 'character', hp: { current: 0, max: 0 } },
    c: { id: 'c', x: 0, y: 0, kind: 'character', hp: 0 },
    d: { id: 'd', x: 0, y: 0, kind: 'token', hp: { current: 0, max: 9 } },
    e: { id: 'e', x: 0, y: 0, kind: 'character', hp: { current: 3, max: 9 } },
  } } }));
  assert.deepEqual(map.tokens.map(isDowned), [true, false, true, false, false]);
});

test('older hex numbers only number hex grids; a stress max of 0 reads as 10 like Atlas', () => {
  assert.equal(readMap('m', wrap({ grid: { type: 'square', hexNumbers: 'column-row' } })).grid.numbers, null);
  const map = readMap('m', wrap({ objects: { pins: {}, tokens: { a: { id: 'a', x: 0, y: 0, kind: 'character', stress: 2, maxStress: 0 } } } }));
  assert.deepEqual(map.tokens[0]!.stress, { current: 2, max: 10 });
});
