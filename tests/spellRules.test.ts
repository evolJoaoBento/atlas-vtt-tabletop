import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readSpellNote } from '../src/board/spellNotes';
import { readCastSpells, readSpellRequests, type Spell } from '../src/board/spells';
import { derivedRecords, frontmatterOf, inDifficultSpell, pushTo, readSpellRules, rulesFromNote, slide, spellFootprint, spellRuleLights, spellRuleWalls } from '../src/board/spellRules';
import type { BoardWall } from '../src/board/walls';

const rulesOf = (name: string) => {
  const note = readSpellNote(readFileSync(`tests/fixtures/spells/rules/${name}.md`, 'utf8'), name);
  assert.ok(note, name);
  return note.rules;
};

test('the SRD wording gives a spell its rules: walls, obscuring, darkness, light, difficult ground, a push, a teleport', () => {
  assert.deepEqual(rulesOf('Wall of Stone'), { wall: { look: 'stone', blocks: 'both' } });
  assert.deepEqual(rulesOf('Fog Cloud'), { obscure: true });
  assert.deepEqual(rulesOf('Darkness'), { obscure: true, dark: true });
  assert.deepEqual(rulesOf('Daylight'), { light: { bright: 60, dim: 60 } });
  assert.deepEqual(rulesOf('Web'), { difficult: true });
  assert.deepEqual(rulesOf('Thunderwave'), { push: 10 });
  assert.deepEqual(rulesOf('Misty Step'), { teleport: 30 });
  // "Difficult terrain doesn't cost you extra movement" is no difficult terrain.
  assert.equal(rulesOf('Freedom of Movement'), null);
});

test("a note's spell- properties say what its text cannot, and turn off what it gets wrong", () => {
  const spiritual = readSpellNote(`---\nspell-summon: Spiritual Weapon\nspell-summon-count: 2\n---\n${readFileSync('tests/fixtures/spells/rules/Spiritual Weapon.md', 'utf8')}`, 'Spiritual Weapon');
  assert.deepEqual(spiritual?.rules, { summon: { name: 'Spiritual Weapon', count: 2 } });
  assert.deepEqual(frontmatterOf('---\nspell-wall: Ice\nspell-push: "-10 ft"\n---\nbody'), { 'spell-wall': 'Ice', 'spell-push': '-10 ft' });
  const own = rulesFromNote({ 'spell-wall': 'wood', 'spell-wall-blocks': 'sight', 'spell-light': '15/30', 'spell-light-color': '#ff8800', 'spell-push': '-10', 'spell-teleport': '60', 'spell-portal': 'Blue gate', 'spell-difficult': 'yes', 'spell-dark': 'true', 'spell-obscure': 'true' }, 'Homebrew', '');
  assert.deepEqual(own, { wall: { look: 'wood', blocks: 'sight' }, obscure: true, dark: true, difficult: true, light: { bright: 15, dim: 30, color: '#ff8800' }, push: -10, teleport: 60, portal: 'Blue gate' });
  // A property set to false or none turns off what the text would give.
  assert.equal(rulesFromNote({ 'spell-push': 'none' }, 'Thunderwave', 'each creature is pushed 10 feet away from you'), null);
  assert.equal(rulesFromNote({ 'spell-difficult': 'false' }, 'X', 'the area becomes difficult terrain'), null);
  // A gate or summons named "true" takes the spell's name.
  assert.deepEqual(rulesFromNote({ 'spell-portal': 'true', 'spell-summon': 'yes' }, 'Arcane Gate', ''), { portal: 'Arcane Gate', summon: { name: 'Arcane Gate', count: 1 } });
});

