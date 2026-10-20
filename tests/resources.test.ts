import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HP_RESOURCE, STRESS_RESOURCE, defeatedResources, hiddenResourcesOf, isDefeated, isKillable, mapDefinitions,
  parseResourceDefinitions, parseValueInput, resourceColor, resourceUpdate, slottedResources, tokenFromFile,
  tokenToFile, visibleResources, wheelGauge, withCurrent, type ResourceDefinition,
} from '../src/board/resources';

const def = (key: string, extra: Partial<ResourceDefinition> = {}): ResourceDefinition => ({
  key, name: key.toUpperCase(), field: key, direction: 'drains', color: '#22c55e', visibleToPlayers: false, ...extra,
});

test('a file token reads its old fields as resources, as Atlas 0.8 reads them', () => {
  const token = tokenFromFile({
    id: 't', hp: { current: 3, max: 9 }, stress: 2, maxStress: 6, hope: 1,
    statblockResources: { ac: { current: 15, max: 15 }, 'spell-slots': 2 }, maxHpOverridden: true, overriddenMax: ['ac'],
  });
  assert.deepEqual(token.resources, {
    hp: { current: 3, max: 9 }, stress: { current: 2, max: 6 }, hope: { current: 1, max: 10 },
    ac: { current: 15, max: 15 }, 'spell-slots': { current: 2, max: 2 },
  });
  assert.deepEqual(token.overriddenMax, ['hp', 'ac']);
  assert.equal('hp' in token, false);
  assert.equal(token.id, 't');
});

test('a bare HP number is out of 100 unless it is larger; maxStress 0 reads as 10', () => {
  assert.deepEqual(tokenFromFile({ hp: 30 }).resources, { hp: { current: 30, max: 100 } });
  assert.deepEqual(tokenFromFile({ hp: 130 }).resources, { hp: { current: 130, max: 130 } });
  assert.deepEqual(tokenFromFile({ stress: 2, maxStress: 0 }).resources, { stress: { current: 2, max: 10 } });
});

test('a token with none of the fields is left as it is', () => {
  const raw = { id: 'x', x: 1 };
  assert.equal(tokenFromFile(raw), raw);
});

test('a token goes back to its file fields; reading it again gives the same token', () => {
  const memory = { id: 't', resources: { hp: { current: 1, max: 9 }, stress: { current: 2, max: 6 }, ac: { current: 15, max: 15 } }, overriddenMax: ['hp', 'ac'] };
  const file = tokenToFile(memory) as Record<string, unknown>;
  assert.deepEqual(file, {
    id: 't', hp: { current: 1, max: 9 }, stress: { current: 2, max: 6 }, maxStress: 6,
    statblockResources: { ac: { current: 15, max: 15 } }, maxHpOverridden: true, overriddenMax: ['ac'],
  });
  assert.deepEqual(tokenFromFile(file), memory);
});

test('definitions are parsed as Atlas parses them, without duplicates, at most six', () => {
  const parsed = parseResourceDefinitions([
    { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: true },
    { key: 'hp', name: 'Again', field: 'hp', direction: 'drains', color: '#22c55e' },
    { key: 'ac', name: 'AC', field: 'ac', direction: 'static', color: '#64748b', defeatedWhenSpent: true },
    { key: 'bad', name: 'Bad', field: 'x', direction: 'sideways', color: '#000000' },
    { key: 'c', name: 'C', field: 'c', direction: 'fills', color: 'red' },
  ]);
  assert.deepEqual(parsed.map((d) => d.key), ['hp', 'ac']);
  assert.equal(parsed[0]!.defeatedWhenSpent, true);
  // A static value is never spent, so it defeats nothing.
  assert.equal(parsed[1]!.defeatedWhenSpent, undefined);
});

test('a map uses its collection\'s resources; outside every collection, HP and the secondary bar', () => {
  const stored = [def('hp'), def('ac', { direction: 'static' })];
  assert.deepEqual(mapDefinitions({ resources: stored }, true).map((d) => d.key), ['hp', 'ac']);
  assert.deepEqual(mapDefinitions({ defaultWidgets: { stressBar: true } }, true).map((d) => d.key), ['hp', 'stress']);
  assert.deepEqual(mapDefinitions({}, true).map((d) => d.key), ['hp']);
  assert.equal(mapDefinitions({ defaultWidgets: { stressBar: true } }, true)[1]!.name, 'Secondary resource');
  assert.deepEqual(mapDefinitions({ defaultWidgets: { stressBar: false } }, true).map((d) => d.key), ['hp']);
  const outside = mapDefinitions(null, false);
  assert.deepEqual(outside.map((d) => d.name), ['HP', 'Secondary resource']);
  assert.deepEqual(mapDefinitions(null, true), [HP_RESOURCE]);
});

test('slots: stored sockets hold, the rest take the first free socket in list order', () => {
  const slotted = slottedResources([def('a', { slot: 3 }), def('b'), def('c', { slot: 3 }), def('d')]);
  assert.deepEqual(slotted.map(({ definition, slot }) => [definition.key, slot]), [['b', 0], ['c', 1], ['d', 2], ['a', 3]]);
});

