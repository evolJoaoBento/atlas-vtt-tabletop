/**
 * Atlas's copy, cut and paste of map objects (`clipboard/mapClipboardActions.ts`), for the tokens the board shows. The
 * clipboard is Atlas's own file (`src/atlasPort/app/clipboard/mapClipboard.ts`: the objects stay in memory, a readable
 * summary goes to the system clipboard, and a paste notices that something else was copied since); it is shared by every
 * board, so tokens copied on one map paste into another. What the store does (take tokens off, put the copies on, numbering
 * them) goes through `TokenWriter`, so each is one step of Atlas's history; Duplicate (next) reuses `tokensToCopy`.
 */
import { holdsMapClipboard, readMapClipboard, writeMapClipboard } from '../atlasPort/app/clipboard/mapClipboard';
import type { TokenWriter } from './tokenWriter';

/** Whether something was copied (it may have gone stale since, which only a paste finds out). */
export function holdsTokenClipboard(): boolean {
  return holdsMapClipboard();
}

/** Puts the tokens on the clipboard. False when none of the ids is a token on the map. */
export async function copyTokens(writer: TokenWriter, path: string, ids: readonly string[]): Promise<boolean> {
  const content = await writer.tokensToCopy(path, ids);
  if (!content) return false;
  await writeMapClipboard(content);
  return true;
}

/** Copies the tokens, then takes them off the map in one step. False when none of the ids is a token on the map. */
export async function cutTokens(writer: TokenWriter, path: string, ids: readonly string[]): Promise<boolean> {
  const content = await writer.cutTokens(path, ids);
  if (!content) return false;
  await writeMapClipboard(content);
  return true;
}

/** Duplicates the tokens one cell aside (Atlas's Duplicate; the clipboard is left alone); the ids of the copies. */
export function duplicateTokens(writer: TokenWriter, path: string, ids: readonly string[]): Promise<string[]> {
  return writer.duplicateTokens(path, ids);
}

/** Pastes the copied tokens centred on `target` (map pixels); the ids of the copies, none when nothing is on the clipboard. */
export async function pasteTokens(writer: TokenWriter, path: string, target: { x: number; y: number }): Promise<string[]> {
  const copied = await readMapClipboard();
  if (!copied) return [];
  // Only tokens go on this clipboard from the board; another kind (from a copy made elsewhere) is left out.
  const content = { ...copied, drawings: [], texts: [], pins: [], levelLinks: [] };
  if (content.tokens.length === 0) return [];
  return writer.pasteContent(path, content, target);
}
