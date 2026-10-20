import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { collectionOf, conditionLabel, emptyRules, readCollectionRules } from '../src/board/conditions';

const metadata = JSON.parse(readFileSync('tests/fixtures/assets-metadata.json', 'utf8'));

test('a map\'s collection is the folder under atlas-vtt/collections', () => {
  assert.equal(collectionOf('atlas-vtt/collections/DotMM Level 1 Full Test/scenes/x.atlasmap'), 'DotMM Level 1 Full Test');
  assert.equal(collectionOf('elsewhere/x.atlasmap'), null);
});

test('conditions are read from the collection\'s settings', () => {
  const rules = readCollectionRules(metadata, 'DotMM Level 1 Full Test');
  assert.deepEqual(rules.conditions.get('dnd5e-frightened'), { name: 'Frightened', color: '#7c3aed', valued: false, icon: 'terror' });
  assert.equal(rules.conditions.get('dnd5e-exhaustion')!.valued, true);
  assert.equal(rules.conditions.get('dnd5e-blinded'), undefined);
});

test('the resources tokens track come from the collection, as Atlas defines them', () => {
  const rules = readCollectionRules(metadata, 'DotMM Level 1 Full Test');
  const slots = rules.definitions.find((definition) => definition.key === 'spell-slots')!;
  assert.equal(slots.name, 'Spell Slots');
  assert.equal(slots.color, '#6366f1');
  assert.equal(rules.definitions.find((definition) => definition.key === 'hp')!.defeatedWhenSpent, true);
});

test('a map outside every collection tracks HP and the secondary bar; one Atlas does not know, HP', () => {
  assert.deepEqual(readCollectionRules(metadata, null).definitions.map((d) => d.key), ['hp', 'stress']);
  assert.deepEqual(readCollectionRules(metadata, 'Nope').definitions.map((d) => d.key), ['hp']);
  assert.deepEqual(emptyRules().definitions.map((d) => d.key), ['hp', 'stress']);
});

test('a missing collection reads as no rules', () => {
  const rules = readCollectionRules(metadata, 'Nope');
  assert.equal(rules.conditions.size, 0);
  assert.equal(readCollectionRules(null, 'x').conditions.size, 0);
});

test('a valued condition shows its number, 1 when unset', () => {
  assert.equal(conditionLabel({ name: 'Exhaustion', color: '#000', valued: true }, 2), 'Exhaustion 2');
  assert.equal(conditionLabel({ name: 'Exhaustion', color: '#000', valued: true }, undefined), 'Exhaustion 1');
  assert.equal(conditionLabel({ name: 'Poisoned', color: '#000', valued: false }, 3), 'Poisoned');
});

test('the collection measuring rules are kept for the ruler', () => {
  const rules = readCollectionRules({ collections: { C: { settings: { gridDefaults: { unitType: 'meters', unitDistance: 1.5 } } } } }, 'C');
  assert.deepEqual(rules.gridDefaults, { unitType: 'meters', unitDistance: 1.5 });
  assert.equal(readCollectionRules(null, 'C').gridDefaults, null);
});
