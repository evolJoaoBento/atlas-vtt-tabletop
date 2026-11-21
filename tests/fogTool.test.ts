import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BrushGesture, FogTool, type FogOperationInput, type FogToolDeps } from '../src/board/fogTool';
import type { FogWall } from '../src/board/fogWalls';
import { clampBrushSize, DEFAULT_FOG_TOOL, fogStrokeErases, steppedBrushSize } from '../src/atlasPort/fogToolChoices';
import { DEFAULT_GM_FOG_OPACITY, readGmFogOpacity } from '../src/atlasPort/gmFogOpacity';
import { FogVolume } from '../src/board/fogVolume';

const keys = { shift: false, ctrl: false };

/** A fake 2D canvas context that only counts what is drawn. */
const drawn = { clears: 0 };
function fakeCanvas(): HTMLCanvasElement {
  const calls: string[] = [];
  const context = new Proxy({}, { get: (_target, name) => (name === 'calls' ? calls : () => { calls.push(String(name)); if (name === 'clearRect') drawn.clears += 1; }), set: () => true });
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}

function tool(options: { walls?: FogWall[]; grid?: { type: string; size: number; offsetX: number; offsetY: number; snap: boolean } | null; switches?: { fogSnap: boolean; fogConstrain: boolean } } = {}) {
  const parent = new THREE.Group();
  const commits: FogOperationInput[][] = [];
  let fogKey = 'a';
  let changed = 0;
  const notices: string[] = [];
  const switches = options.switches ?? { fogSnap: true, fogConstrain: false };
  const walls = options.walls ?? [];
  const deps: FogToolDeps = {
    parent,
    canvas: fakeCanvas,
    // The ground is the screen: one map pixel a screen pixel.
    boardPoint: (x, y) => ({ x, y }),
    unitsPerPixel: () => 1,
    fogKey: () => fogKey,
    mapSize: () => ({ width: 1000, height: 800 }),
    commit: (operations) => { commits.push(operations); },
    changed: () => { changed += 1; },
    wake: () => {},
    walls: () => walls,
    grid: () => (options.grid === undefined ? null : options.grid),
    mapRect: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    notice: (text) => { notices.push(text); },
    switchOn: (id) => switches[id],
    accent: () => '#7c5cff',
  };
  return { fog: new FogTool(deps), parent, commits, notices, switches, changes: () => changed, setFogKey: (key: string) => { fogKey = key; } };
}

test("Atlas's fog choices: the brush's limits, step and the eraser's flip", () => {
  assert.deepEqual(DEFAULT_FOG_TOOL, { shape: 'brush', brushSize: 50 });
  assert.equal(clampBrushSize(5), 10);
  assert.equal(clampBrushSize(500), 200);
  assert.equal(clampBrushSize(Number.NaN), 50);
  assert.equal(steppedBrushSize(50, 1), 57);
  assert.equal(steppedBrushSize(50, 1, true), 53);
  assert.equal(steppedBrushSize(10, -1), 10);
  assert.equal(steppedBrushSize(12, 1, true), 13);
  assert.equal(fogStrokeErases('fog', false), false);
  assert.equal(fogStrokeErases('fog', true), true);
  assert.equal(fogStrokeErases('eraser', true), false);
});

test("Atlas's GM fog opacity is read as Atlas reads it", () => {
  assert.equal(DEFAULT_GM_FOG_OPACITY, 0.5);
  assert.equal(readGmFogOpacity(0.8), 0.8);
  assert.equal(readGmFogOpacity('0.3'), 0.3);
  assert.equal(readGmFogOpacity(5), 1);
  assert.equal(readGmFogOpacity(0), 0.1);
  assert.equal(readGmFogOpacity('nope'), 0.5);
});

test('the fog volume shows the GM the fog at the strength Atlas has, players whole', () => {
  const fog = new FogVolume();
  const strength = (): number => ((fog as unknown as { material: THREE.ShaderMaterial }).material.uniforms.uStrength.value as number);
  fog.show('gm');
  assert.equal(strength(), 0.5);
  fog.setGmStrength(0.8);
  assert.equal(strength(), 0.8);
  fog.show('player');
  assert.equal(strength(), 1);
  // A setting changed while the players' picture is drawn is for the GM's next.
  fog.setGmStrength(0.2);
  assert.equal(strength(), 1);
  fog.show('gm');
  assert.equal(strength(), 0.2);
  fog.setGmStrength(null);
  assert.equal(strength(), 0.5);
});

