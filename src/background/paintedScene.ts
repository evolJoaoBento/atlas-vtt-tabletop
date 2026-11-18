/**
 * A painted background on the board: reads it (and the materials its slots name) once and keeps it by its folder,
 * then works out what the plane round the map wears: the heights, the material blended by the painted material
 * layer, and a sheet for each liquid painted. Anything missing gives nothing, and the board draws the plain horizon
 * plane instead.
 */
import * as THREE from 'three';
import type { LoadedMaterial } from '../materials';
import { LIQUID_KINDS, type LiquidKind } from '../board/water';
import { WaterSurface } from '../board/waterSurface';
import type { PaintedLook } from '../board/groundPlane';
import type { LoadedBackground } from './backgroundData';
import { paintedGroundMaterial, splatTexture } from './paintedGround';
import { liquidMask } from './paintedLiquids';
import { backgroundFrame, backgroundHeight } from './terrainHeight';
import type { LoadedMini } from '../library';
import { scatterProps } from './propScatter';
import { PropForest } from './propForest';
import { PROP_FILL } from '../board/propSize';

/** Where the map lies and how the ground is set, as the painted ground needs them. */
export interface PaintedArea {
  /** The map's size, in world units (its pixels), and the world units to a square. */
  width: number;
  height: number;
  cell: number;
  /** The extra board round the map, in squares. */
  margin: number;
  /** The Ground settings' squares to a material tile. */
  tile: number;
  /** How far the plane runs from the map's middle, in world units; the liquid sheets run as far. Unset: just the picture's square. */
  reach?: number;
}

/** A background read, with a copy of each material of its slots to take the maps from (null where there is none). */
interface Read {
  background: LoadedBackground;
  slots: (THREE.MeshStandardMaterial | null)[];
  /** Which read it is: a background read again is another read. */
  serial: number;
}

/** What is drawn for one background at one map size. */
interface Built {
  key: string;
  /** The background it shows. */
  ref: string;
  look: PaintedLook;
  splat: THREE.DataTexture;
  material: THREE.MeshStandardMaterial;
}

export class PaintedScene {
  /** The liquid sheets, laid on the picture's square; the board lifts the group with the ground. */
  readonly object3d = new THREE.Group();
  /** The sheets by liquid; a liquid not painted has none. */
  readonly liquids = new Map<LiquidKind, WaterSurface>();
  /** The backgrounds read. A read that failed is not kept: the next draw tries again. */
  private readonly reads = new Map<string, Read>();
  private readonly pending = new Set<string>();
  /** How many times each background was forgotten: a read tells by it whether it is out of date. */
  private readonly generations = new Map<string, number>();
  private gone = false;
  private readonly warned = new Set<string>();
  private built: Built | null = null;
  private readonly cell = { value: 1 };
  private readonly tile = { value: 1 };
  private readonly area = new THREE.Vector3();
  /** Slots of a read that was forgotten while its look was still drawn: put away when the look is replaced. */
  private retired: (THREE.MeshStandardMaterial | null)[] = [];
  private serial = 0;
  /** The props standing on the plane now (none while the models load, or when the background paints none). */
  forest: PropForest | null = null;
  /** How long the last forest took to place and build, in milliseconds (the models already loaded). */
  forestMs = 0;
  /** Which forest is wanted: a forest whose models were still loading when this moved on is dropped. */
  private forestJob = 0;
  /** A flat picture of each model, by path, kept for the board's life: a forest drawn again does not make them again. */
  private readonly pictures = new Map<string, THREE.Texture>();
  private readonly forestWarned = new Set<string>();

  /**
   * `background` and `material` read from the host; `changed` is called when a background has come in (the board
   * draws the ground again). `keepOnlyCurrent`: only the background shown stays read (a player's board, where an
   * old one is never shown again), asked at each draw. `model` loads a prop's model (the board keeps it loaded) and
   * `impostor` takes a flat picture of one; without them no props are drawn.
   */
  constructor(
    private readonly source: {
      background(ref: string): Promise<LoadedBackground | null>;
      material(path: string): Promise<LoadedMaterial | null>;
      model?(path: string): Promise<LoadedMini | null>;
      impostor?(model: LoadedMini): THREE.Texture;
    },
    private readonly changed: () => void,
    private readonly options: { keepOnlyCurrent?: () => boolean } = {},
  ) {
    this.object3d.name = 'painted-liquids';
  }

  /** Whether any liquid sheet is drawn (they move, so the board asks for frames). */
  get moving(): boolean {
    return this.liquids.size > 0;
  }

  /** Whether the group has anything to show (a liquid sheet or the props): the board puts it in the scene then. */
  get hasContent(): boolean {
    return this.liquids.size > 0 || this.forest !== null;
  }

