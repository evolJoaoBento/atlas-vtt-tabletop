/**
 * The liquid to the horizon (`ground.ts`, water, lava or acid mode): painted liquid's own surface (`waterSurface.ts`),
 * wet everywhere and running far out round the map (as far as the ground's `planeReach` says), over a plain bed a few
 * squares down that clearer water and acid show (lava hides it). It moves and looks as the GM sets it, with the same
 * settings as the painted liquid. It lies a hair under the map.
 */
import * as THREE from 'three';
import { WaterMask, type LiquidKind, type WaterMotion } from './water';
import { WaterSurface } from './waterSurface';

/** How deep the bed lies, in squares. */
const DEPTH = 2.5;

export class SeaPlane {
  readonly object3d = new THREE.Group();
  private surface: WaterSurface | null = null;
  private readonly bed: THREE.Mesh;
  private key = '';

  constructor() {
    this.object3d.name = 'sea';
    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a4434, roughness: 1, metalness: 0 }));
    this.bed.receiveShadow = true;
    this.object3d.add(this.bed);
  }

  /** The liquid it is now. */
  get liquid(): LiquidKind {
    return this.surface?.liquid ?? 'water';
  }

  /**
   * Lays it round a map `width` by `height` (world units, `cell` a square), `reach` from the map's middle each way,
   * the liquid `liquid` moving and looking as `motion` says.
   */
  update(motion: WaterMotion, area: { width: number; height: number; cell: number; reach: number }, liquid: LiquidKind = 'water'): void {
    const reach = area.reach * 2;
    const key = JSON.stringify([reach, area.cell, liquid]);
    if (key !== this.key) {
      this.key = key;
      this.surface?.dispose();
      const mask = WaterMask.forMap(reach, reach, area.cell);
      mask.data.fill(255);
      this.surface = new WaterSurface(mask, reach, reach, area.cell, motion, liquid);
      // Under the map's floor (which is drawn over it), centred on the map: a tenth of a square down, so the water's
      // own depth offset (it is drawn over painted floors) never brings it up through the map far from the camera.
      this.surface.object3d.position.set(area.width / 2, -area.cell * 0.1, area.height / 2);
      this.object3d.add(this.surface.object3d);
      this.bed.scale.set(reach, 1, reach);
      this.bed.position.set(area.width / 2, -DEPTH * area.cell, area.height / 2);
      this.bed.visible = liquid !== 'lava';
    }
    this.surface?.setMotion(motion);
  }

  /** Moves the liquid on to this time, in seconds. */
  tick(seconds: number): void {
    this.surface?.tick(seconds);
  }

  dispose(): void {
    this.surface?.dispose();
    this.bed.geometry.dispose();
    (this.bed.material as THREE.Material).dispose();
    this.object3d.removeFromParent();
  }
}
