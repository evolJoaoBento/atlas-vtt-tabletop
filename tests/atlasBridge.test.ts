import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AtlasBridge } from '../src/atlasBridge';

/** A store as Atlas's zustand ones: getState and subscribe. */
const store = <T>(state: T) => ({ getState: () => state, subscribe: () => () => {} });

interface FakeOptions {
  plugin?: Record<string, unknown> | null;
  views?: Array<{ leaf: { id: string }; view: Record<string, unknown> }>;
  ran?: string[];
}

function fakeApp({ plugin = null, views = [], ran = [] }: FakeOptions = {}) {
  const active: string[] = [];
  const app = {
    plugins: { plugins: plugin ? { 'atlas-vtt': plugin } : {}, manifests: plugin ? { 'atlas-vtt': { version: '0.12.0' } } : {} },
    workspace: {
      getLeavesOfType: (type: string) => (type === 'atlas-vtt' ? views.map(({ leaf, view }) => ({ ...leaf, view })) : []),
      setActiveLeaf: (leaf: { id: string }) => { active.push(leaf.id); },
    },
    commands: { executeCommandById: (id: string) => { ran.push(id); return true; } },
  };
  return { app, active, ran };
}

test("the laser and the dice volume are Atlas's own settings", () => {
  let laser = { color: '#ff0059', size: 16 };
  const listeners = new Set<() => void>();
  const settingsService = {
    getLaserPointerSettings: () => laser,
    setLaserPointerSettings: (changes: Partial<typeof laser>) => { laser = { ...laser, ...changes }; for (const listener of listeners) listener(); },
    getDiceVolume: () => 0.3,
    onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const bridge = new AtlasBridge(fakeApp({ plugin: { settingsService } }).app as never);
  assert.deepEqual(bridge.laser(), { color: '#ff0059', size: 16 });
  let heard = 0;
  const stop = bridge.onSettingsChange(() => { heard += 1; });
  assert.equal(bridge.setLaser({ color: '#00a9ff' }), true);
  assert.deepEqual(bridge.laser(), { color: '#00a9ff', size: 16 });
  assert.equal(heard, 1);
  stop();
  bridge.setLaser({ size: 20 });
  assert.equal(heard, 1);
  assert.equal(bridge.diceVolume(), 0.3);

  // Without Atlas, or with one that lacks the members: no laser of its own, and dice at full volume.
  const none = new AtlasBridge(fakeApp().app as never);
  assert.equal(none.laser(), null);
  assert.equal(none.setLaser({ color: '#00a9ff' }), false);
  assert.equal(none.diceVolume(), 1);
  assert.doesNotThrow(() => none.onSettingsChange(() => {})());
  const odd = new AtlasBridge(fakeApp({ plugin: { settingsService: { getDiceVolume: () => 7, getLaserPointerSettings: () => ({ color: 5 }) } } }).app as never);
  assert.equal(odd.diceVolume(), 1);
  assert.equal(odd.laser(), null);
});

function atlasView(mapPath: string, assetService: unknown = null) {
  return {
    viewId: 'v1',
    atlasStore: store({ mapPath, remoteView: null }),
    tabMetaStore: store({ tabs: [{ id: 't1', filePath: mapPath, displayName: 'Map' }], activeTabId: 't1' }),
    switchToTab: async () => {},
    serviceManager: { getAssetService: () => assetService },
  };
}

test('bridge without Atlas', () => {
  const { app } = fakeApp();
  const bridge = new AtlasBridge(app as never);
  assert.equal(bridge.loaded(), false);
  assert.equal(bridge.version(), null);
  assert.equal(bridge.assetService(), null);
  assert.equal(bridge.settings(), null);
  assert.equal(bridge.collectionFor('a.atlasmap'), null);
  assert.equal(bridge.collectionSettings('c'), null);
  assert.equal(bridge.openGlobalAssetManager('tokens'), false);
  assert.equal(bridge.runInAtlas('a.atlasmap', 'atlas-vtt:toggle-loot-roller', { id: 'board' } as never), false);
  assert.deepEqual(bridge.toolbarLayout().order.slice(0, 3), ['move', 'fog', 'draw']);
  assert.equal(bridge.toolbarLayout().hidden.size, 0);
  assert.equal(bridge.hotkey('lootRoller'), 'l');
  assert.equal(bridge.hotkey('palette'), 'Space');
});

test('bridge without Atlas: updateCollectionSettings reports it could not', async () => {
  const { app } = fakeApp();
  assert.equal(await new AtlasBridge(app as never).updateCollectionSettings('c', { noRepeats: true }), false);
});

test("uses Atlas's running asset service, from a map view", async () => {
  const calls: unknown[] = [];
  const service = {
    getCollectionForMap: (path: string) => (path === 'a.atlasmap' ? 'col1' : null),
    getCollectionSettings: (id: string) => ({ id, randomTables: [] }),
    updateCollectionSettings: async (id: string, change: unknown) => { calls.push([id, change]); },
  };
  const { app } = fakeApp({ plugin: { settingsService: {} }, views: [{ leaf: { id: 'atlas' }, view: atlasView('a.atlasmap', service) }] });
  const bridge = new AtlasBridge(app as never);
  assert.equal(bridge.assetService(), service);
  assert.equal(bridge.collectionFor('a.atlasmap'), 'col1');
  assert.deepEqual(bridge.collectionSettings('col1'), { id: 'col1', randomTables: [] });
  assert.equal(await bridge.updateCollectionSettings('col1', { noRepeats: true }), true);
  assert.deepEqual(calls, [['col1', { noRepeats: true }]]);
});

test("toolbarLayout honours Atlas's hidden tools and order", () => {
  const settingsService = { getToolbarLayout: () => ({ order: ['palette', 'loot'], hidden: ['assets', 'palette'] }), getHotkeys: () => ({}) };
  const { app } = fakeApp({ plugin: { settingsService } });
  const layout = new AtlasBridge(app as never).toolbarLayout();
  // Atlas's own resolution: the user's order kept, each tool they did not place after the one preceding it by default
  // (tools with nothing placed before them go first).
  assert.deepEqual(layout.order.filter((id) => ['palette', 'loot'].includes(id)), ['palette', 'loot']);
  assert.deepEqual(layout.order.slice(0, 2), ['move', 'fog']);
  assert.ok(layout.order.includes('assets'));
  assert.ok(layout.hidden.has('assets'));
  // The Command palette can never be hidden.
  assert.ok(!layout.hidden.has('palette'));
});

test('hotkey reads a key rebound in Atlas', () => {
  const settingsService = { getToolbarLayout: () => ({}), getHotkeys: () => ({ lootRoller: 'g', palette: 'Space' }) };
  const { app } = fakeApp({ plugin: { settingsService } });
  const bridge = new AtlasBridge(app as never);
  assert.equal(bridge.hotkey('lootRoller'), 'g');
  assert.equal(bridge.hotkey('assets'), 'a');
});

test('runInAtlas runs the command on the leaf holding the map and gives the focus back', () => {
  const { app, active, ran } = fakeApp({ plugin: {}, views: [{ leaf: { id: 'atlas' }, view: atlasView('a.atlasmap') }] });
  const ok = new AtlasBridge(app as never).runInAtlas('a.atlasmap', 'atlas-vtt:toggle-loot-roller', { id: 'board' } as never);
  assert.equal(ok, true);
  assert.deepEqual(ran, ['atlas-vtt:toggle-loot-roller']);
  assert.deepEqual(active, ['atlas', 'board']);
});

test('openGlobalAssetManager opens Atlas\'s own window on a tab', () => {
  const opened: unknown[] = [];
  const { app } = fakeApp({ plugin: { globalAssetManager: { open: (tab: unknown) => opened.push(tab) } } });
  assert.equal(new AtlasBridge(app as never).openGlobalAssetManager('encounters'), true);
  assert.deepEqual(opened, ['encounters']);
});

test('onLoaded fires once Atlas appears', () => {
  const plugins: Record<string, unknown> = {};
  const app = { plugins: { plugins, manifests: {} }, workspace: { getLeavesOfType: () => [] } };
  let tick: (() => void) | null = null;
  const bridge = new AtlasBridge(app as never, { every: (_ms, fn) => { tick = fn; return () => { tick = null; }; } });
  let fired = 0;
  bridge.onLoaded(() => { fired += 1; });
  tick!();
  assert.equal(fired, 0);
  plugins['atlas-vtt'] = {};
  tick!();
  assert.equal(fired, 1);
  assert.equal(tick, null, 'stops watching once loaded');
});

test("the drag-distance choice and the map's movement are Atlas's own (0.15)", () => {
  const steps = [{ name: 'Move', multiple: 1, color: '#22c55e' }];
  const movement = { rules: () => ({ steps, countPerTurn: true }), speedOf: (token: { id: string }) => (token.id === 'hero' ? 30 : -1) };
  const view = { ...atlasView('a.atlasmap'), serviceManager: { getRendererService: () => ({ getRenderer: () => ({ getTokenRenderer: () => ({ dragRuler: { movement } }) }) }) } };
  const { app } = fakeApp({ plugin: { settingsService: { getDragDistance: () => 'combat' } }, views: [{ leaf: { id: 'atlas' }, view }] });
  const bridge = new AtlasBridge(app as never);
  assert.equal(bridge.dragDistance(), 'combat');
  const read = bridge.movementFor('a.atlasmap');
  assert.deepEqual(read?.rules, { steps, countPerTurn: true });
  assert.equal(read?.speedOf({ id: 'hero' }), 30);
  assert.equal(read?.speedOf({ id: 'gob' }), null);
  assert.equal(bridge.movementFor('other.atlasmap'), null);
  // Without Atlas, or a choice that is none: always.
  assert.equal(new AtlasBridge(fakeApp().app as never).dragDistance(), 'always');
  assert.equal(new AtlasBridge(fakeApp({ plugin: { settingsService: { getDragDistance: () => 'sometimes' } } }).app as never).dragDistance(), 'always');
});
