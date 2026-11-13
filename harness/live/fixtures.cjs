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
