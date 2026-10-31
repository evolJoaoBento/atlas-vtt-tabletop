/**
 * Atlas's own Ctrl/Cmd + hover stat block window for a token (`StatblockPreviewWindow`, opened by the map view's
 * `NotePreviewUIManager`): its card with the token's portrait and live HP, its surface, placement and fade. Asking
 * Atlas to open it makes the hover look the same as on Atlas's own map, because it is the same window. Atlas 0.10's
 * map views keep the manager reachable (`serviceManager.getNotePreviewUIManager()`); every member is checked, and a
 * view without it reads as "no window", when Tabletop draws the card itself (`hoverCard.ts`).
 */
import type { MapViewLike } from '../dice/atlasDice';
import type { ResourceValue } from '../board/resources';
import { routeCardRolls } from './atlasCard';
import type { AdvantageSide } from './sheet';

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null;

/** What the hover needs of a token. */
export interface PreviewToken {
  id: string;
  x: number;
  y: number;
  name: string | null;
  instanceNumber: number | null;
  statblockPath: string | null;
  imagePath: string | null;
  showRing: boolean;
  ringColor: string;
  resources: Record<string, ResourceValue>;
}

/** Atlas's handle on the token (`TokenPreviewAnchor`): the note, and the vitals its statblock mirrors. */
export function previewAnchor(token: PreviewToken): Rec {
  const meter = (key: string): { current: number; max: number } | undefined => {
    const value = token.resources[key];
    return value ? { current: value.current, max: value.max } : undefined;
  };
  const hp = meter('hp');
  const stress = meter('stress');
  return {
    id: token.id,
    notePath: token.statblockPath ?? '',
    x: token.x,
    y: token.y,
    type: 'token',
    ...(token.name ? { name: token.name } : {}),
    ...(token.instanceNumber !== null ? { instanceNumber: token.instanceNumber } : {}),
    ...(hp ? { hp } : {}),
    ...(stress ? { stress } : {}),
    ...(token.imagePath ? { imagePath: token.imagePath } : {}),
    ringColor: token.ringColor,
    showRing: token.showRing,
  };
}

/**
 * The dice links of Atlas's own Ctrl/Cmd + hover window throw the board's dice (as the card Tabletop draws does), never
 * Atlas's dice tool, which would roll at once. Heard on the page (Atlas puts its window on the body), only for links in
 * Atlas's window, not the card Tabletop drew itself. Returns how to stop.
 */
export function routeAtlasWindowRolls(doc: Document, onRoll: (formula: string, label: string, side?: AdvantageSide) => void): () => void {
  return routeCardRolls(doc.body, onRoll, (link) => link.closest('.atlas-statblock-preview-window:not([data-tabletop-card])') !== null);
}

/** Atlas's window for a token's stat block. */
export interface AtlasPreviews {
  /** Opens the window by (x, y) in window coordinates; it places itself, as it does on Atlas's own map. */
  show(anchor: Rec, x: number, y: number): Promise<void>;
  /** Closes the token's window, with Atlas's fade. */
  hide(tokenId: string): void;
}

/** A method of `target` by name, bound to it; null when it has none. */
function method(target: unknown, name: string): ((...args: unknown[]) => unknown) | null {
  if (!isObject(target) || typeof target[name] !== 'function') return null;
  return (target[name] as (...args: unknown[]) => unknown).bind(target);
}

/** Atlas's window opener on a map view; null where this Atlas gives none. */
export function atlasPreviews(view: MapViewLike | null): AtlasPreviews | null {
  if (!view) return null;
  let manager: unknown;
  try {
    manager = method(view.serviceManager, 'getNotePreviewUIManager')?.();
  } catch {
    return null;
  }
  const open = method(manager, 'showOrCreatePreview');
  const close = method(manager, 'hidePreview');
  if (!open || !close) return null;
  return {
    show: async (anchor, x, y) => { await open(anchor, x, y, null); },
    hide: (tokenId) => { try { close(tokenId, false); } catch { /* the window is gone */ } },
  };
}
