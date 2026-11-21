/**
 * What becomes an undo step (src/board/undoHistory.ts), and how it is taken back:
 * - Tabletop's own data of a map (water, props, wall heights and materials, door flips, scene placements, minis):
 *   every change is recorded from the stores themselves, as snapshots of the map's record before and after.
 * - A map file Tabletop wrote (Atlas does not hold the map): the text before and after; undone only while the file
 *   still holds what Tabletop wrote.
 * - A change Atlas took into its store (it holds the map): the steps it added to Atlas's own history, undone there
 *   while nothing else was added to it since.
 */
import type { Assignments } from '../assignments';
import type { BoardData, MapData } from './boardData';
import type { TokenWriter } from './tokenWriter';
import type { AtlasTemporal, AtlasView } from '../atlas';
import type { UndoHistory, UndoStep } from './undoHistory';

/** Board data that a slider or picker changes many times in one gesture: such changes fold into one step. */
const GESTURE_KEYS = new Set(['ambient', 'tint', 'fogHeight', 'wallThickness', 'placement', 'waterLook']);

function changedKeys(before: object | undefined, after: object | undefined): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => a[key] !== b[key] && JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  // Water whose mask stayed changed only its look or motion (sliders, swatches): a gesture of its own.
  const mask = (water: unknown): string => JSON.stringify((water as { mask?: unknown } | undefined)?.mask ?? null);
  return keys.map((key) => (key === 'water' && a.water && b.water && mask(a.water) === mask(b.water) ? 'waterLook' : key));
}

const LABELS: Record<string, string> = {
  water: 'water', waterLook: 'water look', props: 'props', wallHeights: 'wall height', wallWidths: 'wall width', windows: 'window', wallMaterials: 'wall material', lightHeights: 'light height',
  styles: 'token style', placement: 'scene placement', hidden: 'layer visibility', ambient: 'ambient light', tint: 'light tint',
  fogHeight: 'fog height', wallThickness: 'wall thickness', doorFlips: 'door',
};

/** A snapshot step of one store's record of a map. */
function snapshotStep<T extends object>(path: string, label: string, before: T | undefined, after: T | undefined, put: (value: T | undefined) => void, mergeKey?: string): UndoStep {
  const step: UndoStep = {
    paths: [path], label,
    undo: () => { put(before); return true; },
    redo: () => { put(after); return true; },
    ...(mergeKey && { mergeKey, merge: (earlier: UndoStep): UndoStep => snapshotStep(path, label, (earlier as { before?: T }).before, after, put, mergeKey) }),
  };
  return Object.assign(step, { before });
}

/** Records every change of Tabletop's own data of a map. Returns the unsubscribe. */
export function recordTabletopData(history: UndoHistory, boardData: BoardData, assignments: Assignments): () => void {
  let boards = { ...boardData.toJSON() } as Record<string, MapData | undefined>;
  let minis = { ...assignments.toJSON() } as Record<string, object | undefined>;
  const stopBoard = boardData.onChange((path) => {
    if (path === null) { boards = { ...boardData.toJSON() }; return; }
    const before = boards[path];
    const after = boardData.snapshot(path);
    boards[path] = after;
    if (history.travelling || before === after) return;
    // A migration's bookkeeping (the 3D settings moved onto Atlas's records) is nothing the GM did: no step to take back.
    if (after?.extrasMoved === true && before?.extrasMoved !== true) return;
    if (after?.roomWallsMoved === true && before?.roomWallsMoved !== true) return;
    if (after?.waterMoved === true && before?.waterMoved !== true) return;
    const keys = changedKeys(before, after);
    if (keys.length === 0) return;
    const label = keys.map((key) => LABELS[key] ?? key).join(', ');
    const gesture = keys.every((key) => GESTURE_KEYS.has(key)) ? `board:${path}:${keys.join(',')}` : undefined;
    history.push(snapshotStep(path, label, before, after, (value) => boardData.restore(path, value), gesture));
  });
  const stopMinis = assignments.onChange((path) => {
    if (path === null) { minis = { ...assignments.toJSON() }; return; }
    const before = minis[path];
    const after = assignments.snapshot(path);
    minis[path] = after;
    if (history.travelling || before === after || JSON.stringify(before) === JSON.stringify(after)) return;
    const turnsOnly = changedKeys(before, after).length === 1;
    history.push(snapshotStep(path, 'mini', before, after, (value) => assignments.restore(path, value as never), turnsOnly ? `minis:${path}:${changedKeys(before, after)[0]}` : undefined));
  });
  return () => { stopBoard(); stopMinis(); };
}


