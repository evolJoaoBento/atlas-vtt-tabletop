/**
 * Atlas's fog of war standing on the 3D board as a black cloud: pure black, unlit, tallest over the fog and rounding
 * down to its edge, then thinning out softly a little past it, so it reads as a cloud and not a box.
 *
 * It is one box over the fog, whose shader marches each pixel's ray through it in a few dozen steps and gathers how
 * much cloud it crosses. The cloud's shape comes from a texture: the fog's areas (with their erased holes) painted
 * white and blurred, so the edge falls off smoothly, its outline roughened by a small static noise. Over the fog
 * itself the map is covered completely for players (so the cloud's soft edge never shows them what is under the fog);
 * the GM sees through it at half strength, as Atlas shows fog to the GM (`show`). Rebuilt only when the fog or its
 * height changes.
 *
 * The box is drawn by its outside faces; a camera inside it would see none of them, so while one is inside, its
 * inside faces are drawn instead (`face`). A camera inside the cloud itself sees nothing: `hides` tells the board,
 * which blacks the players' picture out.
 */
import * as THREE from 'three';
import { fogAreas, type FogArea, type FogOperation } from './fog';
import { cloudFrame, cloudNoise, type CloudFrame } from './fogCloud';

/** Atlas shows the GM the fog at half strength. */
const GM_STRENGTH = 0.5;
/** Just over the board, so the cloud's floor does not flicker with the map. */
const FLOOR = 0.5;
/** How far the blur spreads the edge, in grid squares. */
const EDGE_SQUARES = 0.35;
/** Steps each ray takes through the cloud. */
const STEPS = 24;
const NOISE_TEXELS = 64;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uShape;
uniform sampler2D uNoise;
uniform vec2 uMin;
uniform vec2 uSize;
uniform float uFloor;
uniform float uHeight;
uniform float uCell;
uniform float uStrength;
varying vec3 vWorld;

// How deep in the cloud a point of the map is: 1 well inside the fog, 0.5 on its outline, 0 a little past it.
float shape(vec2 xz) {
  float c = texture2D(uShape, (xz - uMin) / uSize).r;
  float n = texture2D(uNoise, xz / (uCell * 3.0)).r;
  // The noise only roughens the edge: deep inside and far outside stay as they are.
  return clamp(c + (n - 0.5) * 0.45 * (1.0 - abs(2.0 * c - 1.0)), 0.0, 1.0);
}

