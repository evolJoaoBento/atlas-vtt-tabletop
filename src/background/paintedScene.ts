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
}

/** A background read, with a copy of each material of its slots to take the maps from (null where there is none). */
interface Read {
  background: LoadedBackground;
  slots: (THREE.MeshStandardMaterial | null)[];
}

/** What is drawn for one background at one map size. */
interface Built {
  key: string;
  look: PaintedLook;
  splat: THREE.DataTexture;
  material: THREE.MeshStandardMaterial;
}

export class PaintedScene {
  /** The liquid sheets, laid on the picture's square; the board lifts the group with the ground. */
  readonly object3d = new THREE.Group();
  /** The sheets by liquid; a liquid not painted has none. */
  readonly liquids = new Map<LiquidKind, WaterSurface>();
  private readonly reads = new Map<string, Read | null>();
  private readonly pending = new Set<string>();
  private readonly warned = new Set<string>();
  private built: Built | null = null;
  private readonly cell = { value: 1 };
  private readonly tile = { value: 1 };
  private readonly area = new THREE.Vector3();

  /**
   * `background` and `material` read from the host; `changed` is called when a background has come in (the board
   * draws the ground again).
   */
  constructor(
    private readonly source: { background(ref: string): Promise<LoadedBackground | null>; material(path: string): Promise<LoadedMaterial | null> },
    private readonly changed: () => void,
  ) {
    this.object3d.name = 'painted-liquids';
  }

  /** Whether any liquid sheet is drawn (they move, so the board asks for frames). */
  get moving(): boolean {
    return this.liquids.size > 0;
  }

  /**
   * What the ground wears for the background `ref` on this map. Null while it is being read, and when it cannot be
   * (not chosen, gone, broken): the board draws the plain horizon plane then, and a background that is gone is
   * mentioned once.
   */
  look(ref: string | undefined, area: PaintedArea): PaintedLook | null {
    if (!ref) { this.clear(); return null; }
    const read = this.reads.get(ref);
    if (read === undefined) { this.start(ref); this.clear(); return null; }
    if (read === null) { this.clear(); return null; }
    const key = JSON.stringify([ref, area.width, area.height, area.cell, area.margin, area.tile]);
    this.cell.value = area.cell;
    this.tile.value = area.cell * area.tile;
    if (this.built?.key !== key) this.build(key, read, area);
    return this.built?.look ?? null;
  }

  /** Reads this background again next time (it was saved). */
  forget(ref: string): void {
    const read = this.reads.get(ref);
    this.reads.delete(ref);
    this.warned.delete(ref);
    this.clear();
    for (const slot of read?.slots ?? []) slot?.dispose();
  }

  /** Moves the liquids on to this time, in seconds. */
  tick(seconds: number): void {
    for (const surface of this.liquids.values()) surface.tick(seconds);
  }

  /** Puts away what is drawn (the background stays read). */
  clear(): void {
    for (const surface of this.liquids.values()) surface.dispose();
    this.liquids.clear();
    this.built?.material.dispose();
    this.built?.splat.dispose();
    this.built = null;
    this.object3d.removeFromParent();
  }

  dispose(): void {
    this.clear();
    for (const read of this.reads.values()) for (const slot of read?.slots ?? []) slot?.dispose();
    this.reads.clear();
  }

  private start(ref: string): void {
    if (this.pending.has(ref)) return;
    this.pending.add(ref);
    void this.read(ref).then((read) => {
      this.pending.delete(ref);
      this.reads.set(ref, read);
      if (!read && !this.warned.has(ref)) { this.warned.add(ref); console.warn(`Painted background "${ref}" could not be read; the ground is drawn plain.`); }
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
    return { background, slots };
  }

  private build(key: string, read: Read, area: PaintedArea): void {
    this.clear();
    const { settings, layers } = read.background;
    const frame = backgroundFrame(area.width, area.height, area.cell, layers.size);
    const flat = { x0: -area.margin, y0: -area.margin, x1: area.width / area.cell + area.margin, y1: area.height / area.cell + area.margin };
    const side = frame.extent * area.cell;
    this.area.set(area.width / 2 - side / 2, area.height / 2 - side / 2, side);
    const splat = splatTexture(layers, frame, flat);
    const material = paintedGroundMaterial(splat, read.slots, this.cell, { area: this.area, tile: this.tile });
    const look: PaintedLook = { height: (x, y) => backgroundHeight(x, y, settings, layers, frame, flat), material, key };
    this.built = { key, look, splat, material };
    for (const kind of LIQUID_KINDS) {
      const mask = liquidMask(layers, frame, area.cell, kind, flat);
      if (!mask) continue;
      const surface = new WaterSurface(mask, side, side, area.cell, settings.liquids[kind], kind);
      // Laid like the sea plane: centred on the map, a tenth of a square down, so the beds the ground sinks to lie under it.
      surface.object3d.position.set(area.width / 2, -area.cell * 0.1, area.height / 2);
      this.object3d.add(surface.object3d);
      this.liquids.set(kind, surface);
    }
  }
}
