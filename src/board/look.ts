/**
 * How the board's picture is formed from its light: a tone mapper that leaves ordinary colours as they are and rolls
 * only the brightest ones off toward white (a plain clamp, or a curve applied to each colour channel on its own, turns
 * bright colours into the same few garish hues), and a painted dusk backdrop behind the table.
 */
import * as THREE from 'three';

/** The board's daylight at full ambient light, and the colours of its lights. */
export interface Lighting {
  sky: number;
  sun: number;
  skyColor: number;
  groundColor: number;
  sunColor: number;
  /** How wide the shadows' edges are softened. */
  shadowRadius: number;
}

/**
 * The classic look is the board's first: white sun, no tone mapping, a flat dark room. The painted look is a warm key
 * and a cool fill, so the shadows go blue where the lit side goes gold, as a painter would keep them apart, with a
 * tone mapper, softer shadows and a painted sky.
 */
export const LIGHTING: Readonly<Record<'classic' | 'painted', Lighting>> = {
  classic: { sky: 1.5, sun: 2.2, skyColor: 0xfff4e6, groundColor: 0x2a2430, sunColor: 0xffffff, shadowRadius: 1 },
  painted: { sky: 1.2, sun: 2.6, skyColor: 0xe2ebff, groundColor: 0x3a3040, sunColor: 0xffeed6, shadowRadius: 2.5 },
};

/**
 * The painted look's light follows its sky: a low warm sun at dusk, a bright neutral one by day, and a dim cool moon
 * at night with a deep blue sky and a shadow side that stays dark.
 */
export const SKY_LIGHTING: Readonly<Record<Sky, Lighting>> = {
  dusk: LIGHTING.painted,
  day: { sky: 1.4, sun: 3, skyColor: 0xdbe8ff, groundColor: 0x5a5448, sunColor: 0xfff8ee, shadowRadius: 2 },
  night: { sky: 1, sun: 1.3, skyColor: 0x5a6cb0, groundColor: 0x161a2c, sunColor: 0x9fb4ff, shadowRadius: 3.5 },
};

/** The lights for a look: the classic one's, or the painted one's in the colours of its sky. */
export function lightingFor(painted: boolean, sky: Sky): Lighting {
  return painted ? SKY_LIGHTING[sky] : LIGHTING.classic;
}

/** Khronos's neutral mapper in the painted look: identity for the map's own colours, a gentle highlight roll-off, no hue shifts. */
export function setLook(renderer: THREE.WebGLRenderer, painted: boolean): void {
  renderer.toneMapping = painted ? THREE.NeutralToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
}

/** The room round the table: a flat dark one, or a painted sky; the GM's tint (#rrggbb) colours either. */
export function room(doc: Document, painted: boolean, sky: Sky, tint: string | null = null): THREE.Texture | THREE.Color {
  return painted ? paintSky(doc, sky, tint) : tinted(0x0f0c0a, tint);
}

/** A colour multiplied by the tint, as the daylight is. */
export function tinted(hex: number, tint: string | null): THREE.Color {
  const colour = new THREE.Color(hex);
  return tint ? colour.multiply(new THREE.Color(tint)) : colour;
}

/** A small repeatable random run, so the painting is the same each time the board opens. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Sky = 'dusk' | 'day' | 'night';

export const DEFAULT_SKY: Sky = 'dusk';

export function readSky(value: unknown): Sky {
  return value === 'dusk' || value === 'day' || value === 'night' ? value : DEFAULT_SKY;
}

/** How a sky is painted: its gradient from the zenith down to the ground, its clouds, and the light of the horizon. */
interface SkyPalette {
  /** Gradient stops from the zenith (0) to the horizon (0.5) and below. */
  stops: [number, string][];
  /** The sky at the horizon, as the table's far floor fades into it. */
  horizon: number;
  /** Cloud colours, as r,g,b. */
  clouds: string[];
  /** How strongly clouds are laid on, and how many. */
  cloudStrength: [number, number];
  cloudCount: number;
  /** Stars, as a share of the sky's pixels; 0 for none. */
  stars: number;
}

const PALETTES: Readonly<Record<Sky, SkyPalette>> = {
  dusk: {
    stops: [[0, '#141a3a'], [0.25, '#2c3270'], [0.42, '#7a5a80'], [0.5, '#c8805e'], [0.52, '#3a2a30'], [1, '#150f10']],
    horizon: 0xc8805e,
    clouds: ['190,170,220', '235,185,175', '160,160,220', '250,210,170'],
    cloudStrength: [0.09, 0.2],
    cloudCount: 34,
    stars: 0,
  },
  day: {
    stops: [[0, '#2f6fc0'], [0.25, '#5b9bdc'], [0.42, '#a8d0ee'], [0.5, '#e4eef2'], [0.52, '#6f7a6a'], [1, '#2a2e26']],
    horizon: 0xe4eef2,
    clouds: ['255,255,255', '245,248,255', '230,238,250', '255,246,232'],
    cloudStrength: [0.12, 0.28],
    cloudCount: 40,
    stars: 0,
  },
  night: {
    stops: [[0, '#04060f'], [0.25, '#0a1030'], [0.42, '#18204a'], [0.5, '#2c3a6a'], [0.52, '#0c0f1c'], [1, '#05060c']],
    horizon: 0x2c3a6a,
    clouds: ['70,80,130', '90,90,150', '50,60,110'],
    cloudStrength: [0.06, 0.14],
    cloudCount: 24,
    stars: 0.0009,
  },
};