test('rules not well formed are left out, and travel with casts and asks', () => {
  assert.equal(readSpellRules({ push: 'far', wall: { look: 'gold', blocks: 'both' } }), null);
  assert.deepEqual(readSpellRules({ summon: { name: 'Wolf', count: 99 }, junk: 1 }), { summon: { name: 'Wolf', count: 20 } });
  assert.equal(readSpellRules({ name: 'Only a name' }), null);
  const spell = { shape: 'sphere', from: 'point', at: { x: 0, y: 0, h: 10 }, yaw: 0, pitch: 0, roll: 0, size: 100, length: 0, angle: 1 };
  assert.deepEqual(readCastSpells([{ id: 's1', owner: 'p', color: '#fff', spell, rules: { teleport: 30 } }])[0]?.rules, { teleport: 30 });
  assert.equal(readCastSpells([{ id: 's1', owner: 'p', color: '#fff', spell, rules: { push: 'x' } }])[0]?.rules, undefined);
  assert.deepEqual(readSpellRequests([{ id: 'a1', tokenId: 't', ask: { shape: 'sphere', from: 'point', size: 10, length: 0, rules: { dark: true, obscure: true } } }])[0]?.ask.rules, { obscure: true, dark: true });
});

const ball = (x: number, y: number, size: number): Spell => ({ shape: 'sphere', from: 'point', at: { x, y, h: 0 }, yaw: 0, pitch: 0, roll: 0, size, length: 0, angle: 1 });

test('a spell stands its walls while it lasts: a wall its run, an obscuring area its edge, stopping sight alone', () => {
  const wall: Spell = { shape: 'wall', from: 'point', at: { x: 0, y: 0, h: 0 }, to: { x: 300, y: 0 }, yaw: 0, pitch: 0, roll: 0, size: 10, length: 100, angle: 1 };
  const stone = spellRuleWalls('w1', wall, { wall: { look: 'stone', blocks: 'both' } });
  assert.equal(stone.length, 1);
  assert.deepEqual([stone[0]!.p1, stone[0]!.p2, stone[0]!.blocks], [{ x: 0, y: 0 }, { x: 300, y: 0 }, null]);
  assert.equal(spellRuleWalls('w2', wall, { wall: { look: 'force', blocks: 'move' } })[0]!.blocks, 'movement');
  const fog = spellRuleWalls('f', ball(500, 500, 140), { obscure: true });
  assert.equal(fog.length, 32);
  assert.ok(fog.every((segment) => segment.blocks === 'sight'));
  // The edge runs round the sphere: every corner about its radius from its middle.
  for (const segment of fog) assert.ok(Math.abs(Math.hypot(segment.p1.x - 500, segment.p1.y - 500) - 140) < 3, JSON.stringify(segment.p1));
  assert.deepEqual(spellRuleWalls('n', ball(0, 0, 10), { push: 10 }), []);
});

test('light and magical darkness from the middle of the area, in the scene units', () => {
  const [light] = spellRuleLights('d', ball(100, 100, 50), { light: { bright: 60, dim: 60 } }, 1.5 / 5, 70 / 1.5);
  assert.deepEqual([Math.round(light!.x), Math.round(light!.y), light!.bright, light!.dim, light!.darkness], [100, 100, 18, 36, false]);
  const [dark] = spellRuleLights('k', ball(100, 100, 140), { dark: true, obscure: true }, 1, 70 / 5);
  assert.equal(dark!.darkness, true);
  assert.ok(Math.abs(dark!.bright - 10) < 0.3, String(dark!.bright));
  const middle = spellFootprint(ball(10, 20, 5)).middle;
  assert.ok(Math.abs(middle.x - 10) < 1e-6 && Math.abs(middle.y - 20) < 1e-6, JSON.stringify(middle));
});

