import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spellToMeasure, templateToMeasure, type SpellLike } from '../packages/atlas-host/src/index';
import { castsOfMeasures, marksOfMeasures, readMeasures, spellWrite, templateWrite } from '../src/board/boardMeasures';
import { readMapState } from '../src/board/mapModel';
import { shapeOutline } from '../src/board/marks';
import { templateHit } from '../src/board/playerTools';

const spell: SpellLike = { shape: 'sphere', from: 'point', at: { x: 700, y: 420, h: 70 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1, effect: 'fire' };
const kept = (id: string, record: object): Record<string, unknown> => ({ id, kind: 'measure', ...JSON.parse(JSON.stringify(record)) });
const RAW = {
  area: { id: 'area', kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], effect: 'frost' },
  wide: { id: 'wide', kind: 'measure', shape: 'line', points: [{ x: 0, y: 0 }, { x: 140, y: 0 }], width: 35, color: '#ff8800' },
  path: { id: 'path', kind: 'measure', shape: 'ruler', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }] },
  mine: kept('mine', templateToMeasure({ shape: 'cone', start: { x: 0, y: 0 }, end: { x: 70, y: 0 } }, { owner: 'p1', by: 'Ana', color: '#22c55e' })),
  cast: kept('cast', spellToMeasure(spell, { owner: 'p2', by: 'Ben', color: '#3366ff', name: 'Web', rules: { difficult: true }, about: { line: 'x', properties: [], text: 'Sticky.' } })),
  hidden: { id: 'hidden', kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], hidden: true },
  junk: 'x', blob: { id: 'blob', shape: 'blob', points: [] }, short: { id: 'short', shape: 'circle', points: [{ x: 1, y: 1 }] },
};

test("the board reads Atlas's measures: what reads as one, in the order they were made", () => {
  const measures = readMeasures(RAW);
  assert.deepEqual(measures.map((measure) => measure.id), ['area', 'wide', 'path', 'mine', 'cast', 'hidden']);
  assert.deepEqual(readMeasures(undefined), []);
  assert.deepEqual(readMeasures('x'), []);
});

test("a spell measure reads as the cast that made it; nothing else is a cast", () => {
  const casts = castsOfMeasures(readMeasures(RAW));
  assert.equal(casts.length, 1);
  const [cast] = casts;
  assert.deepEqual([cast!.id, cast!.owner, cast!.color, cast!.name], ['cast', 'p2', '#3366ff', 'Web']);
  assert.deepEqual(cast!.rules, { difficult: true });
  assert.equal(cast!.about?.text, 'Sticky.');
  assert.equal(cast!.spell.shape, 'sphere');
  assert.ok(Math.abs(cast!.spell.size - 140) < 1e-6);
  // The GM's own: no owner on the measure, white as the GM's casts always were.
  const own = castsOfMeasures(readMeasures({ s: kept('s', spellToMeasure(spell)) }));
  assert.deepEqual([own[0]!.owner, own[0]!.color], ['gm', '#ffffff']);
});

test('every other measure is drawn flat: an area, a kept ruler as its legs, a template with its owner; a spell is left to its 3D shape', () => {
  const marks = marksOfMeasures(readMeasures(RAW), { cell: 70, accent: '#7c5cff' });
  assert.deepEqual(marks.map((mark) => [mark.id, mark.shape, mark.kind, mark.owner, mark.color]), [
    ['area', 'circle', 'area', 'gm', '#7c5cff'], ['wide', 'line', 'area', 'gm', '#ff8800'],
    ['path:0', 'line', 'area', 'gm', '#7c5cff'], ['path:1', 'line', 'area', 'gm', '#7c5cff'],
    ['mine', 'cone', 'template', 'p1', '#22c55e'], ['hidden', 'circle', 'area', 'gm', '#7c5cff'],
  ]);
  assert.equal(marks[1]!.width, 35);
  assert.equal(marks[2]!.ruler, true);
});

test('an aura is left out of the flat marks: it lies around its token, not where its points were last written', () => {
  const aura = { id: 'aura', kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], follows: 't1', aura: 10 };
  assert.deepEqual(marksOfMeasures(readMeasures({ aura }), { cell: 70, accent: '#7c5cff' }), []);
  // One of the two fields alone says nothing (Atlas's `isAura`): a plain circle.
  assert.equal(marksOfMeasures(readMeasures({ aura: { ...aura, aura: undefined } }), { cell: 70, accent: '#7c5cff' }).length, 1);
});

test("the map's measures are read from Atlas's store, those of the level shown", () => {
  const state = (measures: unknown, extra: Record<string, unknown> = {}) => ({ mapPath: 'm.atlasmap', backgroundImage: null, grid: { size: 70 }, objects: { tokens: {}, measures }, ...extra });
  assert.deepEqual(readMapState('m.atlasmap', state(RAW)).measures.map((measure) => measure.id), ['area', 'wide', 'path', 'mine', 'cast', 'hidden']);
  assert.deepEqual(readMapState('m.atlasmap', state(undefined)).measures, []);
  const levels = [{ id: 'ground', name: 'Ground', elevation: { bottom: 0 } }, { id: 'upper', name: 'Upper', elevation: { bottom: 10 } }];
  const split = { low: { ...RAW.area, id: 'low' }, high: { ...RAW.area, id: 'high', level: 'upper' } };
  assert.deepEqual(readMapState('m.atlasmap', state(split, { levels }), 'upper').measures.map((measure) => measure.id), ['high']);
  assert.deepEqual(readMapState('m.atlasmap', state(split, { levels }), 'ground').measures.map((measure) => measure.id), ['low']);
});

