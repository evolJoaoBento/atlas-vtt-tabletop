// node harness/live/fixtures.cjs [vault]
// Run with the live-check Obsidian stopped. Writes `Fusion Rooms.atlasmap`, a copy of `Probe Cellar.atlasmap` as Atlas
// 0.14 would have saved a scene with rooms: `objects.rooms` holds two shown rooms that touch and one hidden room, on no
// level, and no wall. Tabletop's data.json gets a height and a material under two of the 0.14 names of that outline
// (`room_<x1>_<y1>_<x2>_<y2>`, eighth pixels), as a GM would have set them in Tabletop 1.3.
const fs = require('fs'), path = require('path');
const vault = process.argv[2] || 'C:/Users/joaoo/fusion-gate-vault';
if (!/fusion-gate-vault/.test(vault)) throw new Error(`${vault} is not the throwaway vault`);
const SCENES = 'atlas-vtt/collections/The Gilded Flagon/scenes';
const MAP = `${SCENES}/Fusion Rooms.atlasmap`;
const Q = 8;
const rect = (x1, y1, x2, y2) => [[x1, y1, x2, y1, x2, y2, x1, y2].map((v) => v * Q)];

const source = JSON.parse(fs.readFileSync(path.join(vault, SCENES, 'Probe Cellar.atlasmap'), 'utf8'));
const objects = source.state.objects;
objects.walls = {};
delete objects.measures;
objects.rooms = {
  room_a: { id: 'room_a', kind: 'room', name: 'Hall', order: 0, area: rect(140, 140, 700, 560) },
  room_b: { id: 'room_b', kind: 'room', name: 'Side room', order: 1, area: rect(700, 280, 1120, 560) },
  room_c: { id: 'room_c', kind: 'room', name: 'Vault', order: 2, hidden: true, area: rect(1260, 140, 1540, 420) },
};
delete source.state.levels;
delete source.state.levelAlignments;
fs.writeFileSync(path.join(vault, MAP), JSON.stringify(source));

// The outline of Hall and Side room: (140,140) (700,140) (700,280) (1120,280) (1120,560) (140,560).
const TOP = `room_${140 * Q}_${140 * Q}_${700 * Q}_${140 * Q}`;
const LEFT = `room_${140 * Q}_${560 * Q}_${140 * Q}_${140 * Q}`;
const dataFile = path.join(vault, '.obsidian/plugins/tabletop-for-atlas/data.json');
const data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {};
data.board = data.board || {};
data.board[MAP] = { wallHeights: { [TOP]: 3 }, wallMaterials: { [LEFT]: 'Materials/stone' } };
fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
// Phase 2: the same cellar on a hex grid (columns of pointy hexes), for a Large token's snap.
const hex = JSON.parse(fs.readFileSync(path.join(vault, SCENES, 'Probe Cellar.atlasmap'), 'utf8'));
hex.state.grid = { ...(hex.state.grid || {}), type: 'hex-vertical', snapToGrid: true };
fs.writeFileSync(path.join(vault, SCENES, 'Fusion Hex.atlasmap'), JSON.stringify(hex));

fs.writeFileSync(path.join(__dirname, 'fixtures.json'), JSON.stringify({ map: MAP, top: TOP, left: LEFT }, null, 2));
console.log('wrote', MAP, 'with overrides on', TOP, 'and', LEFT);

// Phase 4C: a scene stack as older Tabletop kept one. The base is the cove; over it the cellar as one floor (its levels
// taken off), three squares up, shifted, on squares of another size, with a token style, a mini, a prop, a wall height
// and a cutscene shot that looks at it; under it the cove again (every id collides with the base's), hidden.
const COVE = `${SCENES}/Probe Cove.atlasmap`;
const STACK = { base: `${SCENES}/Stack Base.atlasmap`, upper: `${SCENES}/Stack Upper.atlasmap`, lower: `${SCENES}/Stack Lower.atlasmap` };
const coveText = fs.readFileSync(path.join(vault, COVE), 'utf8');
fs.writeFileSync(path.join(vault, STACK.base), coveText.split(COVE).join(STACK.base));
fs.writeFileSync(path.join(vault, STACK.lower), coveText.split(COVE).join(STACK.lower));
const floor = JSON.parse(fs.readFileSync(path.join(vault, SCENES, 'Probe Cellar.atlasmap'), 'utf8'));
floor.state.mapPath = STACK.upper;
floor.state.version = 4;
for (const key of ['levels', 'levelAlignments', 'viewedLevel', 'exploredMasks']) delete floor.state[key];
for (const record of Object.values(floor.state.objects)) if (record && typeof record === 'object') for (const entry of Object.values(record)) if (entry && typeof entry === 'object') { delete entry.level; delete entry.levels; }
fs.writeFileSync(path.join(vault, STACK.upper), JSON.stringify(floor));
const stackToken = Object.keys(floor.state.objects.tokens)[0];
const stackWall = Object.keys(floor.state.objects.walls)[0];
const GLB = 'atlas-vtt/assets/minis/Goblin Raider.glb';
const fresh = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
fresh.board = fresh.board || {};
fresh.assignments = fresh.assignments || {};
for (const key of Object.keys(fresh.board)) if (key.includes('/Stack ')) delete fresh.board[key];
for (const key of Object.keys(fresh.assignments)) if (key.includes('/Stack ')) delete fresh.assignments[key];
fresh.board[STACK.upper] = {
  layer: { base: STACK.base, elevation: 3, x: 200, y: 100 }, styles: { [stackToken]: 'standee' }, wallHeights: { [stackWall]: 3 },
  props: [{ id: 'prop_stack', glb: GLB, x: 280, y: 280, rotation: 0, scale: 1 }],
};
fresh.board[STACK.lower] = { layer: { base: STACK.base, elevation: -2 }, hidden: true };
fresh.board[STACK.base] = { cutscenes: [{ id: 'cs_floors', name: 'Floors', shots: [
  { id: 's1', at: 0, mapPath: STACK.base, eye: { x: 900, y: 900, z: 1200 }, target: { x: 900, y: 0, z: 500 }, keyframe: false, transition: 'fade' },
  { id: 's2', at: 1500, mapPath: STACK.upper, eye: { x: 700, y: 840, z: 1400 }, target: { x: 700, y: 0, z: 700 }, keyframe: false, transition: 'cut' },
] }] };
fresh.assignments[STACK.upper] = { [stackToken]: { mini: GLB, scale: 1, turn: 0 } };
fs.writeFileSync(dataFile, JSON.stringify(fresh, null, 2));
fs.writeFileSync(path.join(__dirname, 'fixtures.json'), JSON.stringify({ map: MAP, top: TOP, left: LEFT, stack: { ...STACK, token: stackToken, wall: stackWall, glb: GLB } }, null, 2));
console.log('wrote the stack', STACK.base, 'with', STACK.upper, 'and', STACK.lower);
