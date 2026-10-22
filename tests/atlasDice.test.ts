import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diceRulesOf, onRolled, publishRoll, rollViewFor, stockRoll, type MapViewLike } from '../src/dice/atlasDice';
import { DEFAULT_RULES } from '../src/dice/rollRules';

type Listener = (...args: unknown[]) => void;

/** Runs `body` with console.warn kept quiet, returning what it warned. */
function quietly(body: () => void): unknown[][] {
  const warn = console.warn;
  const warned: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warned.push(args); };
  try { body(); } finally { console.warn = warn; }
  return warned;
}

/** A map view as Atlas 0.9 shapes it, with a bus that remembers what was emitted and who listens. */
function fakeView(options: { path?: string; storePath?: string; remote?: boolean; diceTool?: unknown; settings?: unknown; type?: string } = {}) {
  const emitted: Array<[string, unknown]> = [];
  const listeners = new Map<string, Set<Listener>>();
  const bus = {
    emit: (event: string, roll: unknown) => { emitted.push([event, roll]); for (const listener of listeners.get(event) ?? []) listener(roll); },
    on: (event: string, listener: Listener) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)?.add(listener); },
    off: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener); },
  };
  const view: MapViewLike = {
    getViewType: () => options.type ?? 'atlas-vtt',
    file: options.path === undefined ? null : { path: options.path },
    atlasStore: { getState: () => ({ mapPath: options.storePath ?? options.path ?? null, ...(options.remote ? { remoteView: {} } : {}) }) },
    serviceManager: {
      getEventBus: () => bus,
      getToolController: () => (options.diceTool === undefined ? undefined : { getDiceTool: () => options.diceTool }),
      getAssetService: () => ({
        getCollectionForMap: (path: string) => (path.startsWith('atlas-vtt/collections/') ? 'c1' : null),
        getCollectionSettings: (id: string) => (id === 'c1' ? options.settings : { conditions: [] }),
      }),
    },
  };
  return { view, emitted, listeners };
}

const MAP = 'atlas-vtt/collections/c1/maps/cave.json';
const OTHER = 'atlas-vtt/collections/c1/maps/keep.json';
const D10_EXPLODING = { defaultRoll: '1d10', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 1 } } as const;

test('rollViewFor picks the view showing the map over the most recent one', () => {
  const other = fakeView({ path: OTHER }).view;
  const showing = fakeView({ path: MAP }).view;
  assert.equal(rollViewFor([other, showing], other, MAP), showing);
});

test('rollViewFor also finds the map in a view whose scene tab shows it', () => {
  const tabbed = fakeView({ path: OTHER, storePath: MAP }).view;
  assert.equal(rollViewFor([fakeView({ path: 'x.json' }).view, tabbed], null, MAP), tabbed);
});

test('rollViewFor skips a remote view, then falls back to the recent view, the first one, then none', () => {
  const remote = fakeView({ path: MAP, remote: true }).view;
  const recent = fakeView({ path: OTHER }).view;
  const first = fakeView({ path: 'a.json' }).view;
  assert.equal(rollViewFor([remote, first, recent], recent, MAP), recent);
  assert.equal(rollViewFor([remote, first, recent], remote, MAP), first);
  assert.equal(rollViewFor([remote, first], fakeView({ type: 'markdown' }).view, MAP), first);
  assert.equal(rollViewFor([remote], remote, MAP), null);
  assert.equal(rollViewFor([], null, MAP), null);
});

test('diceRulesOf reads the collection settings dice of the view map', () => {
  const { view } = fakeView({ path: MAP, settings: { conditions: [], dice: D10_EXPLODING } });
  assert.deepEqual(diceRulesOf(view), D10_EXPLODING);
});

test("diceRulesOf prefers the dice tool's set, as Atlas's own toolbar rolls it", () => {
  const set = { id: 'builtin:d10-exploding', name: 'd10 exploding', builtIn: true, dice: [{ count: 1, sides: 10 }], crit: 'natural', explode: D10_EXPLODING.explode };
  const { view } = fakeView({ path: MAP, diceTool: { getDiceRules: () => set }, settings: { conditions: [], diceSetId: 'builtin:d10-exploding' } });
  assert.deepEqual(diceRulesOf(view), D10_EXPLODING);
  const power = fakeView({ path: MAP, diceTool: { getDiceRules: () => ({ dice: [{ count: 2, sides: 10 }], crit: 'high-total', advantage: { kind: 'number', value: 2 } }) } }).view;
  assert.deepEqual(diceRulesOf(power), { defaultRoll: '2d10', crit: 'high-total' });
});

