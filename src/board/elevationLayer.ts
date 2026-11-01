/**
 * A scene stacked above (or below) the one the board shows, drawn read-only in the same 3D space: its map image as a
 * floor at its elevation (transparent where the image is, solid, faded or left out by the "Upper layers" setting),
 * and its walls, doors, props, lights and minis standing on it. Nothing in it is picked or edited on this board;
 * players never see it (Connect treats each scene as its own). The layer's pixels are scaled so its grid squares
 * match the shown scene's, and shifted so the two grids line up.
 */
import * as THREE from 'three';
import type { MiniPlacement } from '../assignments';
import type { LoadedMini } from '../library';
import type { PropPlacement, TokenStyle } from './boardData';
import { FADED_LAYER_OPACITY, type LayerLook } from './quality';
import type { BoardMap } from './mapModel';
import { LightRig } from './lightRig';
import { PropPiece, TokenPiece, type PoseContext } from './pieces';
import { WallSet, type WallLookup } from './wallPieces';
import { NO_FLIP, type DoorFlip } from './walls';
import { NO_PLACEMENT, type Placement } from './layerPlacement';

/** What a layer is drawn from: its scene, and what Tabletop keeps for it (the same data the shown scene's own comes from). */
export interface ElevationLayerData {
  path: string;
  /** Grid squares above the scene the board shows (negative: below it). */
  elevation: number;
  map: BoardMap;
  wallHeight(id: string): number | null;
  wallMaterial(id: string): string | null;
  doorProp(id: string): string | null;
  /** How the GM turned a door from the way Atlas draws it. */
  doorFlip?(id: string): DoorFlip;
  /** A light's height above the layer's floor, in grid squares. */
  lightHeight(id: string): number;
  fogHeight: number;
  wallThickness: number;
  props: readonly PropPlacement[];
  /** Where it stands on the plane beyond its height, seen from the scene being played; none puts it where its grid does. */
  stands?: Placement;
  placement(tokenId: string): MiniPlacement | null;
  style(tokenId: string): TokenStyle;
}

/** What a layer takes from the board it is drawn in. */
export interface ElevationLayerHost {
  wallLook: WallLookup['look'];
  displaces(path: string | null): boolean;
  tileOf(path: string | null): number;
  model(path: string): Promise<LoadedMini | null>;
  image(path: string): Promise<THREE.Texture | null>;
  art(path: string): Promise<THREE.Texture | null>;
  /** Lets a material fade where it is between the camera and the pivot (the see-through setting). */
  cut(material: THREE.Material): void;
  wake(): void;
}

export interface ElevationLayerShape {
  /** The shown scene's grid: a square's size and where its lines start, in map pixels. */
  cell: number;
  offsetX: number;
  offsetY: number;
  look: LayerLook;
  /** The least a wall stands, in grid squares (the board's own floor for a map with flat fog). */
  minWall: number;
  edge: number;
  cuts: number;
  miniShadows: 'real' | 'blob';
  ambient: number;
  litThreshold: number;
  unitDistance: number;
}

interface Standing {
  piece: TokenPiece;
  x: number;
  y: number;
  mini: string | null;
}

export class ElevationLayerView {
  readonly object3d = new THREE.Group();
  private readonly floor: THREE.Mesh;
  private readonly image: THREE.MeshStandardMaterial;
  /** The floor as a shadow: black wherever the image is drawn, with the same look (solid, faded) and cut-outs. */
  private readonly shade = new THREE.MeshBasicMaterial({ color: 0x000000 });
  /** Everything that stands on the layer; hidden while the layer is only a shadow. */
  private readonly content = new THREE.Group();
  private blackedOut = false;
  private look: LayerLook = 'solid';
  /** What the layer was last laid out by, so it can be moved on the plane without drawing it all again. */
  private laid: { shape: ElevationLayerShape; scale: number } | null = null;
  private stands: Placement = NO_PLACEMENT;
  private readonly walls: WallSet;
  private readonly rig = new LightRig();
  private readonly props = new Map<string, PropPiece>();
  private readonly tokens = new Map<string, Standing>();
  private picture: string | null | undefined;
  private hideImage = false;
  private imageSize: { width: number; height: number } | null = null;
  private disposed = false;

