/**
 * A scene stacked above (or below) the one the board shows, drawn read-only in the same 3D space: its map image as a
 * floor at its elevation (transparent where the image is, solid, faded or left out by the "Upper layers" setting),
 * and its walls, doors, props, lights and minis standing on it. Nothing in it is picked or edited on this board;
 * a Connect player's board draws the same layers from what Connect sends (`layersFromExtras`). The layer's pixels are scaled so its grid squares
 * match the shown scene's, and shifted so the two grids line up.
 */
import { smoother } from './camera';
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
import { LIQUID_KINDS, type LiquidKind, type WaterMotionKind } from './water';
import { maskOfSource, motionsOf, waterKeyOf, type WaterSource } from './liquids';
import { waterDistance } from '../sound/waterSound';
import { WaterSurface } from './waterSurface';
import { releaseTexture } from './textures';
import { stretchPlacement } from './mapStretch';
import { ShapesView } from './shapeView';
import { shapeHeightAt, type TerrainShape } from './terrainShapes';

/** What a layer is drawn from: its scene, and what Tabletop keeps for it (the same data the shown scene's own comes from). */
/** How long a layer takes to fade in or out, or to another look. */
const FADE_SECONDS = 0.6;

export interface ElevationLayerData {
  path: string;
  /** Grid squares above the scene the board shows (negative: below it). */
  elevation: number;
  map: BoardMap;
  wallHeight(id: string): number | null;
  /** A window's opening as the GM set it; null (or absent) for the default. */
  windowOf?(id: string): { bottom: number; top: number } | null;
  /** A wall's own width in grid squares; null (or absent) for the layer's wall thickness. */
  wallWidth?(id: string): number | null;
  wallMaterial(id: string): string | null;
  doorProp(id: string): string | null;
  /** How the GM turned a door from the way Atlas draws it. */
  doorFlip?(id: string): DoorFlip;
  /** A light's height above the layer's floor, in grid squares. */
  lightHeight(id: string): number;
  fogHeight: number;
  wallThickness: number;
  props: readonly PropPlacement[];
  /** The raised shapes standing on it (roofs, hills: `terrainShapes.ts`). */
  shapes?: readonly TerrainShape[];
  /** The liquids painted on it, and how each moves (as the scene keeps them); none for no liquid. */
  water?: WaterSource | null;
  /** Where it stands on the plane beyond its height, seen from the scene being played; none puts it where its grid does. */
  stands?: Placement;
  /**
   * The scene being played itself, given too so it is ready as a layer the moment another is shown (kept put away,
   * not drawn, until then).
   */
  current?: boolean;
  placement(tokenId: string): MiniPlacement | null;
  style(tokenId: string): TokenStyle;
}

