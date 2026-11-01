/**
 * The handles for placing a scene of a stack: two arrows to slide it along the map's x and y, a square between them to
 * slide it freely, and a ring to turn it about the middle. Lying on the scene's plane, drawn over everything, and kept
 * the same size on screen. `hit` says which handle a ray meets; the board does the dragging.
 */
import * as THREE from 'three';

export type GizmoPart = 'move' | 'x' | 'z' | 'turn';

const COLORS: Record<GizmoPart, number> = { move: 0xffffff, x: 0xf0524f, z: 0x4f8ff0, turn: 0xf5c542 };

function material(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
}

export class PlacementGizmo {
  readonly object3d = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];

  constructor() {
    this.object3d.name = 'placement-gizmo';
    this.object3d.renderOrder = 1000;
    const add = (part: GizmoPart, geometry: THREE.BufferGeometry, place: (mesh: THREE.Mesh) => void): void => {
      const mesh = new THREE.Mesh(geometry, material(COLORS[part]));
      mesh.userData.part = part;
      mesh.renderOrder = 1000;
      place(mesh);
      this.meshes.push(mesh);
      this.object3d.add(mesh);
    };
    // The square in the middle.
    add('move', new THREE.PlaneGeometry(0.34, 0.34).rotateX(-Math.PI / 2), () => undefined);
    // The arrows: a shaft and a head along +x and along +z (the map's down).
    for (const part of ['x', 'z'] as const) {
      const turn = (mesh: THREE.Mesh): void => { if (part === 'x') mesh.rotation.z = -Math.PI / 2; else mesh.rotation.x = Math.PI / 2; };
      add(part, new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8).translate(0, 0.55, 0), turn);
      add(part, new THREE.ConeGeometry(0.11, 0.26, 12).translate(0, 1.05, 0), turn);
    }
    // The ring, wide enough to reach from outside the arrows' tips.
    add('turn', new THREE.TorusGeometry(1.45, 0.07, 8, 72).rotateX(Math.PI / 2), () => undefined);
  }

  /** The handle nearest along the ray, or null. */
  hit(raycaster: THREE.Raycaster): GizmoPart | null {
    this.object3d.updateMatrixWorld(true);
    const found = raycaster.intersectObjects(this.meshes, false)[0];
    return (found?.object.userData.part as GizmoPart | undefined) ?? null;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.object3d.removeFromParent();
  }
}
