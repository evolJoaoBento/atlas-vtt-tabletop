/**
 * Keeping pictures small on a device short of memory (a phone): a texture whose image is larger than the preset's
 * `imageSide` is drawn onto a smaller canvas before it reaches the graphics card, and its full-size image let go. Used
 * for token art, wall materials and the textures inside minis and props (`QualityPreset.imageSide`).
 */
import * as THREE from 'three';
import { fitTexture } from './textures';

type Sized = { width: number; height: number; close?: () => void };
type MakeCanvas = (width: number, height: number) => { width: number; height: number; getContext(kind: '2d'): { drawImage(image: unknown, x: number, y: number, width: number, height: number): void } | null } | null;

const browserCanvas: MakeCanvas = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as ReturnType<MakeCanvas>;
};

/**
 * Shrinks `texture`'s image in place to at most `max` on its longest side (its shape kept); called before it is first
 * drawn. A video, a data texture or one that fits is left as it is. Returns whether it shrank.
 */
export function capTexture(texture: THREE.Texture, max: number | undefined, makeCanvas: MakeCanvas = browserCanvas): boolean {
  if (!max || !(max > 0)) return false;
  if ((texture as THREE.VideoTexture).isVideoTexture || (texture as THREE.DataTexture).isDataTexture) return false;
  const image = texture.image as Sized | null | undefined;
  if (!image || !(image.width > 0) || !(image.height > 0)) return false;
  const fit = fitTexture(image.width, image.height, max);
  if (fit.width === image.width && fit.height === image.height) return false;
  const canvas = makeCanvas(fit.width, fit.height);
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return false;
  context.drawImage(image, 0, 0, fit.width, fit.height);
  texture.image = canvas;
  if (texture.userData.sourceSize === undefined) texture.userData.sourceSize = { width: image.width, height: image.height };
  // An ImageBitmap (a GLB's textures) holds its pixels until closed.
  image.close?.();
  texture.needsUpdate = true;
  return true;
}

/** Every texture on the materials of `root`'s meshes, each once, shrunk with `capTexture`. Returns how many shrank. */
export function capObjectTextures(root: THREE.Object3D, max: number | undefined, makeCanvas: MakeCanvas = browserCanvas): number {
  if (!max) return 0;
  const seen = new Set<THREE.Texture>();
  let shrunk = 0;
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const one of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(one as unknown as Record<string, unknown>)) {
        if (!(value instanceof THREE.Texture) || seen.has(value)) continue;
        seen.add(value);
        if (capTexture(value, max, makeCanvas)) shrunk += 1;
      }
    }
  });
  return shrunk;
}