  /**
   * What the ground wears for the background `ref` on this map. Null while it is being read, and when it cannot be
   * (not chosen, gone, broken): the board draws the plain horizon plane then, and a background that is gone is
   * mentioned once.
   */
  look(ref: string | undefined, area: PaintedArea): PaintedLook | null {
    if (!ref || this.gone) { this.clear(); return null; }
    if (this.options.keepOnlyCurrent?.()) this.evictOthers(ref);
    const read = this.reads.get(ref);
    if (read === undefined) {
      this.start(ref);
      // A background read again after a save goes on being drawn as it was until the fresh read comes; any other waits drawn plain.
      if (this.built?.ref !== ref) this.clear();
      return this.built?.look ?? null;
    }
    // The tile's width is not in the key: it reaches the shader through its uniform.
    const key = JSON.stringify([ref, read.serial, area.width, area.height, area.cell, area.margin, area.reach ?? null]);
    this.cell.value = area.cell;
    this.tile.value = area.cell * area.tile;
    if (this.built?.key !== key) this.build(key, ref, read, area);
    return this.built?.look ?? null;
  }

  /** Reads this background again next time (it was saved); what is drawn of it stays until the fresh read is in. */
  forget(ref: string): void {
    const read = this.reads.get(ref);
    this.reads.delete(ref);
    this.warned.delete(ref);
    // A read still under way is out of date now: its answer is dropped when it lands, and the next draw reads afresh.
    this.generations.set(ref, (this.generations.get(ref) ?? 0) + 1);
    this.pending.delete(ref);
    // The look drawn still wears the old read's materials: they go when it is replaced.
    if (this.built?.ref === ref) this.retired.push(...(read?.slots ?? []));
    else for (const slot of read?.slots ?? []) slot?.dispose();
  }

  /** Puts away every read but the one of `ref`. */
  private evictOthers(ref: string): void {
    for (const other of [...this.reads.keys()]) {
      if (other === ref) continue;
      for (const slot of this.reads.get(other)?.slots ?? []) slot?.dispose();
      this.reads.delete(other);
      this.warned.delete(other);
    }
    // A read under way for another background is out of date too.
    for (const other of [...this.pending]) {
      if (other === ref) continue;
      this.generations.set(other, (this.generations.get(other) ?? 0) + 1);
      this.pending.delete(other);
    }
  }

  /** Moves the liquids on to this time, in seconds. */
  tick(seconds: number): void {
    for (const surface of this.liquids.values()) surface.tick(seconds);
  }

  /** Puts away what is drawn (the background stays read). */
  clear(): void {
    for (const surface of this.liquids.values()) surface.dispose();
    this.liquids.clear();
    // A forest still waiting for its models is out of date now.
    this.forestJob++;
    this.forest?.dispose();
    this.forest = null;
    this.built?.material.dispose();
    this.built?.splat.dispose();
    this.built = null;
    this.object3d.removeFromParent();
    for (const slot of this.retired) slot?.dispose();
    this.retired = [];
  }

  dispose(): void {
    this.gone = true;
    this.clear();
    for (const read of this.reads.values()) for (const slot of read.slots) slot?.dispose();
    this.reads.clear();
    for (const picture of this.pictures.values()) picture.dispose();
    this.pictures.clear();
  }

  private start(ref: string): void {
    if (this.pending.has(ref)) return;
    this.pending.add(ref);
    const generation = this.generations.get(ref) ?? 0;
    void this.read(ref).then((read) => {
      // Forgotten while it was being read (it was saved since), or the scene was put away: this answer is old.
      if (this.gone || (this.generations.get(ref) ?? 0) !== generation) { for (const slot of read?.slots ?? []) slot?.dispose(); return; }
      this.pending.delete(ref);
      if (!read) {
        // Not kept: whatever went wrong (mid-save, mid-sync) may be over by the next draw, which reads it again.
        if (!this.warned.has(ref)) { this.warned.add(ref); console.warn(`Painted background "${ref}" could not be read; the ground is drawn plain.`); }
        // The old drawing kept meanwhile (after a save) is not true any more: put it away and draw again, plain.
        if (this.built?.ref === ref) { this.clear(); this.changed(); }
        return;
      }
      this.reads.set(ref, read);
      this.changed();
    });
  }

  private async read(ref: string): Promise<Read | null> {
    let background: LoadedBackground | null;
    try { background = await this.source.background(ref); } catch { background = null; }
    if (!background) return null;
    const slots = await Promise.all(background.materials.slice(0, 4).map(async (path) => {
      if (!path) return null;
      try {
        const material = await this.source.material(path);
        if (!material) return null;
        const copy = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
        material.apply(copy);
        return copy;
      } catch { return null; }
    }));
    return { background, slots, serial: ++this.serial };
  }

