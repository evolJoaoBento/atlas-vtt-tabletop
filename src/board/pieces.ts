/**
 * What stands on the board: tokens, pins and props.
 *
 * A token floats a little above its spot. Without a mini it is a disc (its art on top of a thick coin, Atlas's ring
 * around it) or a standee (its art upright on a round base, turned to face the camera). With a mini there is no
 * disc: the mini stands on the board inside Atlas's ring and moves the way Tabletop's minis always have
 * (`MiniFigure`). A hidden token is half transparent with Atlas's crossed-out eye over it, as the GM sees it in Atlas.
 *
 * A pin is Atlas's pin, kept one size on screen like Atlas's, with its title over it. A prop is a GLB standing on the
 * board, sized to a grid cell.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { MiniPlacement } from '../assignments';
import { MiniFigure } from '../figure';
import type { LoadedMini } from '../library';
import type { TokenStyle, PropPlacement } from './boardData';
import { hexCenter, ringDiameter, tokenDiameter } from './geometry';
import type { BoardGrid, BoardPin, BoardToken } from './mapModel';
import { pinTitle } from './pinIcons';
import { downedMarkerTexture, hiddenMarkerTexture, pinTexture, plateTexture } from './textures';

/**
 * How far a token floats over the board, and how thick its disc is, as shares of its diameter. A token with a mini has
 * no disc: the mini stands on the board inside the token's ring.
 */
const DISC_LIFT = 0.15;
const DISC_THICKNESS = 0.12;
/** How high a carried token is held, as a share of its diameter, so a leaning mini never dips into the board. */
const CARRY_HEIGHT = 0.35;
/** How fast it is picked up and set down, per second. */
const CARRY_SPEED = 12;
/** How fast a downed figure falls over, per second. */
const FALL_SPEED = 8;

/**
 * Greys out a material (a downed token, as Atlas greys it): a step added at the end of its shader, switched by a
 * uniform so toggling it needs no recompile.
 */
function setGrey(root: THREE.Object3D, grey: boolean): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.userData.grey = grey ? 1 : 0;
      const uniform = material.userData.greyUniform as { value: number } | undefined;
      if (uniform) { uniform.value = material.userData.grey; continue; }
      if (material.userData.greyHooked) continue;
      material.userData.greyHooked = true;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrey = { value: material.userData.grey };
        material.userData.greyUniform = shader.uniforms.uGrey;
        shader.fragmentShader = `uniform float uGrey;\n${shader.fragmentShader}`.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114))), uGrey);',
        );
      };
      material.customProgramCacheKey = () => 'tabletop-grey';
      material.needsUpdate = true;
    }
  });
}
/** The standee's base, as a share of the diameter. */
const STANDEE_BASE = 0.9;
const STANDEE_BASE_THICKNESS = 0.06;
const HIDDEN_OPACITY = 0.5;
/** A pin's size on screen (Atlas: a 20 px radius), and its title's. */
const PIN_PX = 40;
const TITLE_PX = 22;
/** How far a pin floats over the board, in grid cells. */
const PIN_LIFT = 0.6;
/** A prop at scale 1 fills this share of a cell. */
const PROP_FILL = 0.9;

const EDGE_COLOR = 0x2b2118;
/**
 * A mini's blob shadow: its radius as a share of the token's diameter, how far it falls away from the sun (which
 * shines from the map's top left), and how dark it is.
 */
const BLOB_RADIUS = 0.9;
const BLOB_OFFSET = 0.18;
const BLOB_OPACITY = 0.7;

let blobTexture: THREE.Texture | null = null;

/** A soft round shadow, drawn once and shared by every mini (never freed with a piece). */
function blob(): THREE.Texture {
  if (blobTexture) return blobTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(canvas);
  return blobTexture;
}

/** What a piece needs from the board each frame. */
export interface PoseContext {
  dt: number;
  now: number;
  /** Screen pixels per world unit at the camera's target, for the minis' lean. */
  zoom: number;
  /** The camera's yaw, which standees turn to face. */
  yaw: number;
  /** The sprite scale of one screen pixel (see `screenScale`). */
  pixel: number;
}