test('a brush gesture keeps every point a map pixel apart, and a tap is a one point stroke', () => {
  const gesture = new BrushGesture();
  assert.equal(gesture.down({ x: 10, y: 10 }, keys, 40), true);
  gesture.move({ x: 10.3, y: 10.2 });
  gesture.move({ x: 20, y: 10 });
  gesture.move({ x: 30, y: 25 });
  assert.deepEqual(gesture.preview(), { kind: 'brush', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 25 }], radius: 40 });
  assert.deepEqual(gesture.up({ x: 30, y: 25 }, keys), [{ type: 'brush', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 25 }], brushRadius: 40 }]);
  assert.equal(gesture.active, false);
  const tap = new BrushGesture();
  tap.down({ x: 5, y: 6 }, keys, 20);
  assert.deepEqual(tap.up({ x: 5, y: 6 }, keys), [{ type: 'brush', points: [{ x: 5, y: 6 }], brushRadius: 20 }]);
});

test('a stroke is committed once, at the release, as one brush operation with the brush\'s radius', () => {
  const { fog, commits } = tool();
  fog.setOn(true);
  fog.setBrushSize(70);
  assert.equal(fog.down(100, 100, keys, false), true);
  fog.move(150, 110, keys, false);
  assert.equal(commits.length, 0);
  fog.up(200, 120, keys, false);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], [{ type: 'brush', points: [{ x: 100, y: 100 }, { x: 150, y: 110 }, { x: 200, y: 120 }], brushRadius: 70, isErasing: false }]);
});

test('Alt turns a stroke around, read at the release (also when pressed mid-stroke); the eraser is turned the other way', () => {
  const { fog, commits } = tool();
  fog.setOn(true);
  fog.down(10, 10, keys, true);
  fog.up(40, 10, keys, true);
  assert.equal((commits[0]![0] as { isErasing: boolean }).isErasing, true);
  fog.down(10, 10, keys, false);
  fog.move(30, 10, keys, true);
  fog.up(40, 10, keys, true);
  assert.equal((commits[1]![0] as { isErasing: boolean }).isErasing, true);
  fog.setMode('eraser');
  fog.down(10, 10, keys, false);
  fog.up(40, 10, keys, false);
  assert.equal((commits[2]![0] as { isErasing: boolean }).isErasing, true);
  fog.down(10, 10, keys, true);
  fog.up(40, 10, keys, true);
  assert.equal((commits[3]![0] as { isErasing: boolean }).isErasing, false);
});

test('the ring follows the pointer in the colour of what a stroke does, and goes with the pointer, the shape and the tool', () => {
  const { fog } = tool();
  fog.setOn(true);
  assert.equal(fog.rings, null);
  fog.move(300, 200, keys, false);
  const rings = fog.rings!;
  assert.equal(rings.light.visible && rings.dark.visible, true);
  assert.deepEqual([rings.light.position.x, rings.light.position.z], [300, 200]);
  assert.equal((rings.light.material as THREE.MeshBasicMaterial).color.getHexString(), 'ffffff');
  assert.equal((rings.dark.material as THREE.MeshBasicMaterial).opacity, 0.55);
  assert.equal((rings.light.material as THREE.MeshBasicMaterial).opacity, 0.95);
  fog.setFlipped(true);
  assert.equal((rings.light.material as THREE.MeshBasicMaterial).color.getHexString(), 'ff4444');
  fog.setFlipped(false);
  fog.leave();
  assert.equal(rings.light.visible, false);
  fog.move(10, 10, keys, false);
  assert.equal(rings.light.visible, true);
  fog.setShape('lasso');
  assert.equal(rings.light.visible, false);
  fog.setShape('brush');
  fog.setOn(false);
  assert.equal(rings.light.visible, false);
});

