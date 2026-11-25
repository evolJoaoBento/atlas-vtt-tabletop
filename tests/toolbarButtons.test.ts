import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  TOOLBAR_BUTTON_IDS,
  TOOLBAR_BUTTONS,
  targetModeFor,
  toolbarButtonEntries,
  type ToolbarButtonState,
} from '../src/board/toolbarButtons';

function makeState(over: Partial<ToolbarButtonState> = {}, actionsOver: Record<string, unknown> = {}): ToolbarButtonState {
  const actions = {
    mode: () => 'play' as const,
    setMode: () => {},
    undo: () => {},
    redo: () => {},
    canUndo: () => true,
    canRedo: () => false,
    fogHeight: () => 1,
    setFogHeight: () => {},
    wallThickness: () => 0.12,
    setWallThickness: () => {},
    wallEdges: () => 'soft' as const,
    setWallEdges: () => {},
    seeThrough: () => false,
    setSeeThrough: () => {},
    seeThroughSize: () => 2,
    setSeeThroughSize: () => {},
    layerLook: () => 'solid' as const,
    setLayerLook: () => {},
    hosting: () => false,
    waterTool: () => null,
    setWaterTool: () => {},
    ground: () => ({ mode: 'board' }),
    setGround: () => {},
    shapeTool: () => false,
    setShapeTool: () => {},
    painting: () => null,
    setPainting: () => {},
    selectMeasure: () => {},
    measureOn: () => false,
    measureShape: () => 'line' as const,
    playerViewOpen: () => false,
    togglePlayerView: () => {},
    playerFrozen: () => false,
    togglePlayerFreeze: () => {},
    laserOn: () => false,
    selectTool: () => {},
    laser: () => ({ color: '#ff0059', size: 16 }),
    setLaser: () => {},
    initiativeOpen: () => false,
    toggleInitiative: () => {},
    canLight: () => true,
    lighting: () => 'classic' as const,
    setLighting: () => {},
    tiltShift: () => false,
    setTiltShift: () => {},
    occlusion: () => false,
    setOcclusion: () => {},
    autoRoll: () => false,
    setAutoRoll: () => {},
    ambient: () => 1,
    setAmbient: () => {},
    tint: () => null,
    setTint: () => {},
    resetTint: () => {},
    ...actionsOver,
  };
  return {
    actions: actions as never,
    hasDice: true,
    hasDiceLog: false,
    hasSheet: true,
    hasCinema: true,
    cinemaLive: false,
    hasMore: false,
    atlasTools: [
      { id: 'loot', label: 'Random tables', enabled: true, active: false },
      { id: 'assets', label: 'Asset manager', enabled: true, active: false },
      { id: 'palette', label: 'Command Palette', enabled: true, active: false },
    ],
    ...over,
  };
}

test('targetModeFor returns the first target mode only when current mode differs', () => {
  assert.equal(targetModeFor(['edit'], 'play'), 'edit');
  assert.equal(targetModeFor(['edit'], 'edit'), null);
  assert.equal(targetModeFor(['edit'], 'cinematic'), 'edit');
  assert.equal(targetModeFor(['play', 'edit'], 'play'), null);
  assert.equal(targetModeFor(['play', 'edit'], 'cinematic'), 'play');
  assert.equal(targetModeFor('all', 'cinematic'), null);
  assert.equal(targetModeFor(['edit'], null), null);
});

test('every toolbar button id has a complete registry definition', () => {
  for (const id of TOOLBAR_BUTTON_IDS) {
    const def = TOOLBAR_BUTTONS[id];
    assert.ok(def, `missing definition for ${id}`);
    assert.equal(def.id, id);
    assert.ok(def.label.length > 0, `empty label for ${id}`);
    assert.ok(def.keywords.length > 0, `empty keywords for ${id}`);
  }
});

