/**
 * Browser harness for the 3D board: a made-up map (a drawn background, a square 70 px grid, four tokens: one with a
 * mini, a standee, a hidden one and one whose art is missing; two pins and a prop) on a `Board` with a fake host that
 * records what the board asks of it. Driven by Playwright; not shipped.
 */
import type { TerrainShape } from '../src/board/terrainShapes';
import { DEFAULT_GROUND, type GroundSettings } from '../src/board/ground';
import { equipWindow } from './dom-polyfill';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { Board, type BoardHost } from '../src/board/board';
import { SceneTabBar } from '../src/board/sceneTabBar';
import type { PropPlacement } from '../src/board/boardData';
import { UndoHistory, type UndoStep } from '../src/board/undoHistory';
import { LIQUID_DEFAULTS, LIQUID_KINDS, readWaterMotion, WaterMask, type LiquidKind, type SavedWaterMask, type WaterMotion } from '../src/board/water';
import { maskOutlines, readLiquids, strokeLiquids, waterSourceOf, type LiquidMasks, type WaterArea, type WaterSource } from '../src/board/liquids';
import { emptyRules } from '../src/board/conditions';
import { QUALITY, readSeeThroughSize } from '../src/board/quality';
import { lookOf } from '../src/board/look';
import { renderBoardCard } from '../src/boardCard';
import { setLanguage } from '../src/i18n';
import { readMap, type BoardMap, type BoardToken } from '../src/board/mapModel';
import { CutsceneStudio, type StudioHost } from '../src/cutscene/studio';
import { DEFAULT_CINEMATIC_SETTINGS, readCinematicSettings, type CinematicSettings } from '../src/cutscene/cinematicSettings';
import { levelOfPlace, mapOfPlace, placeAt, type Cutscene } from '../src/cutscene/cutsceneData';
import { CutsceneChannel } from '../src/cutscene/cutsceneRun';
import type { BoardSession } from '../src/connectContract';
import { insideFog } from '../src/board/playerView';
import { AtlasMenu } from '../src/board/atlasMenu';
import { tokenMenuEntries } from '../src/board/tokenMenu';
import { conditionChange, conditionStep, resetChange } from '../src/board/tokenEdits';
import { defeatedResources } from '../src/board/resources';
import { HP_RESOURCE, type ResourceDefinition, type ResourceValue } from '../src/board/resources';
import { readInitiative, type InitiativeAction } from '../src/board/initiative';
import { applyInitiative } from './fakeTracker';
import { InitiativePanel } from '../src/board/initiativePanel';
import { NO_FLIP, type BoardWall, type DoorFlip } from '../src/board/walls';
import { materialDrag, type LoadedMaterial } from '../src/materials';
import { parseMini, type LoadedMini } from '../src/library';
import { DiceTable } from '../src/dice/diceTable';
import { TFile, TFolder } from 'obsidian';
import { BackgroundEditor } from '../src/background/backgroundEditor';
import { BackgroundStore } from '../src/background/backgroundStore';
import { decodeLayer, encodeLayer, renderThumbnail } from '../src/background/backgroundCodec';
import { DEFAULT_BACKGROUND, emptyLayers, TERRAINS } from '../src/background/backgroundData';
import { backgroundFrame } from '../src/background/terrainHeight';
import { chooseAction } from '../src/atlasPort/app/ui/confirmDialog';
import { LootWindow } from '../src/loot/LootWindow';
import { AssetWindow } from '../src/assets/AssetWindow';
import { HOST_BAR_LABELS, hostBar, mapName } from '../src/board/hostBar';
import { PaletteWindow } from '../src/palette/PaletteWindow';
import { HotkeyHelpWindow } from '../src/board/HotkeyHelpWindow';
import type { PaletteHost } from '../src/palette/paletteHost';
import { tabletopCommands } from '../src/palette/tabletopCommands';
import { boardKey } from '../src/board/atlasTools';
import { marksOfMeasures, measureWrite, type BoardMeasure, type MeasureChange } from '../src/board/boardMeasures';
import { DEFAULT_MEASURE_TOOL, readMeasureToolOptions, type MeasureToolOptions } from '../src/board/measureOptions';
import type { BoardSpawnHost } from '../src/assets/boardTarget';
import { TokenWriter } from '../src/board/tokenWriter';
import { readSpellNote } from '../src/board/spellNotes';
import type { SpellBook, SpellEntry } from '../src/board/spellPicker';
import { searchSpells } from '../src/spellLibrary';
import { DEFAULT_RULES, type RollRequest } from '../src/dice/rollRules';
import { RollSession } from '../src/dice/rollSession';
import type { Flick } from '../src/dice/throwInput';
import { BoardDice } from '../src/dice/boardDice';
import type { MapViewLike } from '../src/dice/atlasDice';
import { vendoredPack } from '../src/dice/dicePack';
import { DiceTextures } from '../src/dice/diceTextures';
import { DEFAULT_DICE_SETTINGS, readDiceSettings } from '../src/dice/diceSettings';
import { mountSoundControl, webSound } from '../src/web/soundControl';
import { SoundEngine } from '../src/sound/soundEngine';
import { FreeCamera } from '../src/cutscene/freeCamera';
import { CustomSounds } from '../src/sound/customSounds';
import { CATALOG, loadSound } from '../src/sound/catalog';
import { DEFAULT_SOUND_SETTINGS } from '../src/sound/soundSettings';
import { buildSheet } from '../packages/atlas-host/src/sheets/sheets';
import { routeAtlasWindowRolls } from '../src/sheets/atlasPreview';

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

/** A tree: a brown trunk and a green cone of leaves, taller than it is wide (for the painted props). */
async function treeGlb(): Promise<ArrayBuffer> {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }));
  trunk.position.y = 0.3;
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.6, 14), new THREE.MeshStandardMaterial({ color: 0x2f7a3a }));
  leaves.position.y = 1.2;
  const root = new THREE.Group();
  root.add(trunk, leaves);
  return exportGlb(root);
}

/** A low grey boulder. */
async function rockGlb(): Promise<ArrayBuffer> {
  const rock = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshStandardMaterial({ color: 0x8a8a90 }));
  rock.scale.set(1, 0.6, 0.8);
  rock.position.y = 0.3;
  const root = new THREE.Group();
  root.add(rock);
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
/** A balcony drawn on a transparent image: an elevation layer shows the map below through what is not drawn. */
const balcony = drawn(1400, 1000, (context) => {
  context.fillStyle = '#c9a66b';
  context.fillRect(280, 140, 490, 280);
  context.fillStyle = '#8a6a3c';
  context.fillRect(280, 140, 490, 12);
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
  showNameplate: true, conditions: [], conditionValues: {}, resources: {}, overriddenMax: [], instanceNumber: null, statblockPath: null, side: null, sees: false, offMap: false, elevation: 0, speed: null, ...over,
});

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, over: Partial<BoardWall> = {}): BoardWall => ({
  id, type: 'solid', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over,
});

/** A brick pattern standing in for a Poly Haven material. */
function brickMaterial(): LoadedMaterial {
  const texture = new THREE.CanvasTexture((() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d9d2c5';
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = '#a0412d';
    for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) context.fillRect(col * 64 + (row % 2) * 32 + 3, row * 32 + 3, 58, 26);
    return canvas;
  })());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return { name: 'Bricks', apply: (material) => { material.color.set(0xffffff); material.map = texture; } };
}