test("the ring's lines are 4 and 1.5 screen pixels wide at any zoom", () => {
  const { fog } = tool();
  fog.setOn(true);
  fog.move(300, 200, keys, false);
  const width = (mesh: THREE.Mesh): number => { const g = (mesh.geometry as THREE.RingGeometry).parameters; return g.outerRadius - g.innerRadius; };
  assert.equal(width(fog.rings!.dark), 4);
  assert.equal(width(fog.rings!.light), 1.5);
});

test('the size keys step the brush and the ring takes the size', () => {
  const { fog } = tool();
  fog.setOn(true);
  fog.move(300, 200, keys, false);
  fog.stepBrush(1, false);
  assert.equal(fog.brushSize, 57);
  const radius = ((fog.rings!.light.geometry as THREE.RingGeometry).parameters.outerRadius + (fog.rings!.light.geometry as THREE.RingGeometry).parameters.innerRadius) / 2;
  assert.ok(Math.abs(radius - 57) < 1e-6);
  for (let i = 0; i < 40; i += 1) fog.stepBrush(1, false);
  assert.equal(fog.brushSize, 200);
  for (let i = 0; i < 80; i += 1) fog.stepBrush(-1, false);
  assert.equal(fog.brushSize, 10);
});

test('Escape drops a stroke under way without committing; a press with the tool off, or with Cells and no grid, begins nothing', () => {
  const { fog, commits } = tool();
  assert.equal(fog.down(5, 5, keys, false), false);
  fog.setOn(true);
  fog.down(5, 5, keys, false);
  assert.equal(fog.drawing, true);
  fog.cancel();
  assert.equal(fog.drawing, false);
  fog.up(20, 20, keys, false);
  assert.equal(commits.length, 0);
  fog.setShape('cells');
  assert.equal(fog.down(5, 5, keys, false), false);
});

test("a committed stroke's preview stays until the board draws different fog, or a write is refused", () => {
  const { fog, parent, setFogKey } = tool();
  fog.setOn(true);
  fog.down(10, 10, keys, false);
  fog.up(60, 10, keys, false);
  const preview = (): boolean => parent.getObjectByName('fog-preview')?.visible === true;
  assert.equal(preview(), true);
  // The board draws the fog it had: not yet.
  fog.fogDrawn();
  assert.equal(preview(), true);
  setFogKey('b');
  fog.fogDrawn();
  assert.equal(preview(), false);
  fog.down(10, 10, keys, false);
  fog.up(60, 10, keys, false);
  assert.equal(preview(), true);
  fog.failed();
  assert.equal(preview(), false);
});

test('the tool tells the toolbar what changed', () => {
  const { fog, changes } = tool();
  const before = changes();
  fog.setOn(true);
  fog.setMode('eraser');
  fog.setShape('lasso');
  fog.setBrushSize(120);
  assert.ok(changes() >= before + 4);
  fog.toggleMode();
  assert.equal(fog.mode, 'fog');
  fog.toggleMode();
  assert.equal(fog.mode, 'eraser');
});

const press = (fog: FogTool, x: number, y: number, held = keys, alt = false): boolean => fog.down(x, y, held, alt);

test('the rectangle commits one rectangle op, Shift (Constrain) makes a square, Alt flips it to erasing', () => {
  const { fog, commits } = tool();
  fog.setOn(true);
  fog.setShape('rectangle');
  press(fog, 100, 100);
  fog.move(300, 200, keys, false);
  fog.up(300, 200, keys, false);
  assert.deepEqual(commits[0], [{ type: 'rectangle', x: 100, y: 100, width: 200, height: 100, isErasing: false }]);
  press(fog, 100, 100, { shift: true, ctrl: false });
  fog.move(300, 200, { shift: true, ctrl: false }, false);
  fog.up(300, 200, { shift: true, ctrl: false }, false);
  assert.deepEqual(commits[1], [{ type: 'rectangle', x: 100, y: 100, width: 200, height: 200, isErasing: false }]);
  press(fog, 100, 100);
  fog.move(150, 150, keys, true);
  fog.up(150, 150, keys, true);
  assert.equal((commits[2]![0] as { isErasing: boolean }).isErasing, true);
  // An erasing shape that is no brush marks no area of its own, as Atlas's gesture: the operation is plain.
  assert.equal('area' in commits[2]![0]!, false);
});