/**
 * Frees a piece's own geometry and materials. Textures are freed only with `ownMaps`: token art and a GLB's textures
 * are shared and outlive the piece, while a pin's drawn canvases are its own. A copy of a GLB shares its geometry
 * too, so it is freed without `ownGeometry`.
 */
function disposeTree(root: THREE.Object3D, ownMaps = false, ownGeometry = true): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (ownGeometry) mesh.geometry?.dispose();
    const materials = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
    for (const material of materials) {
      if (ownMaps) (material as THREE.MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
  });
}

export class TokenPiece {
  /** At the token's spot on the board; everything of the token hangs from it. */
  readonly object3d = new THREE.Group();
  /** An invisible column over the token that the pointer hits, mini or not. */
  readonly hitTarget: THREE.Mesh;
  /** Tips the token over when it is downed; the body hangs from it. */
  readonly fall = new THREE.Group();
  /** What stays on the board when the figure falls: the ring and the blob shadow. */
  private readonly ground = new THREE.Group();
  private readonly body = new THREE.Group();
  private fallen = 0;
  private skull: THREE.Sprite | null = null;
  private readonly materials: THREE.Material[] = [];
  private art: THREE.Texture | null = null;
  private style: TokenStyle = 'disc';
  private figure: MiniFigure | null = null;
  private model: LoadedMini | null = null;
  private placement: MiniPlacement | null = null;
  private standee: THREE.Group | null = null;
  private marker: THREE.Sprite | null = null;
  private token: BoardToken;
  /** Being carried: it rises off the board, and sets down when let go. */
  carried = false;
  /** Whether a mini casts its own shadow or has a soft blob under it (the board's quality). */
  private miniShadows: 'real' | 'blob' = 'blob';
  private blobShadow: THREE.Mesh | null = null;
  private carry = 0;

  constructor(token: BoardToken, private readonly grid: BoardGrid) {
    this.token = token;
    this.fall.add(this.body);
    this.object3d.add(this.fall, this.ground);
    this.hitTarget = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitTarget.userData.tokenId = token.id;
    this.object3d.add(this.hitTarget);
    this.build();
  }

  get id(): string {
    return this.token.id;
  }

  get diameter(): number {
    return tokenDiameter(this.grid, this.token.size);
  }

  /** How high the disc floats: a token with a mini stands on the board. */
  private get lift(): number {
    return this.model ? 0 : this.diameter * DISC_LIFT;
  }

  private get thickness(): number {
    return this.model ? 0 : this.diameter * DISC_THICKNESS;
  }

  /** The height of the disc's top face over the board, where a mini stands. */
  get top(): number {
    return this.lift + this.thickness;
  }

  /** How tall the token stands upright. */
  private uprightHeight(): number {
    if (this.model && this.placement) {
      const base = (this.diameter * this.placement.scale * 0.9) / this.model.footprint;
      return this.top + this.model.height * base;
    }
    if (this.style === 'standee') return this.diameter * STANDEE_BASE_THICKNESS + this.standeeHeight();
    return this.top;
  }

  /** Whether a downed token tips over: a mini or a standee does; a disc already lies flat. */
  private get tips(): boolean {
    return this.model !== null || this.style === 'standee';
  }

  /** How tall the token is now, for the labels over it: lower as a downed figure falls. */
  figureHeight(): number {
    const upright = this.uprightHeight();
    if (!this.tips) return upright;
    return upright + (this.diameter * 0.45 - upright) * this.fallen;
  }

  get animating(): boolean {
    return (this.figure?.animating ?? false) || this.carry !== (this.carried ? 1 : 0) || this.fallen !== (this.downed ? 1 : 0);
  }

  /** A character at 0 HP or less, as Atlas draws it: greyed out, with a skull, and here lying down. */
  get downed(): boolean {
    return this.token.kind === 'character' && this.token.hp !== null && this.token.hp.current <= 0;
  }

  update(token: BoardToken): void {
    const wasDowned = this.downed;
    const rebuild = token.size !== this.token.size || token.rotation !== this.token.rotation || token.showRing !== this.token.showRing || token.ringColor !== this.token.ringColor || token.hidden !== this.token.hidden;
    this.token = token;
    if (rebuild) this.build();
    else if (wasDowned !== this.downed) this.markDowned();
  }

