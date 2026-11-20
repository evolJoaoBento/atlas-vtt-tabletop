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
  lighting.submenu!.find((entry) => entry.id === 'tabletop-lighting-tilt')!.run!();
  assert.deepEqual(calls, ['lighting:night', 'tilt:true']);
  assert.equal(refreshed, 2);
});

test('no lighting entries where the board cannot light', () => {
  const { made } = actions(false);
  const ids = tabletopCommands(made, () => {}).map((entry) => entry.id);
  assert.equal(ids.includes('tabletop-lighting'), false);
  assert.equal(ids.includes('tabletop-toolbar-lighting'), false);
  assert.equal(ids.includes('tabletop-board-settings'), true);
});

test("the board settings entries run the board settings panel's actions without duplicating toolbar registry entries", () => {
  const { made, calls } = actions();
  const entries = tabletopCommands(made, () => {});
  const board = entries.find((entry) => entry.id === 'tabletop-board-settings')!;
  assert.equal(board.submenu!.find((entry) => entry.id === 'tabletop-edges-soft')!.active, true);
  // Initiative lives in the toolbar registry instead of being duplicated inside board settings.
  assert.equal(board.submenu!.some((entry) => entry.id === 'tabletop-initiative'), false);
  assert.equal(entries.some((entry) => entry.id === 'tabletop-toolbar-initiative'), true);
  board.submenu!.find((entry) => entry.id === 'tabletop-edges-round')!.run!();
  board.submenu!.find((entry) => entry.id === 'tabletop-auto-roll')!.run!();
  assert.deepEqual(calls, ['edges:round', 'autoRoll:false']);
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
  assert.deepEqual(jumped, ['water', 'measure']);
});
