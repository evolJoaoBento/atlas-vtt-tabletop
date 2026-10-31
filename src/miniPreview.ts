/**
 * The picture "Assign mini…" shows of the mini on its token: the token's square, and the mini standing in it at the size,
 * turn and base chosen, drawn by the same figure the board uses, so what is seen is how it will stand. The square stays
 * one size while the mini changes, so a size is judged against it. One small renderer, made on first use and let go
 * when the window closes.
 */
import * as THREE from 'three';
import type { MiniBase } from './assignments';
import { MiniFigure, MINI_FILL } from './figure';
import type { LoadedMini } from './library';
import { MINI_BASE_COLOR, MINI_BASE_THICKNESS, miniBaseGeometry } from './miniBase';

export interface PreviewChoice {
  scale: number;
  turn: number;
  base: MiniBase;
}

/**
 * How much the view takes in, in token squares: a fixed amount while the mini fits (so the square stays one size and a
 * size is judged against it), and more once the mini would be cut off.
 */
export function previewReach(model: { height: number; footprint: number } | null, scale: number, base: MiniBase): number {
  if (!model) return MIN_REACH;
  const height = ((model.height * MINI_FILL) / model.footprint) * scale + (base === 'none' ? 0 : MINI_BASE_THICKNESS);
  const width = MINI_FILL * scale;
  return Math.max(MIN_REACH, height * 1.4, width * 1.5);
}

const MIN_REACH = 1.7;

export class MiniPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  private figure: MiniFigure | null = null;
  private model: LoadedMini | null = null;
  private baseMesh: THREE.Mesh | null = null;
  private choice: PreviewChoice = { scale: 1, turn: 0, base: 'none' };
  /** Whether a drawing context was made; false where the device cannot draw one. */
  ok = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.ok = false;
      return;
    }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1.5, 3, 2);
    this.scene.add(sun);
    // The token's square: a lit floor with a bright edge, one unit on a side, on a darker table.
    const flat = (size: number): THREE.PlaneGeometry => new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(flat(1), new THREE.MeshStandardMaterial({ color: 0x8d8678, roughness: 0.9 }));
    floor.position.y = -0.001;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(flat(1)), new THREE.LineBasicMaterial({ color: 0xf2e6c8 }));
    const table = new THREE.Mesh(flat(40), new THREE.MeshStandardMaterial({ color: 0x4a463f, roughness: 1 }));
    table.position.y = -0.01;
    this.scene.add(table, floor, edge);
    this.frame();
  }

  setMini(model: LoadedMini | null): void {
    if (!this.renderer || model === this.model) return;
    this.figure?.dispose();
    this.figure?.anchor.removeFromParent();
    this.figure = null;
    this.model = model;
    if (model) {
      const figure = new MiniFigure();
      figure.attach(model);
      this.scene.add(figure.anchor);
      this.figure = figure;
    }
    this.apply();
  }

  set(choice: PreviewChoice): void {
    this.choice = choice;
    this.apply();
  }

  private apply(): void {
    if (!this.renderer) return;
    const { scale, turn, base } = this.choice;
    this.baseMesh?.removeFromParent();
    this.baseMesh?.geometry.dispose();
    (this.baseMesh?.material as THREE.Material | undefined)?.dispose();
    this.baseMesh = null;
    let top = 0;
    if (base !== 'none') {
      this.baseMesh = new THREE.Mesh(miniBaseGeometry(base, 1), new THREE.MeshStandardMaterial({ color: MINI_BASE_COLOR, roughness: 0.55, metalness: 0.1 }));
      this.baseMesh.position.y = MINI_BASE_THICKNESS / 2;
      this.scene.add(this.baseMesh);
      top = MINI_BASE_THICKNESS;
    }
    if (this.figure) {
      this.figure.pose({ x: 0, y: 0, worldX: 0, worldY: 0, zoom: 1, size: 1, scale, turn, dt: 0, now: 0 });
      this.figure.anchor.position.y = top;
    }
    this.frame();
    this.render();
  }

  /** Aims the camera at the square, from the front and above, far enough that the mini fits. */
  private frame(): void {
    const reach = previewReach(this.model, this.choice.scale, this.choice.base);
    const distance = (reach / 2) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    const target = new THREE.Vector3(0, reach * 0.18, 0);
    this.camera.position.copy(target).add(new THREE.Vector3(0.45, 0.62, 1).normalize().multiplyScalar(distance));
    this.camera.lookAt(target);
  }

  render(): void {
    if (!this.renderer) return;
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    const ratio = Math.min(2, this.canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.figure?.dispose();
    this.baseMesh?.geometry.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.figure = null;
  }
}