  /** Greys the token and shows the skull while it is downed. */
  private markDowned(): void {
    setGrey(this.body, this.downed);
    setGrey(this.ground, this.downed);
    if (this.downed && !this.skull) {
      this.skull = new THREE.Sprite(new THREE.SpriteMaterial({ map: downedMarkerTexture(), sizeAttenuation: false, depthTest: false, transparent: true }));
      this.skull.renderOrder = 10;
      this.skull.position.y = this.diameter * 0.45;
      this.object3d.add(this.skull);
    } else if (!this.downed && this.skull) {
      this.skull.removeFromParent();
      this.skull.material.map?.dispose();
      this.skull.material.dispose();
      this.skull = null;
    }
  }

  setArt(texture: THREE.Texture | null): void {
    if (this.art === texture) return;
    this.art = texture;
    this.build();
  }

  setStyle(style: TokenStyle): void {
    if (this.style === style) return;
    this.style = style;
    this.build();
  }

  setMini(model: LoadedMini | null, placement: MiniPlacement | null): void {
    if (model === this.model && placement?.mini === this.placement?.mini && placement?.scale === this.placement?.scale && placement?.turn === this.placement?.turn) return;
    const changedModel = model !== this.model;
    this.model = model;
    this.placement = placement;
    if (changedModel || !model) this.build();
  }

  /** Draws the token at (x, y) on the map this frame. */
  pose(x: number, y: number, context: PoseContext): void {
    const goal = this.carried ? 1 : 0;
    this.carry += (goal - this.carry) * (1 - Math.exp(-CARRY_SPEED * context.dt));
    if (Math.abs(goal - this.carry) < 1e-3) this.carry = goal;
    // A downed mini or standee tips over onto its side; a disc is already lying flat.
    const fallGoal = this.downed ? 1 : 0;
    this.fallen += (fallGoal - this.fallen) * (1 - Math.exp(-FALL_SPEED * context.dt));
    if (Math.abs(fallGoal - this.fallen) < 1e-3) this.fallen = fallGoal;
    // It falls toward screen right and lies centred over its own cell, raised by about its thickness.
    const tips = this.tips;
    this.fall.rotation.z = tips ? -this.fallen * (Math.PI / 2) : 0;
    this.fall.position.set(tips ? -this.fallen * (this.uprightHeight() / 2) : 0, tips ? this.fallen * this.diameter * 0.2 : 0, 0);
    if (this.skull) this.skull.scale.setScalar(context.pixel * Math.min(40, this.diameter * 0.5) * 0.6);
    this.object3d.position.set(x, this.carry * this.diameter * CARRY_HEIGHT, y);
    if (this.standee) this.standee.rotation.y = context.yaw;
    if (this.marker) this.marker.scale.setScalar(context.pixel * Math.min(40, this.diameter * 0.5) * 0.6);
    if (this.figure && this.placement) {
      this.figure.pose({
        x: 0, y: 0, worldX: x, worldY: y, zoom: context.zoom,
        size: this.diameter, scale: this.placement.scale, turn: this.token.rotation + this.placement.turn, dt: context.dt, now: context.now,
      });
    }
    const height = this.figureHeight();
    const radius = ringDiameter(this.grid, this.token.size) / 2;
    this.hitTarget.scale.set(radius, height, radius);
    this.hitTarget.position.y = height / 2;
  }

  shake(now: number): void {
    this.figure?.shake(now);
  }

