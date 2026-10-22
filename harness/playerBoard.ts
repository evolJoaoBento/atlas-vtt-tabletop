/**
 * The player board harness: Tabletop's `playerBoard` mounted as Connect mounts it in a player's tab, with a fake Connect
 * that records what the board asks of it, a Connect scene and board extras, and files that arrive late on demand.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { playerBoardFactory, type PlayerBoardHandle, type PlayerBoardHost } from '../src/playerBoard';
import type { BoardExtras, PlayerDiceResult } from '../src/connectContract';
import { vendoredPack } from '../src/dice/dicePack';
import { DEFAULT_DICE_SETTINGS } from '../src/dice/diceSettings';

function exportGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, (out) => resolve(out as ArrayBuffer), reject, { binary: true }));
}

async function heroGlb(): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 24), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
  body.position.y = 0.6;
  root.add(body);
  return exportGlb(root);
}

function drawn(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  return canvas.toDataURL('image/png');
}

const MAP = 'M'.repeat(43);
const ART = 'A'.repeat(43);
const GLB = 'G'.repeat(43);
const TEX = 'T'.repeat(43);

const scene = {
  sceneId: 's1',
  map: { asset: MAP, width: 1400, height: 1000, cellSize: 70 },
  grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.4, lineType: 'solid', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null },
  tokens: {
    mine: { x: 385, y: 385, size: 1, rotation: 0, layer: 0, image: ART, ring: '#2266ff', conditions: [{ id: 'prone', value: null, name: 'Prone', color: '#aa3300' }], name: 'Anna', hp: { current: 8, max: 10 }, stress: null, mini: { asset: GLB, scale: 1, turn: 0 } },
    theirs: { x: 525, y: 385, size: 1, rotation: 0, layer: 0, image: ART, ring: '#ff2222', conditions: [], name: 'Goblin', hp: null, stress: null },
  },
  fog: { f1: { type: 'rectangle', erase: false, order: 1, x: 1050, y: 0, width: 350, height: 1000 } },
  texts: {}, drawings: {}, widgets: [], initiative: null,
  measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true, coneAngle: 53 },
  pins: [{ id: 'pin-1', x: 700, y: 700, label: '1', title: 'Crypt', icon: 'number' }],
};

const extras: BoardExtras = {
  sceneId: 's1',
  walls: [
    { id: 'w1', type: 'solid', p1: { x: 280, y: 280 }, p2: { x: 630, y: 280 }, height: null, material: TEX },
    { id: 'd1', type: 'door', p1: { x: 630, y: 280 }, p2: { x: 700, y: 280 }, height: null, material: null, door: { open: false, swing: 'left', prop: null } },
  ],
  lights: [{ id: 'l1', x: 455, y: 455, height: 1.5, color: '#ffaa55', bright: 10, dim: 25, intensity: 1, animation: null, angle: null, rotation: 0, darkness: false, activeBelowAmbient: null }],
  props: [], materials: [{ id: TEX, scale: 1, maps: { color: TEX } }],
  ambient: 0.4, fogHeight: 1, wallThickness: 0.12,
  lighting: { enabled: true, ambient: 0.4, ambientColor: null },
};

async function main(): Promise<void> {
  const files = new Map<string, string | ArrayBuffer>();
  const late = new Map<string, string | ArrayBuffer>();
  late.set(MAP, drawn(1400, 1000, (context) => { context.fillStyle = '#9c8a6e'; context.fillRect(0, 0, 1400, 1000); }));
  files.set(ART, drawn(64, 64, (context) => { context.fillStyle = '#3a8a3a'; context.fillRect(0, 0, 64, 64); }));
  files.set(GLB, await heroGlb());
  files.set(TEX, drawn(64, 64, (context) => { context.fillStyle = '#884422'; context.fillRect(0, 0, 64, 64); }));
  const record = {
    moves: [] as unknown[][], pings: [] as unknown[][], lasers: [] as unknown[][], templates: [] as unknown[], pins: [] as string[],
    hovers: [] as unknown[][], toolsChanged: 0, diceResults: [] as PlayerDiceResult[],
  };
  const pack = vendoredPack();
  const host: PlayerBoardHost = {
    image: (id) => { const file = files.get(id); return typeof file === 'string' ? file : null; },
    model: (id) => { const file = files.get(id); return file instanceof ArrayBuffer ? file : null; },
    sendMove: (id, x, y) => { record.moves.push([id, x, y]); return true; },
    sendLaser: (points, lifted, dt, color) => { record.lasers.push([points.length, lifted, dt.length, color]); return true; },
    sendPing: (x, y) => { record.pings.push([x, y]); return true; },
    sendTemplate: (change) => { record.templates.push(change); return true; },
    openPin: (pinId) => { record.pins.push(pinId); },
    hover: (id, client, modifier) => { record.hovers.push([id, client !== null, modifier]); },
    toolsChanged: () => { record.toolsChanged++; },
    sendDiceResult: (result) => { record.diceResults.push(result); return true; },
    diceRules: () => null,
  };
  const container = document.getElementById('board')!;
  const handle: PlayerBoardHandle = playerBoardFactory(() => 'medium', { settings: () => DEFAULT_DICE_SETTINGS, pack: () => pack }).create(container, host);
  handle.setPlayers(['me', 'you'], 'me');
  handle.setConnected(true);
  handle.setControlled(['mine']);
  handle.setScene(scene);
  handle.setExtras(extras);
  const board = (handle as unknown as { board: { view: THREE.PerspectiveCamera; canvas: HTMLCanvasElement } }).board;
  const project = (x: number, y: number, height = 0): { x: number; y: number } => {
    const point = new THREE.Vector3(x, height, y).project(board.view);
    const rect = board.canvas.getBoundingClientRect();
    return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
  };
  /** Files the harness holds back: they "arrive" with `deliver`, then the board is told. */
  const deliver = (): void => { for (const [id, file] of late) files.set(id, file); late.clear(); handle.refresh(); };
  Object.assign(window, { playerTest: { handle, board, record, project, deliver, scene, extras, ready: true } });
}

main().catch((error: unknown) => { (window as unknown as { boardError: string }).boardError = String(error); console.error(error); });
