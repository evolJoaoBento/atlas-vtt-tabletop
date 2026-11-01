/**
 * The picture "Edit material…" shows of a material: a wall four squares long and two tall, mapped the way the board maps
 * it, lit from the side so the relief shows. It is drawn by three.js with the material's own maps, so what is seen is
 * what the board draws for these settings. The light follows the pointer over the picture, and the camera turns, pans
 * and zooms. One small renderer, made on first use and let go when the window closes.
 */
import * as THREE from 'three';
import { EDGE_SHARE } from './board/quality';
import { DISPLACE_DETAIL, pushBox } from './board/wallPieces';
import type { LoadedMaterial } from './materials';
import type { MaterialTuning } from './materialMaps';

const LENGTH = 4;
const HEIGHT = 2;
const THICK = 0.3;
/** The camera's start: turned a little to the right of the wall's face and above it, looking at its middle. */
const START = { yaw: 0.13, pitch: 0.1, distance: 4.7 };
const CENTRE = new THREE.Vector3(LENGTH / 2, HEIGHT / 2, 0);
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 14;

export class MaterialPreview {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 2, 0.1, 50);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  private readonly material = new THREE.MeshStandardMaterial({ color: 0x777777 });
  private readonly wall: THREE.Mesh;
  private loaded: LoadedMaterial | null = null;
  private readonly target = CENTRE.clone();
  private yaw = START.yaw;
  private pitch = START.pitch;
  private distance = START.distance;
  /** Whether a drawing context was made; false where the device cannot draw one. */
  ok = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.ok = false;
    }
    const data = { positions: [] as number[], normals: [] as number[], uvs: [] as number[], reach: [] as number[] };
    pushBox(data, LENGTH / 2, 0, 0, LENGTH, THICK, 0, HEIGHT, 1, DISPLACE_DETAIL, { start: true, end: true, share: EDGE_SHARE.soft });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setAttribute('reach', new THREE.Float32BufferAttribute(data.reach, 1));
    this.wall = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.wall, new THREE.HemisphereLight(0xffffff, 0x444444, 0.9), this.sun);
    this.sun.target.position.set(LENGTH / 2, HEIGHT / 2, 0);
    this.scene.add(this.sun.target);
    this.place();
    this.lightAt(0.1, 0.5);
  }

  /** Puts a material's maps on the wall; its own settings are the first to show. */
  show(loaded: LoadedMaterial, tuning: MaterialTuning, scale: number): void {
    this.loaded = loaded;
    loaded.apply(this.material);
    loaded.retile(scale);
    loaded.tune(this.material, tuning);
    this.material.needsUpdate = true;
    this.render();
  }

  tune(tuning: MaterialTuning): void {
    this.loaded?.tune(this.material, tuning);
    this.render();
  }

  retile(scale: number): void {
    this.loaded?.retile(scale);
    this.render();
  }

  private place(): void {
    const flat = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * flat, this.target.y + Math.sin(this.pitch) * this.distance, this.target.z + Math.cos(this.yaw) * flat);
    this.camera.lookAt(this.target);
  }

  /** Turns the camera round what it looks at by a drag of `dx`, `dy` pixels; it never goes under the wall's foot or over its head. */
  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.008;
    this.pitch = Math.min(1.45, Math.max(-0.35, this.pitch + dy * 0.008));
    this.place();
    this.render();
  }

  /** Slides the camera across the picture by a drag of `dx`, `dy` pixels. */
  pan(dx: number, dy: number): void {
    const height = this.canvas.clientHeight || this.canvas.height || 1;
    const perPixel = (2 * this.distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / height;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * perPixel).addScaledVector(up, dy * perPixel);
    this.target.clamp(new THREE.Vector3(-1, -1, -2), new THREE.Vector3(LENGTH + 1, HEIGHT + 1, 2));
    this.place();
    this.render();
  }

  /** Moves the camera in (a factor under 1) or out (over 1). */
  zoom(factor: number): void {
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance * factor));
    this.place();
    this.render();
  }

  /** Back to the first view. */
  resetView(): void {
    this.target.copy(CENTRE);
    Object.assign(this, { yaw: START.yaw, pitch: START.pitch, distance: START.distance });
    this.place();
    this.render();
  }

  /** Aims the light: `u` across the picture (0 left, 1 right) and `v` down it (0 top, 1 bottom). A low sideways light shows relief best. */
  lightAt(u: number, v: number): void {
    this.sun.position.set(LENGTH * (u * 2 - 0.5), HEIGHT * (1.6 - v * 1.4), 0.5 + 1.2 * (1 - Math.abs(u - 0.5) * 2));
    this.render();
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
    this.wall.geometry.dispose();
    this.material.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.loaded = null;
  }
}