  /** A mini's shadow: the model's own (sharp, costs a second drawing of it) or a soft blob under it. */
  setMiniShadows(mode: 'real' | 'blob'): void {
    this.miniShadows = mode;
    if (this.blobShadow) this.blobShadow.visible = mode === 'blob';
    this.figure?.anchor.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData.fromMini = true;
      mesh.castShadow = mode === 'real';
    });
  }

  private material(options: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const hidden = this.token.hidden;
    const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05, ...options, transparent: hidden || options.transparent === true, opacity: hidden ? HIDDEN_OPACITY : 1 });
    this.materials.push(material);
    return material;
  }

  private standeeHeight(): number {
    const image = this.art?.image as { width?: number; height?: number } | undefined;
    const aspect = image?.width && image.height ? image.height / image.width : 1;
    return this.diameter * aspect;
  }

  /** Builds the token's meshes for its current style, art, mini and ring. */
  private build(): void {
    this.figure?.dispose();
    this.figure = null;
    disposeTree(this.body);
    this.body.clear();
    disposeTree(this.ground);
    this.ground.clear();
    this.materials.length = 0;
    this.standee = null;
    this.blobShadow = null;
    if (this.marker) {
      this.marker.removeFromParent();
      this.marker.material.map?.dispose();
      this.marker.material.dispose();
      this.marker = null;
    }
    const d = this.diameter;
    const ringColor = new THREE.Color(this.token.ringColor);
    const artColor = this.art ? 0xffffff : ringColor.getHex();

    if (this.style === 'standee' && !this.model) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry((d * STANDEE_BASE) / 2, (d * STANDEE_BASE) / 2, d * STANDEE_BASE_THICKNESS, 48), this.material({ color: this.token.showRing ? ringColor : EDGE_COLOR }));
      base.position.y = (d * STANDEE_BASE_THICKNESS) / 2;
      base.castShadow = true;
      base.receiveShadow = true;
      const height = this.standeeHeight();
      const card = new THREE.Mesh(new THREE.PlaneGeometry(d, height), this.material({ map: this.art, color: artColor, side: THREE.DoubleSide, alphaTest: 0.5 }));
      card.position.y = d * STANDEE_BASE_THICKNESS + height / 2;
      card.castShadow = true;
      this.standee = new THREE.Group();
      this.standee.add(card);
      this.body.add(base, this.standee);
    } else {
      if (!this.model) {
        const { thickness } = this;
        const coin = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, thickness, 64), this.material({ color: EDGE_COLOR }));
        coin.position.y = this.lift + thickness / 2;
        coin.castShadow = true;
        coin.receiveShadow = true;
        const face = new THREE.Mesh(new THREE.CircleGeometry(d / 2, 64).rotateX(-Math.PI / 2), this.material({ map: this.art, color: artColor, polygonOffset: true, polygonOffsetFactor: -1 }));
        face.position.y = this.top + 0.05;
        // Atlas turns the art clockwise on screen: about +y that is a negative turn.
        face.rotation.y = -THREE.MathUtils.degToRad(this.token.rotation);
        face.receiveShadow = true;
        this.body.add(coin, face);
      }
      if (this.token.showRing) {
        const outer = ringDiameter(this.grid, this.token.size) / 2;
        const tube = Math.max(0.5, (outer - d / 2) / 2);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(d / 2 + tube, tube, 12, 64).rotateX(Math.PI / 2), this.material({ color: ringColor, metalness: 0.3, roughness: 0.4 }));
        // Around the disc's top edge; with a mini, lying on the board.
        ring.position.y = this.model ? tube : this.top;
        ring.castShadow = true;
        // On the ground: a downed figure tips over, its ring stays.
        this.ground.add(ring);
      }
    }

    if (this.model && this.placement) {
      const figure = new MiniFigure();
      figure.attach(this.model);
      const holder = new THREE.Group();
      holder.position.y = this.top;
      holder.add(figure.anchor);
      this.body.add(holder);
      if (this.token.hidden) figure.fade(HIDDEN_OPACITY);
      this.figure = figure;
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(d * BLOB_RADIUS, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          map: blob(), transparent: true, opacity: BLOB_OPACITY * (this.token.hidden ? HIDDEN_OPACITY : 1), depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
        }),
      );
      shadow.userData.blobShadow = true;
      // A hair over the board: depth is coarse this far from the camera, so it is also pulled forward when drawn.
      shadow.position.set(d * BLOB_OFFSET, d * 0.01, d * BLOB_OFFSET);
      shadow.renderOrder = -1;
      this.blobShadow = shadow;
      this.ground.add(shadow);
      this.setMiniShadows(this.miniShadows);
    }

    this.markDowned();
    if (this.token.hidden) {
      this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: hiddenMarkerTexture(), sizeAttenuation: false, depthTest: false, transparent: true }));
      this.marker.renderOrder = 10;
      this.marker.position.y = this.top + d * 0.2;
      this.object3d.add(this.marker);
    }
  }

  dispose(): void {
    this.figure?.dispose();
    this.figure = null;
    if (this.skull) {
      this.skull.material.map?.dispose();
      this.skull.material.dispose();
    }
    if (this.marker) {
      this.marker.material.map?.dispose();
      this.marker.material.dispose();
    }
    disposeTree(this.body);
    this.hitTarget.geometry.dispose();
    (this.hitTarget.material as THREE.Material).dispose();
    this.object3d.removeFromParent();
  }
}

