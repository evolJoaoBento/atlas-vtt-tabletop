/**
 * What a right-click on the 3D board offers of its fog while the fog tool is on (Atlas 0.18's `fogMenu.ts`): on fog, whatever
 * painted it, Reveal and Delete, which both act on the whole body of fog under the pointer (fog that touches is one);
 * on the open ground of fog that was revealed so, Hide (it comes back) and Delete (it is forgotten); nowhere else.
 * The hit-testing is Atlas's own (`fogCoverage`, `fogBodyAt`, `areaAt`, copied under `atlasPort`), run on the fog the board
 * read. Pure of the board: the actions come in as callbacks.
 */
import { areaOutline, fogAreaList } from '../atlasPort/app/fog/fogAreas';
import { areaAt, fogBodyAt } from '../atlasPort/app/fog/fogBody';
import { fogCoverage, type FogCoverage } from '../atlasPort/app/fog/fogCoverage';
import type { FogOperation as AtlasFogOperation } from '../atlasPort/app/types/fogTypes';
import { at as atlasText } from '../atlasPort/atlasText';
import type { MenuEntry } from './atlasMenu';
import type { FogOperation } from './fog';
import type { FogPoint } from './fogGesture';
import type { FogOffers } from './fogTool';

type Record_ = Readonly<Record<string, AtlasFogOperation>>;
interface Held {
  record: Record_;
  coverage: FogCoverage | null;
}

/** What a right-click at a point has: the body of fog there, or the remembered revealed fog; and the outlines the menu acts on (drawn while it is open). */
export type FogMenuHit =
  | { kind: 'fog'; body: FogPoint[]; outlines: FogPoint[][] }
  | { kind: 'area'; id: string; outlines: FogPoint[][] };

const held = new WeakMap<readonly FogOperation[], Held>();

/** The fog of the level shown as Atlas's record (by id) and its coverage; null coverage where the geometry cannot be worked out. The same for the same array. */
function heldOf(fog: readonly FogOperation[]): Held {
  let known = held.get(fog);
  if (!known) {
    const record: Record<string, AtlasFogOperation> = {};
    for (const operation of fog) record[operation.id] = { ...operation, kind: 'fog' } as unknown as AtlasFogOperation;
    let coverage: FogCoverage | null = null;
    try { coverage = fogCoverage(record); } catch { coverage = null; }
    known = { record, coverage };
    held.set(fog, known);
  }
  return known;
}

/** The fog menu's hit at the map point `point`, as Atlas gives it; null where the fog has no menu there. */
export function fogMenuAt(fog: readonly FogOperation[], point: FogPoint): FogMenuHit | null {
  const { record, coverage } = heldOf(fog);
  if (!coverage) return null;
  if (coverage.covers(point)) {
    const body = fogBodyAt(coverage.shape, point);
    return body ? { kind: 'fog', body, outlines: [body] } : null;
  }
  const revealed = areaAt(fogAreaList(record), point);
  return revealed ? { kind: 'area', id: revealed.id, outlines: [areaOutline(revealed).map(({ x, y }) => ({ x, y }))] } : null;
}

/** What the menu's entries do; the board's. `now` reads the hit again at the choice (the fog may have changed since the menu opened). */
export interface FogMenuActions {
  offers(): FogOffers;
  now(): FogMenuHit | null;
  reveal(outlines: ReadonlyArray<ReadonlyArray<FogPoint>>): void;
  /** Takes the body away for good (a lasso that erases). */
  erase(body: ReadonlyArray<FogPoint>): void;
  hide(id: string): void;
  forget(id: string): void;
}

/**
 * The menu's entries, in Atlas's order: Reveal, Delete on fog; Hide, Delete on revealed ground. An action the Atlas in use lacks
 * (0.18's reveal, hide and forget) is left out, never offered to fail; none left means no menu (an empty list).
 */
export function fogMenuEntries(hit: FogMenuHit, actions: FogMenuActions): MenuEntry[] {
  const offers = actions.offers();
  const entries: MenuEntry[] = [];
  const remove = (onClick: () => void): MenuEntry => ({ type: 'item', label: atlasText('common.delete'), destructive: true, onClick });
  if (hit.kind === 'fog') {
    if (offers.reveal) {
      entries.push({ type: 'item', label: atlasText('fog.reveal'), onClick: () => { const now = actions.now(); if (now?.kind === 'fog') actions.reveal([now.body]); } });
    }
    if (offers.add) {
      entries.push(remove(() => { const now = actions.now(); if (now?.kind === 'fog') actions.erase(now.body); }));
    }
    return entries;
  }
  const { id } = hit;
  if (offers.hide) entries.push({ type: 'item', label: atlasText('fog.hide'), onClick: () => actions.hide(id) });
  if (offers.forget) entries.push(remove(() => actions.forget(id)));
  return entries;
}
