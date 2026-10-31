/**
 * The rings that show which tokens a Shift-click selection holds: one flat ring on the board under each, as wide as
 * the token's own ring.
 */
import * as THREE from 'three';

/** The selection's ring colour; the active combatant's ring is `ACTIVE_COLOR`. */
export const GROUP_COLOR = 0xffc857;
export const ACTIVE_COLOR = 0x4ade80;
/** Just above the board and the tokens' bases, so the ring is not lost in the map's art. */
const LIFT = 0.8;

export class GroupMarks {
  readonly object3d = new THREE.Group();
  private readonly geometry = new THREE.RingGeometry(0.46, 0.5, 48).rotateX(-Math.PI / 2);
  private readonly material: THREE.MeshBasicMaterial;
  private readonly rings = new Map<string, THREE.Mesh>();

  constructor(color: number = GROUP_COLOR, private readonly scale = 1.08) {
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  }

  /** Rings under exactly these tokens (`place` gives a token's centre and ring diameter, null when it is gone). */
  update(ids: Iterable<string>, place: (id: string) => { x: number; y: number; diameter: number } | null): void {
    const wanted = new Set<string>();
    for (const id of ids) {
      const where = place(id);
      if (!where) continue;
      wanted.add(id);
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.geometry, this.material);
        ring.renderOrder = 5;
        this.rings.set(id, ring);
        this.object3d.add(ring);
      }
      ring.position.set(where.x, LIFT, where.y);
      ring.scale.set(where.diameter * this.scale, 1, where.diameter * this.scale);
    }
    for (const [id, ring] of this.rings) {
      if (wanted.has(id)) continue;
      this.object3d.remove(ring);
      this.rings.delete(id);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object3d.clear();
    this.rings.clear();
  }
}