test('toolbarButtonEntries suffixes the mode when switching modes and hides unavailable buttons', () => {
  const inPlay = toolbarButtonEntries(makeState());
  const byId = new Map(inPlay.map((entry) => [entry.id, entry]));

  // Edit tools show "· Edit mode" while in Play mode and include "edit" in keywords.
  assert.equal(byId.get('water')?.label, 'Water · Edit mode');
  assert.equal(byId.get('water')?.switchTo, 'edit');
  assert.ok(byId.get('water')?.keywords.includes('edit'));

  // Play tools show plain label while in Play mode.
  assert.equal(byId.get('measure')?.label, 'Measure');
  assert.equal(byId.get('measure')?.switchTo, null);

  // Unavailable buttons are omitted.
  assert.equal(byId.has('cinema-live'), false, 'Live toggle hidden while not hosting');
  assert.equal(byId.has('dice-log'), false, 'Dice log hidden when not attached');
  assert.equal(byId.has('more'), false, 'More hidden when not overflowed');

  // Hosting turns the Live toggle on, and Connect end-slot buttons appear.
  const hosting = toolbarButtonEntries(makeState({
    hasMore: true,
    extraEndButtons: [{ id: 'end-slot:connect', label: 'Session' }],
  }, { hosting: () => true }));
  const hostIds = new Set(hosting.map((entry) => entry.id));
  // The Template tool is gone: the Measure tool's kept measures are the board's templates.
  assert.equal(hostIds.has('template'), false);
  assert.equal(hostIds.has('cinema-live'), true);
  assert.equal(hostIds.has('more'), true);
  assert.equal(hostIds.has('end-slot:connect'), true);
});

test('in Edit mode Play tools show Play mode suffix, and in Cinematic mode live stays in Cinematic', () => {
  const inEdit = toolbarButtonEntries(makeState({}, { mode: () => 'edit', hosting: () => true }));
  const byId = new Map(inEdit.map((entry) => [entry.id, entry]));
  assert.equal(byId.get('measure')?.label, 'Measure · Play mode');
  assert.equal(byId.get('measure')?.switchTo, 'play');
  assert.equal(byId.get('water')?.label, 'Water');
  assert.equal(byId.get('water')?.switchTo, null);
  assert.equal(byId.get('cinema-live')?.label, 'Players follow my camera · Play mode');
  assert.equal(byId.get('cinema-live')?.switchTo, 'play');

  const inCinematic = toolbarButtonEntries(makeState({}, { mode: () => 'cinematic', hosting: () => true }));
  const cinById = new Map(inCinematic.map((entry) => [entry.id, entry]));
  assert.equal(cinById.get('cinema-live')?.label, 'Players follow my camera');
  assert.equal(cinById.get('cinema-live')?.switchTo, null);
  assert.equal(cinById.get('measure')?.label, 'Measure · Play mode');
  assert.equal(cinById.get('measure')?.switchTo, 'play');
  // The Visibility bar's settings are on the Tabletop Settings page now.
  assert.equal(cinById.has('visibility'), false);
});

test('every toolbar button created in toolbar.ts is registered in TOOLBAR_BUTTON_IDS and vice versa', () => {
  const source = readFileSync('src/board/toolbar.ts', 'utf8');
  const registered = new Set<string>();
  for (const match of source.matchAll(/registerButton\(\s*'([^']+)'/g)) registered.add(match[1]!);
  // Dynamic atlas tool ids (`atlas-${tool.id}`) and mode buttons (`mode-${mode}`)
  // are registered with template strings; verify those families too.
  assert.match(source, /registerButton\(`mode-\$\{mode\}`/, 'mode buttons must call registerButton');
  assert.match(source, /registerButton\(`atlas-\$\{tool\.id\}`/, 'atlas tool buttons must call registerButton');
  for (const id of ['mode-play', 'mode-edit', 'mode-cinematic', 'atlas-loot', 'atlas-assets', 'atlas-palette']) {
    registered.add(id);
  }
  // `laser` shares the Move/Select button face in the DOM.
  registered.add('laser');
  // The Stat sheet has no button: only the command palette's Stat sheet command opens it.
  assert.equal(registered.has('sheet'), false, 'the Stat sheet has no toolbar button');
  registered.add('sheet');

  for (const id of registered) {
    assert.ok((TOOLBAR_BUTTON_IDS as readonly string[]).includes(id), `toolbar.ts registers unregistered button id "${id}"`);
  }
  for (const id of TOOLBAR_BUTTON_IDS) {
    assert.ok(registered.has(id), `TOOLBAR_BUTTON_IDS has "${id}" which is not registered in toolbar.ts`);
  }
});