export class PinPiece {
  readonly object3d = new THREE.Group();
  readonly hitTarget: THREE.Sprite;
  private readonly title: THREE.Sprite | null;
  private readonly titleAspect: number;

  constructor(readonly pin: BoardPin, grid: BoardGrid) {
    const at = pin.hex && grid.type !== 'square' ? hexCenter(grid, pin.x, pin.y) : { x: pin.x, y: pin.y };
    this.object3d.position.set(at.x, grid.size * PIN_LIFT, at.y);
    this.hitTarget = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTexture(pin), sizeAttenuation: false, transparent: true }));
    this.hitTarget.userData.pinId = pin.id;
    this.object3d.add(this.hitTarget);
    const text = pinTitle(pin);
    if (text) {
      const plate = plateTexture(text);
      this.title = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true }));
      this.title.center.set(0.5, 0);
      this.titleAspect = plate.width / plate.height;
      this.object3d.add(this.title);
    } else {
      this.title = null;
      this.titleAspect = 1;
    }
  }

  /** Keeps the pin and its title one size on screen. */
  pose(context: PoseContext): void {
    this.hitTarget.scale.setScalar(context.pixel * PIN_PX);
    if (this.title) {
      this.title.scale.set(context.pixel * TITLE_PX * this.titleAspect, context.pixel * TITLE_PX, 1);
      // Over the pin: half the pin and a small gap up, in the sprite's own screen units.
      this.title.center.set(0.5, -((PIN_PX / 2 + 4) / TITLE_PX));
    }
  }

  dispose(): void {
    disposeTree(this.object3d, true);
    this.object3d.removeFromParent();
  }
}

export class PropPiece {
  readonly object3d = new THREE.Group();
  readonly hitTarget: THREE.Mesh;
  private model: THREE.Object3D | null = null;
  /** Whether `model` is a copy of a GLB (whose geometry is shared) rather than the placeholder. */
  private fromGlb = false;

  constructor(public placement: PropPlacement, private readonly grid: BoardGrid) {
    this.hitTarget = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitTarget.userData.propId = placement.id;
    this.object3d.add(this.hitTarget);
    this.place(placement.x, placement.y);
    this.setModel(null);
  }

  get id(): string {
    return this.placement.id;
  }

  /** Stands the prop's GLB on its spot, a cell across at scale 1. Null shows a placeholder box while it loads. */
  setModel(model: LoadedMini | null): void {
    if (this.model) {
      this.model.removeFromParent();
      disposeTree(this.model, false, !this.fromGlb);
    }
    this.fromGlb = model !== null;
    const cell = this.grid.size * PROP_FILL * this.placement.scale;
    let height = cell * 0.5;
    if (model) {
      const copy = cloneSkinned(model.scene);
      const scale = cell / model.footprint;
      copy.scale.setScalar(scale);
      // Materials are cloned so disposing this copy never touches the shared GLB.
      copy.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map((material) => material.clone()) : mesh.material.clone();
      });
      height = model.height * scale;
      this.model = copy;
    } else {
      this.model = new THREE.Mesh(new THREE.BoxGeometry(cell, height, cell), new THREE.MeshStandardMaterial({ color: 0x8a7a66, transparent: true, opacity: 0.5 }));
      this.model.position.y = height / 2;
    }
    this.model.rotation.y = -THREE.MathUtils.degToRad(this.placement.rotation);
    this.object3d.add(this.model);
    this.hitTarget.scale.set(cell / 2, height, cell / 2);
    this.hitTarget.position.y = height / 2;
  }

  place(x: number, y: number): void {
    this.object3d.position.set(x, 0, y);
  }

  dispose(): void {
    if (this.model) disposeTree(this.model, false, !this.fromGlb);
    this.hitTarget.geometry.dispose();
    (this.hitTarget.material as THREE.Material).dispose();
    this.object3d.removeFromParent();
  }
}
