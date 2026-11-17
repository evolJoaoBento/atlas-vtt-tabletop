import { TERRAINS, type BackgroundLayers } from './backgroundData';

function canvasOf(doc: Document, width: number, height: number): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error('Could not make a PNG'))), 'image/png');
  });
}

/** Turns a painted layer into a grey PNG: red, green and blue all hold the cell's value, fully opaque. */
export async function encodeLayer(layer: Uint8Array, size: number, doc: Document): Promise<ArrayBuffer> {
  const canvas = canvasOf(doc, size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = layer[i];
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return toPng(canvas);
}

/** Reads a layer PNG back (the red channel). A picture that cannot be read, or is not size by size, gives null. */
export async function decodeLayer(bytes: ArrayBuffer, size: number): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    if (bitmap.width !== size || bitmap.height !== size) { bitmap.close(); return null; }
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { bitmap.close(); return null; }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, size, size).data;
    const out = new Uint8Array(size * size);
    for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4];
    return out;
  } catch {
    return null;
  }
}

/** A small preview picture of the terrain, each cell in its terrain's colour, sampled without smoothing. */
export async function renderThumbnail(layers: BackgroundLayers, doc: Document, px: number = 160): Promise<ArrayBuffer> {
  const canvas = canvasOf(doc, px, px);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  const colors = new Map<number, [number, number, number]>();
  for (const t of TERRAINS) {
    const n = parseInt(t.color.slice(1), 16);
    colors.set(t.index, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  const plains = colors.get(0) ?? [155, 176, 106];
  const image = ctx.createImageData(px, px);
  for (let y = 0; y < px; y++) {
    const sy = Math.min(layers.size - 1, Math.floor((y / px) * layers.size));
    for (let x = 0; x < px; x++) {
      const sx = Math.min(layers.size - 1, Math.floor((x / px) * layers.size));
      const [r, g, b] = colors.get(layers.terrain[sy * layers.size + sx]) ?? plains;
      const o = (y * px + x) * 4;
      image.data[o] = r;
      image.data[o + 1] = g;
      image.data[o + 2] = b;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return toPng(canvas);
}
