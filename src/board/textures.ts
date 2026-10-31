/**
 * The board's pictures: images read from the vault, and the small canvases drawn for pins, labels and markers.
 * Labels and pins keep one size on screen whatever the zoom, as Atlas's pins do: they are sprites without size
 * attenuation, sized through `screenScale`.
 */
import * as THREE from 'three';
import { pinGlyph, pinTone } from './pinIcons';
import type { BoardPin } from './mapModel';

/** The longest side a map's texture keeps: a larger map (Atlas 0.11 allows 1,000 megapixels) is drawn from a smaller copy. */
export const MAX_MAP_TEXTURE = 8192;

/** `width` by `height` scaled down to at most `max` on its longest side, whole pixels; as it is when it already fits. */
export function fitTexture(width: number, height: number, max: number = MAX_MAP_TEXTURE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > max)) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

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

/** Whether a map's background is a video (an animated map): WebM, MP4 and the other formats a browser plays. */
export function isVideoPath(path: string): boolean {
  return /\.(webm|mp4|m4v|ogv|mov)$/i.test(path.split(/[?#]/)[0] ?? '');
}

/**
 * An animated map: the video plays muted and looped on the board's floor. It keeps its true size in `sourceSize` and the
 * element in `userData.video`; disposing the texture stops the video and lets go of its file.
 */
export function loadVideoTexture(url: string): Promise<THREE.VideoTexture> {
  return new Promise((resolve, reject) => {
    const video = createEl('video');
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    const fail = (): void => reject(new Error(`cannot read ${url}`));
    video.addEventListener('error', fail, { once: true });
    video.addEventListener('loadeddata', () => {
      // The element's own size is what the grid's contrast colour is measured on.
      video.width = video.videoWidth;
      video.height = video.videoHeight;
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.userData.video = video;
      texture.userData.sourceSize = { width: video.videoWidth, height: video.videoHeight };
      texture.addEventListener('dispose', () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      void video.play().catch(() => undefined);
      resolve(texture);
    }, { once: true });
    video.src = url;
  });
}

/** What a map image measures, whatever size its texture is kept at (`userData.sourceSize` of a scaled-down one). */
export function mapImageSize(texture: THREE.Texture | null): { width: number; height: number } | null {
  const kept = texture?.userData.sourceSize as { width?: number; height?: number } | undefined;
  const image = texture?.image as { width?: number; height?: number } | undefined;
  const width = kept?.width ?? image?.width;
  const height = kept?.height ?? image?.height;
  return width && height ? { width, height } : null;
}

/**
 * A map image's texture, kept to `MAX_MAP_TEXTURE` on its longest side so a huge map neither fills the graphics memory
 * nor goes black. The map keeps its true size (`mapImageSize`): tokens and the grid live in its pixels.
 */
export async function loadMapTexture(url: string, path?: string, max: number = MAX_MAP_TEXTURE): Promise<THREE.Texture> {
  if (path !== undefined && isVideoPath(path)) return loadVideoTexture(url);
  const texture = await loadImageTexture(url);
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  const fit = fitTexture(image.width, image.height, max);
  if (fit.width === image.width && fit.height === image.height) return texture;
  const canvas = createEl('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const context = canvas.getContext('2d');
  if (!context) return texture;
  context.drawImage(image, 0, 0, fit.width, fit.height);
  const scaled = new THREE.CanvasTexture(canvas);
  scaled.colorSpace = THREE.SRGBColorSpace;
  scaled.anisotropy = 8;
  scaled.userData.sourceSize = { width: image.width, height: image.height };
  texture.dispose();
  return scaled;
}

/**
 * A map picture from Atlas's tiles (`atlasMosaic`) as the board's texture. A bitmap is not flipped by the texture, so it
 * is drawn onto a canvas first, as a scaled-down map is; the map keeps its true size in `sourceSize`.
 */
export function mapTextureFromPicture(picture: { bitmap: ImageBitmap; width: number; height: number }): THREE.Texture | null {
  const { bitmap } = picture;
  const canvas = createEl('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (context) context.drawImage(bitmap, 0, 0);
  bitmap.close();
  if (!context) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.sourceSize = { width: picture.width, height: picture.height };
  return texture;
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

/** The marker on a token whose combatant holds its turn back: a dark disc with an amber hourglass. */
export function delayedMarkerTexture(): THREE.CanvasTexture {
  const px = 96;
  return canvasTexture(px, px, (context) => {
    const c = px / 2;
    context.globalAlpha = 0.78;
    context.fillStyle = '#111114';
    context.beginPath();
    context.arc(c, c, c - 3, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = '#f5b73d';
    context.fillStyle = '#f5b73d';
    context.lineWidth = 5;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    const w = px * 0.26;
    const h = px * 0.3;
    // The two glass bulbs meeting at the waist, with a bar at each end, and the sand in the lower one.
    context.beginPath();
    context.moveTo(c - w, c - h);
    context.lineTo(c + w, c - h);
    context.lineTo(c, c);
    context.lineTo(c + w, c + h);
    context.lineTo(c - w, c + h);
    context.lineTo(c, c);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(c - w * 0.55, c + h);
    context.lineTo(c + w * 0.55, c + h);
    context.lineTo(c, c + h * 0.35);
    context.closePath();
    context.fill();
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
