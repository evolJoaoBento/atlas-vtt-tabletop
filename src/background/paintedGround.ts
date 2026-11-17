/**
 * The ground of a painted background as three.js draws it: a picture of weights (the splat, one channel for each of
 * the background's four material slots) and a ground material that blends the slots' colours and relief by it, with
 * plain ground where no slot is painted. Like the plane to the horizon, the textures are read without their tiling
 * showing.
 */
import * as THREE from 'three';
import { EASE_SQUARES } from '../board/ground';
import { naturalGround, PLAIN_GROUND } from '../board/groundPlane';
import { MAX_MATERIALS, type BackgroundLayers } from './backgroundData';
import type { BackgroundFrame } from './terrainHeight';

/**
 * The picture of weights: red where material slot 1 is painted, green slot 2, blue slot 3, alpha slot 4. Inside `flat`
 * (the usable board, in squares) nothing is painted: the board's ground stays plain, and past its edge the weights
 * grow from nothing to full over `EASE_SQUARES`, as the heights do. Smoothly filtered, so a border
 * between materials is soft, and mipmapped, so far ground does not shimmer.
 */
export function splatTexture(layers: BackgroundLayers, frame: BackgroundFrame, flat: { x0: number; y0: number; x1: number; y1: number }): THREE.DataTexture {
  const { size, material } = layers;
  const data = new Uint8Array(size * size * 4);
  const at = (square: number, centre: number): number => (square - (centre - frame.extent / 2)) / frame.extent * size - 0.5;
  // Where each slot is painted: the rows it touches and the columns it spans, so the blur works only there.
  const rows = Array.from({ length: MAX_MATERIALS }, () => new Uint8Array(size));
  const left = new Array<number>(MAX_MATERIALS).fill(size), right = new Array<number>(MAX_MATERIALS).fill(-1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const slot = material[y * size + x];
      if (slot < 1 || slot > MAX_MATERIALS) continue;
      const c = slot - 1;
      data[(y * size + x) * 4 + c] = 255;
      rows[c][y] = 1;
      if (x < left[c]) left[c] = x;
      if (x > right[c]) right[c] = x;
    }
  }
  // A border between materials fades over about two squares, not at the edge of one cell.
  const radius = Math.max(1, Math.round(size / frame.extent));
  for (let c = 0; c < MAX_MATERIALS; c++) if (right[c] >= 0) blur(data, size, c, radius, rows[c], Math.max(0, left[c] - radius), Math.min(size - 1, right[c] + radius));
  // The cells inside the board are left plain, and past its edge the materials ease in over `EASE_SQUARES`, as the heights do.
  const from = (lo: number, centre: number): number => Math.max(0, Math.floor(at(lo, centre)));
  const to = (hi: number, centre: number): number => Math.min(size - 1, Math.ceil(at(hi, centre)));
  const x0 = from(flat.x0 - EASE_SQUARES, frame.cx), x1 = to(flat.x1 + EASE_SQUARES, frame.cx);
  const y0 = from(flat.y0 - EASE_SQUARES, frame.cy), y1 = to(flat.y1 + EASE_SQUARES, frame.cy);
  // A cell's middle, in squares.
  const squareOf = (cell: number, centre: number): number => centre - frame.extent / 2 + (cell + 0.5) / size * frame.extent;
  for (let y = y0; y <= y1; y++) {
    const sy = squareOf(y, frame.cy), dy = Math.max(flat.y0 - sy, 0, sy - flat.y1);
    for (let x = x0; x <= x1; x++) {
      const sx = squareOf(x, frame.cx), d = Math.hypot(Math.max(flat.x0 - sx, 0, sx - flat.x1), dy);
      if (d >= EASE_SQUARES) continue;
      const t = d / EASE_SQUARES, ease = t * t * (3 - 2 * t), i = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) data[i + c] = Math.round(data[i + c] * ease);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Softens one channel of four-channel picture data in place: each value becomes the mean of those within `radius`
 * cells along a row, then along a column. Only the rows marked in `rows` have anything to spread along, and only the
 * columns `from` to `to` can have anything after that.
 */
function blur(data: Uint8Array, size: number, channel: number, radius: number, rows: Uint8Array, from: number, to: number): void {
  const width = radius * 2 + 1, line = new Float32Array(size + 2 * radius + 1);
  // Cells past the picture's edge count as the edge cell, as the ground does.
  const pass = (start: number, step: number, a: number, b: number): void => {
    for (let i = a - radius; i <= b + radius + 1; i++) line[i - a + radius] = data[start + Math.min(size - 1, Math.max(0, i)) * step + channel];
    let sum = 0;
    for (let i = 0; i < width; i++) sum += line[i];
    for (let i = a; i <= b; i++) {
      data[start + i * step + channel] = Math.round(sum / width);
      sum += line[i - a + 2 * radius + 1] - line[i - a];
    }
  };
  for (let y = 0; y < size; y++) if (rows[y]) pass(y * size * 4, 4, from, to);
  const top = rows.indexOf(1), bottom = rows.lastIndexOf(1);
  for (let x = from; x <= to; x++) pass(x * 4, size * 4, Math.max(0, top - radius), Math.min(size - 1, bottom + radius));
}

/** A texel standing in for a map a slot has not got. */
let blank: THREE.DataTexture | null = null;
function blankTexture(): THREE.DataTexture {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    blank.needsUpdate = true;
  }
  return blank;
}

