import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GROUND, FOG_MIN, fogRange, groundHeight, planeReach, readGround, REACH_SPANS, type GroundSettings } from '../src/board/ground';
import { LIQUID_DEFAULTS } from '../src/board/water';

const flat = { x0: 0, y0: 0, x1: 20, y1: 15 };
const hills = (over: Partial<GroundSettings> = {}): GroundSettings => ({ ...DEFAULT_GROUND, mode: 'horizon', noise: 'rolling', strength: 0.5, ...over });

test('ground settings read tolerantly: defaults for what is missing, numbers kept in range', () => {
  assert.deepEqual(readGround(undefined), DEFAULT_GROUND);
  assert.deepEqual(readGround('junk'), DEFAULT_GROUND);
  const read = readGround({ mode: 'horizon', material: 'atlas-vtt/assets/materials/grass', noise: 'dunes', strength: 3, fog: -5, margin: 250, tile: 20 });
  assert.deepEqual(read, { mode: 'horizon', material: 'atlas-vtt/assets/materials/grass', noise: 'dunes', strength: 1, fog: 0, margin: 100, tile: 8, water: DEFAULT_GROUND.water, lava: LIQUID_DEFAULTS.lava, acid: LIQUID_DEFAULTS.acid });
  assert.equal(readGround({ tile: 0 }).tile, 1);
  const sea = readGround({ mode: 'water', water: { kind: 'waves', amount: 0.9, direction: 450, tint: '#123F63', clarity: 2 } });
  assert.deepEqual([sea.mode, sea.water], ['water', { kind: 'waves', amount: 0.9, direction: 90, tint: '#123f63', clarity: 1 }]);
  assert.equal(readGround({ mode: 'sky', noise: 'cliffs' }).mode, 'board');
  assert.equal(readGround({ mode: 'sky', noise: 'cliffs' }).noise, DEFAULT_GROUND.noise);
  assert.equal(readGround({ margin: 12.6 }).margin, 13);
});

test('fog is off or 80 to 100: a thinner fog saved before reads as the thinnest; the default is the thinnest', () => {
  assert.equal(DEFAULT_GROUND.fog, FOG_MIN);
  assert.equal(FOG_MIN, 80);
  assert.deepEqual([0, -3, 1, 40, 79.4, 80, 93.6, 100, 250].map((fog) => readGround({ fog }).fog), [0, 0, 80, 80, 80, 80, 94, 100, 100]);
});

test('lava and acid to the horizon: their own modes, each with its own motion read tolerantly from its own start', () => {
  const lava = readGround({ mode: 'lava', lava: { kind: 'waves', amount: 2, tint: '#C2240F' }, acid: 'junk' });
  assert.equal(lava.mode, 'lava');
  assert.deepEqual(lava.lava, { ...LIQUID_DEFAULTS.lava, kind: 'waves', amount: 1, tint: '#c2240f' });
  assert.deepEqual(lava.acid, LIQUID_DEFAULTS.acid);
  assert.equal(readGround({ mode: 'acid' }).mode, 'acid');
  // Water keeps its own: lava's settings never reach it.
  assert.deepEqual(lava.water, LIQUID_DEFAULTS.water);
});

test('the plane runs a little past where the fog hides everything, from anywhere over the map; without fog as far as before', () => {
  const span = 4200;
  // At 80 the fog hides everything 7.6 spans off: the plane runs past that, by a little.
  const far = fogRange(80, span)!.far;
  assert.equal(Math.round(far), 31920);
  const reach = planeReach(80, span);
  assert.ok(reach > far + span / 2 && reach < far * 1.3 + span / 2, String(reach));
  // Thicker fog, a shorter plane; no fog, the old reach.
  assert.ok(planeReach(100, span) < reach);
  assert.equal(planeReach(0, span), span * REACH_SPANS);
});

test('the usable board stays flat; past its edge the ground eases into the pattern', () => {
  const s = hills();
  for (const [x, y] of [[0, 0], [10, 7], [20, 15], [19.9, 0.1]]) assert.equal(groundHeight(x, y, s, flat), 0, `(${x}, ${y})`);
  // Far out the pattern has its full swing; just past the edge only a little of it.
  let near = 0, far = 0;
  for (let k = 0; k < 40; k++) {
    near = Math.max(near, Math.abs(groundHeight(20.5, k * 0.37, s, flat)));
    far = Math.max(far, Math.abs(groundHeight(60 + k * 1.3, 40 + k * 0.7, s, flat)));
  }
  assert.ok(near < 0.25, `just past the edge it rises ${near} squares`);
  assert.ok(far > 1, `far out the hills swing only ${far} squares`);
});

test('the pattern is the same every time (a map looks the same each time it opens)', () => {
  const s = hills({ noise: 'rough' });
  assert.equal(groundHeight(73.2, -41.5, s, flat), groundHeight(73.2, -41.5, s, flat));
  assert.equal(groundHeight(73.2, -41.5, s, flat), groundHeight(73.2, -41.5, { ...s }, { ...flat }));
});

test('flat, no strength, and the map-board mode give level ground everywhere', () => {
  for (const s of [hills({ noise: 'flat' }), hills({ strength: 0 }), hills({ mode: 'board' })]) {
    for (const [x, y] of [[80, 80], [-50, 30], [200, -120]]) assert.equal(groundHeight(x, y, s, flat), 0);
  }
});

test('more strength, taller hills', () => {
  let low = 0, high = 0;
  for (let k = 0; k < 60; k++) {
    low = Math.max(low, Math.abs(groundHeight(70 + k, 50 - k * 0.5, hills({ strength: 0.2 }), flat)));
    high = Math.max(high, Math.abs(groundHeight(70 + k, 50 - k * 0.5, hills({ strength: 0.9 }), flat)));
  }
  assert.ok(high > low * 2, `${low} -> ${high}`);
});

test('distance fog: none at 0, nearer and thicker as it rises', () => {
  assert.equal(fogRange(0, 1000), null);
  const light = fogRange(20, 1000)!, thick = fogRange(90, 1000)!;
  assert.ok(light.far > thick.far && light.near > thick.near && thick.near < thick.far, JSON.stringify({ light, thick }));
});

test('the plane: faces up, level a hair under the usable board, shaped past it', async () => {
  const { groundGeometry } = await import('../src/board/groundPlane');
  const area = { width: 1400, height: 1050, cell: 70, margin: 10 };
  const geometry = groundGeometry(hills({ strength: 0.8 }), area);
  const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  let underBoard = 0, outer = 0;
  for (let i = 0; i < pos.count; i++) {
    assert.ok(normal.getY(i) > 0, `vertex ${i} faces down`);
    const x = pos.getX(i) / 70, z = pos.getZ(i) / 70;
    if (x > -10 && x < 30 && z > -10 && z < 25) { underBoard++; assert.equal(pos.getY(i), -1); }
    else if (Math.abs(pos.getY(i) + 1) > 1) outer++;
  }
  assert.ok(underBoard > 50, `${underBoard} lines under the board`);
  assert.ok(outer > 100, `${outer} raised points out beyond`);
});