  constructor(private data: ElevationLayerData, private readonly host: ElevationLayerHost) {
    this.image = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    host.cut(this.image);
    host.cut(this.shade);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.image);
    this.floor.receiveShadow = true;
    this.floor.visible = false;
    this.walls = new WallSet({
      look: (path, door) => host.wallLook(path, door),
      materialOf: (id) => this.data.wallMaterial(id),
      displaces: (path) => host.displaces(path),
      tileOf: (path) => host.tileOf(path),
      heightOf: (id) => this.data.wallHeight(id),
      propOf: (id) => this.data.doorProp(id),
      flipOf: (id) => this.data.doorFlip?.(id) ?? NO_FLIP,
      prop: (glb) => host.model(glb),
    });
    this.object3d.name = `layer:${data.path}`;
    this.content.add(this.walls.object3d, this.rig.object3d);
    this.object3d.add(this.floor, this.content);
  }

  get path(): string {
    return this.data.path;
  }

  /** The scene's size in its own pixels: its image's once that is read, else what its map says. */
  get size(): { width: number; height: number } {
    return this.imageSize ?? { width: this.data.map.world?.width ?? 0, height: this.data.map.world?.height ?? 0 };
  }

  /** Grid squares above the scene the board shows (negative: below it). */
  get elevation(): number {
    return this.data.elevation;
  }

  /** Moves the layer on the plane (drawn live while a hand drags it); the height and the grid alignment stay. */
  place(placement: Placement): void {
    this.stands = placement;
    this.lay();
    this.host.wake();
  }

  /** Puts the layer where its grid, its height and its placement say: the grids lined up, then turned and shifted as a whole. */
  private lay(): void {
    const laid = this.laid;
    if (!laid) return;
    const { shape, scale: k } = laid;
    const { map } = this.data;
    // world = turn(k p + aligned) + shift: the group turns about the origin of its own pixels, so its position carries the aligned corner round with it.
    const turn = THREE.MathUtils.degToRad(this.stands.turn);
    const aligned = { x: shape.offsetX - map.grid.offsetX * k, y: shape.offsetY - map.grid.offsetY * k };
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    this.object3d.rotation.y = -turn;
    this.object3d.position.set(aligned.x * cos - aligned.y * sin + this.stands.x, this.data.elevation * shape.cell, aligned.x * sin + aligned.y * cos + this.stands.y);
  }

  /** Brings the layer in line with its scene, the shown scene's grid and the "Upper layers" setting. */
  update(data: ElevationLayerData, shape: ElevationLayerShape): void {
    this.data = data;
    const { map } = data;
    // The layer's own pixels, scaled so its squares are the shown scene's, and its grid lines laid on the other's.
    const k = map.grid.size > 0 ? shape.cell / map.grid.size : 1;
    this.object3d.scale.setScalar(k);
    this.laid = { shape, scale: k };
    this.stands = data.stands ?? NO_PLACEMENT;
    this.lay();

    this.setImage(map.background);
    this.shapeFloor(shape.look);

    this.walls.update(map.walls, {
      height: Math.max(shape.minWall, data.fogHeight) * map.grid.size,
      tile: map.grid.size,
      thickness: data.wallThickness * map.grid.size,
      fogged: () => false,
      fogKey: '',
      edge: shape.edge,
      cuts: shape.cuts,
    });

    this.rig.update(map.lights, {
      unitDistance: shape.unitDistance,
      cell: map.grid.size,
      ambient: shape.ambient,
      litThreshold: shape.litThreshold,
      heightOf: (light) => data.lightHeight(light.id) * map.grid.size,
    });
    // A layer's lights light, but cost no shadow maps and show no bulb.
    this.rig.castShadows(0, { x: 0, z: 0 });
    this.rig.show('player');

    this.syncProps(data, map);
    this.syncTokens(data, map, shape);
    this.host.wake();
  }

  private syncProps(data: ElevationLayerData, map: BoardMap): void {
    const wanted = new Map(data.props.map((prop) => [prop.id, prop]));
    for (const [id, piece] of [...this.props]) {
      const next = wanted.get(id);
      if (next && next.glb === piece.placement.glb && next.scale === piece.placement.scale && next.rotation === piece.placement.rotation) {
        piece.placement = next;
        piece.place(next.x, next.y);
        continue;
      }
      piece.dispose();
      this.props.delete(id);
    }
    for (const prop of wanted.values()) {
      if (this.props.has(prop.id)) continue;
      const piece = new PropPiece(prop, map.grid);
      this.props.set(prop.id, piece);
      this.content.add(piece.object3d);
      void this.host.model(prop.glb).then((model) => {
        if (this.disposed || this.props.get(prop.id) !== piece || !model) return;
        piece.setModel(model);
        this.host.wake();
      });
    }
  }

  private syncTokens(data: ElevationLayerData, map: BoardMap, shape: ElevationLayerShape): void {
    const seen = new Set<string>();
    for (const token of map.tokens) {
      if (token.offMap || token.offLevel) continue;
      seen.add(token.id);
      let entry = this.tokens.get(token.id);
      if (!entry) {
        const piece = new TokenPiece(token, map.grid, []);
        this.content.add(piece.object3d);
        entry = { piece, x: token.x, y: token.y, mini: null };
        this.tokens.set(token.id, entry);
      } else {
        entry.piece.update(token, []);
      }
      entry.x = token.x;
      entry.y = token.y;
      entry.piece.setMiniShadows(shape.miniShadows);
      entry.piece.setStyle(data.style(token.id));
      this.dress(token.id, token.imagePath, entry);
      this.rig.place(token.id, token.x, token.y);
    }
    for (const [id, entry] of [...this.tokens]) {
      if (seen.has(id)) continue;
      entry.piece.dispose();
      this.tokens.delete(id);
    }
  }

  /** The art and the mini on a token. */
  private dress(id: string, artPath: string | null, entry: Standing): void {
    if (artPath) {
      void this.host.art(artPath).then((texture) => {
        if (this.disposed || this.tokens.get(id) !== entry) return;
        entry.piece.setArt(texture);
        this.host.wake();
      });
    } else {
      entry.piece.setArt(null);
    }
    const placement = this.data.placement(id);
    if (!placement) {
      entry.mini = null;
      entry.piece.setMini(null, null);
      return;
    }
    entry.mini = placement.mini;
    void this.host.model(placement.mini).then((model) => {
      if (this.disposed || this.tokens.get(id) !== entry || entry.mini !== placement.mini) return;
      entry.piece.setMini(model, model ? placement : null);
      this.host.wake();
    });
  }

  /** Loads the layer's map image the first time, or when it changed. */
  private setImage(path: string | null): void {
    if (this.picture === path) return;
    this.picture = path;
    this.image.map?.dispose();
    this.image.map = null;
    this.shade.map = null;
    this.floor.visible = false;
    if (!path) return;
    void this.host.image(path).then((texture) => {
      if (this.disposed || this.picture !== path || !texture) { texture?.dispose(); return; }
      const source = texture.userData.sourceSize as { width: number; height: number } | undefined;
      const image = texture.image as { width?: number; height?: number } | undefined;
      const width = source?.width ?? image?.width ?? this.data.map.world?.width ?? 1;
      const height = source?.height ?? image?.height ?? this.data.map.world?.height ?? 1;
      this.image.map = texture;
      this.shade.map = texture;
      this.image.needsUpdate = true;
      this.shade.needsUpdate = true;
      this.imageSize = { width, height };
      this.floor.scale.set(width, 1, height);
      this.floor.position.set(width / 2, 0, height / 2);
      this.floor.visible = !this.hideImage;
      this.host.wake();
    });
  }

  /**
   * Solid: the image whole, its transparent parts cut out (of the shadow too). Faded: half see-through, casting no
   * shadow. Hidden: no image at all, only what stands on it.
   */
  private shapeFloor(look: LayerLook): void {
    this.look = look;
    const solid = look === 'solid';
    for (const material of [this.image, this.shade]) {
      material.transparent = look === 'faded';
      material.opacity = look === 'faded' ? FADED_LAYER_OPACITY : 1;
      material.depthWrite = solid;
      material.alphaTest = solid ? 0.5 : 0;
      material.needsUpdate = true;
    }
    this.floor.castShadow = solid && !this.blackedOut;
    this.floor.renderOrder = solid ? 0 : 1;
    this.hideImage = look === 'transparent';
    this.floor.visible = this.image.map !== null && !this.hideImage;
  }

  /** Called each frame: tokens stand where they are, the walls' doors swing, the lights flicker. Returns whether it is still moving. */
  step(dt: number, now: number, context: PoseContext): boolean {
    const moving = this.walls.step(dt);
    this.rig.step(now);
    for (const entry of this.tokens.values()) entry.piece.pose(entry.x, entry.y, context);
    return moving;
  }

  get animated(): boolean {
    return this.rig.animated;
  }

  /**
   * Line of sight blacks out a scene above the one being played: its image is drawn black (a shadow, as solid or faded as
   * the Upper layers setting says, and not at all under Hidden), and nothing that stands on it shows.
   */
  setBlackout(on: boolean): void {
    if (on === this.blackedOut) return;
    this.blackedOut = on;
    this.floor.material = on ? this.shade : this.image;
    this.floor.castShadow = this.look === 'solid' && !on;
    this.content.visible = !on;
    this.host.wake();
  }

  /** Only the GM sees a layer. */
  setVisible(visible: boolean): void {
    this.object3d.visible = visible;
  }

  dispose(): void {
    this.disposed = true;
    this.walls.dispose();
    this.rig.dispose();
    for (const piece of this.props.values()) piece.dispose();
    for (const entry of this.tokens.values()) entry.piece.dispose();
    this.image.map?.dispose();
    this.image.dispose();
    this.shade.dispose();
    this.floor.geometry.dispose();
    this.object3d.removeFromParent();
  }
}
