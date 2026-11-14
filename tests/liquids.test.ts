import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyWaterLiquids, waterFromWire, wireAreas, brushLiquids, LIQUID_LIMITS, maskOfSource, maskOutlines, motionOf, rasterAreas, readLiquids, waterKeyOf, withoutAreas, type WaterArea } from '../src/board/liquids';
import { DEFAULT_WATER_MOTION, WaterMask } from '../src/board/water';

/** A mask of 10 px texels (an 80 px cell) drawn from rows of `#` (wet) and `.` (dry). */
function maskOf(rows: string[]): WaterMask {
  const mask = WaterMask.forMap(rows[0]!.length * 10, rows.length * 10, 80);
  rows.forEach((row, j) => [...row].forEach((cell, i) => { if (cell === '#') mask.data[j * mask.width + i] = 255; }));
  return mask;
}
const rowsOf = (mask: WaterMask): string[] => Array.from({ length: mask.height }, (_, j) => Array.from({ length: mask.width }, (_, i) => (mask.data[j * mask.width + i]! > 0 ? '#' : '.')).join(''));
/** The mask its outlines give back. */
function roundTrip(rows: string[], limits = LIQUID_LIMITS): { areas: WaterArea[]; rows: string[] } {
  const mask = maskOf(rows);
  const areas = maskOutlines(mask, limits);
  const back = WaterMask.like(mask);
  rasterAreas(back, areas);
  return { areas, rows: rowsOf(back) };
}
const area2 = (ring: ReadonlyArray<{ x: number; y: number }>): number => ring.reduce((sum, point, index) => { const next = ring[(index + 1) % ring.length]!; return sum + point.x * next.y - next.x * point.y; }, 0);

test('a painted patch is traced along its edge into one ring of corners, and the ring gives the same patch back', () => {
  const rect = ['......', '.####.', '.####.', '......'];
  const { areas, rows } = roundTrip(rect);
  assert.deepEqual(rows, rect);
  assert.equal(areas.length, 1);
  // Four corners, in map pixels: the straight runs between them carry no point.
  assert.deepEqual([...areas[0]!.polygon].sort((a, b) => a.x - b.x || a.y - b.y), [{ x: 10, y: 10 }, { x: 10, y: 30 }, { x: 50, y: 10 }, { x: 50, y: 30 }]);
  assert.deepEqual(areas[0]!.holes, []);
  const ell = ['#....', '#....', '####.', '.....'];
  assert.deepEqual(roundTrip(ell).rows, ell);
  assert.equal(roundTrip(ell).areas[0]!.polygon.length, 6);
});

test('dry ground inside water is a hole of that water, an island in a hole a patch of its own; patches meeting at a corner stay two', () => {
  const lake = ['#######', '#.....#', '#.###.#', '#.#.#.#', '#.###.#', '#.....#', '#######'];
  const traced = roundTrip(lake);
  assert.deepEqual(traced.rows, lake);
  // The lake with its dry ring, and the island (with its own dry middle).
  assert.deepEqual(traced.areas.map((area) => area.holes.length).sort(), [1, 1]);
  const corner = ['##..', '##..', '..##', '..##'];
  const two = roundTrip(corner);
  assert.deepEqual(two.rows, corner);
  assert.equal(two.areas.length, 2);
  assert.ok(two.areas.every((area) => area.polygon.length === 4));
  // To the map's very edge, and nothing at all.
  const edge = ['###', '###'];
  assert.deepEqual(roundTrip(edge).rows, edge);
  assert.deepEqual(maskOutlines(maskOf(['...', '...'])), []);
});

test("a brush's round stroke comes back as it was painted, with far fewer corners than its edge has texels", () => {
  const mask = WaterMask.forMap(800, 600, 80);
  mask.stroke({ x: 150, y: 150 }, { x: 600, y: 420 }, 90, true);
  mask.paint(400, 300, 30, false);
  const areas = maskOutlines(mask);
  const back = WaterMask.like(mask);
  rasterAreas(back, areas);
  assert.deepEqual(rowsOf(back), rowsOf(mask));
  assert.equal(areas.length, 1);
  assert.equal(areas[0]!.holes.length, 1);
  const corners = areas[0]!.polygon.length + areas[0]!.holes[0]!.length;
  assert.ok(corners > 12 && corners < 600, String(corners));
  // The outer ring and its hole turn opposite ways, and no ring is empty.
  assert.ok(area2(areas[0]!.polygon) * area2(areas[0]!.holes[0]!) < 0);
});