/** GLSL declaring a slot's inputs. */
const slotUniforms = (n: number): string => `uniform sampler2D uPaintMap${n};\nuniform sampler2D uPaintNormal${n};`;

/** GLSL adding slot `n` to the blend if it is painted here. */
const slotBlend = (n: number, channel: string): string => `
  if (gW.${channel} > 0.002) {
    vec3 c = uPaintColor[${n}];
    if (uPaintHas[${n}].x > 0.5) c *= textureNoTileGrad(uPaintMap${n}, gUv, gDx, gDy).rgb;
    gColor += c * gW.${channel};
    gRough += uPaintRough[${n}] * gW.${channel};
    if (uPaintHas[${n}].y > 0.5) {
      vec3 n = textureNoTileGrad(uPaintNormal${n}, gUv, gDx, gDy).xyz * 2.0 - 1.0;
      n.xy *= uPaintNScale[${n}];
      gNormal += n * gW.${channel};
    } else gNormal += vec3(0.0, 0.0, 1.0) * gW.${channel};
  }`;

/**
 * The material of the ground of a painted background. `splat` says where each slot of `materials` shows (a slot null,
 * or with no maps, is read as plain ground), `cell` is the world units to a square (the colour drift's, shared with
 * the plane), and `placing` says where the splat lies (`area`: the left and top of its square and its side, in world
 * units) and how wide a tile is (`tile`, world units).
 */
export function paintedGroundMaterial(
  splat: THREE.DataTexture, materials: (THREE.MeshStandardMaterial | null)[], cell: { value: number },
  placing: { area: THREE.Vector3; tile: { value: number } },
): THREE.MeshStandardMaterial {
  const base = new THREE.MeshStandardMaterial({ color: PLAIN_GROUND, roughness: 0.95, metalness: 0 });
  const plain = new THREE.Color(PLAIN_GROUND);
  const slots = Array.from({ length: MAX_MATERIALS }, (_, k) => materials[k] ?? null);
  const uniforms: Record<string, THREE.IUniform> = {
    uPaintSplat: { value: splat },
    uPaintArea: { value: placing.area },
    uPaintTile: placing.tile,
    uPaintColor: { value: slots.map((m) => (m ? new THREE.Vector3(m.color.r, m.color.g, m.color.b) : new THREE.Vector3(plain.r, plain.g, plain.b))) },
    // x: has a colour map, y: has a normal map
    uPaintHas: { value: slots.map((m) => new THREE.Vector2(m?.map ? 1 : 0, m?.normalMap ? 1 : 0)) },
    uPaintRough: { value: slots.map((m) => (m ? m.roughness : base.roughness)) },
    uPaintNScale: { value: slots.map((m) => (m ? m.normalScale.clone() : new THREE.Vector2(1, 1))) },
  };
  slots.forEach((m, k) => {
    uniforms[`uPaintMap${k}`] = { value: m?.map ?? blankTexture() };
    uniforms[`uPaintNormal${k}`] = { value: m?.normalMap ?? blankTexture() };
  });
  // The ground's own shader first (the untiled reads, the colour drift), then this one's blend in place of the
  // material, roughness and normal reads.
  const natural = naturalGround(base, cell);
  const earlier = natural.onBeforeCompile;
  natural.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uPaintSplat;
uniform vec3 uPaintArea;
uniform float uPaintTile;
uniform vec3 uPaintColor[${MAX_MATERIALS}];
uniform vec2 uPaintHas[${MAX_MATERIALS}];
uniform float uPaintRough[${MAX_MATERIALS}];
uniform vec2 uPaintNScale[${MAX_MATERIALS}];
${[0, 1, 2, 3].map(slotUniforms).join('\n')}
mat3 paintTangentFrame(vec3 eyePos, vec3 surfNorm, vec2 uv) {
  vec3 q0 = dFdx(eyePos), q1 = dFdy(eyePos);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, surfNorm), q0perp = cross(surfNorm, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, surfNorm);
}`)
      .replace('#include <map_fragment>', `
  // Where each material shows here, softly; the rest is plain ground.
  vec2 gUv = vec2(vGroundAt.x, -vGroundAt.y) / uPaintTile;
  vec2 gDx = dFdx(gUv), gDy = dFdy(gUv);
  vec4 gW = texture2D(uPaintSplat, (vGroundAt - uPaintArea.xy) / uPaintArea.z);
  float gSum = gW.r + gW.g + gW.b + gW.a;
  if (gSum > 1.0) { gW /= gSum; gSum = 1.0; }
  vec3 gColor = diffuseColor.rgb * (1.0 - gSum);
  float gRough = roughness * (1.0 - gSum);
  vec3 gNormal = vec3(0.0, 0.0, 1.0) * (1.0 - gSum);
  ${slotBlend(0, 'r')}${slotBlend(1, 'g')}${slotBlend(2, 'b')}${slotBlend(3, 'a')}
  diffuseColor.rgb = gColor;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', `
  if (gSum > 0.002) normal = normalize(paintTangentFrame(-vViewPosition, normal, gUv) * normalize(gNormal));`);
    earlier(shader, renderer);
  };
  natural.customProgramCacheKey = () => 'tabletop-painted-ground';
  natural.needsUpdate = true;
  return natural;
}
