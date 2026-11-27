import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabletopCommands } from '../src/palette/tabletopCommands';

function actions(canLight = true) {
  const calls: string[] = [];
  let lighting = 'classic';
  let tilt = false;
  const made = {
    canLight: () => canLight, lighting: () => lighting, setLighting: (value: string) => { lighting = value; calls.push(`lighting:${value}`); },
    tiltShift: () => tilt, setTiltShift: (on: boolean) => { tilt = on; calls.push(`tilt:${on}`); },
    occlusion: () => false, setOcclusion: (on: boolean) => calls.push(`occlusion:${on}`),
    wallEdges: () => 'soft', setWallEdges: (edges: string) => calls.push(`edges:${edges}`),
    initiativeOpen: () => false, toggleInitiative: () => calls.push('initiative'),
    autoRoll: () => true, setAutoRoll: (on: boolean) => calls.push(`autoRoll:${on}`),
    hosting: () => false,
    laserOn: () => false,
    selectTool: (tool: string) => calls.push(`tool:${tool}`),
    laser: () => ({ color: '#ff0059', size: 16 }),
    setLaser: () => {},
  };
  return { made: made as never, calls };
}

test('the lighting entries are the lighting menu, with the current one marked', () => {
  const { made, calls } = actions();
  let refreshed = 0;
  const lighting = tabletopCommands(made, () => { refreshed += 1; }).find((entry) => entry.id === 'tabletop-lighting');
  assert.ok(lighting, 'tabletop-lighting submenu present');
  const night = lighting.submenu!.find((entry) => entry.id === 'tabletop-lighting-night')!;
  assert.equal(lighting.submenu!.find((entry) => entry.id === 'tabletop-lighting-classic')!.active, true);
  night.run!();
  assert.deepEqual(calls, ['lighting:night']);
  assert.equal(refreshed, 1);
  // The Miniature look and Contact shadows are on the Tabletop Settings page, not in the lighting submenu.
  assert.equal(lighting.submenu!.some((entry) => entry.id === 'tabletop-lighting-tilt' || entry.id === 'tabletop-lighting-occlusion'), false);
  const page = tabletopCommands(made, () => {}).find((entry) => entry.id === 'tabletop-settings')!;
  for (const word of ['miniature', 'tilt', 'contact', 'shadows']) assert.ok(page.keywords?.includes(word), word);
});

test('no lighting entries where the board cannot light', () => {
  const { made } = actions(false);
  const ids = tabletopCommands(made, () => {}).map((entry) => entry.id);
  assert.equal(ids.includes('tabletop-lighting'), false);
  assert.equal(ids.includes('tabletop-toolbar-lighting'), false);
  assert.equal(ids.includes('tabletop-settings'), true);
});

test("Tabletop Settings is one page entry in the palette, not a submenu of quick options or a second toolbar entry", () => {
  const { made } = actions();
  const entries = tabletopCommands(made, () => {});
  const page = entries.find((entry) => entry.id === 'tabletop-settings')!;
  assert.equal(page.label, 'Tabletop Settings');
  assert.equal(page.page, true);
  assert.equal(page.submenu, undefined);
  // The old quick-options submenu and the toolbar button's own entry are gone: the page holds every one of them.
  assert.equal(entries.some((entry) => entry.id === 'tabletop-board-settings'), false);
  assert.equal(entries.some((entry) => entry.id === 'tabletop-toolbar-board-settings'), false);
  assert.equal(entries.some((entry) => /board settings/i.test(entry.label)), false);
  // The Visibility bar's settings (see-through walls, window size, upper layers, initiative tracker) are on the page.
  assert.equal(entries.some((entry) => entry.id === 'tabletop-toolbar-initiative'), false);
  for (const word of ['visibility', 'see-through', 'layers', 'initiative']) assert.ok(page.keywords?.includes(word), word);
});

