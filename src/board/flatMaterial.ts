/**
 * A material drawn bare (the leanest memory, `QualityPreset.bare`): no textures at all, only its colour map's average
 * colour, read from the picture shrunk to a few pixels (decoded at that size where the browser can, so the whole
 * picture never sits in memory). The board puts it on walls and props as it would the textured one.
 */
import * as THREE from 'three';
import type { LoadedMaterial } from '../materials';

/** The grey a material without a readable colour map is drawn. */
export const FLAT_FALLBACK = 0x8a8580;
const SAMPLE = 8;

/** The average of RGBA pixels (sRGB bytes), skipping clear ones; null with none left. */
export function averageColour(data: ArrayLike<number>): [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 8) continue;
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    count += 1;
  }
  return count === 0 ? null : [r / count, g / count, b / count];
}

/** The picture at `url` shrunk to a few pixels and averaged; null when it cannot be read. */
async function averageOfPicture(url: string): Promise<[number, number, number] | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    const blob = await (await fetch(url)).blob();
    bitmap = await createImageBitmap(blob, { resizeWidth: SAMPLE, resizeHeight: SAMPLE, resizeQuality: 'medium' });
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    // A browser that ignored the resize gave the picture whole: drawing it this small still averages it.
    context.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
    return averageColour(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/** A material that draws as `colour` (sRGB 0..255), matte, with no maps. */
export function flatMaterialOf(name: string, colour: [number, number, number] | null): LoadedMaterial {
  const tint = new THREE.Color(FLAT_FALLBACK);
  if (colour) tint.setRGB(colour[0] / 255, colour[1] / 255, colour[2] / 255, THREE.SRGBColorSpace);
  return {
    name,
    hasNormal: false,
    hasHeight: false,
    retile: () => {},
    tune: (material) => {
      material.roughness = 0.9;
      material.userData.displaces = false;
    },
    apply: (material) => {
      material.color.copy(tint);
      material.map = null;
      material.normalMap = null;
      material.aoMap = null;
      material.roughnessMap = null;
      material.metalnessMap = null;
      material.metalness = 0;
      material.roughness = 0.9;
      material.userData.displaces = false;
      material.needsUpdate = true;
    },
  };
}

/** The bare material for a colour map at `url` (none: the fallback grey). */
export async function flatMaterial(name: string, url: string | null): Promise<LoadedMaterial> {
  return flatMaterialOf(name, url ? await averageOfPicture(url) : null);
}