/** What a layer takes from the board it is drawn in. */
export interface ElevationLayerHost {
  wallLook: WallLookup['look'];
  /** The material a wall wears with none painted on it (the defaults for its kind). */
  defaultOf?: WallLookup['defaultOf'];
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
  /** What lays the floor as the layer's grid alignment says (a level Atlas fitted: scaled, set aside, turned a little), as `BoardSurface` lays the shown one. */
  private readonly laying = new THREE.Group();
  private readonly image: THREE.MeshStandardMaterial;
  /** The floor as a shadow: black wherever the image is drawn, with the same look (solid, faded) and cut-outs. */
  private readonly shade = new THREE.MeshBasicMaterial({ color: 0x000000 });
  /** Everything that stands on the layer; hidden while the layer is only a shadow, and drawn in its look (faded, hidden) as its floor is. */
  private readonly content = new THREE.Group();
  /** The see-through copies of what stands on it, by the material they copy: the layer's own, so nothing shared with another layer or the shown scene fades. */
  private readonly fadedCopies = new Map<THREE.Material, THREE.Material>();
  private readonly copies = new WeakSet<THREE.Material>();
  /** How see-through what stands on it was last drawn (1: as it is). */
  private contentShown = 1;
  /** Something was added to what stands on it since it was last drawn in its look. */
  private contentDirty = false;
  private blackedOut = false;
  private look: LayerLook = 'solid';
  /** What the layer was last laid out by, so it can be moved on the plane without drawing it all again. */
  private laid: { shape: ElevationLayerShape; scale: number } | null = null;
  private stands: Placement = NO_PLACEMENT;
  private readonly walls: WallSet;
  private readonly rig = new LightRig();
  private readonly props = new Map<string, PropPiece>();
  /** Its raised shapes, wearing its own map image. */
  private readonly shapes = new ShapesView();
  private readonly tokens = new Map<string, Standing>();
  private picture: string | null | undefined;
  /**
   * How much of it shows, eased each frame toward what is wanted: `presence` (1 shown, 0 put away) times the look's own
   * (solid 1, faded half, hidden 0). The floor fades with both; what stands on it with its presence.
   */
  private presence = 0;
  private presenceTarget = 1;
  private lookLevel = 0;
  private drawnTransparent: boolean | null = null;
  private readonly presenceEase = new Fade(0);
  private readonly lookEase = new Fade(0);
  private imageSize: { width: number; height: number } | null = null;
  private disposed = false;
  /** Its painted liquids, each drawn over its floor; and what they were made from. */
  private readonly liquids = new Map<LiquidKind, WaterSurface>();
  private waterKey = '';

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
      defaultOf: (wall) => host.defaultOf?.(wall) ?? null,
      displaces: (path) => host.displaces(path),
      tileOf: (path) => host.tileOf(path),
      heightOf: (id) => this.data.wallHeight(id),
      windowOf: (id) => this.data.windowOf?.(id) ?? null,
      widthOf: (id) => this.data.wallWidth?.(id) ?? null,
      propOf: (id) => this.data.doorProp(id),
      flipOf: (id) => this.data.doorFlip?.(id) ?? NO_FLIP,
      prop: (glb) => host.model(glb),
    });
    this.object3d.name = `layer:${data.path}`;
    this.content.add(this.walls.object3d, this.rig.object3d, this.shapes.object3d);
    this.laying.add(this.floor);
    this.object3d.add(this.laying, this.content);
  }

  get path(): string {
    return this.data.path;
  }

  /** The scene's size in its own pixels: its image's once that is read, else what its map says. */
  get size(): { width: number; height: number } {
    return this.imageSize ?? { width: this.data.map.world?.width ?? 0, height: this.data.map.world?.height ?? 0 };
  }

  /** Grid squares above the scene the board shows (negative: below it). */
  /** Its floor's picture (a vault path), kept while it is put away. */
  get background(): string | null {
    return this.data.map.background ?? null;
  }

  /** Raised or lowered (another scene became the one played): by `squares`, at once. */
  shiftElevation(squares: number): void {
    if (!squares) return;
    this.data = { ...this.data, elevation: this.data.elevation + squares };
    this.lay();
    this.host.wake();
  }

  /** Takes the look its new place gives it (above the scene played: the Upper layers look; below: solid), easing to it. */
  restyle(look: LayerLook): void {
    if (this.chosenLook !== null) { this.chosenLook = look; return; }
    this.shapeFloor(look);
  }

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
    // A level fitted anew (Atlas aligned it) lies by its new fit, its image already read.
    this.layFloor();
    this.shapeFloor(shape.look);
    // What is built below (and what loads later: art, minis, props) is drawn in the look on the next frame.
    this.contentDirty = true;

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
    this.syncWater();
    this.host.wake();
  }

  private syncProps(data: ElevationLayerData, map: BoardMap): void {
    this.drawShapes();
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
        this.contentDirty = true;
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
        this.contentDirty = true;
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
      this.contentDirty = true;
      this.host.wake();
    });
  }

  /** Draws the layer's painted water (again when it, or the size it is laid on, changed); its motion follows without a redraw. */
  private syncWater(): void {
    const saved = this.data.water ?? null;
    const { width, height } = this.size;
    const cell = this.data.map.grid.size;
    const key = saved && width > 0 && height > 0 ? JSON.stringify([waterKeyOf(saved), width, height, cell]) : '';
    const motions = motionsOf(saved);
    if (key === this.waterKey) {
      for (const [liquid, surface] of this.liquids) surface.setMotion(motions[liquid]);
      return;
    }
    this.waterKey = key;
    this.clearLiquids();
    if (!key || !saved) return;
    for (const liquid of LIQUID_KINDS) {
      const mask = maskOfSource(saved, width, height, cell, liquid);
      if (!mask) continue;
      const surface = new WaterSurface(mask, width, height, cell, motions[liquid], liquid);
      this.liquids.set(liquid, surface);
      this.content.add(surface.object3d);
    }
    if (this.liquids.size > 0) this.host.wake();
  }

  private clearLiquids(): void {
    for (const surface of this.liquids.values()) surface.dispose();
    this.liquids.clear();
  }

  /** Lays the floor by the layer's grid alignment (`stretchPlacement`), or, without one, at its corner at the image's own size. */
  private layFloor(): void {
    const size = this.imageSize;
    if (!size) return;
    const stretch = this.data.map.grid.mapStretch;
    this.floor.scale.set(size.width, 1, size.height);
    if (stretch) {
      const placement = stretchPlacement(size, stretch);
      this.floor.position.set(placement.centre.x, 0, placement.centre.y);
      this.floor.rotation.y = placement.rotation;
      this.laying.scale.set(placement.scale.x, 1, placement.scale.y);
    } else {
      this.floor.position.set(size.width / 2, 0, size.height / 2);
      this.floor.rotation.y = 0;
      this.laying.scale.set(1, 1, 1);
    }
  }

  /** Loads the layer's map image the first time, or when it changed. */
  /** How high a token at (x, y) stands: on the surface of a raised shape there (a roof, a hill), else the floor. */
  private standOf(x: number, y: number): number {
    let top = 0;
    for (const shape of this.data.shapes ?? []) {
      const h = shapeHeightAt(shape, x, y);
      if (h !== null) top = Math.max(top, h * this.data.map.grid.size);
    }
    return top;
  }

  /** Its raised shapes, at its size and in its image (once read). */
  private drawShapes(): void {
    const { width, height } = this.size;
    this.shapes.update(this.data.shapes ?? [], { cell: this.data.map.grid.size, width, height, image: this.image.map, material: (folder) => this.host.wallLook(folder, false) });
    this.contentDirty = true;
  }

  private setImage(path: string | null): void {
    if (this.picture === path) return;
    this.picture = path;
    releaseTexture(this.image.map);
    this.image.map = null;
    this.shade.map = null;
    this.floor.visible = false;
    if (!path) return;
    void this.host.image(path).then((texture) => {
      if (this.disposed || this.picture !== path || !texture) { releaseTexture(texture); return; }
      const source = texture.userData.sourceSize as { width: number; height: number } | undefined;
      const image = texture.image as { width?: number; height?: number } | undefined;
      const width = source?.width ?? image?.width ?? this.data.map.world?.width ?? 1;
      const height = source?.height ?? image?.height ?? this.data.map.world?.height ?? 1;
      this.image.map = texture;
      this.shade.map = texture;
      this.image.needsUpdate = true;
      this.shade.needsUpdate = true;
      this.imageSize = { width, height };
      this.layFloor();
      this.drawShapes();
      this.applyShown();
      // The water is laid on the image's own size.
      this.syncWater();
      this.host.wake();
    });
  }

  /**
   * Solid: the image whole, its transparent parts cut out (of the shadow too). Faded: half see-through, casting no
   * shadow. Hidden: no image at all, only what stands on it.
   */
  private shapeFloor(look: LayerLook): void {
    this.look = look;
    // Not at once: the floor eases to its new look in `step`.
    this.applyShown();
  }

  /** How much of the floor its look shows. */
  private lookTarget(): number {
    return this.look === 'solid' ? 1 : this.look === 'faded' ? FADED_LAYER_OPACITY : 0;
  }

  /** Brings it in (1) or puts it away (0), easing over a third of a second. */
  fadeTo(presence: number): void {
    this.presenceTarget = presence;
    this.host.wake();
  }

  /** Whether it is still easing in or out, or to another look. */
  get fading(): boolean {
    return this.presenceEase.moving(this.presenceTarget) || this.lookEase.moving(this.lookTarget());
  }

  /** Put away all the way: nothing of it shows. */
  get gone(): boolean {
    return this.presenceTarget === 0 && this.presence <= 1e-3;
  }

  /** The floor and what stands on it as they show now. */
  private applyShown(): void {
    const shown = this.presence * this.lookLevel;
    const whole = shown >= 0.999 && this.look === 'solid';
    // See-through only while it is (a half-faded floor, or one easing); solid, its transparent parts cut out.
    const transparent = !whole;
    for (const material of [this.image, this.shade]) {
      material.opacity = Math.min(1, shown);
      material.depthWrite = whole;
      if (this.drawnTransparent !== transparent) {
        material.transparent = transparent;
        material.alphaTest = whole ? 0.5 : 0;
        material.needsUpdate = true;
      }
    }
    this.drawnTransparent = transparent;
    this.floor.castShadow = whole && !this.blackedOut;
    this.floor.renderOrder = whole ? 0 : 1;
    this.floor.visible = this.image.map !== null && shown > 0.003;
    // What stands on it takes its look: faded with a faded floor, gone with a hidden one.
    this.content.visible = !this.blackedOut && this.presence > 0.4 && this.lookLevel > 0.02;
    this.fadeContent(this.lookLevel);
  }

  /**
   * Draws what stands on the layer `level` see-through (1: as it is): every mesh on it wears a faded copy of its
   * material, kept per layer, and its own again once the layer is solid. A material changed under it (a door's state, a
   * token's look) is taken as the new one to copy.
   */
  private fadeContent(level: number): void {
    const shown = Math.min(1, Math.max(0, level));
    if (shown >= 0.999 && this.contentShown >= 0.999) return;
    this.contentShown = shown;
    const copyOf = (material: THREE.Material): THREE.Material => {
      let copy = this.fadedCopies.get(material);
      if (!copy) {
        copy = material.clone();
        // A clone leaves the shader hooks behind (the see-through cut), and three's own copy sets its defines anew (the
        // water's USE_UV, which its hook reads): the copy keeps both.
        copy.onBeforeCompile = material.onBeforeCompile;
        const defines = (material as THREE.Material & { defines?: Record<string, unknown> }).defines;
        if (defines) (copy as THREE.Material & { defines?: Record<string, unknown> }).defines = { ...defines };
        copy.customProgramCacheKey = material.customProgramCacheKey;
        copy.transparent = true;
        copy.depthWrite = false;
        this.fadedCopies.set(material, copy);
        this.copies.add(copy);
      }
      copy.opacity = (material.opacity ?? 1) * shown;
      return copy;
    };
    this.content.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const current = mesh.material;
      const list = Array.isArray(current) ? current : [current];
      // The mesh's own material: what it wore before it was faded, unless something has put another on it since.
      const kept = mesh.userData.layerOwn as THREE.Material | THREE.Material[] | undefined;
      const own = kept !== undefined && list.every((m) => this.copies.has(m)) ? kept : current;
      if (shown >= 0.999) {
        mesh.material = own;
        delete mesh.userData.layerOwn;
        return;
      }
      mesh.userData.layerOwn = own;
      mesh.material = Array.isArray(own) ? own.map(copyOf) : copyOf(own);
    });
  }

  /** Eases presence and look toward what is wanted, by the clock, in and out; whether anything moved. */
  private ease(_dt: number): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const presence = this.presenceEase.tick(now, this.presenceTarget);
    const look = this.lookEase.tick(now, this.lookTarget());
    if (!presence && !look) return false;
    this.presence = this.presenceEase.value;
    this.lookLevel = this.lookEase.value;
    this.applyShown();
    return true;
  }

  /** A point of the board (its floor plane) in this layer's own map pixels. */
  mapPointAt(x: number, z: number): { x: number; y: number } {
    this.object3d.updateMatrixWorld(true);
    const local = this.object3d.worldToLocal(new THREE.Vector3(x, this.object3d.position.y, z));
    return { x: local.x, y: local.z };
  }

  /**
   * How each of the layer's painted liquids moves and how far it lies from a board point (board units); none while it
   * shows none (no liquid, hidden, put away, or blacked out).
   */
  waterReach(x: number, z: number): Array<{ liquid: LiquidKind; kind: WaterMotionKind; distance: number }> {
    const size = this.imageSize;
    if (this.liquids.size === 0 || !size || !this.object3d.visible || !this.content.visible) return [];
    const at = this.mapPointAt(x, z);
    const out: Array<{ liquid: LiquidKind; kind: WaterMotionKind; distance: number }> = [];
    for (const [liquid, surface] of this.liquids) {
      const distance = waterDistance(surface.mask, size.width, size.height, at);
      if (distance !== Infinity) out.push({ liquid, kind: surface.currentMotion.kind, distance: distance * this.object3d.scale.x });
    }
    return out;
  }

  /** Whether its floor has ground at a board point: its image there not see-through (no image: no ground). */
  groundAt(x: number, z: number, opaque: (image: CanvasImageSource & { width: number; height: number }, u: number, v: number) => boolean | null): boolean {
    const size = this.imageSize;
    const picture = this.image.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!size || !picture) return false;
    const at = this.mapPointAt(x, z);
    if (at.x < 0 || at.y < 0 || at.x > size.width || at.y > size.height) return false;
    return opaque(picture, at.x / size.width, at.y / size.height) ?? true;
  }

  /** Called each frame: tokens stand where they are, the walls' doors swing, the lights flicker. Returns whether it is still moving. */
  step(dt: number, now: number, context: PoseContext): boolean {
    const eased = this.ease(dt);
    if (this.contentDirty) {
      this.contentDirty = false;
      // Freshly built or loaded meshes wear their own materials: faded again if the layer is.
      if (this.lookLevel < 0.999) { this.contentShown = 0; this.fadeContent(this.lookLevel); }
    }
    const moving = this.walls.step(dt) || eased;
    this.rig.step(now);
    for (const surface of this.liquids.values()) surface.tick(now);
    for (const entry of this.tokens.values()) entry.piece.pose(entry.x, entry.y, context, this.standOf(entry.x, entry.y));
    return moving;
  }

  get animated(): boolean {
    return this.rig.animated || [...this.liquids.values()].some((surface) => surface.moving) || this.fading;
  }

  /**
   * Line of sight blacks out a scene above the one being played: its image is drawn black (a shadow, as solid or faded as
   * the Upper layers setting says, and not at all under Hidden), and nothing that stands on it shows.
   */
  setBlackout(on: boolean): void {
    if (on === this.blackedOut) return;
    this.blackedOut = on;
    this.floor.material = on ? this.shade : this.image;
    this.applyShown();
    this.host.wake();
  }

  /** The look the Upper layers setting gave it, while a token's eyes force it solid. */
  private chosenLook: LayerLook | null = null;

  /** Seen from a token's eyes: drawn solid whatever the Upper layers setting (a faded or hidden ceiling is no ceiling). */
  setFirstPerson(on: boolean): void {
    if (on && this.chosenLook === null) {
      this.chosenLook = this.look;
      if (this.look !== 'solid') this.shapeFloor('solid');
    } else if (!on && this.chosenLook !== null) {
      const chosen = this.chosenLook;
      this.chosenLook = null;
      if (chosen !== this.look) this.shapeFloor(chosen);
    }
  }

  /** Only the GM sees a layer. */
  setVisible(visible: boolean): void {
    this.object3d.visible = visible;
  }

  /** Lets go of the lamps' shadow maps (see `LightRig.releaseShadows`). */
  releaseShadows(): void {
    this.rig.releaseShadows();
  }

  dispose(): void {
    this.disposed = true;
    this.clearLiquids();
    this.walls.dispose();
    this.rig.dispose();
    // The faded copies are the layer's own (their textures are not: those belong to what they copy).
    for (const copy of this.fadedCopies.values()) copy.dispose();
    this.fadedCopies.clear();
    for (const piece of this.props.values()) piece.dispose();
    this.shapes.dispose();
    for (const entry of this.tokens.values()) entry.piece.dispose();
    releaseTexture(this.image.map);
    this.image.dispose();
    this.shade.dispose();
    this.floor.geometry.dispose();
    this.object3d.removeFromParent();
  }
}

/**
 * A value faded to its target over `FADE_SECONDS` by the clock, eased in and out; a new target starts again from where
 * it is. It starts on the first frame after the target changes (after whatever heavy work changed it).
 */
class Fade {
  private from: number;
  private to: number;
  private start: number | null = null;

  constructor(public value: number) {
    this.from = value;
    this.to = value;
  }

  moving(target: number): boolean {
    return target !== this.to || this.value !== this.to;
  }

  /** On to `now` (ms) toward `target`; whether it moved. */
  tick(now: number, target: number): boolean {
    if (target !== this.to) { this.from = this.value; this.to = target; this.start = null; }
    if (this.value === this.to) return false;
    this.start ??= now;
    const t = Math.min(1, (now - this.start) / (FADE_SECONDS * 1000));
    this.value = t >= 1 ? this.to : this.from + (this.to - this.from) * smoother(t);
    return true;
  }
}
