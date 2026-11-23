/**
 * An area of Atlas with an effect (fire, frost, lightning, mist, radiance or shadow: `objects.measures[].effect`) as
 * the board draws it: the look a spell of that damage has, standing from the floor over the area's footprint as the
 * walls leave it (`areaCuts.ts`), as tall as the map's default wall height. Atlas draws such an area's effect in the
 * wash's place, in its own colour, with the outline kept; the board keeps the flat outline (`marks.ts`) and stands
 * the same look up in 3D.
 *
 * The footprint is the body (an extrusion of the cut outline); the damage's own look (`spellEffects.ts`) is laid over
 * it by a spell that stands for the shape (a column for a circle, a slab along the run for a square, a line or a cone)
 * and cut to the footprint by a mask, so a circle cut by a wall shows its flames only on the room's side.
 */
import * as THREE from 'three';
import { damageOfEffect } from '../../packages/atlas-host/src/spellMeasure';
import type { MeasureArea } from '../atlasPort/app/measure/measureGeometry';
import { cutArea, ringsOf, type WallsLook } from './areaCuts';
import type { TemplateMark } from './playerTools';
import { templateArea } from './playerTools';
import { SpellView, type Footprint } from './spellView';
import { isDamageType, type Spell } from './spells';
import type { BoardWall } from './walls';

/** What the board draws for one area with an effect. */
export interface AreaVolume {
  id: string;
  color: string;
  gmOnly: boolean;
  footprint: Footprint;
}

/** What a flat mark of an area becomes on the floor: the outline as Atlas leaves it, cut by walls (null: the shape itself). */
export interface MarkShape {
  shaped: ReturnType<typeof templateArea>;
  cut: MeasureArea | null;
}

/** The mark's shape and what the walls leave of it; null for a ruler, a thin line and an area without a size. */
export function markShape(mark: Pick<TemplateMark, 'shape' | 'start' | 'end' | 'width' | 'ruler' | 'uncut'>, coneAngle: number, walls: readonly BoardWall[], look: WallsLook): MarkShape | null {
  const shaped = templateArea(mark, coneAngle);
  if (!shaped) return null;
  if (mark.uncut === true || walls.length === 0) return { shaped, cut: null };
  const cut = cutArea(shaped, walls, look);
  return { shaped, cut: cut === shaped ? null : cut };
}

/** The spell that stands for an area's shape: a column for a circle, a slab along its run for the rest. */
function standIn(mark: TemplateMark, height: number, effect: Spell['effect'], coneAngle: number): Spell | null {
  const run = Math.hypot(mark.end.x - mark.start.x, mark.end.y - mark.start.y);
  if (!(run > 1e-3)) return null;
  const own = { yaw: 0, pitch: 0, roll: 0, angle: Math.PI / 2, ...(effect ? { effect } : {}) };
  if (mark.shape === 'circle') {
    // Stood up: a cylinder at a point whose own -z is the world's up, its middle half way up.
    return { ...own, shape: 'cylinder', from: 'point', at: { x: mark.start.x, y: mark.start.y, h: height / 2 }, pitch: Math.PI / 2, size: run, length: height };
  }
  // A square is as thick as it is long, a cone as wide as it opens at its end, a line as wide as it says.
  const thick = mark.shape === 'square' ? run : mark.shape === 'cone' ? 2 * run * Math.tan(Math.min(coneAngle / 2, Math.PI / 2 - 0.05)) : mark.width ?? run / 4;
  return { ...own, shape: 'wall', from: 'point', at: { x: mark.start.x, y: mark.start.y, h: 0 }, to: { x: mark.end.x, y: mark.end.y }, size: Math.max(1, thick), length: height };
}

/**
 * The volume of an area with an effect, or null: the mark has none (or one the board does not know), it is no area, or
 * what the walls leave of it is nothing. `height` is the default wall height, map pixels.
 */
export function areaVolumeOf(mark: TemplateMark, cut: MeasureArea | null, height: number, coneAngle: number): AreaVolume | null {
  if (!mark.effect || mark.ruler || !(height > 0)) return null;
  const shaped = templateArea(mark, coneAngle);
  if (!shaped) return null;
  const rings = ringsOf(cut ?? shaped).filter((ring) => ring.length > 2);
  if (rings.length === 0) return null;
  const damage = damageOfEffect(mark.effect);
  const look = standIn(mark, height, isDamageType(damage) ? damage : undefined, coneAngle);
  if (!look) return null;
  return { id: mark.id, color: mark.color, gmOnly: mark.gmOnly === true, footprint: { rings, height, look } };
}

/** Every area of the scene drawn in 3D, kept while it is the same area and drawn again when it is another. */
export class AreaVolumes {
  readonly object3d = new THREE.Group();
  private readonly views = new Map<string, { key: string; view: SpellView; gmOnly: boolean }>();

  constructor() {
    this.object3d.name = 'area-volumes';
  }

  /** The areas now on the map; `cell` a square, map pixels. */
  set(list: readonly AreaVolume[], cell: number): void {
    const wanted = new Set<string>();
    for (const volume of list) {
      wanted.add(volume.id);
      const key = JSON.stringify([volume.color, cell, volume.footprint.height, volume.footprint.look, volume.footprint.rings]);
      const kept = this.views.get(volume.id);
      if (kept?.key === key) { kept.gmOnly = volume.gmOnly; continue; }
      kept?.view.dispose();
      const view = new SpellView(volume.footprint.look, volume.color, [], 0.4, cell, { footprint: volume.footprint });
      view.grow(1);
      this.object3d.add(view.object3d);
      this.views.set(volume.id, { key, view, gmOnly: volume.gmOnly });
    }
    for (const [id, kept] of [...this.views]) {
      if (wanted.has(id)) continue;
      kept.view.dispose();
      this.views.delete(id);
    }
  }

  /** How many areas are drawn. */
  get count(): number {
    return this.views.size;
  }

  /** Whether any moves by itself (a damage's look): the board draws every frame then. */
  get animated(): boolean {
    for (const { view } of this.views.values()) if (view.animated) return true;
    return false;
  }

  /** On to `time`, seconds; `viewport` the drawing's height, pixels. */
  tick(time: number, viewport: number): void {
    for (const { view } of this.views.values()) if (view.animated) view.tick(time, viewport);
  }

  /** Shows the areas as `viewer` sees them: what Atlas keeps from its players is the GM's alone. */
  show(viewer: 'gm' | 'player'): void {
    for (const kept of this.views.values()) kept.view.object3d.visible = viewer === 'gm' || !kept.gmOnly;
  }

  /** What stands now, for a look in tests: each area's id, effect, where its body lies (map x and y, height) and whether it shows. */
  state(): Array<{ id: string; effect: string | null; height: number; x: [number, number]; y: [number, number]; visible: boolean }> {
    return [...this.views].map(([id, { view }]) => {
      const box = view.bodyBox();
      return { id, effect: view.spell.effect ?? null, height: box.max.y - Math.min(0, box.min.y), x: [box.min.x, box.max.x], y: [box.min.z, box.max.z], visible: view.object3d.visible };
    });
  }

  dispose(): void {
    for (const { view } of this.views.values()) view.dispose();
    this.views.clear();
    this.object3d.removeFromParent();
  }
}
