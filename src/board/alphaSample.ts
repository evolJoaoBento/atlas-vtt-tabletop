/**
 * Whether a picture is solid at a point (its alpha there at least half): the floors' see-through parts, which a carried
 * token falls through to the layer below. Each picture is read once, small (at most 256 pixels a side), and kept while
 * the picture lives.
 */
type Picture = CanvasImageSource & { width: number; height: number };

const SIDE = 256;
const read = new WeakMap<object, { alpha: Uint8ClampedArray; width: number; height: number } | null>();

/** Whether `picture` is solid at (u, v) (0..1 across and down); null when it cannot be read (a tainted picture). */
export function opaqueAt(picture: Picture, u: number, v: number): boolean | null {
  let sampled = read.get(picture);
  if (sampled === undefined) {
    sampled = sample(picture);
    read.set(picture, sampled);
  }
  if (!sampled) return null;
  if (u < 0 || v < 0 || u > 1 || v > 1) return false;
  const x = Math.min(sampled.width - 1, Math.floor(u * sampled.width));
  const y = Math.min(sampled.height - 1, Math.floor(v * sampled.height));
  return sampled.alpha[y * sampled.width + x]! >= 128;
}

function sample(picture: Picture): { alpha: Uint8ClampedArray; width: number; height: number } | null {
  if (!(picture.width > 0) || !(picture.height > 0) || typeof document === 'undefined') return null;
  const scale = Math.min(1, SIDE / Math.max(picture.width, picture.height));
  const width = Math.max(1, Math.round(picture.width * scale));
  const height = Math.max(1, Math.round(picture.height * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(picture, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const alpha = new Uint8ClampedArray(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
    return { alpha, width, height };
  } catch {
    return null;
  }
}