void main() {
  vec3 origin = cameraPosition;
  vec3 dir = normalize(vWorld - origin);
  vec3 boxMin = vec3(uMin.x, uFloor, uMin.y);
  vec3 boxMax = vec3(uMin.x + uSize.x, uFloor + uHeight + uCell * 0.5, uMin.y + uSize.y);
  vec3 t0 = (boxMin - origin) / dir;
  vec3 t1 = (boxMax - origin) / dir;
  vec3 tLow = min(t0, t1);
  vec3 tHigh = max(t0, t1);
  float near = max(max(tLow.x, tLow.y), max(tLow.z, 0.0));
  float far = min(min(tHigh.x, tHigh.y), tHigh.z);
  if (far <= near) discard;

  float stepLength = (far - near) / ${STEPS}.0;
  float crossed = 0.0;
  for (int i = 0; i < ${STEPS}; i++) {
    vec3 p = origin + dir * (near + (float(i) + 0.5) * stepLength);
    float c = shape(p.xz);
    // Tallest well inside, rounding down to nothing past the edge, with a soft top.
    float top = uFloor + uHeight * smoothstep(0.0, 0.75, c);
    float density = smoothstep(0.05, 0.5, c) * clamp((top - p.y) / (uCell * 0.35), 0.0, 1.0);
    crossed += density * stepLength;
  }
  float alpha = 1.0 - exp(-crossed * 4.0 / uCell);

  // Where the ray meets the map under the fog, the fog hides it completely (only the soft edge past it shows the map).
  if (dir.y < 0.0) {
    vec3 ground = origin + dir * ((uFloor - origin.y) / dir.y);
    alpha = max(alpha, smoothstep(0.3, 0.5, shape(ground.xz)));
  }
  alpha *= uStrength;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}`;

export class FogVolume {
  readonly object3d = new THREE.Group();
  private key = '';
  /** The fog's areas, for what players cannot see under it. */
  areas: FogArea[] = [];
  private cloud: THREE.Mesh | null = null;
  /** The box the rays march through, and how tall the cloud stands in it. */
  private readonly box = new THREE.Box3();
  private top = 0;
  private shapeTexture: THREE.CanvasTexture | null = null;
  private readonly noise: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.object3d.name = 'fog';
    const values = cloudNoise(NOISE_TEXELS, 11);
    const rgba = new Uint8Array(NOISE_TEXELS * NOISE_TEXELS * 4);
    values.forEach((value, i) => rgba.set([value, value, value, 255], i * 4));
    this.noise = new THREE.DataTexture(rgba, NOISE_TEXELS, NOISE_TEXELS);
    this.noise.wrapS = THREE.RepeatWrapping;
    this.noise.wrapT = THREE.RepeatWrapping;
    this.noise.magFilter = THREE.LinearFilter;
    this.noise.minFilter = THREE.LinearFilter;
    this.noise.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uShape: { value: null },
        uNoise: { value: this.noise },
        uMin: { value: new THREE.Vector2() },
        uSize: { value: new THREE.Vector2(1, 1) },
        uFloor: { value: FLOOR },
        uHeight: { value: 0 },
        uCell: { value: 70 },
        uStrength: { value: GM_STRENGTH },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
  }

  /** Shows the fog of `operations`, `height` grid squares of `cellSize` pixels tall (0 lays it flat on the map). */
  update(operations: readonly FogOperation[], height: number, cellSize: number): void {
    const key = JSON.stringify([operations, height, cellSize]);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    this.areas = fogAreas(operations);
    const frame = cloudFrame(this.areas, cellSize);
    const shape = frame ? paintShape(this.areas, frame, cellSize) : null;
    if (!frame || !shape) return;
    this.shapeTexture = shape;
    const tall = Math.max(0, height) * cellSize;
    const uniforms = this.material.uniforms;
    uniforms.uShape!.value = shape;
    (uniforms.uMin!.value as THREE.Vector2).set(frame.minX, frame.minY);
    (uniforms.uSize!.value as THREE.Vector2).set(frame.width, frame.height);
    uniforms.uHeight!.value = tall;
    uniforms.uCell!.value = cellSize;
    // The box the rays march through: the frame, as tall as the cloud and its soft top.
    const boxHeight = tall + cellSize * 0.5;
    const geometry = new THREE.BoxGeometry(frame.width, boxHeight, frame.height);
    geometry.translate(frame.minX + frame.width / 2, FLOOR + boxHeight / 2, frame.minY + frame.height / 2);
    this.box.set(
      new THREE.Vector3(frame.minX, FLOOR, frame.minY),
      new THREE.Vector3(frame.minX + frame.width, FLOOR + boxHeight, frame.minY + frame.height),
    );
    this.top = FLOOR + tall;
    this.cloud = new THREE.Mesh(geometry, this.material);
    this.cloud.renderOrder = 5;
    this.object3d.add(this.cloud);
  }

  /** Dresses the fog for whose picture is drawn next: the GM sees through it at half strength, players not at all. */
  show(viewer: 'gm' | 'player'): void {
    this.material.uniforms.uStrength!.value = viewer === 'gm' ? GM_STRENGTH : 1;
  }

  /** Draws the box's outside faces for a camera at `eye` outside it, its inside faces for one inside. */
  face(eye: THREE.Vector3): void {
    if (!this.cloud) return;
    const side = this.box.containsPoint(eye) ? THREE.BackSide : THREE.FrontSide;
    if (this.material.side !== side) {
      this.material.side = side;
      this.material.needsUpdate = true;
    }
  }

  /** Whether a camera at `eye` is inside the cloud: over the fog (not a hole in it) and below its top. */
  hides(eye: THREE.Vector3, inside: (point: { x: number; y: number }) => boolean): boolean {
    return this.cloud !== null && eye.y < this.top && inside({ x: eye.x, y: eye.z });
  }

  /** Whether there is any fog on the map. */
  get empty(): boolean {
    return this.cloud === null;
  }

  private clear(): void {
    this.areas = [];
    if (this.cloud) {
      this.cloud.geometry.dispose();
      this.cloud.removeFromParent();
      this.cloud = null;
    }
    this.shapeTexture?.dispose();
    this.shapeTexture = null;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.noise.dispose();
    this.object3d.removeFromParent();
  }
}

/** The cloud's shape: the fog's areas painted white (holes left black) into the frame's texture, then blurred. */
function paintShape(areas: readonly FogArea[], frame: CloudFrame, cellSize: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const sharp = document.createElement('canvas');
  sharp.width = frame.texWidth;
  sharp.height = frame.texHeight;
  const paint = sharp.getContext('2d');
  if (!paint) return null;
  paint.fillStyle = '#000';
  paint.fillRect(0, 0, sharp.width, sharp.height);
  paint.scale(frame.texWidth / frame.width, frame.texHeight / frame.height);
  paint.translate(-frame.minX, -frame.minY);
  paint.fillStyle = '#fff';
  for (const area of areas) {
    paint.beginPath();
    for (const ring of [area.outer, ...area.holes]) {
      ring.forEach((point, i) => (i === 0 ? paint.moveTo(point.x, point.y) : paint.lineTo(point.x, point.y)));
      paint.closePath();
    }
    // A hole lies inside its outline: even-odd leaves it out.
    paint.fill('evenodd');
  }
  const soft = document.createElement('canvas');
  soft.width = frame.texWidth;
  soft.height = frame.texHeight;
  const blur = soft.getContext('2d');
  if (!blur) return null;
  blur.fillStyle = '#000';
  blur.fillRect(0, 0, soft.width, soft.height);
  blur.filter = `blur(${(EDGE_SQUARES * cellSize * frame.texWidth) / frame.width}px)`;
  blur.drawImage(sharp, 0, 0);
  const texture = new THREE.CanvasTexture(soft);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}