test('the Constrain switch squares a rectangle without Shift, and Shift turns it back', () => {
  const { fog, commits } = tool({ switches: { fogSnap: true, fogConstrain: true } });
  fog.setOn(true);
  fog.setShape('rectangle');
  press(fog, 100, 100);
  fog.move(300, 200, keys, false);
  fog.up(300, 200, keys, false);
  assert.equal((commits[0]![0] as { height: number }).height, 200);
  press(fog, 100, 100, { shift: true, ctrl: false });
  fog.move(300, 200, { shift: true, ctrl: false }, false);
  fog.up(300, 200, { shift: true, ctrl: false }, false);
  assert.equal((commits[1]![0] as { height: number }).height, 100);
});

test('the lasso closes on release; fewer than three points leave nothing', () => {
  const { fog, commits } = tool();
  fog.setOn(true);
  fog.setShape('lasso');
  press(fog, 10, 10);
  fog.move(100, 10, keys, false);
  fog.up(100, 10, keys, false);
  assert.equal(commits.length, 0);
  press(fog, 10, 10);
  fog.move(100, 10, keys, false);
  fog.move(100, 100, keys, false);
  fog.up(100, 100, keys, false);
  assert.equal(commits.length, 1);
  assert.equal(commits[0]![0]!.type, 'lasso');
  assert.equal((commits[0]![0] as { points: unknown[] }).points.length, 3);
});

test('the polygon keeps its corners across presses; Enter, the first corner, a double click close it; Backspace and Escape drop corners', () => {
  const { fog, commits } = tool();
  fog.setOn(true);
  fog.setShape('polygon');
  for (const [x, y] of [[100, 100], [300, 100], [300, 300]] as const) { press(fog, x, y); fog.up(x, y, keys, false); }
  assert.equal(fog.drawing, true);
  assert.equal(commits.length, 0);
  // Backspace takes the last corner back; the polygon still waits.
  assert.equal(fog.key('Backspace', false), true);
  assert.equal(fog.drawing, true);
  press(fog, 310, 300); fog.up(310, 300, keys, false);
  assert.equal(fog.key('Enter', false), true);
  assert.equal(fog.drawing, false);
  assert.deepEqual(commits[0], [{ type: 'lasso', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 310, y: 300 }], isErasing: false }]);
  // A click on the first corner closes it.
  for (const [x, y] of [[100, 100], [300, 100], [300, 300]] as const) { press(fog, x, y); fog.up(x, y, keys, false); }
  press(fog, 103, 102); fog.up(103, 102, keys, false);
  assert.equal(commits.length, 2);
  assert.equal(fog.drawing, false);
  // Fewer than three corners close nothing; the undo key drops the last corner (as Backspace); Escape drops all.
  press(fog, 50, 50); fog.up(50, 50, keys, false);
  press(fog, 80, 50); fog.up(80, 50, keys, false);
  assert.equal(fog.key('Enter', false), true);
  assert.equal(fog.drawing, true);
  assert.equal(commits.length, 2);
  assert.equal(fog.key('z', false, true), true);
  assert.equal(fog.drawing, true);
  assert.equal(fog.key('z', false, true), true);
  assert.equal(fog.drawing, false);
  press(fog, 50, 50); fog.up(50, 50, keys, false);
  fog.cancel();
  assert.equal(fog.drawing, false);
  assert.equal(fog.key('Enter', false), false);
});

test('a double click closes the polygon', () => {
  const { fog, commits } = tool();
  fog.setOn(true);
  fog.setShape('polygon');
  for (const [x, y] of [[100, 100], [300, 100], [300, 300]] as const) { press(fog, x, y); fog.up(x, y, keys, false); }
  press(fog, 200, 400); fog.up(200, 400, keys, false);
  press(fog, 200, 400); fog.up(200, 400, keys, false);
  assert.equal(commits.length, 1);
  assert.equal((commits[0]![0] as { points: unknown[] }).points.length, 4);
});

