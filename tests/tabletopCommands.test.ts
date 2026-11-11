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
  };
  return { made: made as never, calls };
}

test('the lighting entries are the lighting menu, with the current one marked', () => {
  const { made, calls } = actions();
  let refreshed = 0;
  const [lighting] = tabletopCommands(made, () => { refreshed += 1; });
  assert.equal(lighting!.id, 'tabletop-lighting');
  const night = lighting!.submenu!.find((entry) => entry.id === 'tabletop-lighting-night')!;
  assert.equal(lighting!.submenu!.find((entry) => entry.id === 'tabletop-lighting-classic')!.active, true);
  night.run!();
  lighting!.submenu!.find((entry) => entry.id === 'tabletop-lighting-tilt')!.run!();
  assert.deepEqual(calls, ['lighting:night', 'tilt:true']);
  assert.equal(refreshed, 2);
});

test('no lighting entries where the board cannot light', () => {
  const { made } = actions(false);
  assert.deepEqual(tabletopCommands(made, () => {}).map((entry) => entry.id), ['tabletop-board-settings']);
});

test("the board settings entries run the board settings panel's actions", () => {
  const { made, calls } = actions();
  const board = tabletopCommands(made, () => {}).find((entry) => entry.id === 'tabletop-board-settings')!;
  assert.equal(board.submenu!.find((entry) => entry.id === 'tabletop-edges-soft')!.active, true);
  board.submenu!.find((entry) => entry.id === 'tabletop-edges-round')!.run!();
  board.submenu!.find((entry) => entry.id === 'tabletop-auto-roll')!.run!();
  assert.deepEqual(calls, ['edges:round', 'autoRoll:false']);
});