test('toolbar registry commands route through the toolbar host and show mode suffix when switching modes', () => {
  const { made } = actions(true);
  const jumped: string[] = [];
  const entries = tabletopCommands(made, () => {}, {
    state: () => ({
      actions: {
        ...(made as object),
        mode: () => 'play',
        setMode: () => {},
        setWaterTool: () => {},
        selectMeasure: () => {},
      } as never,
      hasDice: true,
      hasDiceLog: false,
      hasSheet: true,
      hasCinema: true,
      cinemaLive: false,
      hasMore: false,
      atlasTools: [],
    }),
    goTo: (id) => { jumped.push(id); return true; },
  });
  const water = entries.find((entry) => entry.id === 'tabletop-toolbar-water');
  assert.ok(water);
  assert.equal(water.label, 'Water · Edit mode');
  water.run!();
  const measure = entries.find((entry) => entry.id === 'tabletop-toolbar-measure');
  assert.ok(measure);
  assert.equal(measure.label, 'Measure');
  measure.run!();
  // The Stat sheet has no toolbar button: its palette command opens the drawer.
  const sheet = entries.find((entry) => entry.id === 'tabletop-toolbar-sheet');
  assert.ok(sheet);
  assert.equal(sheet.label, 'Stat sheet');
  // Not a toggle: Atlas's palette draws a toggle's checkbox in place of the icon, and the command has its notebook.
  assert.equal(sheet.active, undefined);
  assert.equal(sheet.icon, 'notebook');
  sheet.run!();
  assert.deepEqual(jumped, ['water', 'measure', 'sheet']);
});

test("the AR table's fine-tuning is a palette command, there before a phone has sent a table too, not a Tabletop Settings row", () => {
  const placed: string[] = [];
  const { made } = actions();
  const without = tabletopCommands({ ...(made as object), arTableSheets: () => null, placeArTable: () => placed.push('place') } as never, () => {});
  without.find((entry) => entry.id === 'tabletop-ar-table')!.run!();
  assert.deepEqual(placed, ['place']);
  const withTable = tabletopCommands({ ...(made as object), arTableSheets: () => 3, placeArTable: () => placed.push('place') } as never, () => {});
  const ar = withTable.find((entry) => entry.id === 'tabletop-ar-table')!;
  assert.equal(ar.label, 'Fine-tune the AR table');
  assert.equal(ar.icon, 'scan');
  assert.equal(ar.active, undefined);
  ar.run!();
  assert.deepEqual(placed, ['place', 'place']);
  const page = withTable.find((entry) => entry.id === 'tabletop-settings')!;
  assert.equal(page.keywords?.includes('ar'), false);
});

test("Atlas 0.20's Appearance page is a palette command that opens it in Atlas", async () => {
  const { setPaletteHost } = await import('../src/palette/paletteHost');
  const opened: (string | undefined)[] = [];
  setPaletteHost({ openInAtlas: (page?: string) => opened.push(page) } as never);
  try {
    const { made } = actions();
    const entry = tabletopCommands(made, () => {}).find((command) => command.id === 'tabletop-atlas-appearance')!;
    assert.equal(entry.label, 'Appearance settings');
    assert.equal(entry.icon, 'paintbrush');
    entry.run!();
    assert.deepEqual(opened, ['appearance']);
  } finally {
    setPaletteHost(null);
  }
});

test('Sound Settings is a page of its own in the palette, found by the words for sound', () => {
  const { made } = actions();
  const entries = tabletopCommands(made, () => {});
  const page = entries.find((entry) => entry.id === 'tabletop-sound-settings')!;
  assert.equal(page.label, 'Sound Settings');
  assert.equal(page.page, true);
  assert.equal(page.icon, 'volume');
  for (const word of ['sound', 'volume', 'mute', 'audio']) assert.ok(page.keywords?.includes(word), word);
  // It follows Tabletop Settings, both pages heading the palette's Settings.
  assert.ok(entries.indexOf(page) > entries.findIndex((entry) => entry.id === 'tabletop-settings'));
});
