/**
 * Opening and showing a 3D board from notes: a link that opens a map in 3D (`obsidian://tabletop-board?...`, handled by
 * the plugin), a `tabletop` code block that shows a card for a map with its latest snapshot, and the names snapshots of
 * the board are saved under. Pure, so it is tested without Obsidian.
 */

export const BOARD_PROTOCOL_ACTION = 'tabletop-board';
export const DEFAULT_SNAPSHOT_FOLDER = 'Tabletop snapshots';

const MAP_EXTENSION = '.atlasmap';

export const isMapFile = (path: string): boolean => path.toLowerCase().endsWith(MAP_EXTENSION);

/** A link that opens `mapPath` of `vault` in 3D when it is followed (in a note, or anywhere on the machine). */
export function boardLink(vault: string, mapPath: string): string {
  return `obsidian://${BOARD_PROTOCOL_ACTION}?vault=${encodeURIComponent(vault)}&map=${encodeURIComponent(mapPath)}`;
}

/** The map a followed link names; null when it names none, or a file that is not an Atlas map. */
export function readBoardLink(params: Readonly<Record<string, string | undefined>>): string | null {
  const map = params.map?.trim();
  return map && isMapFile(map) && !map.split('/').includes('..') ? map : null;
}

/** What a `tabletop` code block holds: the map (`path`, `[[path]]` or `[[path|caption]]`), and a caption when given. */
export function parseBoardBlock(source: string): { map: string; caption: string | null } | null {
  const line = source.split(/\r?\n/).map((each) => each.trim()).find((each) => each !== '');
  if (!line) return null;
  const link = /^!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(line);
  const map = (link ? link[1] : line).trim();
  if (!isMapFile(map)) return null;
  const caption = link?.[2]?.trim();
  return { map, caption: caption ? caption : null };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `<folder>/<map name> 2026-10-30 143005.png`: where a snapshot of the board is saved. */
export function snapshotPath(folder: string, mapPath: string, now: Date): string {
  const name = (mapPath.split('/').pop() ?? mapPath).replace(/\.atlasmap$/i, '');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const clean = folder.trim().replace(/^\/+|\/+$/g, '');
  return `${clean === '' ? '' : `${clean}/`}${name} ${stamp}.png`;
}

/** The newest of the snapshots (paths) saved for `mapPath`: names are stamped, so the last in order is the latest. */
export function latestSnapshot(paths: readonly string[], folder: string, mapPath: string): string | null {
  const name = (mapPath.split('/').pop() ?? mapPath).replace(/\.atlasmap$/i, '');
  const clean = folder.trim().replace(/^\/+|\/+$/g, '');
  const prefix = `${clean === '' ? '' : `${clean}/`}${name} `;
  const mine = paths.filter((path) => path.startsWith(prefix) && /\d{4}-\d{2}-\d{2} \d{6}\.png$/.test(path));
  return mine.sort().pop() ?? null;
}
