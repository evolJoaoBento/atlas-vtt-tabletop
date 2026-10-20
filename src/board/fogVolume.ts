/**
 * Atlas's fog of war standing on the 3D board: each area of fog (with the holes erased out of it) raised into a block
 * as tall as the GM set, in grid squares. The GM sees through it, as Atlas shows fog to the GM at half strength; a
 * faint outline marks its edges so its shape reads from any angle. The players' picture shows it solid and
 * unoutlined (`show('player')`, for that window's pass). Rebuilt only when the fog or its height changes.
 */
import * as THREE from 'three';
import { fogAreas, type FogArea, type FogOperation } from './fog';

/** Atlas shows the GM the fog at half strength. */
const GM_OPACITY = 0.5;
/** Just over the board, so its floor does not flicker with the map. */
const FLOOR = 0.5;

export class FogVolume {
  readonly object3d = new THREE.Group();
  private key = '';
  private readonly sides = new THREE.MeshStandardMaterial({ color: 0x0b0b10, transparent: true, opacity: GM_OPACITY, depthWrite: false, roughness: 1, side: THREE.DoubleSide });
  private readonly caps = new THREE.MeshStandardMaterial({ color: 0x24242c, transparent: true, opacity: GM_OPACITY, depthWrite: false, roughness: 1, side: THREE.DoubleSide });
  private readonly edges = new THREE.LineBasicMaterial({ color: 0x9aa0b4, transparent: true, opacity: 0.35, depthWrite: false });
  /** Players cannot see through it: their own solid materials, swapped in for their pass. */
  private readonly playerSides = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 1, side: THREE.DoubleSide });
  private readonly playerCaps = new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 1, side: THREE.DoubleSide });
  private blocks: Array<{ mesh: THREE.Mesh; outline: THREE.LineSegments; extruded: boolean }> = [];
  /** The fog's areas, for what players cannot see under it. */
  areas: FogArea[] = [];

  constructor() {
    this.object3d.name = 'fog';
  }

  /** Shows the fog of `operations`, `height` grid squares of `cellSize` pixels tall (0 lays it flat on the map). */
  update(operations: readonly FogOperation[], height: number, cellSize: number): void {
    const key = JSON.stringify([operations, height, cellSize]);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const tall = Math.max(0, height) * cellSize;
    this.areas = fogAreas(operations);
    for (const area of this.areas) {
      // Map y runs down the board (+z); a shape's y is flipped so laying it down puts it back.
      const shape = new THREE.Shape(area.outer.map((point) => new THREE.Vector2(point.x, -point.y)));
      shape.holes = area.holes.map((hole) => new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, -point.y))));
      const geometry = tall > 0 ? new THREE.ExtrudeGeometry(shape, { depth: tall, bevelEnabled: false, curveSegments: 1 }) : new THREE.ShapeGeometry(shape, 1);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, FLOOR, 0);
      // An extrusion's first group is its caps (floor and top), its second its sides.
      const block = new THREE.Mesh(geometry, tall > 0 ? [this.caps, this.sides] : this.caps);
      block.renderOrder = 5;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), this.edges);
      outline.renderOrder = 6;
      this.object3d.add(block, outline);
      this.blocks.push({ mesh: block, outline, extruded: tall > 0 });
    }
  }

  /** Dresses the fog for whose picture is drawn next: the GM's see-through, the players' solid. */
  show(viewer: 'gm' | 'player'): void {
    const gm = viewer === 'gm';
    for (const { mesh, outline, extruded } of this.blocks) {
      mesh.material = extruded ? (gm ? [this.caps, this.sides] : [this.playerCaps, this.playerSides]) : (gm ? this.caps : this.playerCaps);
      outline.visible = gm;
    }
  }

  /** Whether there is any fog on the map. */
  get empty(): boolean {
    return this.object3d.children.length === 0;
  }

  private clear(): void {
    this.blocks = [];
    this.areas = [];
    for (const child of [...this.object3d.children]) {
      (child as THREE.Mesh | THREE.LineSegments).geometry.dispose();
      child.removeFromParent();
    }
  }

  dispose(): void {
    this.clear();
    this.sides.dispose();
    this.caps.dispose();
    this.edges.dispose();
    this.playerSides.dispose();
    this.playerCaps.dispose();
    this.object3d.removeFromParent();
  }
}
