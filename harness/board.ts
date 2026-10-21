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
import { insideFog } from '../src/board/playerView';
import { AtlasMenu } from '../src/board/atlasMenu';
import { tokenMenuEntries } from '../src/board/tokenMenu';
import { conditionChange, conditionStep, resetChange } from '../src/board/tokenEdits';
import { defeatedResources } from '../src/board/resources';
import { HP_RESOURCE, type ResourceDefinition, type ResourceValue } from '../src/board/resources';
import { applyInitiative, readInitiative, type InitiativeAction } from '../src/board/initiative';
import { InitiativePanel } from '../src/board/initiativePanel';
import type { BoardWall } from '../src/board/walls';
import type { LoadedMaterial } from '../src/materials';
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
  showNameplate: true, conditions: [], conditionValues: {}, resources: {}, overriddenMax: [], instanceNumber: null, statblockPath: null, side: null, sees: false, offMap: false, ...over,
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
    token({ id: 'fallenDisc', x: 1225, y: 525, imagePath: 'green.png', name: 'Fallen disc', resources: { hp: { current: 0, max: 9 } } }),
  ],
  rawGrid: null,
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
    { id: 'd1', points: [{ x: 160, y: 520 }, { x: 260, y: 560 }, { x: 330, y: 520 }, { x: 420, y: 600 }], color: '#d13b3b', width: 8, opacity: 1 },
    { id: 'd2', points: [{ x: 600, y: 120 }, { x: 760, y: 120 }, { x: 760, y: 220 }, { x: 600, y: 220 }, { x: 600, y: 120 }], color: '#3b7dd1', width: 5, opacity: 0.6 },
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
  const hero: LoadedMini = await parseMini(await heroGlb());
  const barrel: LoadedMini = await parseMini(await barrelGlb());
  const images: Record<string, string> = { 'bg.png': background, 'red.png': face('#b03030'), 'green.png': face('#3a8a3a') };
  const props: PropPlacement[] = [{ id: 'barrel', glb: 'props/barrel.glb', x: 910, y: 805, rotation: 0, scale: 1 }];
  const record = {
    moves: [] as Array<[string, number, number]>, propMoves: [] as Array<[string, number, number]>, added: [] as Array<[string, number, number]>,
    notes: [] as string[], menus: [] as string[], propMenus: [] as string[], previews: [] as string[], warnings: [] as string[],
    copies: [] as Array<[string, string, number, number]>, menuActions: [] as unknown[][], initiative: [] as unknown[], shown: [] as string[],
    heights: [] as unknown[][], doors: [] as string[], wallMenus: [] as string[], paints: [] as Array<[string, string, boolean]>, lightMenus: [] as string[], ambients: [] as number[], lasers: [] as Array<Record<string, unknown>>, fogHeights: [] as number[], thicknesses: [] as number[],
    /** Resource edits as the host saved them: token, key, the value it held, the value written, max edited. */
    edits: [] as Array<[string, string, ResourceValue, ResourceValue, boolean]>,
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
  let wallThickness = 0.12;
  const wallPaint = new Map<string, string>();
  const doorProps = new Map<string, string>();
  const wallHeights = new Map<string, number>();
  const lightHeights = new Map<string, number>();
  let ambientLevel = 1;
  let menu: AtlasMenu | null = null;
  const initiative = new Set<string>();
  let players: Window | null = null;
  let laser = { color: '#ff0059', size: 16 };
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
        inInitiative: () => initiative.has(id), hasMini: () => id === 'hero' || id === 'fallen', standee: () => id === 'gob',
        lightHeight: () => (id === 'gob2' ? 1 : null),
        icon: (element, name) => { element.dataset.icon = name; },
        actions: {
          setCondition: (condition, active) => { record.menuActions.push(['condition', condition, active]); conditions(conditionChange(token()!, condition, active)); },
          stepCondition: (condition, delta) => { record.menuActions.push(['step', condition, delta]); conditions(conditionStep(token()!, condition, delta)); },
          setHidden: (hidden) => { record.menuActions.push(['hidden', hidden]); change({ hidden }); },
          setInitiative: (join) => { record.menuActions.push(['initiative', join]); if (join) initiative.add(id); else initiative.delete(id); },
          assignMini: () => record.menuActions.push(['assignMini']),
          removeMini: () => record.menuActions.push(['removeMini']),
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
    editResource: (id, key, edit, maxEdited) => {
      const held = stored.get(id)?.[key];
      if (!held) return;
      const next = edit(held);
      stored.get(id)![key] = next;
      record.edits.push([id, key, held, next, maxEdited]);
    },
    fogHeight: () => fogHeight,
    setFogHeight: (height) => { fogHeight = height; record.fogHeights.push(height); board.refresh(); },
    wallThickness: () => wallThickness,
    setWallThickness: (thickness) => { wallThickness = thickness; record.thicknesses.push(thickness); board.refresh(); },
    measurement: () => ({ mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', bands: [] }),
    warn: (message) => { if (!record.warnings.includes(message)) record.warnings.push(message); },
    // A popup window stands in for Obsidian's pop-out: same process, another document.
    togglePlayerView: () => {
      if (players && !players.closed) {
        board.detachPlayer();
        players.close();
        players = null;
      } else {
        players = window.open('', 'players', 'width=640,height=400');
        if (!players) return;
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
    initiativeOpen: () => panel.isOpen,
    toggleInitiative: () => panel.setOpen(!panel.isOpen),
    wallMaterial: (id) => wallPaint.get(id) ?? null,
    wallHeight: (id) => wallHeights.get(id) ?? null,
    setWallHeight: (id, squares, whole) => { record.heights.push(['wall', id, squares, whole]); wallHeights.set(id, squares); board.refresh(); },
    setLightHeight: (id, squares) => { record.heights.push(['light', id, squares]); lightHeights.set(id, squares); board.refresh(); },
    doorProp: (id) => doorProps.get(id) ?? null,
    readMaterial: async () => brickMaterial(),
    toggleDoor: (id) => { record.doors.push(id); },
    wallMenu: (id) => { record.wallMenus.push(id); },
    paintWall: (id, material, whole) => {
      record.paints.push([id, material, whole]);
      const walls = (board as unknown as { map: BoardMap }).map.walls;
      const chain = walls.find((w) => w.id === id)?.chain;
      for (const w of whole && chain ? walls.filter((other) => other.chain === chain) : walls.filter((other) => other.id === id)) wallPaint.set(w.id, material);
      board.refresh();
    },
    ambient: () => ambientLevel,
    setAmbient: (level) => { ambientLevel = level; record.ambients.push(level); board.refresh(); },
    lightHeight: (light) => lightHeights.get(light.id) ?? 1,
    lightMenu: (id) => { record.lightMenus.push(id); },
  };
  const container = document.getElementById('board')!;
  const board = new Board(container, host, QUALITY.medium);
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
    if (event.key.toLowerCase() === 'i') panel.setOpen(!panel.isOpen);
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
  Object.assign(window, { boardTest: { board, map, record, panel, rules, doorProps, wallHeights, stored, project, hero, QUALITY, Raycaster: THREE.Raycaster, Vector3: THREE.Vector3, insideFog, ready: true } });
}

main().catch((error: unknown) => { (window as unknown as { boardError: string }).boardError = String(error); console.error(error); });
