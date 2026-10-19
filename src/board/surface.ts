/**
 * The table itself: the map image on a flat board at the image's own size, with Atlas's grid drawn over it, a wooden
 * frame around it and a floor beneath, so nothing outside the map reads as a void. World (x, y) on the map is
 * (x, 0, y) here: screen right is +x, the map's top is toward -z.
 */
import * as THREE from 'three';
import type { BoardGrid } from './mapModel';

const FRAME_COLOR = 0x3b2a1d;
const FLOOR_COLOR = 0x17120e;
/** The grid sits a hair above the image so it never fights it for depth. */
const GRID_LIFT = 0.4;
const SQRT3 = Math.sqrt(3);

/** Black or white, whichever stands out on the image, the way Atlas picks a grid colour that was not set. */
function contrastColor(image: CanvasImageSource & { width: number; height: number }): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, 16, 16);
    const { data } = context.getImageData(0, 0, 16, 16);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    return sum / (data.length / 4) > 128 ? '#000000' : '#ffffff';
  } catch {
    return '#000000';
  }
}

/** The grid's lines as segment pairs, clipped to the map. */
export function gridSegments(grid: BoardGrid, width: number, height: number): number[] {
  const out: number[] = [];
  const push = (ax: number, ay: number, bx: number, by: number): void => { out.push(ax, GRID_LIFT, ay, bx, GRID_LIFT, by); };
  if (grid.type === 'square') {
    const first = (offset: number): number => offset - Math.floor(offset / grid.size) * grid.size;
    for (let x = first(grid.offsetX); x <= width; x += grid.size) push(x, 0, x, height);
    for (let y = first(grid.offsetY); y <= height; y += grid.size) push(0, y, width, y);
    return out;
  }
  const radius = grid.size / SQRT3;
  const pointy = grid.type === 'hex-vertical';
  const origin = pointy ? { x: grid.offsetX + grid.size / 2, y: grid.offsetY + radius } : { x: grid.offsetX + radius, y: grid.offsetY + grid.size / 2 };
  const seen = new Set<string>();
  const key = (x: number, y: number): string => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const inside = (x: number, y: number): boolean => x >= -1 && x <= width + 1 && y >= -1 && y <= height + 1;
  // Enough rows and columns of axial coordinates to cover the map from the origin hex, with one to spare each way.
  const span = Math.ceil(Math.max(width, height) / (radius * 1.5)) + 2;
  const startAngle = pointy ? -Math.PI / 2 : 0;
  for (let r = -span; r <= span; r++) {
    for (let q = -2 * span; q <= 2 * span; q++) {
      const cx = pointy ? origin.x + grid.size * (q + r / 2) : origin.x + 1.5 * radius * q;
      const cy = pointy ? origin.y + 1.5 * radius * r : origin.y + grid.size * (r + q / 2);
      if (cx < -grid.size || cx > width + grid.size || cy < -grid.size || cy > height + grid.size) continue;
      for (let i = 0; i < 6; i++) {
        const a = startAngle + (Math.PI / 3) * i;
        const b = a + Math.PI / 3;
        const ax = cx + radius * Math.cos(a);
        const ay = cy + radius * Math.sin(a);
        const bx = cx + radius * Math.cos(b);
        const by = cy + radius * Math.sin(b);
        if (!inside(ax, ay) || !inside(bx, by)) continue;
        const edge = [key(ax, ay), key(bx, by)].sort().join('|');
        if (seen.has(edge)) continue;
        seen.add(edge);
        push(ax, ay, bx, by);
      }
    }
  }
  return out;
}

export class BoardSurface {
  readonly object3d = new THREE.Group();
  private readonly image: THREE.MeshStandardMaterial;
  private grid: THREE.LineSegments | null = null;

  constructor(readonly width: number, readonly height: number, private readonly gridState: BoardGrid) {
    const span = Math.max(width, height);
    this.image = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9, metalness: 0 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2), this.image);
    plane.position.set(width / 2, 0, height / 2);
    plane.receiveShadow = true;

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
    this.object3d.add(floor, frame, plane);
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(gridSegments(grid, this.width, this.height), 3));
    const color = grid.color ?? (image ? contrastColor(image) : '#000000');
    this.grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: grid.opacity, depthWrite: false }));
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
