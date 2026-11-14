import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameOf, moveOf, planStackMove, stackSkip, type BaseSource, type MemberSource, type SceneFields } from '../src/board/stackMove';
import { NO_PLACEMENT } from '../src/board/layerPlacement';
import { DEFAULT_WATER_MOTION, WaterMask } from '../src/board/water';

const grid = (size = 100, more: Record<string, unknown> = {}) => ({ size, offsetX: 0, offsetY: 0, unitDistance: 5, ...more });
const scene = (objects: SceneFields['objects'] = {}, more: Partial<SceneFields> = {}): SceneFields => ({ background: 'img/base.webp', objects, grid: grid(), ...more });
const token = (id: string, x = 0, y = 0, more: Record<string, unknown> = {}) => ({ id, x, y, size: 1, ...more });
const wall = (id: string, more: Record<string, unknown> = {}) => ({ id, type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, ...more });
const base = (objects: SceneFields['objects'] = {}, more: Partial<SceneFields> = {}): BaseSource => ({ path: 'maps/Keep.atlasmap', name: 'Keep', scene: scene(objects, more), fogHeight: 1, wallThickness: 0.12 });
const member = (name: string, elevation: number, objects: SceneFields['objects'] = {}, more: Partial<MemberSource> = {}): MemberSource => ({
  path: `maps/${name}.atlasmap`, name, elevation, placement: NO_PLACEMENT, scene: scene(objects, { background: `img/${name}.webp` }), size: { width: 2000, height: 1000 },
  legacyExtras: null, legacyWater: null, fogHeight: 1, wallThickness: 0.12, hasInitiative: false, ...more,
});
const ids = (): (() => string) => { let n = 0; return () => `level_${++n}`; };

test('a member on the same grid, never moved, needs no alignment: it lies in the scene\'s frame', () => {
  const { alignment, frame, lost } = frameOf(grid(), grid(), NO_PLACEMENT, { width: 2000, height: 1000 });
  assert.equal(alignment, null);
  assert.deepEqual(frame, { k: 1, x: 0, y: 0 });
  assert.deepEqual(lost, []);
  assert.deepEqual(moveOf(frame)({ x: 30, y: 40 }), { x: 30, y: 40 });
});

test('another cell size, grid offsets and a shift become a scale and an offset; the move is the alignment\'s own', () => {
  // The base's squares are 70 px from (10, 20); the member's 140 px from (40, 0); shifted by hand 70 right, 140 down.
  const { alignment, frame, lost } = frameOf(grid(70, { offsetX: 10, offsetY: 20 }), grid(140, { offsetX: 40, offsetY: 0 }), { x: 70, y: 140, turn: 0 }, null);
  assert.deepEqual(frame, { k: 0.5, x: 60, y: 160 });
  assert.deepEqual(alignment, { offset: { x: 60, y: 160 }, scale: 0.5, stretch: { x: 1, y: 1 } });
  assert.deepEqual(lost, []);
  assert.deepEqual(moveOf(frame)({ x: 100, y: 200 }), { x: 110, y: 260 });
});

test('a place left of or above the base\'s origin is raised by whole squares, so the grids stay lined up, and said', () => {
  const { alignment, frame, lost } = frameOf(grid(100), grid(100), { x: -250, y: 30, turn: 0 }, null);
  assert.deepEqual(frame, { k: 1, x: 50, y: 30 });
  assert.deepEqual(alignment!.offset, { x: 50, y: 30 });
  assert.equal(lost.length, 1);
  assert.match(lost[0]!, /3 squares/);
});

test('a turn is not kept: the level lies unturned about its middle (its corner when its size is not known), on the grid, and said', () => {
  // A 2000 by 1000 map turned a quarter about its corner at the origin and shifted 1000 right: its middle is at (500, 1000).
  const turned = frameOf(grid(100), grid(100), { x: 1000, y: 0, turn: 90 }, { width: 2000, height: 1000 });
  // Unturned about that middle its corner would be at (-500, 500): raised to the grid at or right of the origin.
  assert.deepEqual(turned.frame, { k: 1, x: 0, y: 500 });
  assert.equal(turned.lost.some((line) => /turn of 90/.test(line)), true);
  const corner = frameOf(grid(100), grid(100), { x: 300, y: 200, turn: 180 }, null);
  assert.deepEqual(corner.frame, { k: 1, x: 300, y: 200 });
  assert.equal(corner.lost.some((line) => /turn of 180/.test(line)), true);
});