const map: BoardMap = {
  path: 'harness.atlasmap',
  background: 'bg.png',
  grid: { enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineWidth: 2, color: null, lineType: 'dashed', numbers: 'letter-number', numberOpacity: 0.8 },
  tokenSettings: { showNameplates: false, showInstanceBadges: true, hiddenResources: [] },
  tokens: [
    token({ id: 'hero', x: 245, y: 245, imagePath: 'red.png', name: 'Hero', statblockPath: 'Bestiary/Hero.md', conditions: ['c-poisoned', 'c-frightened'], resources: { hp: { current: 20, max: 27 }, ac: { current: 15, max: 15 }, slots: { current: 2, max: 4 }, ki: { current: 3, max: 5 } } }),
    token({ id: 'gob', x: 525, y: 385, imagePath: 'green.png', name: 'Goblin', resources: { hp: { current: 3, max: 7 } }, instanceNumber: 1 }),
    token({ id: 'gob2', x: 875, y: 385, imagePath: 'green.png', name: 'Goblin', resources: { hp: { current: 7, max: 7 } }, instanceNumber: 2 }),
    token({ id: 'orc', x: 735, y: 525, imagePath: 'red.png', name: 'Orc', hidden: true, resources: { hp: { current: 15, max: 15 } } }),
    token({ id: 'noart', x: 385, y: 665, imagePath: 'missing.png', kind: 'token' }),
    token({ id: 'fallen', x: 1155, y: 525, imagePath: 'red.png', name: 'Fallen', resources: { hp: { current: 0, max: 9 } } }),
    // Inside the fogged room: the GM sees it, players do not.
    token({ id: 'lurker', x: 1015, y: 805, imagePath: 'red.png', name: 'Lurker', resources: { hp: { current: 9, max: 9 } } }),
    // On another floor (Atlas 0.10): kept for the tracker, not drawn, and it does not count as a third goblin.
    token({ id: 'upstairs', x: 245, y: 385, imagePath: 'green.png', name: 'Goblin', instanceNumber: 3, offLevel: true, levelId: 'upper' }),
    token({ id: 'fallenDisc', x: 1225, y: 525, imagePath: 'green.png', name: 'Fallen disc', resources: { hp: { current: 0, max: 9 } } }),
  ],
  rawGrid: null,
  measures: [], measuresElsewhere: [], liquids: [],
  // A room at the bottom of the map: a door in its north wall, a secret door in its south wall, its west wall one-way.
  walls: [
    wall('n1', 455, 840, 525, 840, { chain: 'room' }), wall('door', 525, 840, 595, 840, { type: 'door' }), wall('n2', 595, 840, 665, 840, { chain: 'room' }),
    wall('e', 665, 840, 665, 980, { chain: 'room' }),
    wall('s1', 665, 980, 595, 980, { chain: 'room' }), wall('secret', 595, 980, 525, 980, { type: 'secret-door' }), wall('s2', 525, 980, 455, 980, { chain: 'room' }),
    wall('w', 455, 980, 455, 840, { chain: 'room', direction: 'left' }),
    // Inside the fogged room: players must not see these.
    wall('fogwall', 1000, 800, 1070, 800), wall('fogdoor', 1260, 800, 1300, 800, { type: 'door' }),
  ],
  // A torch and a magic light in the room, and a candle the second goblin carries.
  lights: [
    { id: 'torch', x: 490, y: 875, bright: 20, dim: 40, color: '#ff9a3c', intensity: 1, animation: 'torch', angle: null, rotation: 0, hidden: false, darkness: false, activeBelowAmbient: null, tokenId: null },
    { id: 'magic', x: 630, y: 945, bright: 0, dim: 15, color: '#93c5fd', intensity: 0.8, animation: 'pulse', angle: null, rotation: 0, hidden: false, darkness: false, activeBelowAmbient: null, tokenId: null },
    { id: 'gob2', x: 875, y: 385, bright: 10, dim: 20, color: '#ffd28a', intensity: 1, animation: 'candle', angle: null, rotation: 0, hidden: false, darkness: false, activeBelowAmbient: null, tokenId: 'gob2' },
  ],
  lighting: { enabled: false, ambient: 0.1, ambientColor: null },
  // Four combatants, not fighting yet: the hero (own modifier +2), the two goblins (copies 1 and 2), the hidden orc.
  initiative: readInitiative({
    entries: [
      { id: 'e-hero', tokenId: 'hero', name: 'Hero', initiative: 18, initiativeModifier: 2, imagePath: 'red.png', isActive: false, isNPC: false, order: 0 },
      { id: 'e-gob', tokenId: 'gob', name: 'Goblin', initiative: 12, initiativeModifier: 0, imagePath: 'green.png', isActive: false, isNPC: true, order: 1 },
      { id: 'e-gob2', tokenId: 'gob2', name: 'Goblin', initiative: 9, initiativeModifier: 0, imagePath: 'green.png', isActive: false, isNPC: true, order: 2 },
      { id: 'e-orc', tokenId: 'orc', name: 'Orc', initiative: 5, initiativeModifier: 0, imagePath: 'red.png', isActive: false, isNPC: true, order: 3 },
    ],
    currentIndex: -1, round: 0, isActive: false, config: { autoSort: true },
  }),
  // A fogged room with a corridor erased through it, and a brush stroke beside it.
  fog: [
    { id: 'f1', type: 'rectangle', timestamp: 1, isErasing: false, offsetX: 0, offsetY: 0, x: 980, y: 770, width: 350, height: 210 },
    { id: 'f2', type: 'rectangle', timestamp: 2, isErasing: true, offsetX: 0, offsetY: 0, x: 1085, y: 840, width: 140, height: 70 },
    { id: 'f3', type: 'brush', timestamp: 3, isErasing: false, offsetX: 0, offsetY: 0, points: [{ x: 70, y: 900 }, { x: 280, y: 940 }], brushRadius: 35 },
  ],
  inks: [
    { id: 'd1', points: [{ x: 160, y: 520 }, { x: 260, y: 560 }, { x: 330, y: 520 }, { x: 420, y: 600 }], color: '#d13b3b', width: 8, opacity: 1, rank: 0, layer: 'above' },
    { id: 'd2', points: [{ x: 600, y: 120 }, { x: 760, y: 120 }, { x: 760, y: 220 }, { x: 600, y: 220 }, { x: 600, y: 120 }], color: '#3b7dd1', width: 5, opacity: 0.6, rank: 1, layer: 'above' },
  ],
  texts: [
    { id: 't1', x: 560, y: 560, text: 'The Common Room', fontSize: 28, fontFamily: 'Georgia', color: '#ffe8b0', backgroundColor: '#000000', padding: 8, borderRadius: 6, opacity: 0.55, align: 'center', bold: true, italic: false, rotation: 0, scale: 1 },
    { id: 't2', x: 300, y: 450, text: 'To the\ndocks', fontSize: 22, fontFamily: 'Arial', color: '#ffffff', backgroundColor: null, padding: 8, borderRadius: 0, opacity: 1, align: 'left', bold: false, italic: true, rotation: -30, scale: 1.5 },
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
  // ?lang=pt opens the board in Portuguese, as Obsidian's language does in the plugin.
  setLanguage(new URLSearchParams(location.search).get('lang'));
  const hero: LoadedMini = await parseMini(await heroGlb());
  const barrel: LoadedMini = await parseMini(await barrelGlb());
  const tree: LoadedMini = await parseMini(await treeGlb());
  const rock: LoadedMini = await parseMini(await rockGlb());
  const images: Record<string, string> = { 'bg.png': background, 'red.png': face('#b03030'), 'green.png': face('#3a8a3a'), 'balcony.png': balcony };
  const snapping = { tokens: true, props: true };
  const props: PropPlacement[] = [{ id: 'barrel', glb: 'props/barrel.glb', x: 910, y: 805, rotation: 0, scale: 1 }];
  /** The raised shapes kept (Shapes tool), as the board data keeps them. */
  const shapes: TerrainShape[] = [];
  /** The ground round the map (Board settings, Ground), as the board data keeps it. */
  const groundState = { value: { ...DEFAULT_GROUND } as GroundSettings };
  const record = {
    shapeSaves: 0,
    moves: [] as Array<[string, number, number]>, propMoves: [] as Array<[string, number, number]>, propScales: [] as Array<[string, number]>, propLifts: [] as Array<[string, number]>, added: [] as Array<[string, number, number, unknown?]>,
    notes: [] as string[], menus: [] as string[], propMenus: [] as string[], previews: [] as string[], warnings: [] as string[],
    copies: [] as Array<[string, string, number, number]>, menuActions: [] as unknown[][], initiative: [] as unknown[], shown: [] as string[],
    heights: [] as unknown[][], doors: [] as string[], wallMenus: [] as string[], paints: [] as Array<[string, string, boolean]>, lightMenus: [] as string[], ambients: [] as number[], tints: [] as Array<string | null>, lasers: [] as Array<Record<string, unknown>>, fogHeights: [] as number[], thicknesses: [] as number[], toolActions: [] as unknown[], opened: 0, imageReads: [] as string[], sceneTabs: [] as unknown[][],
    /** Resource edits as the host saved them: token, key, the value it held, the value written, max edited. */
    edits: [] as Array<[string, string, ResourceValue, ResourceValue, boolean]>,
    rotations: [] as Array<Array<{ id: string; rotation: number }>>,
    /** Spell rules carried out: tokens moved, tokens summoned, tokens removed, casts claimed. */
    ruleMoves: [] as Array<Array<{ id: string; x: number; y: number }>>, summons: [] as unknown[], removed: [] as string[], claims: [] as string[],
  };
  /** What the host holds, as Atlas or the file would: edits apply to it. */
  const stored = new Map(map.tokens.map((entry) => [entry.id, structuredClone(entry.resources)]));
  const rules = emptyRules();
  rules.conditions.set('c-poisoned', { name: 'Poisoned', color: '#16a34a', valued: false, icon: 'poison' });
  rules.conditions.set('c-frightened', { name: 'Frightened', color: '#7c3aed', valued: false, icon: 'terror' });
  rules.conditions.set('c-exhaustion', { name: 'Exhaustion', color: '#facc15', valued: true });
  // As DotMM's collection: HP and a static AC on the bars, the rest on wheels.
  const definitions: ResourceDefinition[] = [
    { ...HP_RESOURCE },
    { key: 'ac', name: 'AC', field: 'ac', direction: 'static', color: '#64748b', visibleToPlayers: true },
    { key: 'slots', name: 'Spell Slots', field: 'spell_slots', direction: 'drains', color: '#6366f1', visibleToPlayers: true },
    { key: 'ki', name: 'Ki', field: 'ki', direction: 'fills', color: '#eab308', visibleToPlayers: true },
  ];
  rules.definitions = definitions;
  let fogHeight = 1;
  // Atlas 0.15's movement steps and drag-distance choice, as a feature sets them (none, and always, by default).
  let movement: { rules: { steps: Array<{ name: string; multiple: number; color: string }>; countPerTurn: boolean }; speeds: Record<string, number> } | null = null;
  let dragDistance: 'always' | 'combat' | 'never' = 'always';
  let measureTool: MeasureToolOptions = { ...DEFAULT_MEASURE_TOOL };
  let keptMeasures: BoardMeasure[] = [];
  let nextMeasureId = 1;
  const syncKeptMeasures = (): void => {
    const shown = (board as unknown as { map: BoardMap }).map;
    shown.measures = keptMeasures;
    const tokens = new Map(shown.tokens.map((entry) => [entry.id, entry]));
    board.receiveTemplates(marksOfMeasures(keptMeasures, {
      cell: shown.grid.size,
      accent: '#7c5cff',
      tokenAt: (id) => { const found = tokens.get(id); return found ? { x: found.x, y: found.y } : null; },
      unseen: (id) => tokens.get(id)?.hidden !== false,
    }));
  };
  const applyMeasureChange = (change: MeasureChange): void => {
    const write = measureWrite(change, keptMeasures, null);
    const before = keptMeasures.map((entry) => structuredClone(entry));
    if ('add' in write) {
      const id = `m_${nextMeasureId++}`;
      keptMeasures = [...keptMeasures, { id, record: { id, kind: 'measure', ...(write.add as Record<string, unknown>) } as never }];
    } else {
      const drop = new Set(write.remove);
      if (drop.size === 0) return;
      keptMeasures = keptMeasures.filter((entry) => !drop.has(entry.id));
    }
    const after = keptMeasures.map((entry) => structuredClone(entry));
    syncKeptMeasures();
    history.push({
      paths: [waterPath],
      label: 'add' in write ? 'measure' : 'clear measures',
      undo: () => { keptMeasures = before.map((entry) => structuredClone(entry)); syncKeptMeasures(); return true; },
      redo: () => { keptMeasures = after.map((entry) => structuredClone(entry)); syncKeptMeasures(); return true; },
    });
  };
  /** Tokens a Connect player controls (what the GM board asks Connect). */
  const controlled = new Set<string>();
  let wallThickness = 0.12;
  let hosting = false;
  /** Tells the cutscene source the GM's camera moved (set once the studio exists). */
  let cutsceneCameraMoved: () => void = () => {};
  const wallPaint = new Map<string, string>();
  const doorProps = new Map<string, string>();
  const doorFlips = new Map<string, DoorFlip>();
  const wallHeights = new Map<string, number>();
  const wallWidthsKept = new Map<string, number>();
  const windowSpans = new Map<string, { bottom: number; top: number }>();
  // The toolbar's modes, off unless a check turns them on (the other checks see every tool).
  const modes: { on: boolean; mode: 'play' | 'edit' } = { on: false, mode: 'play' };
  // The cutscene studio, once it exists: Cinematic is its gallery or editor being open (never kept in `modes`), as in BoardView.
  let cinematicStudio: { readonly cinematic: boolean; openGallery(): void; leaveCinematic(): void } | null = null;
  const lightHeights = new Map<string, number>();
  let ambientLevel = 1;
  let tintKept: string | null = null;
  let menu: AtlasMenu | null = null;
  const initiative = new Set<string>();
  let players: Window | null = null;
  let laser = { color: '#ff0059', size: 16 };
  // The dice settings the board and its dice read; the Board settings tick changes `autoRoll`.
  // Kept in the page's storage, as Tabletop keeps its settings in the vault, so a reload of the page shows them kept.
  const kept = (): Partial<typeof DEFAULT_DICE_SETTINGS> => { try { return JSON.parse(window.localStorage.getItem('harness-dice') ?? '{}'); } catch { return {}; } };
  let diceSettings = readDiceSettings({ ...DEFAULT_DICE_SETTINGS, ...kept() });
  const keep = (changes: Partial<typeof DEFAULT_DICE_SETTINGS>): void => {
    diceSettings = { ...diceSettings, ...changes };
    try { window.localStorage.setItem('harness-dice', JSON.stringify({ ...kept(), ...changes })); } catch { /* storage is unavailable */ }
  };
  // The base under the hero's mini, set by the checks (the board reads placements when it syncs).
  let heroBase: 'none' | 'round' | 'square' = 'none';
  // The map's water as these checks' host keeps it (a saved mask and its motion: in the plugin it is Atlas's liquids),
  // each change a step of the undo history, a slider's run of changes one step.
  const history = new UndoHistory();
  const waterPath = 'map.atlasmap';
  type KeptWater = { mask: SavedWaterMask | null; motion: WaterMotion | null };
  const waterStore: KeptWater = { mask: null, motion: null };
  const setWaterStore = (value: KeptWater): void => { waterStore.mask = value.mask; waterStore.motion = value.motion; board.refresh(); };
  const waterStep = (from: KeptWater, to: KeptWater, look: boolean): UndoStep => Object.assign({
    paths: [waterPath], label: look ? 'water look' : 'water',
    undo: () => { setWaterStore(from); return true; },
    redo: () => { setWaterStore(to); return true; },
    ...(look ? { mergeKey: `board:${waterPath}:waterLook`, merge: (earlier: UndoStep) => waterStep((earlier as { from?: KeptWater }).from ?? from, to, look) } : {}),
  }, { from });
  const putWater = (next: KeptWater, look: boolean): void => {
    const before = { ...waterStore };
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    setWaterStore(next);
    history.push(waterStep(before, { ...next }, look));
  };
  // Lava and acid as this host keeps them out of Atlas's record: their outlines (traced as Atlas would keep them) and
  // their motions, not undone.
  const otherLiquids: Record<'lava' | 'acid', { areas: WaterArea[]; motion: WaterMotion | null }> = { lava: { areas: [], motion: null }, acid: { areas: [], motion: null } };
  const keepOthers = (masks: Record<LiquidKind, SavedWaterMask | null>): void => {
    const size = board.mapSize;
    if (!size) return;
    for (const liquid of ['lava', 'acid'] as const) {
      const mask = masks[liquid] ? WaterMask.read(masks[liquid], size.width, size.height, map.grid.size) : null;
      otherLiquids[liquid].areas = mask ? maskOutlines(mask).map((area) => ({ ...area, liquid })) : [];
    }
  };
  const keptWater = (): WaterSource | null => {
    const areas = [...otherLiquids.lava.areas, ...otherLiquids.acid.areas];
    const motions = { ...(otherLiquids.lava.motion ? { lava: otherLiquids.lava.motion } : {}), ...(otherLiquids.acid.motion ? { acid: otherLiquids.acid.motion } : {}) };
    if (!waterStore.mask && !waterStore.motion && areas.length === 0 && Object.keys(motions).length === 0) return null;
    return { mask: waterStore.mask, motion: waterStore.motion, ...(areas.length > 0 ? { areas } : {}), ...motions };
  };
  // The same water kept as Atlas keeps it (`setLiquids`): a record of liquids, of which the brush changes only its
  // own. The board is then handed outlines, and a stroke is kept as the plugin's view keeps it (`strokeLiquids`).
  let liquids: Record<string, Record<string, unknown>> | null = null;
  let liquidCount = 0;
  const setLiquids = (record: Record<string, Record<string, unknown>> | null): void => { liquids = record; board.refresh(); };
  const keepStroke = (masks: Record<LiquidKind, SavedWaterMask | null>, record: Record<string, Record<string, unknown>>): Promise<void> | void => {
    const size = board.mapSize;
    const cell = map.grid.size;
    if (!size) return;
    const painted = {} as LiquidMasks;
    for (const liquid of LIQUID_KINDS) {
      const mask = masks[liquid] ? WaterMask.read(masks[liquid], size.width, size.height, cell) : WaterMask.forMap(size.width, size.height, cell);
      if (!mask) return;
      painted[liquid] = mask;
    }
    const now = readLiquids(record);
    const motion = (liquid: LiquidKind): WaterMotion => now.find((one) => one.liquid === liquid && one.motion)?.motion ?? (liquid === 'water' ? readWaterMotion(waterStore.motion) : otherLiquids[liquid].motion ?? LIQUID_DEFAULTS[liquid]);
    const stroke = strokeLiquids(painted, now, null, { water: motion('water'), lava: motion('lava'), acid: motion('acid') });
    for (const id of stroke.remove) delete record[id];
    for (const liquid of stroke.add) { const id = `brush_${++liquidCount}`; record[id] = { id, kind: 'liquid', ...liquid }; }
    // As the view does when Atlas's store changes; the stroke is kept by the time the promise settles.
    board.refresh();
    return Promise.resolve();
  };
  const travel = (way: 'undo' | 'redo'): void => { void history[way]([waterPath]).then(() => board.refreshToolbar()); };
  // The spell notes searched: none until a test gives them (`setSpellNotes`).
  let spellEntries: SpellEntry[] | null = null;
  const spellBook: SpellBook = { search: async (query, limit) => searchSpells(spellEntries ?? [], query, limit) };
  const setSpellNotes = (notes: Array<{ path: string; text: string }> | null): void => {
    spellEntries = notes === null ? null : notes.flatMap(({ path, text }) => {
      const note = readSpellNote(text, path.replace(/^.*\//, '').replace(/( \(\d{4}\))?\.md$/, ''));
      return note ? [{ id: path, note, source: `SRD ${path.split('/')[0]}` }] : [];
    });
  };
  /** Stands in for the sound engine and records what the board asks of it. */
  const sounds = {
    plays: [] as unknown[][],
    loops: [] as unknown[][],
    /** The keys as the board gave them (each board's own prefix on them). */
    loopKeys: [] as string[],
    /** A closed tab's host gives no engine any more. */
    gone: false,
    /** Another window's engine, once the tab has moved there: the host gives it instead of this one. */
    other: null as unknown,
    listeners: [] as Array<{ listener: unknown; span: number }>,
    /** What the board's own rule for being heard said as each sound was asked (null: no rule given). */
    heards: [] as Array<boolean | null>,
    play(id: string, options?: unknown, heard?: () => boolean) { this.plays.push([id, options]); this.heards.push(heard ? heard() : null); },
    loop(key: string, id: string | null, gain: number) { this.loopKeys.push(key); this.loops.push([key.replace(/^board\d+:/, ''), id, gain]); },
    setListener(listener: unknown, span: number) { this.listeners.push({ listener, span }); },
  };
  // The saved painted backgrounds the Painted ground offers, kept fresh for the host's synchronous `backgrounds()`.
  let backgroundList: readonly { folder: string; name: string }[] = [];
  const host: BoardHost = {
    spellBook: () => (spellEntries === null ? null : spellBook),
    water: () => (liquids ? waterSourceOf(readLiquids(liquids), null, { ...(otherLiquids.lava.motion ? { lava: otherLiquids.lava.motion } : {}), ...(otherLiquids.acid.motion ? { acid: otherLiquids.acid.motion } : {}) }) : keptWater()),
    saveWater: (masks) => {
      if (liquids) return keepStroke(masks, liquids);
      keepOthers(masks);
      putWater({ mask: masks.water, motion: waterStore.motion }, false);
      board.refresh();
    },
    // Without water yet the motion is only remembered, for the first stroke.
    saveWaterMotion: (motion, liquid) => {
      if (liquid !== 'water') { otherLiquids[liquid].motion = motion; return; }
      if (waterStore.mask) putWater({ mask: waterStore.mask, motion }, true); else waterStore.motion = motion;
    },
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    canUndo: () => history.canUndo([waterPath]),
    canRedo: () => history.canRedo([waterPath]),
    readImage: async (path) => { record.imageReads.push(path); return images[path] ?? null; },
    // Atlas 0.11's Mosaic Canvas: a map of 65,535 pixels a side arrives as a small picture and the size it stands for.
    readPicture: async (path) => {
      if (path !== 'mosaic.png') return null;
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext('2d')!;
      const paint = context.createLinearGradient(0, 0, 512, 512);
      paint.addColorStop(0, '#2f5d3a');
      paint.addColorStop(1, '#8a6b3c');
      context.fillStyle = paint;
      context.fillRect(0, 0, 512, 512);
      return { bitmap: await createImageBitmap(canvas), width: 65535, height: 65535 };
    },
    readMini: async (path) => {
      // Painted props: a tree, a rock, and a file that is gone.
      if (path.includes('gone')) throw new Error('the file is gone');
      return path.includes('barrel') ? barrel : path.includes('tree') ? tree : path.includes('rock') ? rock : hero;
    },
    placement: (id) => (id === 'hero' || id === 'fallen' ? { mini: 'minis/hero.glb', scale: 1, turn: 0, ...(heroBase === 'none' ? {} : { base: heroBase }) } : null),
    style: (id) => (id === 'gob' ? 'standee' : 'disc'),
    props: () => props,
    shapes: () => shapes,
    ground: () => groundState.value,
    setGround: (settings) => { groundState.value = settings; queueMicrotask(() => board.refresh()); },
    backgrounds: () => backgroundList,
    // A slot naming a material folder the gallery does not hold reads as gone (null).
    readBackground: async (ref) => {
      const loaded = await backgrounds.load(ref);
      return loaded ? { ...loaded, materials: loaded.settings.materials.map((path) => (['materials/brick', 'materials/stone'].includes(path) ? path : null)) } : null;
    },
    saveShape: (shape) => { const at = shapes.findIndex((one) => one.id === shape.id); if (at >= 0) shapes[at] = shape; else shapes.push(shape); record.shapeSaves += 1; queueMicrotask(() => board.refresh()); },
    removeShape: (id) => { const at = shapes.findIndex((one) => one.id === id); if (at >= 0) shapes.splice(at, 1); queueMicrotask(() => board.refresh()); },
    rules: () => rules,
    moveToken: (id, x, y) => { record.moves.push([id, x, y]); },
    // As one move each (what the board did without it), and kept as one batch.
    moveTokens: (moves) => { for (const move of moves) record.moves.push([move.id, move.x, move.y]); record.ruleMoves.push(moves.map((move) => ({ ...move }))); },
    claimSpell: (id) => { if (record.claims.includes(id)) return false; record.claims.push(id); return true; },
    summonTokens: (tokens) => { record.summons.push(JSON.parse(JSON.stringify(tokens))); return tokens.map((_, k) => (k === 0 ? 'gob' : `summoned${k}`)); },
    removeTokens: (ids) => { record.removed.push(...ids); },
    moveProp: (id, x, y) => { record.propMoves.push([id, x, y]); },
    scaleProp: (id, scale) => { record.propScales.push([id, scale]); },
    liftProp: (id, lift) => { record.propLifts.push([id, lift]); },
    snapProps: () => snapping.props,
    setMovement: (value: typeof movement) => { movement = value; },
    setSnap: (kind, on) => { snapping[kind] = on; if (kind === 'tokens') ((board as unknown as { map: BoardMap }).map.grid as { snap: boolean }).snap = on; },
    addProp: (glb, x, y, look) => { record.added.push([glb, x, y, look]); },
    openNote: (path) => { record.notes.push(path); },
    // The token menu the board's tab opens, with the same entries; its actions change the board and are recorded.
    tokenMenu: (id, event) => {
      record.menus.push(id);
      // The map the board shows now: a reload hands it a new one.
      const shown = (): BoardMap => (board as unknown as { map: BoardMap }).map;
      const token = () => shown().tokens.find((t) => t.id === id) ?? null;
      const change = (fields: Partial<BoardToken>): void => { const now = token(); if (now) board.changeToken(id, { ...now, ...fields }); };
      const conditions = (fields: { conditions: string[] | undefined; conditionValues?: Record<string, number> | undefined } | null): void => {
        if (fields) change({ conditions: fields.conditions ?? [], conditionValues: fields.conditionValues ?? {} });
      };
      menu?.close();
      menu = new AtlasMenu(document, () => tokenMenuEntries({
        token, rules, settings: () => shown().tokenSettings,
        inInitiative: () => initiative.has(id), pov: () => board.povToken === id, hasMini: () => id === 'hero' || id === 'fallen', miniBase: () => 'none', standee: () => id === 'gob',
        lightHeight: () => (id === 'gob2' ? 1 : null),
        icon: (element, name) => { element.dataset.icon = name; },
        actions: {
          setCondition: (condition, active) => { record.menuActions.push(['condition', condition, active]); conditions(conditionChange(token()!, condition, active)); },
          stepCondition: (condition, delta) => { record.menuActions.push(['step', condition, delta]); conditions(conditionStep(token()!, condition, delta)); },
          setHidden: (hidden) => { record.menuActions.push(['hidden', hidden]); change({ hidden }); },
          setPov: (on) => { board.setPov(on ? id : null); },
          setInitiative: (join) => { record.menuActions.push(['initiative', join]); if (join) initiative.add(id); else initiative.delete(id); },
          assignMini: () => record.menuActions.push(['assignMini']),
          removeMini: () => record.menuActions.push(['removeMini']),
          setBase: (base) => record.menuActions.push(['base', base]),
          setStandee: (standee) => record.menuActions.push(['standee', standee]),
          setLightHeight: (height) => record.menuActions.push(['lightHeight', height]),
          reset: () => { record.menuActions.push(['reset']); const r = resetChange(token()!, rules.definitions); change({ resources: r.resources ?? token()!.resources, conditions: [], conditionValues: {} }); },
          kill: () => { record.menuActions.push(['kill']); change({ resources: defeatedResources(token()!, rules.definitions) ?? token()!.resources }); },
          remove: () => { record.menuActions.push(['delete']); board.changeToken(id, null); },
        },
      }), { x: event.clientX, y: event.clientY }, (element, name) => { element.dataset.icon = name; }, () => { menu = null; });
    },
    propMenu: (id) => { record.propMenus.push(id); },
    statblockPreview: (id) => { record.previews.push(id); },
    copyToken: (id, newId, x, y) => { record.copies.push([id, newId, x, y]); },
    rotateTokens: (turns) => { record.rotations.push(turns.map((turn) => ({ ...turn }))); },
    editResource: (id, key, edit, maxEdited) => {
      const held = stored.get(id)?.[key];
      if (!held) return;
      const next = edit(held);
      stored.get(id)![key] = next;
      record.edits.push([id, key, held, next, maxEdited]);
    },
    controlledByPlayers: (id) => controlled.has(id),
    fogHeight: () => fogHeight,
    setFogHeight: (height) => { fogHeight = height; record.fogHeights.push(height); board.refresh(); },
    wallThickness: () => wallThickness,
    setWallThickness: (thickness) => { wallThickness = thickness; record.thicknesses.push(thickness); board.refresh(); },
    measurement: () => ({ mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', bands: [] }),
    movement: () => (movement ? { rules: movement.rules, speedOf: (id: string) => movement?.speeds[id] ?? null } : null),
    dragDistance: () => dragDistance,
    setDragDistance: (value) => { dragDistance = value; board.refreshToolbar(); },
    measureTool: () => measureTool,
    setMeasureTool: (changes) => { measureTool = readMeasureToolOptions({ ...measureTool, ...changes }); board.refreshToolbar(); },
    measureAction: (change) => applyMeasureChange(change),
    measureHotkeys: () => ({ measure: 'M', measureKeep: 'K', gmView: 'D' }),
    warn: (message) => { if (!record.warnings.includes(message)) record.warnings.push(message); },
    // A popup window stands in for Obsidian's pop-out: same process, another document.
    switchLayer: (path) => { record.sceneTabs.push(['layer', path]); },
    layerMenu: (path) => { record.sceneTabs.push(['menu', path]); },
    tablePlaced: (table) => { record.sceneTabs.push(['table', table]); board.setArTable(table); },
    tableRemoved: () => { record.sceneTabs.push(['table-removed']); board.setArTable(null); },
    moveTokensToLayer: (ids, path, places, follow) => { record.sceneTabs.push(['toLayer', [...ids], path, ...(places ? [places, follow === true] : [])]); },
    togglePlayerView: () => {
      if (players && !players.closed) {
        board.detachPlayer();
        players.close();
        players = null;
      } else {
        players = window.open('', 'players', 'width=640,height=400');
        if (!players) return;
        equipWindow(players);
        players.document.body.style.cssText = 'margin:0;background:#0f0c0a';
        const stage = players.document.createElement('div');
        stage.style.cssText = 'position:fixed;inset:0';
        players.document.body.appendChild(stage);
        board.attachPlayer(stage);
      }
      board.refreshToolbar();
    },
    playerViewOpen: () => !!players && !players.closed,
    laser: () => laser,
    setLaser: (changes) => { laser = { ...laser, ...changes }; record.lasers.push(changes); },
    autoRoll: () => diceSettings.autoRoll,
    setAutoRoll: (on) => keep({ autoRoll: on }),
    setTiltShift: (on) => { board.setQuality({ ...board.quality, tiltShift: on }); },
    setOcclusion: (on) => { board.setQuality({ ...board.quality, occlusion: on }); },
    setSeeThrough: (on) => { board.setQuality({ ...board.quality, seeThrough: on }); },
    setSeeThroughSize: (squares) => { board.setQuality({ ...board.quality, seeThroughSize: readSeeThroughSize(squares) }); },
    setLayerLook: (look) => { board.setQuality({ ...board.quality, layerLook: look }); },
    setLighting: (choice) => { const { painted, sky } = lookOf(choice, 'dusk'); board.setQuality({ ...QUALITY.medium, painted, sky }); },
    initiativeOpen: () => panel.isOpen,
    toggleInitiative: () => panel.setOpen(!panel.isOpen),
    wallMaterial: (id) => wallPaint.get(id) ?? null,
    materialDefaults: () => (window as unknown as { __materialDefaults?: Record<string, string> }).__materialDefaults ?? {},
    wallHeight: (id) => wallHeights.get(id) ?? null,
    windowOf: (id) => windowSpans.get(id) ?? null,
    wallWidth: (id) => wallWidthsKept.get(id) ?? null,
    setWallWidth: (id, squares) => { wallWidthsKept.set(id, squares); board.refresh(); },
    setWindowSpan: (id, span) => { windowSpans.set(id, span); board.refresh(); },
    setWallHeight: (id, squares, whole) => { record.heights.push(['wall', id, squares, whole]); wallHeights.set(id, squares); board.refresh(); },
    setLightHeight: (id, squares) => { record.heights.push(['light', id, squares]); lightHeights.set(id, squares); board.refresh(); },
    doorProp: (id) => doorProps.get(id) ?? null,
    doorFlip: (id) => doorFlips.get(id) ?? NO_FLIP,
    readMaterial: async () => brickMaterial(),
    materials: () => [{ path: 'materials/brick', name: 'brick', thumb: null }, { path: 'materials/stone', name: 'stone', thumb: null }],
    boardMode: () => (modes.on ? (cinematicStudio?.cinematic ? 'cinematic' : modes.mode) : null),
    setBoardMode: (mode) => {
      if (mode === 'cinematic') { cinematicStudio?.openGallery(); return; }
      modes.mode = mode;
      cinematicStudio?.leaveCinematic();
    },
    toggleDoor: (id) => { record.doors.push(id); },
    wallMenu: (id) => { record.wallMenus.push(id); },
    paintWall: (id, material, whole) => {
      record.paints.push([id, material, whole]);
      const walls = (board as unknown as { map: BoardMap }).map.walls;
      const chain = walls.find((w) => w.id === id)?.chain;
      for (const w of whole && chain ? walls.filter((other) => other.chain === chain) : walls.filter((other) => other.id === id)) { if (material) wallPaint.set(w.id, material); else wallPaint.delete(w.id); }
      board.refresh();
    },
    ambient: () => ambientLevel,
    // Atlas's scene lighting, switched off by the 'lighting from Atlas' feature.
    lightingOn: () => (window as unknown as { __lightingOff?: boolean }).__lightingOff !== true,
    setAmbient: (level) => { ambientLevel = level; record.ambients.push(level); board.refresh(); },
    tint: () => tintKept,
    setTint: (color) => { tintKept = color; record.tints.push(color); board.refresh(); },
    clearTint: () => { tintKept = null; record.tints.push(null); board.refresh(); },
    lightHeight: (light) => lightHeights.get(light.id) ?? 1,
    lightMenu: (id) => { record.lightMenus.push(id); },
    hosting: () => hosting,
    cameraMoved: () => cutsceneCameraMoved(),
    sounds: () => (sounds.gone ? null : ((sounds.other ?? sounds) as unknown as SoundEngine)),
    playerAction: (action) => { record.toolActions.push(JSON.parse(JSON.stringify(action))); },
  };
  const container = document.getElementById('board')!;
  const board = new Board(container, host, QUALITY.medium);
  history.onChange(() => board.refreshToolbar());
  // Atlas's scene tabs over the board, from the Atlas view holding its map.
  const sceneTabs = new SceneTabBar(container, {
    tabs: () => [
      { id: 't1', name: 'Tavern', filePath: 'maps/tavern.atlasmap', active: true, presented: false, loaded: true, dirty: false },
      { id: 't2', name: 'Crypt', filePath: 'maps/crypt.atlasmap', active: false, presented: true, loaded: false, dirty: false, layer: '+2' },
      { id: 't3', name: 'Cellar', filePath: 'maps/cellar.atlasmap', active: false, presented: false, loaded: true, dirty: true },
    ],
    switchTab: (id) => { record.sceneTabs.push(['switch', id]); },
    presentTab: (id) => { record.sceneTabs.push(['present', id]); },
    closeTab: (id) => { record.sceneTabs.push(['close', id]); },
    addTab: () => { record.sceneTabs.push(['add']); },
    layerMenu: (id) => { record.sceneTabs.push(['layers', id]); },
  });
  sceneTabs.refresh();
  await board.load(map);

  // Atlas's initiative tracker, as the board's tab runs it on a map in the file: each change shown at once.
  const shownMap = (): BoardMap => (board as unknown as { map: BoardMap }).map;
  /** The dice land on these, in turn: the rolls are known. */
  const landings = [0.9, 0.1, 0.5, 0.3, 0.7];
  let landing = 0;
  const act = (action: InitiativeAction): void => {
    record.initiative.push(action);
    const now = shownMap();
    now.initiative = applyInitiative(now.initiative, action, () => landings[landing++ % landings.length]!);
    panel.render();
  };
  const changeShown = (id: string, fields: Partial<BoardToken>): void => {
    const now = shownMap().tokens.find((t) => t.id === id);
    if (now) board.changeToken(id, { ...now, ...fields });
    panel.render();
  };
  const panel = new InitiativePanel(container, {
    state: () => shownMap().initiative,
    rules: () => rules.initiative,
    tokens: () => shownMap().tokens,
    hasToken: (id) => shownMap().tokens.some((t) => t.id === id),
    tokenSettings: () => shownMap().tokenSettings,
    definitions: () => rules.definitions,
    imageUrl: (path) => images[path] ?? '',
    icon: (element, name) => { element.dataset.icon = name; },
    roll: (entryId) => act({ type: 'roll', roll: rules.initiative.roll, statblockModifiers: {}, ...(entryId !== undefined && { entryId }) }),
    act,
    offers: () => true,
    setHidden: (id, hidden) => { record.initiative.push(['hidden', id, hidden]); changeShown(id, { hidden }); },
    setSide: (id, side) => { record.initiative.push(['side', id, side]); changeShown(id, { side }); },
    showToken: (id) => { record.shown.push(id); board.showToken(id); },
    menu: (entries, at) => {
      menu?.close();
      menu = new AtlasMenu(document, entries, at, (element, name) => { element.dataset.icon = name; }, () => { menu = null; });
    },
  });
  // The tab's keys: I shows or hides the tracker; the arrows step the turns while it shows a running fight.
  container.addEventListener('keydown', (event) => {
    if (menu?.isOpen || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).tagName === 'INPUT') return;
    if (event.key.toLowerCase() === 'i') { panel.setOpen(!panel.isOpen); board.refreshToolbar(); }
    else if (panel.isOpen && shownMap().initiative.isActive && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      act({ type: event.key === 'ArrowUp' ? 'previous' : 'next' });
      panel.press(event.key === 'ArrowUp' ? 'prev' : 'next');
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  const view = (board as unknown as { view: THREE.PerspectiveCamera }).view;
  /** Where a point of the map (`height` above the board) is on the page. */
  const project = (x: number, y: number, height = 0): { x: number; y: number } => {
    const point = new THREE.Vector3(x, height, y).project(view);
    const rect = board.canvas.getBoundingClientRect();
    return { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height };
  };
  /** Physical dice on the board: a table made on first use, a roll of `dice` thrown with `flick`, each die settled into the session. */
  const dice: { table: DiceTable | null; session: RollSession | null; readings: Array<{ id: number; face: number | null; caught: boolean }>; throwRoll(counts: RollRequest['dice'], flick: Flick): void } = {
    table: null,
    session: null,
    readings: [],
    throwRoll(counts, flick) {
      if (!this.table) {
        const pack = vendoredPack();
        const textures = new DiceTextures(pack, document, () => board.wake(true));
        this.table = new DiceTable({ ...board.diceHost(), pack: () => pack.config, textures: (type, color) => textures.textures(type, color) }, { dieSquares: 0.6, tolerance: 0.3, motionThreshold: 2, shadows: true, highlight: true, highlightColor: '#ffd700' });
        board.attachDice(this.table);
      }
      const session = new RollSession({ dice: counts, modifier: 0 }, DEFAULT_RULES);
      this.session = session;
      this.readings = [];
      this.table.onSettled = (id, reading) => { this.readings.push({ id, face: reading.face, caught: reading.caught }); session.settle(id, reading); };
      this.table.throwRoll(session, flick);
    },
  };
  // The GM's dice as the board's tab makes them, logging rolls on a stand-in Atlas map view of this map.
  const atlasRolls: Array<[string, unknown]> = [];
  // A stand-in Atlas map view with a bus that tells its listeners; `otherAtlas()` makes a second one.
  const makeAtlas = () => {
    const listeners = new Set<(roll: unknown) => void>();
    const bus = {
      emit: (event: string, roll: unknown) => { atlasRolls.push([event, roll]); if (event === 'dice-rolled') for (const listener of [...listeners]) listener(roll); },
      on: (event: string, listener: (roll: unknown) => void) => { if (event === 'dice-rolled') listeners.add(listener); },
      off: (event: string, listener: (roll: unknown) => void) => { if (event === 'dice-rolled') listeners.delete(listener); },
    };
    const view: MapViewLike = {
      getViewType: () => 'atlas-vtt',
      file: { path: map.path },
      atlasStore: { getState: () => ({ mapPath: map.path }) },
      serviceManager: { getEventBus: () => bus },
    };
    return { view, bus, listeners };
  };
  const first = makeAtlas();
  let current = first.view;
  const atlasView = first.view;
  const atlasBus = first.bus;
  const atlasListeners = first.listeners;
  const otherAtlas = () => makeAtlas();
  const useAtlasView = (view: MapViewLike) => { current = view; };
  const diceWarnings: string[] = [];
  const boardDice = new BoardDice({
    board,
    container,
    mapPath: () => map.path,
    atlasView: () => current,
    settings: () => diceSettings,
    setSheetPinned: (pinned) => keep({ sheetPinned: pinned }),
    pack: () => vendoredPack(),
    warn: (message) => { diceWarnings.push(message); },
    // The hero's stat block, as Fantasy Statblocks would give it; markup in a note stays text.
    sheetOf: async (tokenId) => (tokenId === 'hero' ? buildSheet({
      name: 'Hero', size: 'Medium', type: 'humanoid', subtype: 'human', alignment: 'neutral good', ac: 16, hp: 27, hit_dice: '5d8 + 5', speed: '30 ft.',
      stats: [16, 12, 14, 10, 13, 8], saves: [{ strength: 5 }, { constitution: 4 }], skillsaves: [{ athletics: 5 }, { perception: 3 }],
      senses: 'passive Perception 13', languages: ['Common'], cr: '2',
      traits: [{ name: 'Second Wind', desc: 'Once per rest the hero regains 1d10 + 5 hit points. <img src=x onerror="window.sheetXss=1">' }],
      actions: [
        { name: 'Longsword', desc: 'Melee Weapon Attack: +5 to hit, reach 5 ft. Hit: 7 (1d8 + 3) slashing damage.' },
        { name: 'Hex', desc: 'Hit: 2d6 - 1d4 necrotic damage.' },
      ],
    }) : null),
  });
  // Atlas's Random tables window over the board (src/loot/LootWindow.tsx): one table note, listed for the map's collection
  // by a stand-in of Atlas's asset service on a stand-in Atlas map view (what src/atlasBridge.ts reaches).
  const lootNotes: Record<string, string> = { 'Tables.md': ['## Weather', '', '| d6 | Weather |', '| --- | --- |', '| 1-2 | Rain |', '| 3-4 | Fog |', '| 5-6 | Sun |', ''].join('\n') };
  const lootSaves: unknown[] = [];
  const lootFiles: Record<string, string> = {};
  const lootCollection = { randomTables: [{ path: 'Tables.md', index: 0, kind: 'text' }] };
  // Atlas's asset service as the asset manager reads it: one collection holding one goblin token, and a map with a scene on it.
  const goblinAsset = { id: 'tok-goblin', type: 'token', name: 'Goblin', imagePath: 'art/goblin.png', size: 1, collection: 'col1', tags: [], createdAt: 1, modifiedAt: 1 };
  const coveScene = { id: 'scene-cove', type: 'scene', name: 'Cove', collection: 'col1', tags: [], createdAt: 1, modifiedAt: 1, data: { mapPath: 'maps/cove.atlasmap' } };
  const coveMap = { id: 'map-cove', type: 'map', name: 'Cove map', mapFilePath: 'art/cove.png', collection: 'col1', tags: [], createdAt: 1, modifiedAt: 1 };
  const libraryAssets = [goblinAsset, coveScene, coveMap];
  // The scene's map file, as Atlas saves it: its background is the map's image (how Atlas finds a map's scenes).
  const sceneFiles: Record<string, string> = { 'maps/cove.atlasmap': JSON.stringify({ version: 1, state: { background: 'art/cove.png' } }) };
  const sceneFile = (path: string): TFile => Object.assign(new TFile(path), { stat: { mtime: 1, ctime: 1, size: sceneFiles[path]!.length } });
  const openedMaps: string[] = [];
  const lootAssets = {
    initialize: async () => {},
    getCollectionForMap: () => 'col1', getCollectionSettings: () => lootCollection, updateCollectionSettings: async () => {},
    getCollections: async () => [{ id: 'col1', name: 'col1' }], getDefaultCollectionId: () => 'col1',
    getAssets: async (_collection?: string, type?: string) => libraryAssets.filter((asset) => !type || asset.type === type),
    getAssetById: async (id: string) => libraryAssets.find((asset) => asset.id === id) ?? null,
    getCollectionTags: async () => [], refreshMetadata: async () => {},
  };
  const lootAtlasView = {
    viewId: 'atlas', atlasStore: { getState: () => ({ mapPath: 'maps/tavern.atlasmap', remoteView: null }), subscribe: () => () => {} },
    serviceManager: { getAssetService: () => lootAssets },
  };
  const noRef = { off: () => {} };
  const lootApp = {
    vault: {
      getFileByPath: (path: string) => (path in lootNotes ? new TFile(path) : null),
      getAbstractFileByPath: (path: string) => (path in lootNotes ? new TFile(path) : path in sceneFiles ? sceneFile(path) : null),
      getFolderByPath: (path: string) => new TFolder(path),
      cachedRead: async (file: TFile) => lootNotes[file.path] ?? sceneFiles[file.path] ?? '',
      read: async (file: TFile) => lootNotes[file.path] ?? '',
      on: () => noRef, offref: () => {},
      createFolder: async () => {},
      create: async (path: string, text: string) => { lootFiles[path] = text; return new TFile(path); },
      process: async (file: TFile, edit: (text: string) => string) => { lootFiles[file.path] = edit(lootFiles[file.path] ?? ''); },
      adapter: { exists: async () => false, read: async () => '' },
    },
    metadataCache: { getFileCache: () => ({}), getFirstLinkpathDest: () => null, on: () => noRef, offref: () => {} },
    workspace: { getLeavesOfType: (type: string) => (type === 'atlas-vtt' ? [{ view: lootAtlasView }] : []), on: () => noRef, offref: () => {}, getLeaf: () => null, openLinkText: async () => {}, revealLeaf: async () => {}, setActiveLeaf: () => {} },
    plugins: { plugins: {}, manifests: {} },
    loadLocalStorage: () => null, saveLocalStorage: () => {},
    keymap: { pushScope: () => {}, popScope: () => {} },
  };
  const loot = new LootWindow(container, { app: lootApp as never, readMap: async () => JSON.stringify({ state: {} }), save: async (_path, settings) => { lootSaves.push(settings); } });
  void loot.setMap('maps/tavern.atlasmap');
  // Atlas's asset manager over the board: spawned tokens go to this stand-in for Atlas's store (its `addTokens`), and are recorded.
  const spawnTokens: Record<string, Record<string, unknown>> = {};
  const spawnState = {
    mapPath: 'maps/tavern.atlasmap', mapLoaded: true, isMapLoading: false, objects: { tokens: spawnTokens },
    addTokens: (inputs: ReadonlyArray<Record<string, unknown>>): string[] => inputs.map((input) => {
      const id = typeof input.id === 'string' ? input.id : `tok_spawn_${Object.keys(spawnTokens).length + 1}`;
      spawnTokens[id] = { kind: 'token', ...input, id };
      return id;
    }),
  };
  const spawnView = { viewId: 'spawn', atlasStore: { getState: () => spawnState, subscribe: () => () => {} } };
  const spawnWriter = new TokenWriter({ views: () => [spawnView as never], held: async () => spawnState as never });
  const spawnHost: BoardSpawnHost = {
    leaf: {} as never, writer: spawnWriter, mapPath: () => 'maps/tavern.atlasmap', centre: () => board.viewCentre(),
    grid: () => map.grid, tokens: () => spawnTokens as never, select: () => {}, joinInitiative: async () => {}, openMap: async (path) => { openedMaps.push(path); },
  };
  const assets = new AssetWindow(container, lootApp as never, spawnHost);
  // A second asset window whose app has no Atlas view yet (Atlas's tab deferred, or the board opened first): what it logs
  // while it is made, and while its Open is refused, is kept for the 'asset manager without Atlas' feature.
  const assetErrors: string[] = [];
  const logError = console.error;
  console.error = (...parts: unknown[]) => { assetErrors.push(parts.map((part) => (part instanceof Error ? part.message : String(part))).join(' ')); logError(...parts); };
  const noAtlasAssets = new AssetWindow(container, { ...lootApp, workspace: { ...(lootApp as { workspace?: object }).workspace, getLeavesOfType: () => [] }, plugins: { plugins: {}, manifests: {} } } as never, spawnHost);
  const spawned = (): Record<string, { x: number; y: number; name: string }> => spawnTokens as never;
  // Atlas's command palette over the board: what each entry asks of the board is recorded.
  const paletteCalls: string[] = [];
  const paletteHost: PaletteHost = {
    selectTool: (tool) => { paletteCalls.push(`tool:${tool}`); if (tool === 'move' || tool === 'measure') board.goToToolbar(tool); },
    setDiceLogOpen: (open) => { paletteCalls.push(`diceLog:${open}`); if (open) boardDice.setLogOpen(true); },
    setLootRollerOpen: (open) => { paletteCalls.push(`loot:${open}`); if (open) loot.open(); },
    initiativeOpen: () => panel.isOpen,
    setInitiativeOpen: (open) => { paletteCalls.push(`initiative:${open}`); panel.setOpen(open); },
    openSceneBrowser: () => paletteCalls.push('sceneBrowser'),
    playerViewOpen: () => false, togglePlayerView: () => paletteCalls.push('playerView'), playerFrozen: () => false,
    togglePlayerFreeze: () => paletteCalls.push('freeze'), presentInAtlas: () => paletteCalls.push('present'), openInAtlas: (page) => paletteCalls.push(`atlas:${page ?? ''}`),
    tabletopCommands: () => tabletopCommands(board.toolbarActions(), () => board.refreshToolbar(), board.toolbarCommandHost()),
  };
  const palette = new PaletteWindow(container, lootApp as never, paletteHost, () => board.refreshToolbar());
  const hotkeyHelp = new HotkeyHelpWindow(container, lootApp as never);
  // Attach Atlas's toolbar tools (Random tables & Asset manager in Play mode; Command Palette rightmost in every mode).
  const runAtlasTool = (id: 'loot' | 'assets' | 'palette'): void => {
    if (id === 'loot') loot.toggle();
    else if (id === 'assets') assets.toggle();
    else palette.toggle();
    board.refreshToolbar();
  };
  board.setAtlasTools([
    { id: 'loot', label: 'Random tables', shortcut: 'L', enabled: () => true, active: () => loot.isOpen(), run: () => runAtlasTool('loot') },
    { id: 'assets', label: 'Asset manager', shortcut: 'Shift+A', enabled: () => true, active: () => assets.isOpen(), run: () => runAtlasTool('assets') },
    { id: 'palette', label: 'Command Palette', shortcut: 'Space', enabled: () => true, active: () => palette.isOpen(), run: () => runAtlasTool('palette') },
  ]);
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .atlas-tabletop-atlas-ui, .modal-container')) return;
    const id = boardKey(event, { carrying: board.carryingToken, typing: false, hotkeys: { lootRoller: 'l', assets: 'a', palette: 'Space' } });
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    runAtlasTool(id);
  }, true);
  // Atlas's own Ctrl-hover window, as BoardView routes it: its dice links throw the board's dice for the hovered hero.
  routeAtlasWindowRolls(document, (formula, label, side) => boardDice.cardRoll('hero', formula, label, side));
  // The cutscene studio over the board. Its host keeps cutscenes in memory; `switchMap` loads a second fixture map on the
  // same board (as BoardView gives the studio a new one) and tells the studio, as BoardView does.
  const crypt: BoardMap = { ...map, path: 'maps/crypt.atlasmap', tokens: map.tokens.slice(0, 2) };
  const cutsceneStore = new Map<string, Cutscene[]>();
  const cutsceneLog = {
    saves: [] as Array<{ mapPath: string; cutscene: Cutscene }>,
    notices: [] as string[],
    holds: [] as boolean[],
    asked: [] as string[],
    /** The names askName gives, in turn. */
    names: [] as string[],
    settings: { ...DEFAULT_CINEMATIC_SETTINGS } as CinematicSettings,
    switches: [] as string[],
    /** Each time the players' window was lent to a run (true) or given back (false). */
    lent: [] as boolean[],
  };
  let cutsceneMap = map.path;
  let cutsceneLevel: string | null = null;
  const studioHost: StudioHost = {
    board,
    mapPath: () => cutsceneMap,
    cutscenes: (mapPath) => cutsceneStore.get(mapPath) ?? [],
    save: (mapPath, cutscene) => {
      cutsceneLog.saves.push({ mapPath, cutscene: JSON.parse(JSON.stringify(cutscene)) as Cutscene });
      const list = cutsceneStore.get(mapPath) ?? [];
      cutsceneStore.set(mapPath, list.some((c) => c.id === cutscene.id) ? list.map((c) => (c.id === cutscene.id ? cutscene : c)) : [...list, cutscene]);
    },
    remove: (mapPath, id) => { cutsceneStore.set(mapPath, (cutsceneStore.get(mapPath) ?? []).filter((c) => c.id !== id)); },
    mapTabs: () => [map.path, crypt.path],
    // A place is a map, or a level of one (`cutsceneData.ts`): these checks' maps have no levels, so a level is only kept.
    place: () => placeAt(cutsceneMap, cutsceneLevel),
    at: (place) => place === placeAt(cutsceneMap, cutsceneLevel),
    showPlace: async (place) => {
      const mapPath = mapOfPlace(place);
      if (mapPath !== map.path && mapPath !== crypt.path) return false;
      if (place !== placeAt(cutsceneMap, cutsceneLevel)) {
        cutsceneLog.switches.push(place);
        const other = mapPath !== cutsceneMap;
        cutsceneMap = mapPath;
        cutsceneLevel = levelOfPlace(place);
        if (other) await board.load(mapPath === crypt.path ? crypt : map);
        studio.mapChanged();
      }
      return true;
    },
    settings: () => cutsceneLog.settings,
    setSettings: (changes) => { cutsceneLog.settings = readCinematicSettings({ ...cutsceneLog.settings, ...changes }); },
    askName: (initial) => { cutsceneLog.asked.push(initial); return Promise.resolve(cutsceneLog.names.shift() ?? null); },
    notice: (text) => { cutsceneLog.notices.push(text); },
    holdPlayers: (hold) => { cutsceneLog.holds.push(hold); board.holdPlayers(hold); },
    session: () => fakeSession as unknown as BoardSession,
    lendPlayers: (lend) => { cutsceneLog.lent.push(lend); },
    publishRun: (run) => { channel.publish(owner, run); },
  };
  // Connect's session as the run sees it: hosting follows `setHosting`; a test can take `cutscenes` away.
  const fakeSession: { hosting(): boolean; cutscenes: true | undefined } = { hosting: () => hosting, cutscenes: true };
  // `api.cutscene`, as main.ts makes it: one channel, with this studio as the owner of its run.
  const channel = new CutsceneChannel();
  const owner = { end: () => studio.endRun(), dispose: () => studio.endRunNow(), liveCamera: () => studio.liveCamera() };
  cutsceneCameraMoved = () => channel.cameraMoved(owner);
  const studio = new CutsceneStudio(container, studioHost);
  cinematicStudio = studio;
  board.cinemaButton({ live: () => studio.live, toggleLive: () => studio.toggleLive() });
  const cutsceneHarness = { studio, host: studioHost, store: cutsceneStore, log: cutsceneLog, first: map.path, second: crypt.path, session: fakeSession, channel, owner };
  // Painted backgrounds: a store over in-memory files with the real codec, and the editor mounted on demand in an
  // overlay. "Isle" and "Badlands" are made the first time they are needed (`backgroundsReady()`), not at boot:
  // writing a background encodes six million pixels, which would slow every other feature's page.
  const backgroundFiles = new Map<string, ArrayBuffer | string>();
  const under = (folder: string): string[] => [...backgroundFiles.keys()].filter((path) => path.startsWith(`${folder}/`));
  const backgrounds = new BackgroundStore({
    read: async (path) => { const value = backgroundFiles.get(path); return value instanceof ArrayBuffer ? value.slice(0) : null; },
    readText: async (path) => { const value = backgroundFiles.get(path); return typeof value === 'string' ? value : null; },
    write: async (path, data) => { backgroundFiles.set(path, typeof data === 'string' ? data : data.slice(0)); },
    folders: async (root) => [...new Set([...backgroundFiles.keys()].filter((path) => path.startsWith(`${root}/`)).map((path) => `${root}/${path.slice(root.length + 1).split('/')[0]}`))],
    remove: async (folder) => { for (const path of under(folder)) backgroundFiles.delete(path); },
    rename: async (from, to) => { for (const path of under(from)) { backgroundFiles.set(`${to}${path.slice(from.length)}`, backgroundFiles.get(path) as ArrayBuffer | string); backgroundFiles.delete(path); } },
  }, {
    encode: (layer, size) => encodeLayer(layer, size, document),
    decode: (bytes, size) => decodeLayer(bytes, size),
    thumbnail: (layers) => renderThumbnail(layers, document),
  });
  let seeded: Promise<void> | null = null;
  const backgroundsReady = (): Promise<void> => (seeded ??= (async () => { await backgrounds.create('Isle'); await backgrounds.create('Badlands'); })());
  const refreshBackgroundList = (): void => {
    backgrounds.list()
      .then((list) => { backgroundList = list.map(({ folder, name }) => ({ folder, name })); board.refreshToolbar(); })
      .catch((error) => { console.warn('Harness: the background list could not be read:', error); });
  };
  backgrounds.onChange(refreshBackgroundList);
  let backgroundOverlay: HTMLDivElement | null = null;
  let backgroundEditor: BackgroundEditor | null = null;
  const closeBackgroundEditor = (): void => {
    backgroundEditor?.dispose();
    backgroundOverlay?.remove();
    backgroundEditor = null;
    backgroundOverlay = null;
    (window as unknown as { boardTest: { backgroundEditor: BackgroundEditor | null } }).boardTest.backgroundEditor = null;
  };
  const openBackgroundEditor = async (folder: string | null = null): Promise<BackgroundEditor> => {
    await backgroundsReady();
    closeBackgroundEditor();
    backgroundOverlay = document.createElement('div');
    backgroundOverlay.style.cssText = 'position:fixed;inset:0;z-index:50;background:#1e1e1e';
    document.body.appendChild(backgroundOverlay);
    const editor = new BackgroundEditor(backgroundOverlay, {
      store: backgrounds,
      materials: host.materials,
      props: () => [{ path: 'props/barrel.glb', name: 'barrel', thumb: null }, { path: 'props/crate.glb', name: 'crate', thumb: null }, { path: 'props/tree.glb', name: 'tree', thumb: null }, { path: 'props/rock.glb', name: 'rock', thumb: null }],
      thumbnail: async (path) => { const bytes = backgroundFiles.get(path); return bytes instanceof ArrayBuffer ? URL.createObjectURL(new Blob([bytes], { type: 'image/png' })) : null; },
    });
    backgroundEditor = editor;
    (window as unknown as { boardTest: { backgroundEditor: BackgroundEditor | null } }).boardTest.backgroundEditor = editor;
    await editor.open(folder);
    return editor;
  };
  Object.assign(window, { boardTest: { hotkeyHelp, backgrounds, backgroundFiles, backgroundsReady, backgroundKit: { DEFAULT_BACKGROUND, emptyLayers, TERRAINS, backgroundFrame }, openBackgroundEditor, closeBackgroundEditor, backgroundEditor: null, studio: cutsceneHarness, api: { cutscene: channel },Board, FreeCamera, host, sounds, SoundEngine, CustomSounds, CATALOG, loadSound, DEFAULT_SOUND_SETTINGS, controlled, mountSoundControl, webSound, materialDrag, setHeroBase: (base: 'none' | 'round' | 'square') => { heroBase = base; board.refresh(); }, readMap, renderBoardCard, images, boardDice, atlasBus, atlasListeners, otherAtlas, useAtlasView, atlasRolls, diceWarnings, setHosting: (on: boolean) => { hosting = on; board.refreshToolbar(); }, setSpellNotes, setLiquids, liquids: () => liquids, keptMeasures: () => keptMeasures, clearKeptMeasures: () => { keptMeasures = []; syncKeptMeasures(); }, measureTool: () => measureTool, handoutUrl: images['green.png'], board, history, map, record, snapping, panel, rules, doorProps, doorFlips, wallHeights, windowSpans, wallWidthsKept, modes, props, shapes, groundState, stored, project, hero, QUALITY, Raycaster: THREE.Raycaster, Vector3: THREE.Vector3, Box3: THREE.Box3, Matrix4: THREE.Matrix4, Quaternion: THREE.Quaternion, insideFog, dice, loot, lootSaves, lootFiles, assets, noAtlasAssets, assetErrors, hostBar, mapName, HOST_BAR_LABELS, spawned, openedMaps, palette, paletteCalls, chooseAction, ready: true } });
}

main().catch((error: unknown) => { (window as unknown as { boardError: string }).boardError = String(error); console.error(error); });
