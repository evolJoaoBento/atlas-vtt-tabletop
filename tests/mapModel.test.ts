import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAP_STATE_KEYS, isDowned, mapStateChanged, readMap, readMapState } from '../src/board/mapModel';
import { HP_RESOURCE } from '../src/board/resources';

const fixture = (name: string): string => readFileSync(`tests/fixtures/${name}`, 'utf8');
const wrap = (state: Record<string, unknown>): string => JSON.stringify({ version: 1, state: { objects: { tokens: {}, pins: {} }, ...state } });

test('reads tokens and pins from a real map', () => {
  const map = readMap('m.atlasmap', fixture('dungeon.atlasmap'));
  assert.equal(map.path, 'm.atlasmap');
  assert.equal(map.background, 'atlas-vtt/assets/dotmm-l1-player-map.webp');
  assert.equal(map.tokens.length, 8);
  assert.equal(map.pins.length, 6);
  const kestrel = map.tokens.find((token) => token.name === 'Kestrel Vane')!;
  assert.deepEqual(kestrel.resources.hp, { current: 34, max: 44 });
  assert.deepEqual(kestrel.conditions, ['dnd5e-exhaustion', 'dnd5e-poisoned']);
  assert.deepEqual(kestrel.conditionValues, { 'dnd5e-exhaustion': 2 });
  assert.equal(kestrel.statblockPath, 'DotMM Full Test/Party/Kestrel Vane.md');
  assert.equal(kestrel.kind, 'character');
  const bandit = map.tokens.find((token) => token.name === 'Bandit (spy at the peephole)')!;
  assert.equal(bandit.hidden, true);
  assert.equal(bandit.rotation, 180);
  assert.equal(bandit.instanceNumber, 1);
  const pin = map.pins[0]!;
  assert.deepEqual(pin, { id: 'pin_1792170000001_area-1000', x: 1063.6, y: 1374.7, notePath: 'DotMM Full Test/Adventure/Level 1 - Dungeon Level.md#1. Entry Well', icon: 'number', label: '1', hex: false, name: null, readable: true });
  assert.deepEqual(map.tokenSettings, { showNameplates: true, showInstanceBadges: true, hiddenResources: ['stress'] });
});

test("Atlas's store reads as the map file does", () => {
  const text = fixture('dungeon.atlasmap');
  const state = JSON.parse(text).state;
  const fromFile = readMap('maps/dungeon.atlasmap', text);
  const fromStore = readMapState('maps/dungeon.atlasmap', state);
  assert.deepEqual({ ...fromStore, rawGrid: null }, { ...fromFile, rawGrid: null });
  assert.equal(fromStore.rawGrid, state.grid);
  assert.ok(fromStore.tokens.length > 0);

  // In memory Atlas holds a token's resources by key (the file has `hp`, `stress`…), and the levels' alignments apart.
  const id = Object.keys(state.objects.tokens)[0];
  const live = structuredClone(state);
  const { hp: _hp, stress: _stress, hope: _hope, statblockResources: _others, ...bare } = live.objects.tokens[id];
  live.objects.tokens[id] = { ...bare, resources: { hp: { current: 3, max: 9 } } };
  live.levels = [{ id: 'ground', name: 'Ground', elevation: { bottom: 0 } }, { id: 'upper', name: 'Upper', elevation: { bottom: 10 } }];
  live.levelAlignments = { upper: { offset: { x: 10, y: 20 }, scale: 1, stretch: { x: 1, y: 1 } } };
  const read = readMapState('maps/dungeon.atlasmap', live, 'upper');
  assert.deepEqual(read.tokens.find((token) => token.id === id)?.resources.hp, { current: 3, max: 9 });
  assert.equal(read.level, 'upper');
  assert.deepEqual(read, readMap('maps/dungeon.atlasmap', JSON.stringify({ state: live }), 'upper'));
  assert.throws(() => readMapState('m', { mapPath: 'm' }), /not an Atlas map/);
  assert.throws(() => readMapState('m', null), /not an Atlas map/);
});

