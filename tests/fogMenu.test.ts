import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import type { App } from 'obsidian';
import { AtlasBridge } from '../src/atlasBridge';
import { Board } from '../src/board/board';
import { BoardAtlasTools } from '../src/board/boardAtlasTools';
import { readFog, type FogOperation } from '../src/board/fog';
import { fogMenuAt, fogMenuEntries, type FogMenuActions, type FogMenuHit } from '../src/board/fogMenu';
import { FogTool, type FogOffers, type FogToolDeps } from '../src/board/fogTool';
import type { MenuEntry } from '../src/board/atlasMenu';

const ALL: FogOffers = { add: true, clear: true, cover: true, hideRooms: true, reveal: true, hide: true, forget: true };
const square = (x: number, y: number, size: number): { x: number; y: number }[] => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];

/** Atlas's fog record as a map file holds it, read as the board reads it. */
function fogOf(entries: Array<Record<string, unknown>>): FogOperation[] {
  return readFog(Object.fromEntries(entries.map((entry) => [entry.id as string, { kind: 'fog', ...entry }])));
}
/** Fog painted over a 400 square; a lasso erased from it that is remembered as revealed fog (`area`); a plain erase. */
const painted = { id: 'fog_a', timestamp: 1, isErasing: false, type: 'rectangle', x: 100, y: 100, width: 400, height: 400 };
const revealed = { id: 'fog_b', timestamp: 2, isErasing: true, type: 'lasso', points: square(200, 200, 100), area: {} };
const plainErase = { id: 'fog_c', timestamp: 3, isErasing: true, type: 'lasso', points: square(400, 400, 50) };

test('a right-click on fog hits the whole body of fog under it; off fog, or in a plain hole, there is no menu', () => {
  const hit = fogMenuAt(fogOf([painted]), { x: 150, y: 150 });
  assert.equal(hit?.kind, 'fog');
  assert.equal(fogMenuAt(fogOf([painted]), { x: 50, y: 50 }), null);
  assert.equal(fogMenuAt(fogOf([painted, plainErase]), { x: 420, y: 420 }), null);
  const body = (hit as Extract<FogMenuHit, { kind: 'fog' }>).body;
  assert.ok(body.length >= 4);
  assert.deepEqual(hit?.outlines, [body]);
});

test('on the open ground of fog revealed from the menu the hit is that revealed area, by its id', () => {
  const hit = fogMenuAt(fogOf([painted, revealed]), { x: 250, y: 250 });
  assert.deepEqual(hit && { kind: hit.kind, id: (hit as { id?: string }).id }, { kind: 'area', id: 'fog_b' });
  assert.equal(hit?.outlines[0]?.length, 4);
  // Fog painted over the area again is fog to reveal or delete, not an area to hide.
  const covered = fogOf([painted, revealed, { id: 'fog_d', timestamp: 3, isErasing: false, type: 'rectangle', x: 150, y: 150, width: 200, height: 200 }]);
  assert.equal(fogMenuAt(covered, { x: 250, y: 250 })?.kind, 'fog');
  // Ground erased without the mark is plain ground; a marked operation that paints is no area.
  assert.equal(fogMenuAt(fogOf([painted, { ...revealed, area: undefined }]), { x: 250, y: 250 }), null);
  assert.equal(fogMenuAt(fogOf([{ ...revealed, isErasing: false, id: 'fog_e' }]), { x: 600, y: 600 }), null);
});

test('fog that touches is one body, whatever painted it', () => {
  const two = fogOf([painted, { id: 'fog_f', timestamp: 2, isErasing: false, type: 'lasso', points: square(450, 100, 200) }]);
  const a = fogMenuAt(two, { x: 150, y: 150 }) as Extract<FogMenuHit, { kind: 'fog' }>;
  const b = fogMenuAt(two, { x: 600, y: 150 }) as Extract<FogMenuHit, { kind: 'fog' }>;
  assert.deepEqual(a.body, b.body);
  assert.equal(fogMenuAt(two, { x: 700, y: 150 }), null);
});

function actions(offers: Partial<FogOffers>, log: string[], now: () => FogMenuHit | null): FogMenuActions {
  return {
    offers: () => ({ ...ALL, ...offers }), now,
    reveal: (outlines) => log.push(`reveal ${outlines.length}`),
    erase: (body) => log.push(`erase ${body.length}`),
    hide: (id) => log.push(`hide ${id}`),
    forget: (id) => log.push(`forget ${id}`),
  };
}
const labels = (entries: MenuEntry[]): string[] => entries.map((entry) => (entry.type === 'item' ? `${entry.label}${entry.destructive ? '!' : ''}` : entry.type));
const fogHit = fogMenuAt(fogOf([painted]), { x: 150, y: 150 })!;
const areaHit = fogMenuAt(fogOf([painted, revealed]), { x: 250, y: 250 })!;

test("the menu on fog is Atlas's: Reveal, then Delete as a destructive row; each acts on the body as it is when chosen", () => {
  const log: string[] = [];
  const entries = fogMenuEntries(fogHit, actions({}, log, () => fogHit));
  assert.deepEqual(labels(entries), ['Reveal', 'Delete!']);
  for (const entry of entries) if (entry.type === 'item') entry.onClick();
  assert.deepEqual(log, ['reveal 1', `erase ${(fogHit as { body: unknown[] }).body.length}`]);
  // The fog was gone by the time a row was chosen: nothing is written.
  const gone: string[] = [];
  for (const entry of fogMenuEntries(fogHit, actions({}, gone, () => null))) if (entry.type === 'item') entry.onClick();
  assert.deepEqual(gone, []);
});

