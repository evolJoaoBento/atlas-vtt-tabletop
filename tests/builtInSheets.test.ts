import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSheet, type PlayerSheet } from '../packages/atlas-host/src/sheets/sheets';
import { buildPlayerSheet } from '../packages/atlas-host/src/sheets/templateSheets';
import { builtInTemplate } from '../src/atlasPort/app/statblocks/library/builtInTemplates';

// A note made with an Atlas template, as the shared reader gives it (`linkedCreatures`): its template id, its template
// file (none for a built-in) and its frontmatter. The board lays a built-in out by Atlas's own template (its port).
const builtIns = (id: string): unknown => builtInTemplate(id)?.template ?? null;
const note = (atlasTemplate: string, fields: Record<string, unknown>, template: unknown = null) => ({ atlasTemplate, template, fields });
/** Every item of the sheet as "Name: text". */
const items = (sheet: PlayerSheet): string[] => sheet.sections.flatMap((section) => section.items.map((item) => `${item.name}: ${item.desc}`));

const FRONT = { statblock: true, 'atlas-template': 'builtin:cairn-creature', name: 'Bog Hag', image: 'secret/hag.png', hp: 4, armor: 1, stats: [12, 9, 7], attacks: 'Claws (d6)', abilities: [{ name: 'Curse', desc: 'Save WIL or lose a day.' }], critical_damage: 'Hex' };

test('a 5E built-in note reads as a 5e stat block, its abilities rolled', () => {
  const fields = { name: 'Goblin', 'atlas-template': 'builtin:5e-2024-monster', ac: 15, hp: 7, stats: [8, 14, 10, 10, 8, 8], initiative: 2, gear: 'Scimitar' };
  const sheet = buildPlayerSheet(note('builtin:5e-2024-monster', fields), null, builtIns)!;
  assert.deepEqual(sheet.stats, [8, 14, 10, 10, 8, 8]);
  assert.deepEqual(sheet, buildSheet(fields));
});

test('a note without a template id is the plain sheet', () => {
  const fields = { name: 'Goblin', ac: 15, stats: [8, 14, 10, 10, 8, 8] };
  assert.deepEqual(buildPlayerSheet(fields, null, builtIns), buildSheet(fields));
});

test("Cairn attributes are no six ability scores: Atlas's Cairn template lays them out, no ability rolls, no image", () => {
  const sheet = buildPlayerSheet(note('builtin:cairn-creature', FRONT), null, builtIns)!;
  assert.equal(sheet.stats, null);
  assert.deepEqual(items(sheet), ['HP: 4', 'Armor: 1', 'Attributes: STR 12, DEX 9, WIL 7', 'Attacks: Claws (d6)', 'Curse: Save WIL or lose a day.', 'Critical Damage: Hex']);
  assert.ok(sheet.sections.some((section) => section.title === 'Abilities'));
  assert.ok(!JSON.stringify(sheet).includes('secret'));
});

test('Draw Steel characteristics, fate stress and percentile skills read as their templates show them', () => {
  const steel = buildPlayerSheet(note('builtin:draw-steel-monster', { name: 'Goblin Warrior', stamina: 20, speed: 5, characteristics: [2, 0, -1, 0, 0], abilities: [{ name: 'Slash', desc: '2 damage' }] }), null, builtIns)!;
  assert.ok(items(steel).includes('Stamina: 20'));
  assert.ok(items(steel).includes('Speed: 5'));
  assert.ok(items(steel).includes('Characteristics: Might 2, Agility 0, Reason -1, Intuition 0, Presence 0'));
  const fate = buildPlayerSheet(note('builtin:fate-npc', { name: 'Rook', stress: [2, 3], stunts: [{ name: 'Hardened', desc: '+2 to defend' }] }), null, builtIns)!;
  assert.ok(items(fate).includes('Stress: Physical 2, Mental 3'));
  assert.ok(fate.sections.some((section) => section.title === 'Stunts'));
  const percentile = buildPlayerSheet(note('builtin:percentile-creature', { name: 'Cultist', stats: [50, 60, 55, 40, 45, 70, 65, 50], skills: [{ Stealth: 40 }] }), null, builtIns)!;
  assert.equal(percentile.stats, null);
  assert.deepEqual(percentile.skills, []);
  assert.ok(items(percentile).includes('Skills: Stealth 40'));
});

test("a custom template's note: laid out by its template file, else every field as Atlas's stand-in shows it, never its private keys", () => {
  const fields = { name: 'Warden', image: 'a.png', token: 'b.png', 'atlas-template': 'custom:ward', rank: 'Captain', moves: [{ name: 'Parry', desc: 'Blocks a hit.' }] };
  const missing = buildPlayerSheet(note('custom:ward', fields), null, builtIns)!;
  assert.deepEqual(missing.sections, [{ title: '', items: [{ name: 'Rank', desc: 'Captain' }] }, { title: 'Moves', items: [{ name: 'Parry', desc: 'Blocks a hit.' }] }]);
  assert.ok(!JSON.stringify(missing).includes('.png'));
  const template = { format: 'atlas-statblock-template', id: 'custom:ward', fields: [{ key: 'rank', label: 'Rank', type: 'text' }], layout: { blocks: [{ type: 'stat', field: 'rank' }] } };
  assert.deepEqual(buildPlayerSheet(note('custom:ward', fields, template), null, builtIns)!.sections, [{ title: '', items: [{ name: 'Rank', desc: 'Captain' }] }]);
});