test('a push goes straight away from where the spell comes from, a pull toward it, stopping short of a wall', () => {
  assert.deepEqual(pushTo({ x: 0, y: 0 }, { x: 70, y: 0 }, 140), { x: 210, y: 0 });
  assert.deepEqual(pushTo({ x: 0, y: 0 }, { x: 70, y: 0 }, -140), { x: 0, y: 0 });
  const wall = { id: 'w', type: 'solid', p1: { x: 150, y: -100 }, p2: { x: 150, y: 100 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null } as BoardWall;
  const end = slide({ x: 70, y: 0 }, { x: 210, y: 0 }, [wall], 70);
  assert.ok(end.x < 150 && end.x > 70, JSON.stringify(end));
  // A wall that stops only sight lets it through.
  assert.deepEqual(slide({ x: 70, y: 0 }, { x: 210, y: 0 }, [{ ...wall, blocks: 'sight' }], 70), { x: 210, y: 0 });
  assert.equal(inDifficultSpell({ x: 0, y: 0 }, [{ spell: ball(0, 0, 50), rules: { difficult: true } }]), true);
  assert.equal(inDifficultSpell({ x: 0, y: 0 }, [{ spell: ball(0, 0, 50), rules: { obscure: true } }]), false);
});

const SCALE = { unitsPerFoot: 1, pxPerUnit: 70 / 5 };
const longWall: Spell = { shape: 'wall', from: 'point', at: { x: 0, y: 0, h: 0 }, to: { x: 300, y: 0 }, yaw: 0, pitch: 0, roll: 0, size: 10, length: 100, angle: 1 };

test("a spell's walls as Atlas's own records: its run or its edge, chained to its measure, on the measure's level", () => {
  const stone = derivedRecords('m1', longWall, { wall: { look: 'stone', blocks: 'both' } }, SCALE, 'upper');
  assert.deepEqual(stone.walls, [{ type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 300, y: 0 }, chainId: 'spell:m1', tabletop: { spell: 'm1' }, levels: ['upper'] }]);
  assert.deepEqual([stone.features, stone.light], [[], null]);
  // Force stops bodies alone: Atlas's window. No level: the first, said outright (Atlas would put it on the level shown).
  const force = derivedRecords('m2', longWall, { wall: { look: 'force', blocks: 'move' } }, SCALE);
  assert.deepEqual([force.walls[0]!.blocks, force.walls[0]!.levels, 'levels' in force.walls[0]!], ['movement', undefined, true]);
  const fog = derivedRecords('m3', ball(500, 500, 140), { obscure: true }, SCALE);
  assert.equal(fog.walls.length, 32);
  assert.ok(fog.walls.every((wall) => wall.blocks === 'sight' && wall.chainId === 'spell:m3' && wall.type === 'solid'));
  assert.deepEqual(derivedRecords('m4', ball(0, 0, 10), { push: 10 }, SCALE), { walls: [], features: [], light: null });
});

test("a spell's difficult ground is one map feature of Atlas's over what it covers; its light and darkness are the measure's light", () => {
  const web = derivedRecords('m5', ball(500, 500, 140), { name: 'Web', difficult: true }, SCALE, 'upper');
  assert.equal(web.features.length, 1);
  const [feature] = web.features;
  assert.deepEqual([feature!.name, feature!.terrain, feature!.tabletop, feature!.level], ['Web', { difficult: true }, { spell: 'm5' }, 'upper']);
  assert.equal(feature!.polygon.length, 32);
  for (const corner of feature!.polygon) assert.ok(Math.abs(Math.hypot(corner.x - 500, corner.y - 500) - 140) < 3);
  // A wall has no ground to make difficult.
  assert.deepEqual(derivedRecords('m6', longWall, { difficult: true }, SCALE).features, []);
  // Bright for 60 feet and dim for 60 more: Atlas's `dim` is where the light ends.
  const day = derivedRecords('m7', ball(0, 0, 50), { light: { bright: 60, dim: 60, color: '#ffeeaa' } }, { unitsPerFoot: 1.5 / 5, pxPerUnit: 70 / 1.5 });
  assert.deepEqual(day.light, { bright: 18, dim: 36, color: '#ffeeaa', intensity: 1, animation: { type: 'none', speed: 1, intensity: 1 } });
  const dark = derivedRecords('m8', ball(100, 100, 140), { dark: true, obscure: true }, SCALE);
  assert.deepEqual([dark.light?.darkness, dark.light?.bright, dark.light?.color], [true, 0, '#000000']);
  assert.ok(Math.abs((dark.light?.dim ?? 0) - 10) < 0.3);
  // Atlas has a darkness on a circle only: a cube's is the board's alone.
  const cube: Spell = { ...ball(0, 0, 140), shape: 'cube' };
  assert.equal(derivedRecords('m9', cube, { dark: true }, SCALE).light, null);
});

test("the board's own light of a spell ends where Atlas's does: bright, then dim for as far again", () => {
  const [light] = spellRuleLights('d', ball(100, 100, 50), { light: { bright: 60, dim: 60 } }, 1.5 / 5, 70 / 1.5);
  assert.deepEqual([light!.bright, light!.dim], [18, 36]);
});