  private build(key: string, ref: string, read: Read, area: PaintedArea): void {
    this.clear();
    const { settings, layers } = read.background;
    const frame = backgroundFrame(area.width, area.height, area.cell, layers.size);
    // The usable board (map and extra board) stays level; materials and liquids are painted on all but the map itself.
    const flat = { x0: -area.margin, y0: -area.margin, x1: area.width / area.cell + area.margin, y1: area.height / area.cell + area.margin };
    const map = { x0: 0, y0: 0, x1: area.width / area.cell, y1: area.height / area.cell };
    const side = frame.extent * area.cell;
    this.area.set(area.width / 2 - side / 2, area.height / 2 - side / 2, side);
    const splat = splatTexture(layers, frame, map);
    const material = paintedGroundMaterial(splat, read.slots, this.cell, { area: this.area, tile: this.tile });
    const look: PaintedLook = { height: (x, y) => backgroundHeight(x, y, settings, layers, frame, flat), material, key };
    this.built = { key, ref, look, splat, material };
    // The liquid sheets run as far as the plane does, even past the picture (its edge liquid goes on outward).
    const sheet = Math.max(side, 2 * (area.reach ?? 0));
    for (const kind of LIQUID_KINDS) {
      const mask = liquidMask(layers, frame, area.cell, kind, map, area.reach);
      if (!mask) continue;
      const surface = new WaterSurface(mask, sheet, sheet, area.cell, settings.liquids[kind], kind);
      // Centred on the map, level with the map's floor: over the level extra board it is a shallow sheet on the ground
      // (which lies a hair under the map), past it the beds the ground sinks to lie under it. It is never under the map.
      surface.object3d.position.set(area.width / 2, 0, area.height / 2);
      this.object3d.add(surface.object3d);
      this.liquids.set(kind, surface);
    }
    void this.grow(this.forestJob, ref, read, frame, map, area.cell, look);
  }

  /**
   * Stands the background's props on the plane: loads the models of every brush, places the props, builds the forest.
   * A forest asked for again (or put away) while the models load is dropped. Models that cannot be read are left out.
   */
  private async grow(job: number, ref: string, read: Read, frame: ReturnType<typeof backgroundFrame>, map: { x0: number; y0: number; x1: number; y1: number }, cell: number, look: PaintedLook): Promise<void> {
    const { settings } = read.background;
    const load = this.source.model;
    const paths = [...new Set(settings.props.flatMap((brush) => brush.props))];
    if (!load || paths.length === 0 || !this.source.impostor) return;
    const models = new Map<string, LoadedMini>();
    await Promise.all(paths.map(async (path) => {
      try {
        const model = await load(path);
        if (model) models.set(path, model);
      } catch { /* a model that cannot be read is left out */ }
    }));
    if (this.gone || job !== this.forestJob) return;
    try {
      this.plant(read, frame, map, cell, look, models);
    } catch (error) {
      // The ground stays; only the props are missing. Said once for each background.
      if (!this.forestWarned.has(ref)) {
        this.forestWarned.add(ref);
        console.warn(`Painted background "${ref}": its props could not be drawn: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Places the props with the models that loaded and stands them on the plane. */
  private plant(read: Read, frame: ReturnType<typeof backgroundFrame>, map: { x0: number; y0: number; x1: number; y1: number }, cell: number, look: PaintedLook, models: Map<string, LoadedMini>): void {
    const { settings, layers } = read.background;
    const makePicture = this.source.impostor;
    if (!makePicture) return;
    const started = performance.now();
    // Every model is drawn to the same width (as the gallery's props are), so a brush with any model loaded has that footprint.
    const placements = scatterProps(layers, settings, frame, map, (brush) => (settings.props[brush]?.props.some((path) => models.has(path)) ? PROP_FILL : 0));
    // A flat picture for each model a far prop uses.
    const pictures = new Map<string, THREE.Texture>();
    for (const placement of placements) {
      if (!placement.far) continue;
      const path = settings.props[placement.brush]?.props[placement.prop];
      const model = path === undefined ? undefined : models.get(path);
      if (path === undefined || !model || pictures.has(path)) continue;
      let picture = this.pictures.get(path);
      if (!picture) {
        try { picture = makePicture(model); this.pictures.set(path, picture); } catch { continue; }
      }
      pictures.set(path, picture);
    }
    const forest = new PropForest(models, placements, settings.props, look.height, cell, pictures);
    this.forestMs = performance.now() - started;
    this.forest = forest;
    this.object3d.add(forest.object3d);
    this.changed();
  }
}
