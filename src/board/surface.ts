/**
 * The table itself: the map image on a flat board at the image's own size, with Atlas's grid drawn over it, a wooden
 * frame around it and a floor beneath, so nothing outside the map reads as a void. World (x, y) on the map is
 * (x, 0, y) here: screen right is +x, the map's top is toward -z.
 */
import * as THREE from 'three';
import { styledGrid } from './gridLines';
import type { BoardGrid } from './mapModel';

const FRAME_COLOR = 0x3b2a1d;
const FLOOR_COLOR = 0x17120e;
/** The grid sits a hair above the image so it never fights it for depth. */
const GRID_LIFT = 0.4;

/** Black or white, whichever stands out on the image, the way Atlas picks a grid colour that was not set. */
function contrastColor(image: CanvasImageSource & { width: number; height: number }): string {
  try {
    const canvas = createEl('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return sum / (data.length / 4) > 128 ? '#000000' : '#ffffff';
  } catch {
    return '#000000';
  }
}

/** Segments (x1, y1, x2, y2 in map pixels) as flat strips `width` wide lying on the board. */
export function stripGeometry(segments: readonly number[], width: number): THREE.BufferGeometry {
  const positions = new Float32Array((segments.length / 4) * 18);
  const half = width / 2;
  let at = 0;
  for (let i = 0; i < segments.length; i += 4) {
    const [x1, y1, x2, y2] = [segments[i], segments[i + 1], segments[i + 2], segments[i + 3]];
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / length) * half;
    const ny = ((x2 - x1) / length) * half;
    const corners = [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 + nx, y1 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
    for (const [x, y] of corners) {
      positions[at++] = x!;
      positions[at++] = GRID_LIFT;
      positions[at++] = y!;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class BoardSurface {
  readonly object3d = new THREE.Group();
  private floor: THREE.Mesh | null = null;
  private readonly image: THREE.MeshStandardMaterial;
  private grid: THREE.Mesh | null = null;

  /**
   * `width` and `height`: the world's size. `laid`: the map image's own size and where Atlas's stretch puts it
   * (`stretchPlacement`); without it the image fills the world.
   */
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly gridState: BoardGrid,
    laid?: { image: { width: number; height: number }; placement: { rotation: number; centre: { x: number; y: number }; scale: { x: number; y: number } } },
    /** Where the image lies in the world, as `BoardMap.world.matrix` (a player's map): it replaces `laid`. */
    matrix?: readonly [number, number, number, number, number, number],
  ) {
    const span = Math.max(width, height);
    this.image = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9, metalness: 0 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(laid?.image.width ?? width, laid?.image.height ?? height).rotateX(-Math.PI / 2), this.image);
    plane.receiveShadow = true;
    if (matrix) {
      // The unit square (corner at the origin, the map's top toward -z) carried by the matrix into the world.
      plane.geometry.dispose();
      plane.geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
      const [a, b, c, d, e, f] = matrix;
      plane.matrixAutoUpdate = false;
      plane.matrix.set(a, 0, c, e, 0, 1, 0, 0, b, 0, d, f, 0, 0, 0, 1);
    }
    // A stretched image is a turned plane inside a group scaled across and along the map: scaling turned geometry shears it.
    const laying = new THREE.Group();
    if (matrix) {
      // placed by its matrix above
    } else if (laid) {
      plane.position.set(laid.placement.centre.x, 0, laid.placement.centre.y);
      plane.rotation.y = laid.placement.rotation;
      laying.scale.set(laid.placement.scale.x, 1, laid.placement.scale.y);
    } else {
      plane.position.set(width / 2, 0, height / 2);
    }
    laying.add(plane);

    const border = span * 0.04;
    const depth = span * 0.03;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width + border * 2, depth, height + border * 2),
      new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.75, metalness: 0.05 }),
    );
    frame.position.set(width / 2, -depth / 2 - 0.5, height / 2);
    frame.receiveShadow = true;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(span * 30, span * 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 1 }));
    floor.position.set(width / 2, -depth * 3, height / 2);
    floor.receiveShadow = true;
    this.floor = floor;
    this.object3d.add(floor, frame, laying);
  }

  /** The floor beyond the table, made wider to run out to the horizon (it fades into the sky's colour there). */
  widenFloor(factor: number): void {
    this.floor?.scale.set(factor, 1, factor);
  }

  /** Lays the map image on the board (null keeps the plain board) and draws the grid in its colour. */
  setImage(texture: THREE.Texture | null): void {
    this.image.map = texture;
    this.image.color.set(texture ? 0xffffff : 0x55504a);
    this.image.needsUpdate = true;
    this.drawGrid(texture?.image as (CanvasImageSource & { width: number; height: number }) | undefined);
  }

  private drawGrid(image: (CanvasImageSource & { width: number; height: number }) | undefined): void {
    if (this.grid) {
      this.grid.removeFromParent();
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
    const grid = this.gridState;
    if (!grid.enabled || !grid.visible) return;
    const color = grid.color ?? (image ? contrastColor(image) : '#000000');
    // Atlas's line width, in map pixels: a strip, since WebGL draws lines one pixel thin whatever the width.
    const geometry = stripGeometry(styledGrid(grid, this.width, this.height).segments, Math.max(0.5, grid.lineWidth));
    this.grid = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: grid.opacity, depthWrite: false, side: THREE.DoubleSide }));
    this.object3d.add(this.grid);
  }

  dispose(): void {
    this.object3d.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    this.image.map?.dispose();
  }
}
