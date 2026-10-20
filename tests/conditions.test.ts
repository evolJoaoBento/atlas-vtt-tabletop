import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { collectionOf, conditionLabel, readCollectionRules, resourceLabel } from '../src/board/conditions';

const metadata = JSON.parse(readFileSync('tests/fixtures/assets-metadata.json', 'utf8'));

test('a map\'s collection is the folder under atlas-vtt/collections', () => {
  assert.equal(collectionOf('atlas-vtt/collections/DotMM Level 1 Full Test/scenes/x.atlasmap'), 'DotMM Level 1 Full Test');
  assert.equal(collectionOf('elsewhere/x.atlasmap'), null);
});

test('conditions are read from the collection\'s settings', () => {
  const rules = readCollectionRules(metadata, 'DotMM Level 1 Full Test');
  assert.deepEqual(rules.conditions.get('dnd5e-frightened'), { name: 'Frightened', color: '#7c3aed', valued: false });
  assert.equal(rules.conditions.get('dnd5e-exhaustion')!.valued, true);
  assert.equal(rules.conditions.get('dnd5e-blinded'), undefined);
});

test('resource names and colours come from the collection; unknown keys are humanised', () => {
  const rules = readCollectionRules(metadata, 'DotMM Level 1 Full Test');
  assert.deepEqual(rules.resources.get('spell-slots'), { name: 'Spell Slots', color: '#6366f1' });
  assert.equal(resourceLabel(rules, 'ac'), 'AC');
  assert.equal(resourceLabel(rules, 'ki-points'), 'Ki points');
});

test('a missing collection reads as no rules', () => {
  const rules = readCollectionRules(metadata, 'Nope');
  assert.equal(rules.conditions.size, 0);
  assert.equal(readCollectionRules(null, 'x').resources.size, 0);
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