test('the menu on revealed ground is Hide, then Delete (forget), by the area id', () => {
  const log: string[] = [];
  const entries = fogMenuEntries(areaHit, actions({}, log, () => areaHit));
  assert.deepEqual(labels(entries), ['Hide', 'Delete!']);
  for (const entry of entries) if (entry.type === 'item') entry.onClick();
  assert.deepEqual(log, ['hide fog_b', 'forget fog_b']);
});

test('an Atlas without an action leaves its row out; a menu with no row is none', () => {
  assert.deepEqual(labels(fogMenuEntries(fogHit, actions({ reveal: false }, [], () => fogHit))), ['Delete!']);
  assert.deepEqual(labels(fogMenuEntries(fogHit, actions({ add: false }, [], () => fogHit))), ['Reveal']);
  assert.deepEqual(labels(fogMenuEntries(areaHit, actions({ hide: false }, [], () => areaHit))), ['Delete!']);
  assert.deepEqual(labels(fogMenuEntries(areaHit, actions({ hide: false, forget: false }, [], () => areaHit))), []);
  assert.deepEqual(labels(fogMenuEntries(fogHit, actions({ reveal: false, add: false }, [], () => fogHit))), []);
});

function toolWith(options: { fogKey?: () => string; commits?: unknown[][] } = {}): FogTool {
  const deps = {
    parent: new THREE.Group(), canvas: () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement,
    boardPoint: (x: number, y: number) => ({ x, y }), unitsPerPixel: () => 1, fogKey: options.fogKey ?? (() => 'a'), mapSize: () => ({ width: 1000, height: 800 }),
    commit: (operations) => { options.commits?.push(operations); }, changed: () => {}, wake: () => {}, walls: () => [], grid: () => null, mapRect: () => null, notice: () => {},
    switchOn: () => false, accent: () => '#7c5cff',
  } satisfies FogToolDeps;
  return new FogTool(deps);
}

test("the fog menu's mark is outlined in the accent while open, and goes when the fog changes or the tool is put down", () => {
  let key = 'a';
  const fog = toolWith({ fogKey: () => key });
  fog.setOn(true);
  fog.showTarget(fogHit.outlines);
  assert.equal(fog.targetView.shown.includes('fog-mark-line'), true);
  assert.equal(fog.targetView.current?.accent, true);
  fog.fogDrawn();
  assert.equal(fog.targetView.shown.length > 0, true);
  key = 'b';
  fog.fogDrawn();
  assert.deepEqual(fog.targetView.shown, []);
  fog.showTarget(areaHit.outlines);
  assert.equal(fog.targetView.shown.length > 0, true);
  fog.showTarget(null);
  assert.deepEqual(fog.targetView.shown, []);
  fog.showTarget(areaHit.outlines);
  fog.setOn(false);
  assert.deepEqual(fog.targetView.shown, []);
});

/** Enter, Backspace, Escape and the undo key through the real keydown route of the board's Atlas tools (`BoardAtlasTools.key`), on a real fog tool. */
test('a polygon takes Enter, Backspace and the undo key through BoardAtlasTools.key, before the undo history', () => {
  const commits: unknown[][] = [];
  const fog = toolWith({ commits });
  fog.setOn(true);
  fog.setShape('polygon');
  const none = { shift: false, ctrl: false };
  const corner = (x: number, y: number): void => { fog.down(x, y, none, false); fog.up(x, y, none, false); };
  // The board's own `fogKey`, on a stand-in holding this tool (the rest of the board is not needed to route a key).
  const board = { audience: 'gm', fogTool: fog, carryingToken: false, ownsKey: () => false };
  Object.assign(board, { fogKey: (event: Pick<KeyboardEvent, 'key' | 'repeat'>, undo = false) => Board.prototype.fogKey.call(board as unknown as Board, event, undo) });
  let undone = 0;
  const tools = Object.create(BoardAtlasTools.prototype) as BoardAtlasTools;
  Object.assign(tools, { bridge: new AtlasBridge({} as App), deps: { board: () => board, undo: () => { undone += 1; }, redo: () => {} } });
  const keydown = (init: Partial<KeyboardEvent>): boolean => tools.key({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...init } as KeyboardEvent, false);

  corner(100, 100); corner(300, 100); corner(300, 300); corner(200, 400);
  assert.equal(fog.drawing, true);
  // The undo key (Ctrl/Cmd + Z) drops the last corner and never reaches Tabletop's undo history while corners wait.
  assert.equal(keydown({ key: 'z', code: 'KeyZ', ctrlKey: true }), true);
  assert.equal(undone, 0);
  assert.equal(fog.drawing, true);
  // Backspace drops another; a corner placed again, Enter closes the three as one lasso.
  assert.equal(keydown({ key: 'Backspace', code: 'Backspace' }), true);
  corner(260, 450);
  assert.equal(keydown({ key: 'Enter', code: 'Enter' }), true);
  assert.equal(fog.drawing, false);
  assert.equal(commits.length, 1);
  assert.equal((commits[0]![0] as { points: unknown[] }).points.length, 3);
  // With nothing under way the undo key is Tabletop's.
  assert.equal(keydown({ key: 'z', code: 'KeyZ', ctrlKey: true }), true);
  assert.equal(undone, 1);
  // Escape drops a polygon under way.
  corner(10, 10);
  assert.equal(fog.drawing, true);
  assert.equal(keydown({ key: 'Escape', code: 'Escape' }), true);
  assert.equal(fog.drawing, false);
});