test('diceRulesOf checks field by field', () => {
  const rules = (dice: unknown) => diceRulesOf(fakeView({ path: MAP, settings: { conditions: [], dice } }).view);
  assert.deepEqual(rules({ defaultRoll: '2d6', crit: 'sideways' }), { defaultRoll: '2d6', crit: 'natural' });
  assert.deepEqual(rules({ defaultRoll: '1d7', crit: 'none' }), { defaultRoll: '1d20', crit: 'none' });
  assert.deepEqual(rules({ defaultRoll: '1d6', crit: 'none', explode: { dice: 'some', repeats: true, highFaces: 1, lowFaces: 0 } }), { defaultRoll: '1d6', crit: 'none' });
  assert.deepEqual(rules({ defaultRoll: '1d6', crit: 'none', explode: { dice: 'all', repeats: 'yes', highFaces: 1.5, lowFaces: -1 } }), { defaultRoll: '1d6', crit: 'none' });
  // Mixed dice in a set have no one default die Tabletop can roll.
  assert.deepEqual(rules({ dice: [{ count: 1, sides: 20 }, { count: 1, sides: 6 }], crit: 'none' }), { defaultRoll: '1d20', crit: 'none' });
});

test('diceRulesOf gives the defaults for garbage, no collection and no view', () => {
  for (const dice of [undefined, null, 'd20', 7, [], {}]) {
    assert.deepEqual(diceRulesOf(fakeView({ path: MAP, settings: { conditions: [], dice } }).view), DEFAULT_RULES);
  }
  assert.deepEqual(diceRulesOf(fakeView({ path: MAP, diceTool: { getDiceRules: () => { throw new Error('no map'); } } }).view), DEFAULT_RULES);
  assert.deepEqual(diceRulesOf(fakeView({ path: 'loose.json', settings: { dice: D10_EXPLODING } }).view), DEFAULT_RULES);
  assert.deepEqual(diceRulesOf({ getViewType: () => 'atlas-vtt', serviceManager: 42 }), DEFAULT_RULES);
  assert.deepEqual(diceRulesOf(null), DEFAULT_RULES);
});

test("diceRulesOf for a board's map reads that map's collection when the view shows another map", () => {
  const set = { dice: [{ count: 1, sides: 6 }], crit: 'none' };
  const collections: Record<string, string> = { [MAP]: 'c1', 'atlas-vtt/collections/c2/maps/vault.json': 'c2' };
  const settings: Record<string, unknown> = { c1: { dice: D10_EXPLODING }, c2: { dice: { defaultRoll: '1d12', crit: 'roll-under' } } };
  const view: MapViewLike = {
    getViewType: () => 'atlas-vtt',
    file: { path: MAP },
    atlasStore: { getState: () => ({ mapPath: MAP }) },
    serviceManager: {
      getToolController: () => ({ getDiceTool: () => ({ getDiceRules: () => set }) }),
      getAssetService: () => ({ getCollectionForMap: (path: string) => collections[path] ?? null, getCollectionSettings: (id: string) => settings[id] }),
    },
  };
  // The view shows the board's map: its dice tool's set, as before.
  assert.deepEqual(diceRulesOf(view, MAP), { defaultRoll: '1d6', crit: 'none' });
  // The view fell back from another map: the dice tool rolls the view's map, so the board's map's collection rules.
  assert.deepEqual(diceRulesOf(view, 'atlas-vtt/collections/c2/maps/vault.json'), { defaultRoll: '1d12', crit: 'roll-under' });
  assert.deepEqual(diceRulesOf(view, OTHER), DEFAULT_RULES);
  assert.deepEqual(diceRulesOf(view, 'loose.json'), DEFAULT_RULES);
});

