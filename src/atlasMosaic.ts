/**
 * Atlas 0.11's Mosaic Canvas, as far as the board uses it: maps of up to 1,000 megapixels and 65,535 pixels a side,
 * which a browser cannot decode whole. Atlas cuts such a map into a pyramid of tiles once and answers for the whole map at
 * any size we ask, so a huge map reaches the board as the picture the board's texture takes, never as the file.
 *
 * Atlas has no extension API, so the service is found the way the rest of this plugin finds Atlas: through an open map
 * view's private objects, every member checked before use. Where it is not there (an Atlas before 0.11, whose maps are
 * small enough to decode; no map view open) these functions answer null and the board reads the file as it always did.
 */
import type { App, TFile } from 'obsidian';
import { ATLAS_VIEW_TYPE } from './atlas';

/** Maps from this size on are read through Atlas's tiles; a smaller file decodes whole without trouble. */
export const MOSAIC_FROM_BYTES = 8 * 1024 * 1024;

/** How long the full-size picture is waited for before the quick one is taken instead (the tiles of a huge map are still being cut). */
const FULL_WAIT_MS = 45_000;
/** The side of the quick picture: Atlas's own overview, cut first. */
const QUICK_SIDE = 2048;
const QUICK_WAIT_MS = 120_000;

/** What `MosaicCanvasService` answers to (its `open`, `overview` and `close`). */
export interface MosaicService {
  open(file: TFile): Promise<{ handle: number; pyramid: { width: number; height: number } }>;
  overview(handle: number, maxSide: number, signal?: AbortSignal): Promise<ImageBitmap>;
  close(handle: number): void;
}

/** A map as a picture: the bitmap, and the size of the map it stands for (the board's world is in the map's own pixels). */
export interface MapPicture {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => (typeof value === 'object' || typeof value === 'function') && value !== null;

export function isMosaicService(value: unknown): value is MosaicService {
  return isObject(value) && typeof value.open === 'function' && typeof value.overview === 'function' && typeof value.close === 'function';
}

/** Atlas's tile service, through any map view that has a map image (the service is one per Obsidian, not per view); null where there is none. */
export function mosaicServiceOf(app: App): MosaicService | null {
  for (const leaf of app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)) {
    try {
      const view = leaf.view as unknown as Rec;
      const renderer = view.renderer;
      const image = isObject(renderer) && typeof renderer.getMapImage === 'function' ? (renderer.getMapImage as () => unknown).call(renderer) : null;
      const deps = isObject(image) ? image.deps : null;
      const service = isObject(deps) ? deps.service : null;
      if (isMosaicService(service)) return service;
    } catch {
      // A view that is still starting has no renderer yet: the next one is asked.
    }
  }
  return null;
}

const wait = (ms: number): AbortSignal => AbortSignal.timeout(ms);

/**
 * The map in `file` as a picture of at most `maxSide` pixels on its longer side, from Atlas's tiles; null where Atlas
 * cannot give one (see the top). Asks for the full size first; a map whose tiles are still being cut answers with the
 * quick picture after a wait, so the board shows the map at once and does not hang.
 */
export async function mapPicture(app: App, file: TFile, maxSide: number): Promise<MapPicture | null> {
  const service = mosaicServiceOf(app);
  if (!service) return null;
  let opened: Awaited<ReturnType<MosaicService['open']>>;
  try {
    opened = await service.open(file);
  } catch {
    return null;
  }
  try {
    const { width, height } = opened.pyramid;
    if (!(width > 0 && height > 0)) return null;
    const take = async (side: number, ms: number): Promise<ImageBitmap | null> => {
      try {
        return await service.overview(opened.handle, side, wait(ms));
      } catch {
        return null;
      }
    };
    const full = Math.max(1, Math.floor(maxSide));
    const bitmap = (await take(full, FULL_WAIT_MS)) ?? (full > QUICK_SIDE ? await take(QUICK_SIDE, QUICK_WAIT_MS) : null);
    return bitmap ? { bitmap, width, height } : null;
  } finally {
    service.close(opened.handle);
  }
}