test("what Atlas would not keep is not written: a ring of too many corners is thinned further, patches beyond the level's count are left out, the smallest first", () => {
  // A comb: many teeth, so many corners.
  const comb = ['#.#.#.#.#.#.#.#.#.#.#.#.', '########################'];
  const all = maskOutlines(maskOf(comb));
  // Fifty corners along the texel edges; four lie within the thinning's reach of a slanted edge, and the mask is the same.
  assert.equal(all[0]!.polygon.length, 46);
  assert.deepEqual(roundTrip(comb).rows, comb);
  const thinned = maskOutlines(maskOf(comb), { corners: 20, patches: 256 });
  assert.equal(thinned.length, 1);
  assert.ok(thinned[0]!.polygon.length <= 20 && thinned[0]!.polygon.length >= 3, String(thinned[0]!.polygon.length));
  const dots = ['#.#.##', '......', '###.#.', '###...'];
  const kept = maskOutlines(maskOf(dots), { corners: 2048, patches: 2 });
  assert.equal(kept.length, 2);
  // The two largest: six texels and two.
  assert.deepEqual(kept.map((area) => Math.abs(area2(area.polygon)) / 200).sort((a, b) => a - b), [2, 6]);
});

test("the brush's water is Atlas's liquid: its colours from the tint, its flow from the way it runs, its motion and its mark beside", () => {
  const areas: WaterArea[] = [{ polygon: [{ x: 0, y: 0 }, { x: 0, y: 20.004 }, { x: 30, y: 20 }], holes: [[{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 10 }]] }, { polygon: [{ x: 100, y: 0 }, { x: 100, y: 10 }, { x: 110, y: 10 }], holes: [] }];
  const river = { ...DEFAULT_WATER_MOTION, kind: 'flow' as const, direction: 90, tint: '#336699' };
  const [first, second] = brushLiquids(areas, river, 'upper');
  assert.deepEqual(first, {
    liquid: 'water', polygon: [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 30, y: 20 }], holes: [[{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 10 }]],
    colors: first!.colors, flow: { x: 1, y: 0 }, level: 'upper', tabletop: { v: 1, brush: true, motion: river },
  });
  assert.equal((first!.colors as { surface: string }).surface, '#336699');
  assert.match(JSON.stringify(first!.colors), /^\{"surface":"#336699","deep":"#[0-9a-f]{6}","glint":"#[0-9a-f]{6}"\}$/);
  assert.equal('holes' in second!, false);
  // Still water flows nowhere; no level, none said.
  const [pond] = brushLiquids(areas.slice(1), { ...DEFAULT_WATER_MOTION, kind: 'still' }, null);
  assert.deepEqual(['flow' in pond!, 'level' in pond!], [false, false]);
});

test("Atlas's liquids are read as the board draws them: the brush's with its motion, Atlas's own in their colour, what is no liquid left out", () => {
  const motion = { ...DEFAULT_WATER_MOTION, tint: '#112233' };
  const [mine] = brushLiquids([{ polygon: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], holes: [] }], motion, null);
  const raw = {
    a: { id: 'a', kind: 'liquid', ...mine },
    lava: { id: 'lava', kind: 'liquid', liquid: 'lava', polygon: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], holes: [[{ x: 1, y: 3 }, { x: 1, y: 5 }, { x: 3, y: 5 }], 'junk'], colors: { surface: '#ea580c', deep: '#7c2d12', glint: '#fde047' }, course: [{ x: 0, y: 0 }], art: 'engraved' },
    plain: { id: 'plain', liquid: 'water', polygon: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], colors: 'blue', tabletop: { brush: 'yes' } },
    line: { id: 'line', liquid: 'water', polygon: [{ x: 0, y: 0 }, { x: 0, y: 10 }] },
    mud: { id: 'mud', liquid: 'mud', polygon: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }] },
    junk: 'x',
  };
  const liquids = readLiquids(raw);
  assert.deepEqual(liquids.map((liquid) => [liquid.id, liquid.liquid, liquid.brush, liquid.holes.length, liquid.surface]), [['a', 'water', true, 0, '#112233'], ['lava', 'lava', false, 1, '#ea580c'], ['plain', 'water', false, 0, liquids[2]!.surface]]);
  assert.match(liquids[2]!.surface, /^#[0-9a-f]{6}$/);
  assert.deepEqual(liquids[0]!.motion, motion);
  assert.deepEqual(readLiquids(undefined), []);
  // One motion for the level: the brush's; with only Atlas's own, still water in the first one's colour; none without liquids.
  assert.deepEqual(motionOf(liquids), motion);
  assert.deepEqual(motionOf(liquids.slice(1)), { ...DEFAULT_WATER_MOTION, kind: 'still', tint: '#ea580c' });
  assert.equal(motionOf([]), null);
});

test("what the brush may change is its own water: where a liquid made in Atlas lies, the painted mask says nothing", () => {
  const painted = maskOf(['####', '####', '....']);
  const atlas: WaterArea[] = [{ polygon: [{ x: 20, y: 0 }, { x: 20, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 0 }], holes: [] }];
  const own = withoutAreas(painted, atlas);
  assert.deepEqual(rowsOf(own), ['##..', '##..', '....']);
  // The painted mask itself is left as it was.
  assert.deepEqual(rowsOf(painted), ['####', '####', '....']);
  assert.deepEqual(rowsOf(withoutAreas(painted, [])), ['####', '####', '....']);
});

