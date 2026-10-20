/**
 * Browser harness for the 3D board: a made-up map (a drawn background, a square 70 px grid, four tokens: one with a
 * mini, a standee, a hidden one and one whose art is missing; two pins and a prop) on a `Board` with a fake host that
 * records what the board asks of it. Driven by Playwright; not shipped.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Board, type BoardHost } from '../src/board/board';
import type { PropPlacement } from '../src/board/boardData';
import { emptyRules } from '../src/board/conditions';
import { QUALITY } from '../src/board/quality';
import type { BoardMap, BoardToken } from '../src/board/mapModel';
import { parseMini, type LoadedMini } from '../src/library';

function exportGlb(root: THREE.Object3D, animations: THREE.AnimationClip[] = []): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, (out) => resolve(out as ArrayBuffer), reject, { binary: true, animations }));
}

async function heroGlb(): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 24), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color: 0xf1c27d }));
  head.position.y = 1.5;
  head.name = 'Head';
  root.add(body, head);
  const idle = new THREE.AnimationClip('Idle', 2, [new THREE.VectorKeyframeTrack('Head.position', [0, 1, 2], [0, 1.5, 0, 0, 1.6, 0, 0, 1.5, 0])]);
  const walk = new THREE.AnimationClip('Walk', 0.6, [new THREE.VectorKeyframeTrack('Head.position', [0, 0.3, 0.6], [0, 1.5, 0, 0, 1.75, 0, 0, 1.5, 0])]);
  return exportGlb(root, [idle, walk]);
}

async function barrelGlb(): Promise<ArrayBuffer> {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 24), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
  barrel.position.y = 0.5;
  const root = new THREE.Group();
  root.add(barrel);
  return exportGlb(root);
}

function drawn(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  return canvas.toDataURL('image/png');
}

const background = drawn(1400, 1000, (context) => {
  for (let x = 0; x < 1400; x += 70) for (let y = 0; y < 1000; y += 70) {
    context.fillStyle = (x / 70 + y / 70) % 2 === 0 ? '#9c8a6e' : '#8a7a60';
    context.fillRect(x, y, 70, 70);
  }
  context.fillStyle = '#3d6b8a';
  context.fillRect(980, 140, 280, 210);
});
const face = (color: string): string => drawn(128, 128, (context) => {
  context.fillStyle = color;
  context.beginPath();
  context.arc(64, 64, 62, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.fillRect(44, 40, 12, 12);
  context.fillRect(72, 40, 12, 12);
});

const token = (over: Partial<BoardToken> & Pick<BoardToken, 'id' | 'x' | 'y'>): BoardToken => ({
  size: 1, rotation: 0, imagePath: null, kind: 'character', name: null, hidden: false, showRing: true, ringColor: '#ffffff',
  showNameplate: true, hp: null, stress: null, conditions: [], conditionValues: {}, resources: [], instanceNumber: null, statblockPath: null, ...over,
});

const map: BoardMap = {
  path: 'harness.atlasmap',
  background: 'bg.png',
  grid: { enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineWidth: 2, color: null, lineType: 'dashed', numbers: 'letter-number', numberOpacity: 0.8 },
  tokenSettings: { showNameplates: false, showHPBars: true, showStressBars: false, showInstanceBadges: true, hiddenResources: [] },
  tokens: [
    token({ id: 'hero', x: 245, y: 245, imagePath: 'red.png', name: 'Hero', statblockPath: 'Bestiary/Hero.md', hp: { current: 20, max: 27 }, conditions: ['c-poisoned', 'c-frightened'], resources: [{ key: 'ac', current: 15, max: 15 }, { key: 'slots', current: 2, max: 4 }, { key: 'ki', current: 3, max: 5 }] }),
    token({ id: 'gob', x: 525, y: 385, imagePath: 'green.png', name: 'Goblin', hp: { current: 3, max: 7 }, instanceNumber: 1 }),
    token({ id: 'gob2', x: 875, y: 385, imagePath: 'green.png', name: 'Goblin', hp: { current: 7, max: 7 }, instanceNumber: 2 }),
    token({ id: 'orc', x: 735, y: 525, imagePath: 'red.png', name: 'Orc', hidden: true, hp: { current: 15, max: 15 } }),
    token({ id: 'noart', x: 385, y: 665, imagePath: 'missing.png', kind: 'token' }),
    token({ id: 'fallen', x: 1155, y: 525, imagePath: 'red.png', name: 'Fallen', hp: { current: 0, max: 9 } }),
    token({ id: 'fallenDisc', x: 1225, y: 525, imagePath: 'green.png', name: 'Fallen disc', hp: { current: 0, max: 9 } }),
  ],
  icons: [
    { id: 'i1', icon: 'flame', x: 630, y: 700, color: '#ff8800', size: 70, opacity: 1 },
    { id: 'i2', icon: 'door-closed', x: 770, y: 700, color: '#ffffff', size: 70, opacity: 0.9 },
  ],
  pins: [
    { id: 'p1', x: 1050, y: 300, notePath: 'Notes/Tavern.md', icon: 'treasure', label: null, hex: false },
    { id: 'p2', x: 1100, y: 700, notePath: 'Notes/Area.md#3. Slanted Room', icon: 'number', label: '3', hex: false },
  ],
};

async function main(): Promise<void> {
  const hero: LoadedMini = await parseMini(await heroGlb());
  const barrel: LoadedMini = await parseMini(await barrelGlb());
  const images: Record<string, string> = { 'bg.png': background, 'red.png': face('#b03030'), 'green.png': face('#3a8a3a') };
  const props: PropPlacement[] = [{ id: 'barrel', glb: 'props/barrel.glb', x: 910, y: 805, rotation: 0, scale: 1 }];
  const record = {
    moves: [] as Array<[string, number, number]>, propMoves: [] as Array<[string, number, number]>, added: [] as Array<[string, number, number]>,
    notes: [] as string[], menus: [] as string[], propMenus: [] as string[], previews: [] as string[], warnings: [] as string[],
  };
  const rules = emptyRules();
  rules.conditions.set('c-poisoned', { name: 'Poisoned', color: '#16a34a', valued: false });
  rules.conditions.set('c-frightened', { name: 'Frightened', color: '#7c3aed', valued: false });
  rules.resources.set('ac', { name: 'AC', color: '#64748b' });
  rules.resources.set('slots', { name: 'Spell Slots', color: '#6366f1' });
  const host: BoardHost = {
    readImage: async (path) => images[path] ?? null,
    readMini: async (path) => (path.includes('barrel') ? barrel : hero),
    placement: (id) => (id === 'hero' || id === 'fallen' ? { mini: 'minis/hero.glb', scale: 1, turn: 0 } : null),
    style: (id) => (id === 'gob' ? 'standee' : 'disc'),
    props: () => props,
    rules: () => rules,
    moveToken: (id, x, y) => { record.moves.push([id, x, y]); },
    moveProp: (id, x, y) => { record.propMoves.push([id, x, y]); },
    addProp: (glb, x, y) => { record.added.push([glb, x, y]); },
    openNote: (path) => { record.notes.push(path); },
    tokenMenu: (id) => { record.menus.push(id); },
    propMenu: (id) => { record.propMenus.push(id); },
    statblockPreview: (id) => { record.previews.push(id); },
    warn: (message) => { if (!record.warnings.includes(message)) record.warnings.push(message); },
  };
  const container = document.getElementById('board')!;
  const board = new Board(container, host, QUALITY.medium);
  await board.load(map);
  const view = (board as unknown as { view: THREE.PerspectiveCamera }).view;
  /** Where a point of the map (`height` above the board) is on the page. */
  const project = (x: number, y: number, height = 0): { x: number; y: number } => {
    const point = new THREE.Vector3(x, height, y).project(view);
    const rect = board.canvas.getBoundingClientRect();
    return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
  };
  Object.assign(window, { boardTest: { board, map, record, project, hero, QUALITY, ready: true } });
}

main().catch((error: unknown) => { (window as unknown as { boardError: string }).boardError = String(error); console.error(error); });
