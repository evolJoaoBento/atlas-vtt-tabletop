/**
 * A large map read at the size the board draws it, without decoding it whole first: its size is read from the file's
 * header (Atlas's `imageDimensions`), and the browser decodes it straight to the smaller size (`createImageBitmap` with
 * `resizeWidth`/`resizeHeight`). A phone that decodes a 8192-pixel map whole holds a quarter of a gigabyte for it alone;
 * read this way it holds only what is drawn. Null where it fits already, or the browser cannot (the board then reads it
 * as it always has).
 */
import { imageDimensions } from '../atlasPort/app/imageProcessing/imageDimensions';
import { fitTexture } from './textures';

export interface SmallPicture {
  bitmap: ImageBitmap;
  /** The map's own size, which the board lays it out at. */
  width: number;
  height: number;
}

export interface PictureTools {
  fetchBlob(url: string): Promise<Blob>;
  size(blob: Blob): Promise<{ width: number; height: number } | null>;
  decode?(blob: Blob, width: number, height: number): Promise<ImageBitmap>;
}

const browserTools = (): PictureTools => ({
  fetchBlob: async (url) => (await fetch(url)).blob(),
  size: (blob) => imageDimensions(blob),
  ...(typeof createImageBitmap === 'function' ? { decode: (blob: Blob, width: number, height: number) => createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }) } : {}),
});

export async function smallPicture(url: string, maxSide: number, tools: PictureTools = browserTools()): Promise<SmallPicture | null> {
  if (!tools.decode) return null;
  const blob = await tools.fetchBlob(url);
  const size = await tools.size(blob);
  if (!size || !(size.width > 0) || !(size.height > 0)) return null;
  const fit = fitTexture(size.width, size.height, maxSide);
  if (fit.width === size.width && fit.height === size.height) return null;
  const bitmap = await tools.decode(blob, fit.width, fit.height);
  // A browser that ignores the size asked for gives the whole map: let it go, and the board reads it the usual way (and
  // draws it smaller), rather than drawing it whole.
  if (bitmap.width > fit.width + 1 || bitmap.height > fit.height + 1) {
    bitmap.close();
    return null;
  }
  return { bitmap, width: size.width, height: size.height };
}