test("rooms and Atlas 0.15's room walls are never both drawn", () => {
  const room = { id: 'r', kind: 'room', name: 'Hall', order: 0, area: [[0, 0, 800, 0, 800, 800, 0, 800]] };
  // A 0.14 file Atlas 0.15 has not saved yet: the outline is worked out.
  const old = readMapState('m', { objects: { tokens: {}, rooms: { r: room } } });
  assert.equal(old.walls.length, 4);
  assert.ok(old.walls.every((wall) => wall.id.startsWith('room_') && wall.chain === 'rooms'));
  // Saved by 0.15, with the rooms left in by a merge or a hand edit: only the stored walls.
  const converted = { room__0_0_800_0: { id: 'room__0_0_800_0', kind: 'wall', type: 'solid', closed: true, chainId: 'rooms_', floor: 'left', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } } };
  const both = readMapState('m', { objects: { tokens: {}, rooms: { r: room }, walls: converted } });
  assert.deepEqual(both.walls.map((wall) => wall.id), ['room__0_0_800_0']);
  assert.equal(readMapState('m', { objects: { tokens: {}, walls: converted } }).walls.length, 1);
});

test('mapStateChanged ignores camera, selection and tool state', () => {
  const state: Record<string, unknown> = { ...JSON.parse(fixture('dungeon.atlasmap')).state, mapPath: 'maps/dungeon.atlasmap' };
  assert.equal(mapStateChanged(state, { ...state }), false);
  assert.equal(mapStateChanged(state, { ...state, camera: { x: 1 }, selectedIds: ['a'], isDragging: true, measurePopover: {}, diceTrayOpen: true, activeTool: 'measure' }), false);
  assert.equal(mapStateChanged(state, { ...state, objects: { ...(state.objects as object) } }), true);
  for (const key of MAP_STATE_KEYS) assert.equal(mapStateChanged(state, { ...state, [key]: {} }), true, key);
  assert.deepEqual([...MAP_STATE_KEYS], ['mapPath', 'background', 'grid', 'objects', 'levels', 'levelAlignments', 'viewedLevel', 'lighting', 'initiative', 'tokenSettings']);
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
  assert.deepEqual(a!.resources.hp, { current: 30, max: 100 });
  assert.equal(a!.showRing, true);
  assert.equal(a!.ringColor, '#ffffff');
  assert.equal(a!.name, null);
  assert.equal(a!.hidden, false);
  assert.equal(b!.name, 'Goblin');
  assert.equal(c!.name, 'Unknown Creature');
  assert.equal(d!.kind, 'token');
  assert.equal(a!.statblockPath, null);
});

test('a token\'s resources are read as Atlas 0.8 holds them, by key', () => {
  const map = readMap('m', fixture('dungeon.atlasmap'));
  const thorin = map.tokens.find((token) => token.name === 'Thorin Ashdelve')!;
  assert.deepEqual(thorin.resources.ac, { current: 18, max: 18 });
  assert.deepEqual(thorin.resources.inspiration, { current: 1, max: 1 });
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
    { id: 'a', icon: 'flame', x: 100, y: 200, color: '#ff0000', size: 70, opacity: 0.8, rotation: 0, hidden: false },
    { id: 'd', icon: 'gem', x: 1, y: 2, color: '#ffffff', size: 70, opacity: 1, rotation: 0, hidden: false },
  ]);
});

test('downed: a character with a defeating resource spent; 0/0 is no HP at all (Atlas)', () => {
  const map = readMap('m', wrap({ objects: { pins: {}, tokens: {
    a: { id: 'a', x: 0, y: 0, kind: 'character', hp: { current: 0, max: 9 } },
    b: { id: 'b', x: 0, y: 0, kind: 'character', hp: { current: 0, max: 0 } },
    c: { id: 'c', x: 0, y: 0, kind: 'character', hp: 0 },
    d: { id: 'd', x: 0, y: 0, kind: 'token', hp: { current: 0, max: 9 } },
    e: { id: 'e', x: 0, y: 0, kind: 'character', hp: { current: 3, max: 9 } },
  } } }));
  const defs = [HP_RESOURCE];
  assert.deepEqual(map.tokens.map((token) => isDowned(token, defs)), [true, false, true, false, false]);
  // HP that does not defeat (a collection that says so) downs nobody.
  assert.deepEqual(map.tokens.map((token) => isDowned(token, [{ ...HP_RESOURCE, defeatedWhenSpent: false }])), [false, false, false, false, false]);
});