type AtlasHistory = AtlasTemporal;

function historyOf(view: AtlasView | null): AtlasHistory | null {
  const temporal = view?.atlasStore.temporal;
  return temporal && typeof temporal.getState === 'function' ? temporal : null;
}

/** The writer's methods that may change a map Atlas holds. */
const WRITES = ['move', 'moveMany', 'rotate', 'copy', 'resource', 'update', 'initiative', 'initiativeAction', 'addTokensNow', 'lootRoller', 'toggleDoor', 'lockDoor', 'setWindow', 'kill', 'remove', 'addMeasure', 'removeMeasures', 'setWallExtras', 'setLightHeight', 'replaceLiquids', 'addFog', 'clearFog', 'coverAllFog', 'hideRooms'] as const;
const WRITE_LABELS: Partial<Record<(typeof WRITES)[number], string>> = {
  move: 'token move', moveMany: 'token move', rotate: 'token turn', copy: 'token copy', resource: 'resource', update: 'token',
  initiative: 'initiative', initiativeAction: 'initiative', addTokensNow: 'tokens added', lootRoller: 'loot', toggleDoor: 'door',
  lockDoor: 'door lock', setWindow: 'window', kill: 'token defeated', remove: 'token removed',
  addMeasure: 'spell or template', removeMeasures: 'spell or template removed',
  setWallExtras: 'wall', setLightHeight: 'light height', replaceLiquids: 'water',
  addFog: 'fog', clearFog: 'fog removed', coverAllFog: 'fog', hideRooms: 'fog',
};

/**
 * Records the steps the writer's changes added to Atlas's history, as one Tabletop step each. Atlas takes them
 * synchronously, so the steps added by the call are those its history gained by the time it returns.
 */
export function recordAtlasWrites(history: UndoHistory, writer: TokenWriter): void {
  const target = writer as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of WRITES) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function recorded(this: unknown, ...args: unknown[]): unknown {
      const path = args[0] as string;
      const atlas = historyOf(writer.holder(path));
      const startCount = atlas?.getState().pastStates.length ?? 0;
      const startTop = atlas?.getState().pastStates[startCount - 1];
      const result = original.apply(writer, args);
      if (atlas && !history.travelling) {
        const { pastStates } = atlas.getState();
        const added = pastStates.length - startCount || (pastStates[pastStates.length - 1] !== startTop ? 1 : 0);
        if (added > 0) history.push(atlasStep(path, WRITE_LABELS[name] ?? 'map change', writer, added));
      }
      return result;
    };
  }
}

/** Taking back `steps` steps of Atlas's history, while it is as Tabletop left it. */
function atlasStep(path: string, label: string, writer: TokenWriter, steps: number): UndoStep {
  const atlas = (): AtlasHistory | null => historyOf(writer.holder(path));
  let expected = atlas()?.getState().pastStates.length ?? -1;
  const travel = (way: 'undo' | 'redo'): boolean => {
    const store = atlas();
    if (!store) return false;
    const state = store.getState();
    if (state.pastStates.length !== expected) return false;
    if (way === 'redo' && state.futureStates.length < steps) return false;
    if (way === 'undo' && state.pastStates.length < steps) return false;
    for (let i = 0; i < steps; i += 1) store.getState()[way]();
    expected = store.getState().pastStates.length;
    return true;
  };
  return { paths: [path], label, undo: () => travel('undo'), redo: () => travel('redo') };
}