test('a member whose image is stretched another way than the base\'s needs an alignment even where it lies in place', () => {
  const { alignment, frame } = frameOf(grid(100), grid(100, { mapStretch: { x: 1.1, y: 1 } }), NO_PLACEMENT, null);
  assert.deepEqual(alignment, { offset: { x: 0, y: 0 }, scale: 1, stretch: { x: 1.1, y: 1 } });
  assert.deepEqual(frame, { k: 1, x: 0, y: 0 });
});

test('the levels are the base and the members by height, their heights in the base\'s units; records are tagged by kind', () => {
  const plan = planStackMove(
    base({ tokens: { t1: token('t1', 50, 50) }, walls: { w1: wall('w1') } }),
    [
      member('Tower', 6, { tokens: { t2: token('t2', 10, 10) }, walls: { w2: wall('w2') }, lights: { l1: { id: 'l1', x: 5, y: 5 } }, measures: { m1: { id: 'm1', shape: 'circle', points: [{ x: 1, y: 1 }] } }, pins: { p1: { id: 'p1', x: 1, y: 2 } }, junk: undefined, texts: { broken: 'x' as unknown as Record<string, unknown> } }),
      member('Hall', 2, { liquids: { q1: { id: 'q1', liquid: 'water', polygon: [] } }, audios: { a1: { id: 'a1', x: 0, y: 0 } } }),
    ], ids());
  assert.deepEqual(plan.scene.levels, [
    { id: 'level_1', name: 'Keep', elevation: { bottom: 0, top: 10 }, background: 'img/base.webp' },
    { id: 'level_3', name: 'Hall', elevation: { bottom: 10, top: 20 }, background: 'img/Hall.webp' },
    { id: 'level_2', name: 'Tower', elevation: { bottom: 30, top: 40 }, background: 'img/Tower.webp' },
  ]);
  assert.equal(plan.baseLevel, 'level_1');
  assert.equal(plan.scene.background, 'img/base.webp');
  const { objects } = plan.scene;
  // The base's own records are as they were: it is still the first level.
  assert.deepEqual(objects.tokens!.t1, token('t1', 50, 50));
  assert.deepEqual(objects.walls!.w1, wall('w1'));
  assert.equal((objects.tokens!.t2 as { level: string }).level, 'level_2');
  assert.deepEqual((objects.walls!.w2 as { levels: string[] }).levels, ['level_2']);
  assert.deepEqual((objects.lights!.l1 as { levels: string[] }).levels, ['level_2']);
  assert.equal((objects.measures!.m1 as { level: string }).level, 'level_2');
  assert.equal((objects.pins!.p1 as { level: string }).level, 'level_2');
  assert.equal((objects.liquids!.q1 as { level: string }).level, 'level_3');
  assert.deepEqual((objects.audios!.a1 as { levels: string[] }).levels, ['level_3']);
  // What is no record is not copied.
  assert.equal(objects.texts?.broken, undefined);
  assert.deepEqual(plan.aligns, []);
  assert.deepEqual(plan.members.map((each) => [each.path, each.level, each.frame]), [['maps/Tower.atlasmap', 'level_2', { k: 1, x: 0, y: 0 }], ['maps/Hall.atlasmap', 'level_3', { k: 1, x: 0, y: 0 }]]);
  assert.deepEqual(plan.lost, []);
});

test('a member under the base is the scene\'s first level: the background is its image, the base\'s records name their level, its explored memory is kept by level', () => {
  const plan = planStackMove(
    base({ tokens: { t1: token('t1') }, walls: { w1: wall('w1'), wAll: wall('wAll', { levels: 'all' }) }, lights: { l1: { id: 'l1', x: 0, y: 0 } }, fog: { f1: { id: 'f1', type: 'polygon', points: [] } } }, { exploredMask: 'data:base' }),
    [member('Cellar', -3, { tokens: { t9: token('t9') } }, { scene: scene({ tokens: { t9: token('t9') } }, { background: 'img/Cellar.webp', exploredMask: 'data:cellar' }) })], ids());
  assert.deepEqual((plan.scene.levels as Array<{ id: string; elevation: unknown }>).map((level) => [level.id, level.elevation]), [['level_2', { bottom: -15, top: -5 }], ['level_1', { bottom: 0, top: 10 }]]);
  assert.equal(plan.scene.background, 'img/Cellar.webp');
  assert.equal(plan.baseLevel, 'level_1');
  const { objects } = plan.scene;
  assert.equal((objects.tokens!.t1 as { level: string }).level, 'level_1');
  assert.deepEqual((objects.walls!.w1 as { levels: string[] }).levels, ['level_1']);
  assert.equal((objects.walls!.wAll as { levels: string }).levels, 'all');
  assert.deepEqual((objects.lights!.l1 as { levels: string[] }).levels, ['level_1']);
  assert.equal((objects.fog!.f1 as { level: string }).level, 'level_1');
  assert.equal((objects.tokens!.t9 as { level: string }).level, 'level_2');
  assert.equal(plan.scene.exploredMask, null);
  assert.deepEqual(plan.scene.exploredMasks, { level_1: 'data:base' });
  // What players had explored on the member is not kept.
  assert.equal(plan.lost.some((line) => /Cellar.*explored/.test(line)), true);
});

