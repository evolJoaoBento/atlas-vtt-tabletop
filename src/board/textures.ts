/**
 * The board's pictures: images read from the vault, and the small canvases drawn for pins, labels and markers.
 * Labels and pins keep one size on screen whatever the zoom, as Atlas's pins do: they are sprites without size
 * attenuation, sized through `screenScale`.
 */
import * as THREE from 'three';
import { pinGlyph, pinTone } from './pinIcons';
import type { BoardPin } from './mapModel';

/** Reads an image into a texture (sRGB, mipmapped). */
export function loadImageTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      resolve(texture);
    }, undefined, () => reject(new Error(`cannot read ${url}`)));
  });
}

/** A canvas texture `size` pixels square, drawn by `draw`. */
export function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = createEl('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  draw(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The scale a sprite without size attenuation needs to be `pixels` tall, on a view `viewHeight` pixels tall seen
 * through a vertical field of view of `fovDegrees`.
 */
export function screenScale(pixels: number, viewHeight: number, fovDegrees: number): number {
  return ((2 * pixels) / Math.max(1, viewHeight)) * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
}

/** The surface Atlas draws pins and plates on (its dark theme). */
export const PLATE_COLOR = '#2a2a2a';
const PIN_PX = 128;

/** A pin as Atlas draws it: a dark disc with the icon's glyph in its colour, or its label. */
export function pinTexture(pin: BoardPin): THREE.CanvasTexture {
  return canvasTexture(PIN_PX, PIN_PX, (context) => {
    const centre = PIN_PX / 2;
    const radius = PIN_PX / 2 - 3;
    context.globalAlpha = 0.95;
    context.fillStyle = PLATE_COLOR;
    context.beginPath();
    context.arc(centre, centre, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 2;
    context.strokeStyle = 'rgba(255,255,255,0.4)';
    context.stroke();
    const glyph = pinGlyph(pin.icon);
    if (glyph) {
      // Atlas: a 22 px glyph on a 20 px radius.
      const size = radius * 1.1;
      context.save();
      context.translate(centre - size / 2, centre - size / 2);
      context.scale(size / 512, size / 512);
      context.fillStyle = pinTone(pin.icon);
      context.fill(new Path2D(glyph));
      context.restore();
      return;
    }
    const text = pin.label ?? '';
    context.fillStyle = '#ffffff';
    context.font = `bold ${radius}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const width = context.measureText(text).width;
    const fit = Math.min(1, (radius * 1.5) / Math.max(1, width));
    context.translate(centre, centre);
    context.scale(fit, fit);
    context.fillText(text, 0, 0);
  });
}

/** A text plate (a pill) for a name or a title. Returns the texture and its size in pixels. */
export function plateTexture(text: string, fontPx = 26): { texture: THREE.CanvasTexture; width: number; height: number } {
  const probe = createEl('canvas').getContext('2d')!;
  const font = `600 ${fontPx}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  probe.font = font;
  const height = Math.round(fontPx * 1.6);
  const width = Math.max(height * 2, Math.ceil(probe.measureText(text).width + fontPx * 1.2));
  const texture = canvasTexture(width, height, (context) => {
    context.fillStyle = PLATE_COLOR;
    context.globalAlpha = 0.92;
    context.beginPath();
    context.roundRect(1, 1, width - 2, height - 2, (height - 2) / 2);
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 1.5;
    context.strokeStyle = 'rgba(255,255,255,0.4)';
    context.stroke();
    context.font = font;
    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2 + 1);
  });
  return { texture, width, height };
}

/** Atlas's marker on a hidden token: a dark disc with a crossed-out eye. */
export function hiddenMarkerTexture(): THREE.CanvasTexture {
  const px = 96;
  return canvasTexture(px, px, (context) => {
    const c = px / 2;
    context.fillStyle = 'rgba(0,0,0,0.8)';
    context.beginPath();
    context.arc(c, c, c - 3, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.stroke();
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.ellipse(c, c, px * 0.26, px * 0.15, 0, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(c, c, px * 0.07, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(c - px * 0.27, c - px * 0.27);
    context.lineTo(c + px * 0.27, c + px * 0.27);
    context.stroke();
  });
}

/** Atlas's marker on a downed token: a dark disc with a white skull. */
export function downedMarkerTexture(): THREE.CanvasTexture {
  const px = 96;
  return canvasTexture(px, px, (context) => {
    const c = px / 2;
    context.globalAlpha = 0.72;
    context.fillStyle = '#111114';
    context.beginPath();
    context.arc(c, c, c - 3, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    const glyph = pinGlyph('boss');
    if (!glyph) return;
    const size = px * 0.6;
    context.translate(c - size / 2, c - size / 2);
    context.scale(size / 512, size / 512);
    context.fillStyle = '#ffffff';
    context.fill(new Path2D(glyph));
  });
}
