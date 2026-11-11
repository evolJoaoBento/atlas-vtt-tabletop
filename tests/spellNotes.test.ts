import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { askFromNote, readSpellNote, spellAreaOf, spellProperties, type SpellNote } from '../src/board/spellNotes';
import { readSpellRequests } from '../src/board/spells';
import { inSpellFolder, searchSpells } from '../src/spellLibrary';
import type { SpellEntry } from '../src/board/spellPicker';

const note = (file: string): SpellNote => {
  const read = readSpellNote(readFileSync(`tests/fixtures/spells/${file}`, 'utf8'), file.replace(/^.*\//, '').replace(/( \(2024\))?\.md$/, ''));
  assert.ok(read, file);
  return read;
};

test('a 2014 and a 2024 spell note read the same: name, level, school, the lines, the description', () => {
  for (const file of ['2014/Fireball.md', '2024/Fireball (2024).md']) {
    const fireball = note(file);
    assert.equal(fireball.name, 'Fireball');
    assert.equal(fireball.level, 3);
    assert.equal(fireball.school, 'Evocation');
    assert.equal(fireball.range, '150 feet');
    assert.match(fireball.components, /bat guano/);
    assert.equal(fireball.duration, 'Instantaneous');
    assert.match(fireball.text, /^A bright streak/);
    assert.deepEqual(fireball.area, { shape: 'sphere', from: 'point', size: 20, length: 0 });
    assert.deepEqual(fireball.damage, { dice: '8d6', type: 'fire' });
    assert.equal(fireball.save, 'Dexterity');
  }
  assert.equal(note('2014/Fire Bolt.md').level, 0);
  assert.equal(note('2024/Fire Bolt (2024).md').level, 0);
  assert.equal(note('2024/Fire Bolt (2024).md').attack, true);
  assert.equal(readSpellNote('# Not a spell\n\nJust lore, with a Range: of opinions.', 'x'), null);
});

test('areas from both sets: cones, lines as beams, columns, walls, emanations, cubes from the caster, squares', () => {
  const area = (file: string) => note(file).area;
  assert.deepEqual(area('2014/Cone of Cold.md'), { shape: 'cone', from: 'self', size: 60, length: 0 });
  assert.deepEqual(area('2024/Cone of Cold (2024).md'), { shape: 'cone', from: 'self', size: 60, length: 0 });
  assert.deepEqual(area('2014/Lightning Bolt.md'), { shape: 'cylinder', from: 'self', size: 2.5, length: 100 });
  assert.deepEqual(area('2024/Sunbeam (2024).md'), { shape: 'cylinder', from: 'self', size: 2.5, length: 60 });
  assert.deepEqual(area('2024/Gust of Wind (2024).md'), { shape: 'cylinder', from: 'self', size: 5, length: 60 });
  assert.deepEqual(area('2014/Flame Strike.md'), { shape: 'cylinder', from: 'point', size: 10, length: 40 });
  assert.deepEqual(area('2024/Ice Storm (2024).md'), { shape: 'cylinder', from: 'point', size: 20, length: 40 });
  assert.deepEqual(area('2024/Sleet Storm (2024).md'), { shape: 'cylinder', from: 'point', size: 20, length: 40 });
  assert.deepEqual(area('2014/Wall of Fire.md'), { shape: 'wall', from: 'point', size: 1, length: 20, longest: 60 });
  assert.deepEqual(area('2014/Wall of Ice.md'), { shape: 'wall', from: 'point', size: 1, length: 10, longest: 100 });
  assert.deepEqual(area('2014/Spirit Guardians.md'), { shape: 'sphere', from: 'self', size: 15, length: 0 });
  assert.deepEqual(area('2024/Spirit Guardians (2024).md'), { shape: 'sphere', from: 'self', size: 15, length: 0 });
  assert.deepEqual(area('2014/Thunderwave.md'), { shape: 'cube', from: 'self', size: 15, length: 0 });
  assert.deepEqual(area('2024/Grease (2024).md'), { shape: 'cube', from: 'point', size: 10, length: 0 });
  // No area: a single target, light shed, darts.
  assert.equal(area('2014/Magic Missile.md'), null);
  assert.equal(area('2024/Fire Bolt (2024).md'), null);
  assert.equal(area('2024/Light (2024).md'), null);
  assert.deepEqual(note('2014/Magic Missile.md').damage, { dice: '1d4 + 1', type: 'force' });
  assert.deepEqual(note('2024/Ice Storm (2024).md').damage, { dice: '2d10', type: 'bludgeoning' });
  assert.deepEqual(spellAreaOf('Self (30-foot radius)', 'Creatures within it...'), { shape: 'sphere', from: 'self', size: 30, length: 0 });
});

test('a spell makes an ask in map pixels at the scene\'s feet a square, with its damage and its words; none without an area', () => {
  const fireball = note('2024/Fireball (2024).md');
  const ask = askFromNote(fireball, 5, 70);
  assert.ok(ask);
  assert.equal(ask.name, 'Fireball');
  assert.equal(ask.shape, 'sphere');
  assert.equal(ask.size, 280);
  assert.equal(ask.effect, 'fire');
  assert.match(ask.about?.line ?? '', /Level 3 Evocation/);
  assert.ok(ask.about?.properties.some(([label, value]) => label === 'Area' && /20 ft radius sphere/.test(value)));
  assert.equal(askFromNote(fireball, 10, 70)?.size, 140);
  const wall = askFromNote(note('2014/Wall of Fire.md'), 5, 50);
  assert.deepEqual([wall?.shape, wall?.size, wall?.length, wall?.longest], ['wall', 10, 200, 600]);
  assert.equal(askFromNote(note('2014/Magic Missile.md'), 5, 70), null);
  const properties = spellProperties(fireball).map(([label]) => label);
  assert.deepEqual(properties, ['Casting time', 'Range', 'Area', 'Damage', 'Save', 'Components', 'Duration']);
});

test("an ask keeps its damage and its words on the player's side; words not well formed are dropped", () => {
  const about = { line: 'Level 3 Evocation', properties: [['Range', '150 feet']], text: 'A bright streak.' };
  const [kept] = readSpellRequests([{ id: 'a1', tokenId: 't', ask: { name: 'Fireball', shape: 'sphere', from: 'point', size: 280, length: 0, effect: 'fire', about } }]);
  assert.equal(kept.ask.effect, 'fire');
  assert.deepEqual(kept.ask.about, about);
  const [bad] = readSpellRequests([{ id: 'a2', tokenId: 't', ask: { shape: 'sphere', from: 'point', size: 280, length: 0, effect: 'glitter', about: { line: 3 } } }]);
  assert.equal(bad.ask.effect, undefined);
  assert.equal(bad.ask.about, undefined);
});

test('the spell notes searched: folders named with "spell"; names starting with the words first, then words in them', () => {
  assert.equal(inSpellFolder('SRD Spells/2014/Fireball.md'), true);
  assert.equal(inSpellFolder('Homebrew/my spells/Zap.md'), true);
  assert.equal(inSpellFolder('Nations/Spellmark.md'), false);
  assert.equal(inSpellFolder('Spells/cover.png'), false);
  const entry = (name: string, source: string): SpellEntry => ({ id: `${source}/${name}`, source, note: { name } as SpellNote });
  const all = [entry('Delayed Blast Fireball', 'SRD 2014'), entry('Fireball', 'SRD 2014'), entry('Fireball', 'SRD 2024'), entry('Fire Bolt', 'SRD 2024'), entry('Wall of Fire', 'SRD 2014'), entry('Cure Wounds', 'SRD 2014')];
  assert.deepEqual(searchSpells(all, 'fireball').map((each) => `${each.note.name} ${each.source}`), ['Fireball SRD 2024', 'Fireball SRD 2014', 'Delayed Blast Fireball SRD 2014']);
  const fire = searchSpells(all, 'fire').map((each) => each.note.name);
  assert.deepEqual(new Set(fire.slice(0, 3)), new Set(['Fire Bolt', 'Fireball']));
  assert.deepEqual(new Set(fire.slice(3)), new Set(['Delayed Blast Fireball', 'Wall of Fire']));
  assert.equal(searchSpells(all, 'fire').some((each) => each.note.name === 'Cure Wounds'), false);
  assert.equal(searchSpells(all, '').length, all.length);
  assert.equal(searchSpells(all, 'wall')[0].note.name, 'Wall of Fire');
});