test('an id the base already has is given anew, and what names it follows: a measure\'s token, a wall\'s chain', () => {
  const plan = planStackMove(
    base({ tokens: { tok: token('tok') }, walls: { w: wall('w', { chainId: 'chain' }) }, measures: { m: { id: 'm', shape: 'circle', follows: 'tok' } } }),
    [
      member('Copy', 3, {
        tokens: { tok: token('tok', 5, 5), other: token('other') },
        walls: { w: wall('w', { chainId: 'chain' }), w2: wall('w2', { chainId: 'chain' }), w3: wall('w3', { chainId: 'own' }) },
        measures: { m: { id: 'm', shape: 'circle', follows: 'tok', aura: 10 }, m2: { id: 'm2', shape: 'cone', origin: { tokenIds: ['tok', 'other'], unseen: false } } },
      }),
      member('Copy 2', 6, { tokens: { tok: token('tok', 9, 9) } }),
    ], ids());
  const { objects } = plan.scene;
  assert.deepEqual(Object.keys(objects.tokens!), ['tok', 'tok_s2', 'other', 'tok_s3']);
  assert.equal((objects.tokens!.tok_s2 as { id: string; x: number }).id, 'tok_s2');
  assert.equal((objects.tokens!.tok_s2 as { x: number }).x, 5);
  assert.equal((objects.tokens!.tok_s3 as { x: number }).x, 9);
  assert.deepEqual(Object.keys(objects.walls!), ['w', 'w_s2', 'w2', 'w3']);
  // The member's chain is its own, whole; a chain the base has none of keeps its name.
  assert.deepEqual(['w_s2', 'w2', 'w3'].map((id) => (objects.walls![id] as { chainId: string }).chainId), ['chain_s2', 'chain_s2', 'own']);
  assert.equal((objects.walls!.w as { chainId: string }).chainId, 'chain');
  assert.equal((objects.measures!.m_s2 as { follows: string }).follows, 'tok_s2');
  assert.equal((objects.measures!.m as { follows: string }).follows, 'tok');
  assert.deepEqual((objects.measures!.m2 as { origin: { tokenIds: string[] } }).origin.tokenIds, ['tok_s2', 'other']);
  assert.deepEqual(plan.members[0]!.ids, { tokens: { tok: 'tok_s2' }, walls: { w: 'w_s2' }, measures: { m: 'm_s2' } });
  assert.deepEqual(plan.members[1]!.ids, { tokens: { tok: 'tok_s3' } });
});

test('what a spell stands in Atlas is not copied (it is derived again for the copied measure); the measure is', () => {
  const plan = planStackMove(base(), [member('Up', 3, {
    measures: { spell1: { id: 'spell1', shape: 'circle', tabletop: { v: 1, spell: { kind: 'sphere' } } } },
    walls: { 'spell:spell1:w0': wall('spell:spell1:w0', { chainId: 'spell:spell1', tabletop: { spell: 'spell1' } }), real: wall('real') },
    mapFeatures: { d1: { id: 'd1', polygon: [], tabletop: { spell: 'spell1' } }, pit: { id: 'pit', polygon: [] } },
    lights: { glow: { id: 'glow', x: 0, y: 0, tabletop: { spell: 'spell1' } } },
  })], ids());
  const { objects } = plan.scene;
  assert.deepEqual(Object.keys(objects.walls!), ['real']);
  assert.deepEqual(Object.keys(objects.mapFeatures!), ['pit']);
  assert.deepEqual(Object.keys(objects.lights ?? {}), []);
  assert.deepEqual(Object.keys(objects.measures!), ['spell1']);
});

