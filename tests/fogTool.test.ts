import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BrushGesture, FogTool, gestureFor, type FogOperationInput, type FogToolDeps } from '../src/board/fogTool';
import { clampBrushSize, DEFAULT_FOG_TOOL, fogStrokeErases, steppedBrushSize } from '../src/atlasPort/fogToolChoices';
import { DEFAULT_GM_FOG_OPACITY, readGmFogOpacity } from '../src/atlasPort/gmFogOpacity';
import { FogVolume } from '../src/board/fogVolume';

const keys = { shift: false, ctrl: false };

/** A fake 2D canvas context that only counts what is drawn. */
function fakeCanvas(): HTMLCanvasElement {
  const calls: string[] = [];
  const context = new Proxy({}, { get: (_target, name) => (name === 'calls' ? calls : () => { calls.push(String(name)); }), set: () => true });
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}

function tool() {
  const parent = new THREE.Group();
  const commits: FogOperationInput[][] = [];
  let fogKey = 'a';
  let changed = 0;
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
  };
  return { fog: new FogTool(deps), parent, commits, changes: () => changed, setFogKey: (key: string) => { fogKey = key; } };
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
  assert.equal(gestureFor('brush') instanceof BrushGesture, true);
  // The other shapes have no gesture yet (stage 2).
  for (const shape of ['rectangle', 'polygon', 'lasso', 'cells', 'room'] as const) assert.equal(gestureFor(shape), null);
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

test('Escape drops a stroke under way without committing; a press with the tool off or a shape with no gesture begins nothing', () => {
  const { fog, commits } = tool();
  assert.equal(fog.down(5, 5, keys, false), false);
  fog.setOn(true);
  fog.down(5, 5, keys, false);
  assert.equal(fog.drawing, true);
  fog.cancel();
  assert.equal(fog.drawing, false);
  fog.up(20, 20, keys, false);
  assert.equal(commits.length, 0);
  fog.setShape('rectangle');
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