test('visible resources: those the token holds, not hidden by the map, a counting one with a maximum', () => {
  const defs = [def('hp'), def('ac', { direction: 'static' }), def('slots'), def('gone')];
  const token = { resources: { hp: { current: 0, max: 9 }, ac: { current: 0, max: 0 }, slots: { current: 0, max: 0 }, stress: { current: 1, max: 5 } } };
  assert.deepEqual(visibleResources(token, defs, []).map((r) => [r.definition.key, r.slot]), [['hp', 0], ['ac', 1]]);
  assert.deepEqual(visibleResources(token, defs, ['hp']).map((r) => r.definition.key), ['ac']);
});

test('defeated: a defeating resource spent; killable: the token holds one', () => {
  const hp = def('hp', { defeatedWhenSpent: true });
  const doom = def('doom', { direction: 'fills', defeatedWhenSpent: true });
  assert.equal(isDefeated({ resources: { hp: { current: 0, max: 9 } } }, [hp]), true);
  assert.equal(isDefeated({ resources: { hp: { current: 0, max: 0 } } }, [hp]), false);
  assert.equal(isDefeated({ resources: { doom: { current: 4, max: 4 } } }, [doom]), true);
  assert.equal(isDefeated({ resources: { hp: { current: 0, max: 9 } } }, [def('hp')]), false);
  assert.equal(isKillable({ resources: { hp: { current: 5, max: 9 } } }, [hp]), true);
  assert.equal(isKillable({ resources: { ac: { current: 5, max: 9 } } }, [hp]), false);
});

test('Kill spends every defeating resource and leaves the rest', () => {
  const defs = [def('hp', { defeatedWhenSpent: true }), def('doom', { direction: 'fills', defeatedWhenSpent: true }), def('slots')];
  const killed = defeatedResources({ resources: { hp: { current: 5, max: 9 }, doom: { current: 1, max: 4 }, slots: { current: 2, max: 3 } } }, defs);
  assert.deepEqual(killed, { hp: { current: 0, max: 9 }, doom: { current: 4, max: 4 }, slots: { current: 2, max: 3 } });
});

test('a resource update clamps, and remembers a hand-set maximum once', () => {
  const token = { resources: { hp: { current: 5, max: 9 }, ac: { current: 15, max: 15 } } };
  assert.deepEqual(resourceUpdate(token, 'hp', { current: 12, max: 9 }, false), { resources: { hp: { current: 9, max: 9 }, ac: { current: 15, max: 15 } } });
  assert.deepEqual(resourceUpdate(token, 'hp', { current: 5, max: 12 }, true).overriddenMax, ['hp']);
  assert.equal(resourceUpdate({ ...token, overriddenMax: ['hp'] }, 'hp', { current: 5, max: 12 }, true).overriddenMax, undefined);
  assert.deepEqual(withCurrent({ current: 5, max: 9 }, -3), { current: 0, max: 9 });
});

test('the editor reads an absolute number or a signed change, max first', () => {
  const value = { current: 20, max: 27 };
  assert.deepEqual(parseValueInput('-5', value), { current: 15, max: 27 });
  assert.deepEqual(parseValueInput('+30', value), { current: 27, max: 27 });
  assert.deepEqual(parseValueInput('10', value, 'max'), { current: 10, max: 10 });
  assert.equal(parseValueInput('0', value, 'max'), null);
  assert.equal(parseValueInput('x', value), null);
});

test('a defeating resource turns yellow below 70% and red below 30%; others keep their colour', () => {
  const hp = def('hp', { defeatedWhenSpent: true, color: '#22c55e' });
  assert.equal(resourceColor(hp, { current: 8, max: 10 }), '#22c55e');
  assert.equal(resourceColor(hp, { current: 5, max: 10 }), '#eab308');
  assert.equal(resourceColor(hp, { current: 2, max: 10 }), '#ef4444');
  assert.equal(resourceColor(STRESS_RESOURCE, { current: 9, max: 10 }), STRESS_RESOURCE.color);
});

test('a wheel is cut into one segment per point from 2 to 8 points', () => {
  assert.equal(wheelGauge({ current: 1, max: 4 })!.ticks.length, 4);
  assert.equal(wheelGauge({ current: 1, max: 9 })!.ticks.length, 0);
  assert.equal(wheelGauge({ current: 1, max: 0 }), null);
  assert.equal(wheelGauge({ current: 2, max: 4 })!.share, 0.5);
});

test('the hidden list: the two old switches decide for HP and the secondary bar', () => {
  assert.deepEqual(hiddenResourcesOf({ showHPBars: true, showStressBars: false, hiddenResources: ['ac'] }), ['ac', 'stress']);
  assert.deepEqual(hiddenResourcesOf({ showHPBars: false, showStressBars: true }), ['hp']);
  assert.deepEqual(hiddenResourcesOf({ hiddenResources: ['x'] }), ['x']);
  assert.deepEqual(hiddenResourcesOf({ showResources: false }), ['hp', 'stress']);
  assert.deepEqual(hiddenResourcesOf(undefined), []);
});
