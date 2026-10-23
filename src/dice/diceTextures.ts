/**
 * The dice's face art, from the chosen pack's sheets, as Interactive Dice paints it: a sheet is a mask (a faint wash
 * inside each face's cell, opaque white digits, transparent elsewhere), so it is painted over the die's colour on a
 * canvas rather than handed to the material to tint, which would make the digits the die's colour too. One texture per
 * sheet and colour, shared by every die that wears it.
 */
import * as THREE from 'three';
import { dieColor, packDie, PACK_FALLBACK } from './kit/dieShapes';
import type { DieType } from './kit/faces';
import type { ChosenPack } from './dicePack';

export class DiceTextures {
  private readonly cache = new Map<string, THREE.Texture>();

  /** `wake`: a sheet decoded after the dice were drawn; the board draws them again. */
  /** `doc`: the board's window's document, where the sheets are painted. */
  constructor(private readonly pack: ChosenPack, private readonly doc: Document, private readonly wake: () => void) {}

  /** A die's maps: its face sheet over `color` (the pack's colour for the die when null), and its normal map. */
  textures(type: DieType, color: string | null): { map?: THREE.Texture; normalMap?: THREE.Texture } {
    const out: { map?: THREE.Texture; normalMap?: THREE.Texture } = {};
    const sheet = this.pack.textures[type];
    if (sheet) out.map = this.sheet(sheet, color ?? dieColor(type, this.pack.config), packDie(type, this.pack.config).rimUV ?? PACK_FALLBACK.rimUV);
    const normal = this.pack.normals[type];
    if (normal) out.normalMap = this.normal(normal);
    return out;
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private sheet(url: string, color: string, rimUV: [number, number]): THREE.Texture {
    const key = `${url}|${color}|${rimUV.join(',')}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const canvas = this.doc.win.createEl('canvas');
    const context = canvas.getContext('2d');
    // Until the sheet decodes the die wears its plain colour.
    canvas.width = canvas.height = 1;
    if (context) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Painted in sRGB: unlabelled, three would encode it a second time and wash the colour out.
    texture.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, texture);
    if (!context) return texture;
    const image = this.doc.win.createEl('img');
    image.onload = () => {
      if (this.cache.get(key) !== texture) return;
      canvas.width = image.width;
      canvas.height = image.height;
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      paintRim(this.doc, context, canvas, image, color, rimUV);
      // The one-pixel placeholder's GPU copy does not grow: dropped, the next frame uploads the sheet at its size.
      texture.dispose();
      texture.needsUpdate = true;
      this.wake();
    };
    image.onerror = () => console.warn(`[Tabletop] Cannot read the dice sheet ${url}.`);
    image.src = url;
    return texture;
  }

  private normal(url: string): THREE.Texture {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const texture = new THREE.TextureLoader().load(url, () => this.wake(), undefined, () => console.warn(`[Tabletop] Cannot read the dice normal map ${url}.`));
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.cache.set(url, texture);
    return texture;
  }
}

/**
 * The bevel's rim samples blank sheet, where there is no wash: painted with the sheet's wash (its commonest
 * half-transparent colour, the digits being the opaque end) over the die's colour, it matches the faces.
 */
function paintRim(doc: Document, context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, image: HTMLImageElement, color: string, rimUV: [number, number]): void {
  const scratch = doc.win.createEl('canvas');
  scratch.width = image.width;
  scratch.height = image.height;
  const sheet = scratch.getContext('2d', { willReadFrequently: true });
  if (!sheet) return;
  sheet.drawImage(image, 0, 0);
  let pixels: Uint8ClampedArray;
  try {
    pixels = sheet.getImageData(0, 0, image.width, image.height).data;
  } catch {
    // A sheet that taints the canvas: the rim keeps the plain colour.
    return;
  }
  const seen = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4 * 37) {
    const alpha = pixels[i + 3];
    if (alpha <= 8 || alpha > 240) continue;
    const packed = ((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | alpha) >>> 0;
    seen.set(packed, (seen.get(packed) ?? 0) + 1);
  }
  let wash = 0;
  let most = 0;
  for (const [packed, count] of seen) if (count > most) { most = count; wash = packed; }
  if (!most) return;
  // A patch, not a texel: mipmaps would average a lone texel away.
  const size = Math.max(8, Math.round(Math.min(canvas.width, canvas.height) / 32));
  const x = Math.round(rimUV[0] * canvas.width) - size / 2;
  const y = Math.round((1 - rimUV[1]) * canvas.height) - size / 2;
  context.fillStyle = color;
  context.fillRect(x, y, size, size);
  context.fillStyle = `rgba(${(wash >>> 24) & 255}, ${(wash >>> 16) & 255}, ${(wash >>> 8) & 255}, ${(wash & 255) / 255})`;
  context.fillRect(x, y, size, size);
}
