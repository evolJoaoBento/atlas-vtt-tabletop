/**
 * The phone memory probe: Tabletop's player board mounted as Connect mounts it, on a heavy scene (an 8192-pixel map,
 * large token art, a large wall material, a mini whose texture is 4096 pixels), drawn as a phone draws it
 * (`?memory=lean`, `leanest`) or as a computer does (`normal`). It reports how many bytes the textures it uploaded
 * hold (`window.memoryProbe`), for harness/phoneMemory-test.cjs to hold to a budget.
 */
import './dom-polyfill';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { playerBoardFactory, type PlayerBoardHost } from '../src/playerBoard';
import type { BoardExtras } from '../src/connectContract';
import { vendoredPack } from '../src/dice/dicePack';
import { DEFAULT_DICE_SETTINGS } from '../src/dice/diceSettings';
import type { MemoryMode } from '../src/board/quality';

const memory = (new URLSearchParams(location.search).get('memory') ?? 'normal') as MemoryMode;

function canvasOf(width: number, height: number, colour: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  for (let i = 0; i < 64; i++) context.fillRect((i * 997) % width, (i * 613) % height, 40, 40);
  return canvas;
}

const blobUrl = (canvas: HTMLCanvasElement): Promise<string> => new Promise((resolve) => canvas.toBlob((blob) => resolve(URL.createObjectURL(blob!)), 'image/png'));

async function miniGlb(): Promise<ArrayBuffer> {
  const texture = new THREE.CanvasTexture(canvasOf(4096, 4096, '#c0392b'));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 24), new THREE.MeshStandardMaterial({ map: texture }));
  body.position.y = 0.6;
  const root = new THREE.Group();
  root.add(body);
  return new Promise((resolve, reject) => new GLTFExporter().parse(root, (out) => resolve(out as ArrayBuffer), reject, { binary: true, maxTextureSize: 4096 }));
}

const MAP = 'M'.repeat(43);
const ART = 'A'.repeat(43);
const GLB = 'G'.repeat(43);
const TEX = 'T'.repeat(43);

const scene = {
  sceneId: 's1',
  map: { asset: MAP, width: 8192, height: 6144, cellSize: 128 },
  grid: { type: 'square', size: 128, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.4, lineType: 'solid', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null },
  tokens: {
    mine: { x: 704, y: 704, size: 1, rotation: 0, layer: 0, image: ART, ring: '#2266ff', conditions: [], name: 'Anna', hp: null, stress: null, mini: { asset: GLB, scale: 1, turn: 0 } },
    theirs: { x: 960, y: 704, size: 1, rotation: 0, layer: 0, image: ART, ring: '#ff2222', conditions: [], name: 'Goblin', hp: null, stress: null },
  },
  fog: {}, texts: {}, drawings: {}, widgets: [], initiative: null,
  measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true, coneAngle: 53 },
  pins: [],
};

const extras: BoardExtras = {
  sceneId: 's1',
  walls: [{ id: 'w1', type: 'solid', p1: { x: 512, y: 512 }, p2: { x: 1280, y: 512 }, height: null, material: TEX }],
  lights: [],
  props: [], materials: [{ id: TEX, scale: 1, maps: { color: TEX } }],
  ambient: 0.6, fogHeight: 1, wallThickness: 0.12,
  lighting: { enabled: false, ambient: 0.6, ambientColor: null },
} as never;

/** The bytes the textures the renderer holds take, counted from the scene's materials (each once, mipmaps as a third more). */
function textureBytes(root: THREE.Object3D): { bytes: number; largest: number; count: number } {
  const seen = new Set<THREE.Texture>();
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const one of material ? (Array.isArray(material) ? material : [material]) : []) {
      for (const value of Object.values(one as unknown as Record<string, unknown>)) if (value instanceof THREE.Texture) seen.add(value);
      const uniforms = (one as THREE.ShaderMaterial).uniforms ?? {};
      for (const uniform of Object.values(uniforms)) if (uniform?.value instanceof THREE.Texture) seen.add(uniform.value);
    }
  });
  let bytes = 0;
  let largest = 0;
  for (const texture of seen) {
    const image = texture.image as { width?: number; height?: number } | null;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    largest = Math.max(largest, width, height);
    bytes += width * height * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
  }
  return { bytes, largest, count: seen.size };
}

async function main(): Promise<void> {
  const files = new Map<string, string | ArrayBuffer>();
  files.set(MAP, await blobUrl(canvasOf(8192, 6144, '#9c8a6e')));
  files.set(ART, await blobUrl(canvasOf(2048, 2048, '#3a8a3a')));
  files.set(TEX, await blobUrl(canvasOf(4096, 4096, '#884422')));
  files.set(GLB, await miniGlb());
  const none = (): boolean => true;
  const host = new Proxy({
    image: (id: string) => { const file = files.get(id); return typeof file === 'string' ? file : null; },
    model: (id: string) => { const file = files.get(id); return file instanceof ArrayBuffer ? file : null; },
    diceRules: () => null,
  } as Record<string, unknown>, { get: (target, name: string) => target[name] ?? none }) as unknown as PlayerBoardHost;
  const pack = vendoredPack();
  const factory = playerBoardFactory(() => 'low', () => ({ tiltShift: false, occlusion: false, painted: false, sky: 'dusk' }), { settings: () => DEFAULT_DICE_SETTINGS, pack: () => pack }, () => null, () => memory);
  const handle = factory.create(document.getElementById('board')!, host);
  handle.setPlayers(['me'], 'me');
  handle.setConnected(true);
  handle.setControlled(['mine']);
  handle.setScene(scene as never);
  handle.setExtras(extras);
  const board = (handle as unknown as { board: { scene: THREE.Scene; renderer: THREE.WebGLRenderer } }).board;
  (window as unknown as { memoryProbe: () => unknown }).memoryProbe = () => ({ ...textureBytes(board.scene), gpuTextures: board.renderer.info.memory.textures, ratio: board.renderer.getPixelRatio() });
  (window as unknown as { playerTest: { ready: boolean } }).playerTest = { ready: true };
}

main().catch((error: unknown) => { (window as unknown as { boardError: string }).boardError = String(error instanceof Error ? error.stack : error); });