test('Constrain holds a polygon edge to an eighth of a turn; Ctrl places a point freely off the grid', () => {
  const grid = { type: 'square', size: 100, offsetX: 0, offsetY: 0, snap: true };
  const { fog, commits } = tool({ grid });
  fog.setOn(true);
  fog.setShape('polygon');
  const held = { shift: true, ctrl: false };
  press(fog, 100, 100, held); fog.up(100, 100, held, false);
  // 290,130 is nearest the 45 degree line from 100,100: 100+x, 100+x ... snapped through the held edge.
  press(fog, 330, 170, held); fog.up(330, 170, held, false);
  press(fog, 330, 330, held); fog.up(330, 330, held, false);
  fog.key('Enter', false);
  const points = (commits[0]![0] as { points: Array<{ x: number; y: number }> }).points;
  assert.equal(points[0]!.x, 100);
  // The second corner lies level with the first (an eighth of a turn), on the grid.
  assert.equal(points[1]!.y, 100);
  // Ctrl: no snapping.
  const free = tool({ grid });
  free.fog.setOn(true);
  free.fog.setShape('rectangle');
  const ctrl = { shift: false, ctrl: true };
  press(free.fog, 123, 137, ctrl);
  free.fog.move(260, 301, ctrl, false);
  free.fog.up(260, 301, ctrl, false);
  assert.deepEqual(free.commits[0], [{ type: 'rectangle', x: 123, y: 137, width: 137, height: 164, isErasing: false }]);
  // Without Ctrl the corners land on the grid.
  const snapped = tool({ grid });
  snapped.fog.setOn(true);
  snapped.fog.setShape('rectangle');
  press(snapped.fog, 123, 137);
  snapped.fog.move(260, 301, keys, false);
  snapped.fog.up(260, 301, keys, false);
  assert.deepEqual(snapped.commits[0], [{ type: 'rectangle', x: 100, y: 100, width: 200, height: 200, isErasing: false }]);
  // The Snap switch off places freely; Ctrl turns it on for the press.
  const off = tool({ grid, switches: { fogSnap: false, fogConstrain: false } });
  off.fog.setOn(true);
  off.fog.setShape('rectangle');
  press(off.fog, 123, 137);
  off.fog.up(123, 137, keys, false);
  press(off.fog, 123, 137);
  off.fog.move(260, 301, keys, false);
  off.fog.up(260, 301, keys, false);
  assert.equal((off.commits[0]![0] as { x: number }).x, 123);
  press(off.fog, 123, 137, ctrl);
  off.fog.move(260, 301, ctrl, false);
  off.fog.up(260, 301, ctrl, false);
  assert.equal((off.commits[1]![0] as { x: number }).x, 100);
});

test('a corner within 10 screen pixels of a wall end lands on it and the guide shows it; the guide goes with the shape', () => {
  const wall: FogWall = { id: 'w', kind: 'wall', type: 'solid', p1: { x: 500, y: 400 }, p2: { x: 700, y: 400 }, closed: true };
  const { fog, parent } = tool({ walls: [wall], grid: { type: 'square', size: 100, offsetX: 0, offsetY: 0, snap: false } });
  fog.setOn(true);
  fog.setShape('rectangle');
  fog.move(506, 395, keys, false);
  assert.deepEqual(fog.markView.guide?.point, { x: 500, y: 400 });
  assert.ok(fog.markView.shown.includes('fog-guide'));
  press(fog, 506, 395);
  fog.move(650, 600, keys, false);
  fog.up(650, 600, keys, false);
  assert.deepEqual(fog.markView.guide, null);
  assert.equal((fog.markView.current), null);
  assert.deepEqual(parent.children.filter((child) => child.name === 'fog-guide' && child.visible).length, 0);
  assert.equal((fog.sheet.shown), true);
});

test('the cells shape needs a grid and commits one lasso per row run', () => {
  const grid = { type: 'square', size: 100, offsetX: 0, offsetY: 0, snap: true };
  const { fog, commits } = tool({ grid });
  fog.setOn(true);
  fog.setShape('cells');
  press(fog, 50, 50);
  fog.move(250, 50, keys, false);
  fog.move(250, 150, keys, false);
  assert.ok(fog.markView.shown.includes('fog-mark-line'));
  fog.up(250, 150, keys, false);
  assert.equal(commits.length, 1);
  assert.ok(commits[0]!.length >= 1);
  assert.ok(commits[0]!.every((operation) => operation.type === 'lasso'));
});

