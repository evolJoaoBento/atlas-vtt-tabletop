/**
 * The plane to the horizon (`ground.ts`, horizon mode): a grid round the map, fine near the board and coarse far out,
 * level under the usable board and shaped by the noise pattern past its edge, tiled with a material of the gallery
 * (a tile a square) or plain ground. It lies a hair under the map, which is drawn on it.
 */
import * as THREE from 'three';
import { groundHeight, type GroundSettings } from './ground';

const PLAIN_GROUND = 0x5d6b45;
/** Grid lines across, each way. */
const SEGMENTS = 220;
/** How far out it runs, in spans of the map. */
const REACH = 14;
/** How far under the map's floor it lies, in world units (so the map never fights it for the same depth). */
const SINK = 1;

export interface GroundArea {
  /** The map's size, in world units (its pixels). */
  width: number;
  height: number;
  /** World units to a grid square. */
  cell: number;
  /** The extra board round the map, in squares. */
  margin: number;
}

export class GroundPlane {
  readonly object3d: THREE.Mesh;
  private readonly plain = new THREE.MeshStandardMaterial({ color: PLAIN_GROUND, roughness: 0.95, metalness: 0 });
  private key = '';

  constructor() {
    this.object3d = new THREE.Mesh(new THREE.BufferGeometry(), this.plain);
    this.object3d.name = 'ground';
    this.object3d.receiveShadow = true;
  }

  /** Shapes it for the settings and the map; `material` gives the shared material of a gallery folder. */
  update(settings: GroundSettings, area: GroundArea, material: (folder: string) => THREE.Material): void {
    this.object3d.material = settings.material ? material(settings.material) : this.plain;
    const key = JSON.stringify([settings.noise, settings.strength, settings.margin, area.width, area.height, area.cell]);
    if (key === this.key) return;
    this.key = key;
    this.object3d.geometry.dispose();
    this.object3d.geometry = groundGeometry(settings, area);
  }

  dispose(): void {
    this.object3d.geometry.dispose();
    this.plain.dispose();
    this.object3d.removeFromParent();
  }
}

/** The grid: lines bunched near the middle (u², so the board's surroundings are fine and the horizon coarse). */
export function groundGeometry(settings: GroundSettings, area: GroundArea): THREE.BufferGeometry {
  const { width, height, cell, margin } = area;
  const cx = width / 2, cz = height / 2;
  const reach = Math.max(width, height) * REACH;
  const flat = { x0: -margin, y0: -margin, x1: width / cell + margin, y1: height / cell + margin };
  const n = SEGMENTS + 1;
  const position = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  const along = (i: number): number => { const u = (i / SEGMENTS) * 2 - 1; return Math.sign(u) * u * u * reach; };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx + along(i), z = cz + along(j), k = j * n + i;
      const h = groundHeight(x / cell, z / cell, settings, flat);
      position.set([x, h * cell - SINK, z], k * 3);
      uv.set([x / cell, -z / cell], k * 2);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Facing up (+y): seen from above, x right and z down the screen.
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
