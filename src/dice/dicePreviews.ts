/**
 * A picture of each die of the chosen pack for the dice tray's buttons, as Atlas's tray shows a picture of each of its
 * dice: the die built as the table builds it, with the pack's face art, a little turned so it reads as a solid. One
 * small WebGL renderer draws them all in turn and is given back at once; the pictures are drawn again as the pack's
 * sheets decode.
 */
import * as THREE from 'three';
import { dieMaterial } from './kit/dieShapes';
import type { DieType } from './kit/faces';
import type { ChosenPack } from './dicePack';
import { buildDie } from './dieBuild';
import { DiceTextures } from './diceTextures';

const PIXELS = 96;
const TILT = new THREE.Euler(-0.5, 0.45, 0.1);

export class DicePreviews {
  private readonly urls = new Map<DieType, string>();
  private textures: DiceTextures | null = null;
  private timer = 0;
  private disposed = false;

  /** `onChange`: the pictures were drawn (again). */
  constructor(private readonly doc: Document, private readonly onChange: () => void) {}

  /** The picture of a die, or null until it is drawn. */
  url(type: DieType): string | null {
    return this.urls.get(type) ?? null;
  }

  /** Draws every die of `pack`; again a moment after each of its sheets decodes. */
  draw(pack: ChosenPack, types: readonly DieType[]): void {
    this.textures?.dispose();
    const textures = new DiceTextures(pack, this.doc, () => this.later(() => this.render(pack, types, textures)));
    this.textures = textures;
    this.render(pack, types, textures);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) this.doc.defaultView?.clearTimeout(this.timer);
    this.textures?.dispose();
    this.textures = null;
  }

  /** Waits for the sheets decoding together to be done before drawing again. */
  private later(draw: () => void): void {
    if (this.disposed || this.timer) return;
    this.timer = this.doc.defaultView?.setTimeout(() => {
      this.timer = 0;
      draw();
    }, 120) ?? 0;
  }

  private render(pack: ChosenPack, types: readonly DieType[], textures: DiceTextures): void {
    if (this.disposed || textures !== this.textures) return;
    const canvas = this.doc.win.createEl('canvas');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      // No WebGL to spare: the buttons keep their names.
      return;
    }
    try {
      renderer.setSize(PIXELS, PIXELS, false);
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      // Lit as the board lights its dice, from the front and a little above, so the faces read on the button.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.6));
      const sun = new THREE.DirectionalLight(0xffffff, 3.2);
      sun.position.set(1, 2, 4);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
      camera.position.set(0, 0, 4);
      for (const type of types) {
        const { geometry } = buildDie(type, 0.5, pack.config);
        const material = dieMaterial(type, pack.config, textures.textures(type, null), null);
        const mesh = new THREE.Mesh(geometry, material);
        geometry.computeBoundingSphere();
        mesh.scale.setScalar(0.95 / (geometry.boundingSphere?.radius || 1));
        mesh.rotation.copy(TILT);
        scene.add(mesh);
        renderer.render(scene, camera);
        this.urls.set(type, canvas.toDataURL('image/png'));
        scene.remove(mesh);
        geometry.dispose();
        (Array.isArray(material) ? material : [material]).forEach((made: THREE.Material) => made.dispose());
      }
    } finally {
      renderer.dispose();
      renderer.forceContextLoss();
    }
    this.onChange();
  }
}