/** The lighting the toolbar offers: the classic look, or the painted one under a sky. */
export type LightingChoice = 'classic' | Sky;

export const LIGHTING_CHOICES: readonly LightingChoice[] = ['classic', 'dusk', 'day', 'night'];

export function choiceOf(painted: boolean, sky: Sky): LightingChoice {
  return painted ? sky : 'classic';
}

/** What a choice sets: whether the painted look is on, and under which sky (the last one kept for the classic look). */
export function lookOf(choice: LightingChoice, kept: Sky): { painted: boolean; sky: Sky } {
  return choice === 'classic' ? { painted: false, sky: kept } : { painted: true, sky: choice };
}

/** The colour the far floor fades into, which is the sky's own at the horizon. */
export function horizonColor(sky: Sky): number {
  return PALETTES[sky].horizon;
}

const WIDTH = 3072;
const HEIGHT = 1536;

/**
 * The sky all round the table, painted in code as an equirectangular picture so it turns with the camera: a gradient
 * from the zenith to a glowing horizon, soft clouds laid on in broad horizontal strokes (wrapped round the seam), stars at
 * night, and a little grain to break the bands of a slow gradient. Below the horizon it is dark ground.
 */
export function paintSky(doc: Document, sky: Sky, tint: string | null = null): THREE.Texture | THREE.Color {
  const painting = paintedSky(doc, sky);
  if (!painting) return tinted(0x0f0c0a, tint);
  let canvas = painting;
  if (tint) {
    // The tint is laid over the finished painting, so moving the picker does not paint the sky again.
    canvas = doc.win.createEl('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return tinted(0x0f0c0a, tint);
    context.drawImage(painting, 0, 0);
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = tint;
    context.fillRect(0, 0, WIDTH, HEIGHT);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** The last sky painted, kept so that a tint, or the board opening again, does not paint it twice. */
let lastPainting: { sky: Sky; canvas: HTMLCanvasElement } | null = null;

function paintedSky(doc: Document, sky: Sky): HTMLCanvasElement | null {
  if (lastPainting?.sky === sky && lastPainting.canvas.ownerDocument === doc) return lastPainting.canvas;
  const palette = PALETTES[sky];
  const canvas = doc.win.createEl('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 0, HEIGHT);
  for (const [at, colour] of palette.stops) gradient.addColorStop(at, colour);
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const random = seeded(20261029);
  // Clouds: each a wide, flat puff made of soft discs drawn with low strength so they build up like wet paint, kept
  // above the horizon and drawn again a width to either side so none is cut at the seam.
  for (let cloud = 0; cloud < palette.cloudCount; cloud++) {
    const x = random() * WIDTH;
    const y = (0.12 + random() * 0.34) * HEIGHT;
    const length = 260 + random() * 560;
    const tone = palette.clouds[Math.floor(random() * palette.clouds.length)];
    const strength = palette.cloudStrength[0] + random() * (palette.cloudStrength[1] - palette.cloudStrength[0]);
    for (let puff = 0; puff < 16; puff++) {
      const px = x + (random() - 0.5) * length;
      const py = y + (random() - 0.5) * length * 0.1;
      const radius = 40 + random() * 100;
      for (const shift of [-WIDTH, 0, WIDTH]) {
        context.save();
        context.translate(px + shift, py);
        context.scale(2.8, 0.55);
        const disc = context.createRadialGradient(0, 0, 0, 0, 0, radius);
        disc.addColorStop(0, `rgba(${tone},${strength})`);
        disc.addColorStop(1, `rgba(${tone},0)`);
        context.fillStyle = disc;
        context.fillRect(-radius, -radius, radius * 2, radius * 2);
        context.restore();
      }
    }
  }
  if (palette.stars > 0) {
    const count = Math.floor(WIDTH * HEIGHT * 0.5 * palette.stars);
    for (let star = 0; star < count; star++) {
      context.fillStyle = `rgba(230,235,255,${0.3 + random() * 0.6})`;
      const size = random() < 0.9 ? 1.5 : 2.5;
      context.fillRect(random() * WIDTH, random() * HEIGHT * 0.45, size, size);
    }
  }
  const pixels = context.getImageData(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const grain = (random() - 0.5) * 3;
    pixels.data[i] += grain;
    pixels.data[i + 1] += grain;
    pixels.data[i + 2] += grain;
  }
  context.putImageData(pixels, 0, 0);
  lastPainting = { sky, canvas };
  return canvas;
}