test('the room shape fills the room the walls enclose on a click, says so where there is none', () => {
  const box = (x1: number, y1: number, x2: number, y2: number): FogWall[] => [
    { id: 'a', p1: { x: x1, y: y1 }, p2: { x: x2, y: y1 } }, { id: 'b', p1: { x: x2, y: y1 }, p2: { x: x2, y: y2 } },
    { id: 'c', p1: { x: x2, y: y2 }, p2: { x: x1, y: y2 } }, { id: 'd', p1: { x: x1, y: y2 }, p2: { x: x1, y: y1 } },
  ].map((wall) => ({ ...wall, kind: 'wall', type: 'solid', closed: true }) as FogWall);
  const { fog, commits, notices } = tool({ walls: box(200, 200, 600, 500), grid: { type: 'square', size: 100, offsetX: 0, offsetY: 0, snap: true } });
  fog.setOn(true);
  fog.setShape('room');
  fog.move(400, 350, keys, false);
  assert.ok(fog.markView.shown.includes('fog-mark-line'));
  press(fog, 400, 350);
  fog.up(400, 350, keys, false);
  assert.equal(commits.length, 1);
  const room = commits[0]![0] as { type: string; points: Array<{ x: number; y: number }> };
  assert.equal(room.type, 'lasso');
  assert.ok(room.points.length >= 4);
  // A press that moved is no click.
  press(fog, 400, 350);
  fog.move(420, 350, keys, false);
  fog.up(420, 350, keys, false);
  assert.equal(commits.length, 1);
  // Outside the walls (the ground runs to the map's edge): no room, and Atlas's notice.
  press(fog, 50, 50);
  fog.up(50, 50, keys, false);
  assert.equal(commits.length, 1);
  assert.deepEqual(notices, ['The walls here do not enclose a room.']);
});

test('erasing a shape that is no brush shows the wash (light red), painting shows fog', () => {
  const { fog } = tool();
  fog.setOn(true);
  fog.setShape('rectangle');
  press(fog, 100, 100);
  fog.move(300, 300, keys, false);
  assert.equal(fog.sheet.wash, false);
  fog.setFlipped(true);
  assert.equal(fog.sheet.wash, true);
  fog.cancel();
});

test('a press right after a stroke does not wipe that stroke from the preview before the fog volume holds it', () => {
  const { fog, setFogKey } = tool();
  fog.setOn(true);
  fog.down(10, 10, keys, false);
  fog.up(60, 10, keys, false);
  const before = drawn.clears;
  // The next press and stroke draw on the same sheet: it is not begun anew (cleared) while the first stroke waits for the fog.
  fog.down(10, 100, keys, false);
  fog.move(60, 100, keys, false);
  fog.up(60, 100, keys, false);
  assert.equal(drawn.clears, before);
  assert.equal(fog.sheet.shown, true);
  // The fog is drawn: both are held no more.
  setFogKey('b');
  fog.fogDrawn();
  assert.equal(fog.sheet.shown, false);
  // A stroke that does the other thing (erases) cannot share the sheet: it is begun anew.
  fog.down(10, 10, keys, false);
  fog.up(60, 10, keys, false);
  const mark = drawn.clears;
  fog.down(10, 100, keys, true);
  fog.up(60, 100, keys, true);
  assert.ok(drawn.clears > mark);
});

test("a polygon's corners stay under a second finger or a cancelled pointer; the corner that press placed is taken back", () => {
  const { fog } = tool();
  fog.setOn(true);
  fog.setShape('polygon');
  const corners = (): number => fog.markView.current?.dots?.length ?? 0;
  press(fog, 100, 100); fog.up(100, 100, keys, false);
  press(fog, 300, 100); fog.up(300, 100, keys, false);
  assert.equal(corners(), 2);
  // A third finger down places a corner; the pinch that follows drops that press only.
  press(fog, 300, 300);
  assert.equal(corners(), 3);
  fog.dropPress();
  assert.equal(fog.drawing, true);
  assert.equal(corners(), 2);
  // The press that began the polygon: taken back, nothing is left.
  fog.cancel();
  press(fog, 50, 50);
  fog.dropPress();
  assert.equal(fog.drawing, false);
  // A brush stroke under a pinch is dropped whole.
  fog.setShape('brush');
  press(fog, 10, 10);
  fog.dropPress();
  assert.equal(fog.drawing, false);
});