test('older hex numbers only number hex grids; a stress max of 0 reads as 10 like Atlas', () => {
  assert.equal(readMap('m', wrap({ grid: { type: 'square', hexNumbers: 'column-row' } })).grid.numbers, null);
  const map = readMap('m', wrap({ objects: { pins: {}, tokens: { a: { id: 'a', x: 0, y: 0, kind: 'character', stress: 2, maxStress: 0 } } } }));
  assert.deepEqual(map.tokens[0]!.resources.stress, { current: 2, max: 10 });
});

test('text labels are read as Atlas reads them (its 0.16 reader: a text with no size is 31.5 px), with its defaults; empty ones left out', () => {
  const map = readMap('m', wrap({ objects: { tokens: {}, pins: {}, texts: {
    a: { id: 'a', kind: 'text', x: 100, y: 50, text: 'Throne Room', fontSize: 24, fontFamily: 'Georgia', color: '#ffcc00', backgroundColor: '#000000', opacity: 0.6, borderRadius: 4, bold: true, rotation: 30, scale: 2, hidden: false },
    b: { id: 'b', kind: 'text', x: 0, y: 0, text: 'Plain' },
    c: { id: 'c', kind: 'text', x: 0, y: 0, text: '' },
  } } }));
  assert.deepEqual(map.texts, [
    { id: 'a', x: 100, y: 50, text: 'Throne Room', fontSize: 24, fontFamily: 'Georgia', color: '#ffcc00', backgroundColor: '#000000', padding: 8, borderRadius: 4, opacity: 0.6, align: 'center', bold: true, italic: false, rotation: 30, scale: 2, hidden: false },
    { id: 'b', x: 0, y: 0, text: 'Plain', fontSize: 31.5, fontFamily: 'Arial', color: '#ffffff', backgroundColor: null, padding: 8, borderRadius: 0, opacity: 1, align: 'center', bold: false, italic: false, rotation: 0, scale: 1, hidden: false },
  ]);
});

test('the tokens in Atlas\'s initiative tracker are read', () => {
  const map = readMap('m', JSON.stringify({ state: { objects: { tokens: {}, pins: {} }, initiative: { entries: [{ id: 'i1', tokenId: 'a' }, { id: 'i2', tokenId: 'b' }, { id: 'i3' }] } } }));
  assert.deepEqual(map.initiative.entries.map((entry) => entry.tokenId), ['a', 'b']);
  assert.deepEqual(readMap('m', JSON.stringify({ state: { objects: { tokens: {}, pins: {} } } })).initiative.entries, []);
});

test('a token\'s side (a named one in Atlas 0.9) and whether it sees are read for a fight by sides', () => {
  const map = readMap('m', JSON.stringify({ state: { objects: { tokens: {
    a: { id: 'a', side: 'opponents', vision: { enabled: true } }, b: { id: 'b', side: 'nobody' },
  }, pins: {} } } }));
  assert.deepEqual(map.tokens.map((token) => [token.side, token.sees]), [['opponents', true], ['nobody', false]]);
});

test('a combatant kept beside the map (Atlas 0.9) is read as such, and carries no light onto the map', () => {
  const map = readMap('m', JSON.stringify({ state: { objects: { tokens: {
    a: { id: 'a', x: -105, y: 0, offMap: true, light: { bright: 10, dim: 20 } }, b: { id: 'b', x: 70, y: 70 },
  }, pins: {} } } }));
  assert.deepEqual(map.tokens.map((token) => [token.id, token.offMap]), [['a', true], ['b', false]]);
  assert.deepEqual(map.lights, []);
});