test("a board is handed its water as outlines, as an old saved mask, or both: one mask of them all, and a key that changes only when the water does", () => {
  const painted = maskOf(['##..', '##..', '....']);
  const areas: WaterArea[] = [{ polygon: [{ x: 20, y: 10 }, { x: 20, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 10 }], holes: [] }];
  const both = maskOfSource({ mask: painted.save(), areas, motion: null }, 40, 30, 80);
  assert.deepEqual(rowsOf(both!), ['##..', '####', '..##']);
  assert.deepEqual(rowsOf(maskOfSource({ areas, motion: null }, 40, 30, 80)!), ['....', '..##', '..##']);
  assert.equal(maskOfSource({ motion: null }, 40, 30, 80), null);
  assert.equal(maskOfSource({ areas: [], mask: 'junk', motion: null }, 40, 30, 80), null);
  assert.equal(maskOfSource(null, 40, 30, 80), null);
  // The same water, the same key; a key given is the key.
  assert.equal(waterKeyOf({ areas, motion: { kind: 'flow' } }), waterKeyOf({ areas: JSON.parse(JSON.stringify(areas)), motion: { kind: 'still' } }));
  assert.notEqual(waterKeyOf({ areas, motion: null }), waterKeyOf({ areas: [], motion: null }));
  assert.equal(waterKeyOf({ key: 'k1', areas, motion: null }), 'k1');
  assert.equal(waterKeyOf(null), waterKeyOf(null));
  assert.notEqual(waterKeyOf(null), waterKeyOf({ mask: painted.save(), motion: null }));
});

test('water goes to players as outlines, each ring a flat list of places, and is read back as it was; what is no ring is left out', () => {
  const areas: WaterArea[] = [{ polygon: [{ x: 0, y: 0 }, { x: 0, y: 20.004 }, { x: 30, y: 20 }], holes: [[{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 10 }]] }, { polygon: [{ x: 100, y: 0 }, { x: 100, y: 10 }, { x: 110, y: 10 }], holes: [] }];
  const wire = wireAreas(areas);
  assert.deepEqual(wire, [{ polygon: [0, 0, 0, 20, 30, 20], holes: [[5, 5, 10, 5, 5, 10]] }, { polygon: [100, 0, 100, 10, 110, 10] }]);
  const back = waterFromWire(JSON.parse(JSON.stringify({ areas: wire, motion: { kind: 'flow' } })));
  assert.deepEqual(back?.areas?.map((area) => [area.polygon.length, area.holes.length]), [[3, 1], [3, 0]]);
  assert.deepEqual(back?.motion, { kind: 'flow' });
  assert.deepEqual(waterFromWire({ areas: [{ polygon: [0, 0, 1] }, 'x', { polygon: [0, 0, 0, 10, 10, 10], holes: ['junk', [1, 1]] }], motion: null })?.areas, [{ polygon: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], holes: [] }]);
  assert.equal(waterFromWire({ areas: [], motion: null }), null);
  assert.equal(waterFromWire(null), null);
  // A GM of before sent a saved mask: still drawn.
  assert.deepEqual(waterFromWire({ mask: { width: 1, height: 1, data: 'AQ==' }, motion: null }), { mask: { width: 1, height: 1, data: 'AQ==' }, motion: null });
});

test("a map's old painted water is moved as the brush's liquids on its first level, with the motion it had; a mask made for a map of another size cannot be read", () => {
  const painted = maskOf(['##..', '##..', '...#']);
  const motion = { ...DEFAULT_WATER_MOTION, kind: 'waves' as const, tint: '#123456' };
  const liquids = legacyWaterLiquids({ mask: painted.save(), motion }, 40, 30, 80, 'ground', 256);
  assert.equal(liquids?.length, 2);
  assert.deepEqual(liquids!.map((liquid) => [liquid.liquid, liquid.level, (liquid.tabletop as { brush: boolean; motion: unknown }).brush, (liquid.tabletop as { motion: unknown }).motion]), [['water', 'ground', true, motion], ['water', 'ground', true, motion]]);
  // The very same water back.
  const back = WaterMask.like(painted);
  rasterAreas(back, readLiquids(Object.fromEntries(liquids!.map((liquid, index) => [`l${index}`, liquid]))));
  assert.deepEqual(rowsOf(back), rowsOf(painted));
  // No room left on the level: the largest patches that fit.
  assert.equal(legacyWaterLiquids({ mask: painted.save() }, 40, 30, 80, null, 1)?.length, 1);
  assert.equal('level' in legacyWaterLiquids({ mask: painted.save() }, 40, 30, 80, null, 1)![0]!, false);
  assert.equal(legacyWaterLiquids({ mask: painted.save(), motion }, 400, 300, 80, null, 256), null);
  assert.equal(legacyWaterLiquids({ mask: 'junk' }, 40, 30, 80, null, 256), null);
});
