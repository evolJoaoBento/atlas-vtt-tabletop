import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAtlasSheet } from '../src/sheets/nativeSheet';
import { buildSheet } from '../src/sheets/sheet';

const FRONT = { statblock: true, 'atlas-template': 'builtin:cairn-creature', name: 'Bog Hag', image: 'secret/hag.png', hp: 4, armor: 1, stats: [12, 9, 7], attacks: 'Claws (d6)', abilities: [{ name: 'Curse', desc: 'Save WIL or lose a day.' }], critical_damage: 'Hex' };

test('a 5E template note reads as before, with its extra 2024 fields', () => {
  const note = { name: 'Goblin', 'atlas-template': 'builtin:5e-2024-monster', ac: 15, hp: 7, stats: [8, 14, 10, 10, 8, 8], initiative: 2, gear: 'Scimitar' };
  const sheet = buildAtlasSheet(note)!;
  assert.deepEqual(sheet.stats, [8, 14, 10, 10, 8, 8]);
  assert.deepEqual(sheet.lines.map((line) => `${line.label}: ${line.text}`), ['Initiative: 2', 'Gear: Scimitar']);
});

test('a note without a template id is the plain sheet', () => {
  const note = { name: 'Goblin', ac: 15, stats: [8, 14, 10, 10, 8, 8] };
  assert.deepEqual(buildAtlasSheet(note), buildSheet(note));
});

test('Cairn attributes are no six ability scores: a line, no ability rolls', () => {
  const sheet = buildAtlasSheet(FRONT)!;
  assert.equal(sheet.stats, null);
  assert.equal(sheet.hp, '4');
  assert.deepEqual(sheet.lines.map((line) => `${line.label}: ${line.text}`), ['Armor: 1', 'Attacks: Claws (d6)', 'Critical damage: Hex', 'Attributes: STR 12, DEX 9, WIL 7']);
  assert.deepEqual(sheet.sections, [{ title: 'Abilities', items: [{ name: 'Curse', desc: 'Save WIL or lose a day.' }] }]);
});

test('Draw Steel characteristics, fate stress and percentile skills read as lines', () => {
  const steel = buildAtlasSheet({ name: 'Goblin Warrior', 'atlas-template': 'builtin:draw-steel-monster', stamina: 20, speed: 5, characteristics: [2, 0, -1, 0, 0], abilities: [{ name: 'Slash', desc: '2 damage' }] })!;
  assert.equal(steel.speed, '5');
  assert.ok(steel.lines.some((line) => line.label === 'Stamina' && line.text === '20'));
  assert.ok(steel.lines.some((line) => line.label === 'Characteristics' && line.text === 'Might 2, Agility 0, Reason -1, Intuition 0, Presence 0'));
  const fate = buildAtlasSheet({ name: 'Rook', 'atlas-template': 'builtin:fate-npc', stress: [2, 3], stunts: [{ name: 'Hardened', desc: '+2 to defend' }] })!;
  assert.ok(fate.lines.some((line) => line.label === 'Stress' && line.text === 'Physical 2, Mental 3'));
  assert.equal(fate.sections[0]?.title, 'Stunts');
  const percentile = buildAtlasSheet({ name: 'Cultist', 'atlas-template': 'builtin:percentile-creature', stats: [50, 60, 55, 40, 45, 70, 65, 50], skills: [{ Stealth: 40 }] })!;
  assert.equal(percentile.stats, null);
  assert.deepEqual(percentile.skills, []);
  assert.ok(percentile.lines.some((line) => line.label === 'Skills' && line.text === 'Stealth 40'));
});

test('a custom template is read by what its values are, never its private keys', () => {
  const sheet = buildAtlasSheet({ name: 'Warden', image: 'a.png', token: 'b.png', 'atlas-template': 'custom:ward', rank: 'Captain', moves: [{ name: 'Parry', desc: 'Blocks a hit.' }], odd: { nested: true } })!;
  assert.deepEqual(sheet.lines, [{ label: 'Rank', text: 'Captain' }]);
  assert.deepEqual(sheet.sections, [{ title: 'Moves', items: [{ name: 'Parry', desc: 'Blocks a hit.' }] }]);
});