test('flat shapes lie as Atlas shapes them: a square from the middle of its near side, a line as wide as it says', () => {
  const square = shapeOutline('square', { x: 0, y: 0 }, { x: 100, y: 0 }, Math.PI / 2);
  assert.deepEqual(square, { points: [{ x: 0, y: -50 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: -50 }], closed: true });
  const wide = shapeOutline('line', { x: 0, y: 0 }, { x: 100, y: 0 }, Math.PI / 2, 40);
  assert.deepEqual(wide, { points: [{ x: 0, y: -20 }, { x: 0, y: 20 }, { x: 100, y: 20 }, { x: 100, y: -20 }], closed: true });
  assert.deepEqual(shapeOutline('line', { x: 0, y: 0 }, { x: 100, y: 0 }, Math.PI / 2), { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false });
  assert.equal(templateHit({ shape: 'square', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, { x: 90, y: 40 }, 0, Math.PI / 2), true);
  assert.equal(templateHit({ shape: 'square', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, { x: 90, y: 60 }, 0, Math.PI / 2), false);
  assert.equal(templateHit({ shape: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 40 }, { x: 50, y: 19 }, 0, Math.PI / 2), true);
  assert.equal(templateHit({ shape: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, width: 40 }, { x: 50, y: 30 }, 0, Math.PI / 2), false);
});

const lasting = { line: '2nd-level', properties: [['Duration', 'Concentration, up to 1 minute']] as Array<[string, string]>, text: 'It lasts.' };
const instant = { line: '3rd-level', properties: [['Duration', 'Instantaneous']] as Array<[string, string]>, text: 'Boom.' };
const gmSpell = (id: string) => kept(id, spellToMeasure(spell, { name: 'Fog Cloud' }));
const gmTemplate = (id: string) => ({ id, kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], tabletop: { v: 1, kind: 'template', owner: 'gm' } });

test("the GM's cast that lasts is written as one measure, on the level shown; an instantaneous one goes off and is written nowhere", () => {
  const kept = spellWrite({ add: spell as never, name: 'Web', about: lasting, rules: { difficult: true } }, [], 'upper');
  assert.ok(kept && 'add' in kept);
  assert.equal(kept.add.level, 'upper');
  const back = castsOfMeasures(readMeasures({ a: { ...kept.add, id: 'a' } }));
  assert.deepEqual([back[0]!.owner, back[0]!.name, back[0]!.rules, back[0]!.about?.text], ['gm', 'Web', { difficult: true }, 'It lasts.']);
  assert.equal('level' in (spellWrite({ add: spell as never }, [], null) as { add: object }).add, false);
  const off = spellWrite({ add: spell as never, name: 'Fireball', about: instant, rules: { push: 10 } }, [], null);
  assert.ok(off && 'flash' in off);
  assert.deepEqual([off.flash.owner, off.flash.name, off.flash.rules], ['gm', 'Fireball', { push: 10 }]);
  // A summoning spell is kept though instantaneous: its going is what offers to take its summons off.
  const familiar = spellWrite({ add: spell as never, name: 'Find Familiar', about: instant, rules: { summon: { name: 'Owl', count: 1 } } }, [], null);
  assert.ok(familiar && 'add' in familiar);
});

test("the GM's clear takes the GM's own spells only: a player's spell, a template and an area made in Atlas stay", () => {
  const measures = readMeasures({ ...RAW, g1: gmSpell('g1'), g2: gmSpell('g2'), t1: gmTemplate('t1') });
  assert.deepEqual(spellWrite({ clear: true }, measures, null), { remove: ['g1', 'g2'] });
  assert.deepEqual(spellWrite({ remove: 'cast' }, measures, null), { remove: ['cast'] });
  assert.equal(spellWrite({ decline: 'x' }, measures, null), null);
  assert.deepEqual(templateWrite({ clear: true }, measures, null), { remove: ['t1'] });
  assert.deepEqual(templateWrite({ remove: 'mine' }, measures, null), { remove: ['mine'] });
  // An area made in Atlas, a kept ruler's leg and a spell are not the Template tool's to take off.
  assert.deepEqual(templateWrite({ remove: 'area' }, measures, null), { remove: [] });
  assert.deepEqual(templateWrite({ remove: 'path:0' }, measures, null), { remove: [] });
  assert.deepEqual(templateWrite({ remove: 'cast' }, measures, null), { remove: [] });
  const placed = templateWrite({ add: { shape: 'cone', start: { x: 1, y: 2 }, end: { x: 71, y: 2 } } }, measures, 'upper');
  assert.deepEqual(placed, { add: { shape: 'cone', points: [{ x: 1, y: 2 }, { x: 71, y: 2 }], tabletop: { v: 1, kind: 'template', owner: 'gm' }, level: 'upper' } });
  // What it places reads back as the GM's template, drawn flat.
  assert.deepEqual(marksOfMeasures(readMeasures({ t: { ...(placed as { add: object }).add, id: 't' } }), { cell: 70, accent: '#7c5cff' }).map((mark) => [mark.kind, mark.owner]), [['template', 'gm']]);
});