test("stockRoll is Atlas's stock roll: min 1 on every die, its colour tag as Atlas names it", () => {
  const roll = stockRoll({
    rolls: [
      { die: 'd20', value: 17, max: 20, color: '#ff0000', colorName: 'Fire' },
      { die: 'd20', value: 4, max: 20, dropped: true },
      { die: 'd6', value: 6, max: 6, color: 'red' },
      { die: 'd6', value: 2, max: 6, exploded: true },
    ],
    modifier: 3, total: 28, crit: 'failure',
  }) as Record<string, unknown>;
  assert.match(String(roll.id), /^tabletop_\d+_[a-z0-9]+$/);
  assert.equal(typeof roll.timestamp, 'number');
  assert.equal(roll.formula, '1d20+1d6+3');
  assert.deepEqual(roll.rolls, [
    { die: 'd20', value: 17, max: 20, min: 1, colour: '#ff0000', name: 'Fire' },
    { die: 'd20', value: 4, max: 20, min: 1, dropped: true },
    { die: 'd6', value: 6, max: 6, min: 1 },
    { die: 'd6', value: 2, max: 6, min: 1, exploded: true },
  ]);
  assert.equal(roll.modifiers, 3);
  assert.equal(roll.total, 28);
  assert.equal(roll.crit, 'low');
  assert.equal(roll.player, 'Tabletop for Atlas VTT');
  assert.deepEqual(roll.source, { type: 'toolbar' });
  assert.equal('rolledBy' in roll, false);
});

test('stockRoll names who rolled it and the ability it was rolled from', () => {
  const roll = stockRoll({ rolls: [{ die: 'd20', value: 20, max: 20 }], modifier: -1, total: 19, crit: 'success' }, 'Mira', { abilityName: 'Longbow', tokenId: 't7' }) as Record<string, unknown>;
  assert.equal(roll.formula, '1d20-1');
  assert.equal(roll.crit, 'high');
  assert.equal(roll.rolledBy, 'Mira');
  const tags = stockRoll({ rolls: [{ die: 'd6', value: 3, max: 6, color: '#00ff00', colorName: '<b>Acid</b>' }], modifier: 0, total: 3 }) as { formula: string; rolls: unknown[] };
  assert.equal(tags.formula, '1d6');
  assert.deepEqual(tags.rolls, [{ die: 'd6', value: 3, max: 6, min: 1, colour: '#00ff00' }]);
  assert.deepEqual(roll.source, { type: 'statblock', abilityName: 'Longbow', tokenId: 't7' });
});

test("publishRoll emits once on the view's bus; false with no route", () => {
  const { view, emitted } = fakeView({ path: MAP });
  const roll = { id: 'r' };
  assert.equal(publishRoll(view, roll), true);
  assert.deepEqual(emitted, [['dice-rolled', roll]]);
  assert.equal(publishRoll(null, roll), false);
  assert.equal(publishRoll({ getViewType: () => 'atlas-vtt', serviceManager: { getEventBus: () => ({}) } }, roll), false);
  const warned = quietly(() => {
    assert.equal(publishRoll({ getViewType: () => 'atlas-vtt', serviceManager: { getEventBus: () => ({ emit: () => { throw new Error('gone'); } }) } }, roll), false);
  });
  assert.equal(warned.length, 1);
});

test("publishRoll goes through Atlas's extension API when there is one, not also the bus", () => {
  const { view, emitted } = fakeView({ path: MAP });
  const published: unknown[][] = [];
  const ext = { dice: { publish: (...args: unknown[]) => { published.push(args); } } };
  assert.equal(publishRoll(view, { id: 'r' }, ext), true);
  assert.deepEqual(published, [[{ id: 'r' }, { throw: false }]]);
  assert.deepEqual(emitted, []);
  // An API that refuses the roll leaves the bus to log it.
  quietly(() => assert.equal(publishRoll(view, { id: 's' }, { dice: { publish: () => { throw new Error('refused'); } } }), true));
  assert.deepEqual(emitted, [['dice-rolled', { id: 's' }]]);
});

test("onRolled hears the view's dice-rolled until let go", () => {
  const { view, listeners } = fakeView({ path: MAP });
  const heard: unknown[] = [];
  const stop = onRolled(view, (roll) => heard.push(roll));
  publishRoll(view, { id: 'a' });
  stop();
  publishRoll(view, { id: 'b' });
  assert.deepEqual(heard, [{ id: 'a' }]);
  assert.equal(listeners.get('dice-rolled')?.size, 0);
  assert.doesNotThrow(() => onRolled({ getViewType: () => 'atlas-vtt' }, () => undefined)());
});