test('a member whose 3D settings and old water are still in Tabletop\'s data takes them along on its copies', () => {
  const painted = WaterMask.forMap(2000, 1000, 100);
  painted.data.fill(255, 0, 4);
  const up = member('Up', 3, { walls: { w: wall('w'), door: wall('door', { type: 'door' }) }, lights: { l: { id: 'l', x: 0, y: 0 } } }, {
    legacyExtras: { wallHeights: { w: 3 }, wallMaterials: { w: 'Materials/stone' }, doorProps: { door: 'Props/door.glb' }, lightHeights: { l: 2.5 } },
    legacyWater: { mask: painted.save(), motion: { ...DEFAULT_WATER_MOTION, tint: '#123456' } },
  });
  const plan = planStackMove(base({ walls: { w: wall('w') } }), [up], ids());
  const { objects } = plan.scene;
  assert.deepEqual((objects.walls!.w_s2 as { tabletop: unknown }).tabletop, { v: 1, height: 3, material: 'Materials/stone' });
  assert.deepEqual((objects.walls!.door as { tabletop: unknown }).tabletop, { v: 1, prop: 'Props/door.glb' });
  assert.deepEqual((objects.lights!.l as { tabletop: unknown }).tabletop, { v: 1, height: 2.5 });
  // The base's wall of the same id is not the member's.
  assert.equal((objects.walls!.w as { tabletop?: unknown }).tabletop, undefined);
  const water = Object.values(objects.liquids ?? {}) as Array<{ level: string; liquid: string; colors: { surface: string }; tabletop: { brush: boolean } }>;
  assert.equal(water.length, 1);
  assert.deepEqual([water[0]!.level, water[0]!.liquid, water[0]!.colors.surface, water[0]!.tabletop.brush], ['level_2', 'water', '#123456', true]);
  // Without the image's size the mask cannot be read: it stays in the member's data, and that is said.
  const blind = planStackMove(base(), [{ ...up, size: null }], ids());
  assert.deepEqual(Object.keys(blind.scene.objects.liquids ?? {}), []);
  assert.equal(blind.lost.some((line) => /Up.*water/.test(line)), true);
});

test('a fitted member is aligned by Atlas; what is not kept is listed by member', () => {
  const plan = planStackMove(
    base({}, { grid: grid(70), lighting: { globalLight: true } }),
    [member('Loft', 2, { tokens: { t: token('t', 140, 280) } }, {
      scene: scene({ tokens: { t: token('t', 140, 280) } }, { background: 'img/Loft.webp', grid: grid(140), lighting: { globalLight: false } }),
      placement: { x: 0, y: 0, turn: 90 }, size: null, fogHeight: 2, wallThickness: 0.3, hasInitiative: true,
    })], ids());
  assert.deepEqual(plan.aligns, [{ level: 'level_2', alignment: { offset: { x: 0, y: 0 }, scale: 0.5, stretch: { x: 1, y: 1 } }, frame: { k: 0.5, x: 0, y: 0 } }]);
  // Its records go in as they lie on the member: Atlas moves them with the level's image.
  assert.deepEqual([(plan.scene.objects.tokens!.t as { x: number }).x, (plan.scene.objects.tokens!.t as { y: number }).y], [140, 280]);
  assert.equal(plan.scene.levelAlignments, undefined);
  for (const said of [/turn of 90/, /fog height/, /wall thickness/, /lighting/, /initiative/, /pixels/]) assert.equal(plan.lost.some((line) => /^Loft: /.test(line) && said.test(line)), true, String(said));
});

test('a stack is skipped where it cannot become levels: a base or a member with levels, a scene that was not read, grids too far apart', () => {
  const plain = scene();
  const levelled = scene({}, { levels: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(stackSkip(plain, [{ name: 'Up', scene: plain }]), null);
  assert.match(stackSkip(levelled, [{ name: 'Up', scene: plain }])!, /already has Atlas levels/);
  assert.match(stackSkip(plain, [{ name: 'Up', scene: levelled }])!, /Up has Atlas levels/);
  assert.match(stackSkip(null, [{ name: 'Up', scene: plain }])!, /could not be read/);
  assert.match(stackSkip(plain, [{ name: 'Up', scene: null }])!, /Up could not be read/);
  assert.match(stackSkip(plain, [{ name: 'Up', scene: scene({}, { grid: grid(3000) }) }])!, /grid/);
  // A scene with one level (Atlas gives it one when a level is edited) has none to speak of.
  assert.equal(stackSkip(scene({}, { levels: [{ id: 'only' }] }), [{ name: 'Up', scene: plain }]), null);
  assert.equal(stackSkip(plain, []), 'it has no scenes stacked on it');
});

test('a base and members with no records at all still become levels', () => {
  const plan = planStackMove({ ...base(), scene: { background: null, objects: {}, grid: null } }, [{ ...member('Up', 1), scene: { background: null, objects: {}, grid: null } }], ids());
  assert.equal((plan.scene.levels as unknown[]).length, 2);
  assert.deepEqual(plan.scene.objects, {});
});
