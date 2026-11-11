// Stand-in for Atlas's plugin/deviceId.ts @ 0.12.0 (AGPL-3.0) in the copies. Atlas names the files only one device writes
// (its loot history) by this id; the board's copy of Atlas's history store must never write Atlas's own file, so it gets
// its own id: this device's Atlas id with `-tabletop` after it (Atlas reads every device's file, so its rolls show in
// Atlas and Atlas's in the board's).
import type { App } from 'obsidian';

const ATLAS_DEVICE_ID_KEY = 'atlas-vtt-device-id';
const OWN_DEVICE_ID_KEY = 'tabletop-for-atlas-device-id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TABLETOP_DEVICE_SUFFIX = '-tabletop';

type LocalStorage = Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>;

export function deviceId(app: LocalStorage): string {
  const atlas: unknown = app.loadLocalStorage(ATLAS_DEVICE_ID_KEY);
  if (typeof atlas === 'string' && UUID.test(atlas)) return `${atlas}${TABLETOP_DEVICE_SUFFIX}`;
  const own: unknown = app.loadLocalStorage(OWN_DEVICE_ID_KEY);
  if (typeof own === 'string' && UUID.test(own)) return `${own}${TABLETOP_DEVICE_SUFFIX}`;
  const id = crypto.randomUUID();
  app.saveLocalStorage(OWN_DEVICE_ID_KEY, id);
  return `${id}${TABLETOP_DEVICE_SUFFIX}`;
}
