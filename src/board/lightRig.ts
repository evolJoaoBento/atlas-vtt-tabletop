/**
 * Atlas's lights on the 3D board, lit the board's own way: each a three.js point light (a spotlight for a beam) where
 * Atlas places it, hanging at a height Tabletop keeps per light, reaching as far as its dim radius, coloured and as
 * strong as Atlas says, its flame flickering as Atlas animates it (torch, candle, pulse, magic). A light a token
 * carries goes where the token goes. The few lights nearest the camera's target cast shadows (walls, minis), as many
 * as the quality allows; the GM sees a small bulb on each placed light, which players do not.
 *
 * Atlas's light is full inside its bright radius and dim (half) out to its dim radius. three.js lights fall off by
 * distance instead, so its falloff is replaced once (`getDistanceAttenuation`, before anything is drawn): Atlas's
 * lights are the only point and spot lights on the board, and each carries its bright radius, as a share of its dim
 * one, in `decay`, which nothing else reads. With the flame halo on, `decay` also carries `HALO_FLAG`: Atlas's halo
 * (`lightingConstants` `HALO`, a Gaussian peak round the flame on top of the falloff) is then added, lit only where the
 * light reaches, so walls and shadows stop it as they stop the light.
 *
 * A light that glows from a whole surface (lava, Atlas's `area`) is a few lamps spread over it (`areaGlow.ts`), low over
 * the surface, casting no shadows; the board holds at most `AREA_LAMPS` such lamps, the largest surfaces first.
 */
import * as THREE from 'three';
import { areaSpots } from './areaGlow';
import { flicker, seedOf, unitsToPx, type BoardLight } from './walls';

export interface LightLayout {
  /** Game units in a grid square, and the square's size in map pixels. */
  unitDistance: number;
  cell: number;
  /** How high a light hangs, in map pixels. */
  heightOf(light: BoardLight): number;
  /** The board's ambient light (0–1): a light kept for the dark shines only at or below its level. */
  ambient: number;
}

/** How strong dim light is against bright. */
const DIM_SHARE = 0.5;

/** Atlas's halo: its peak over the falloff, and its Gaussian sigma as a share of the bright radius (at least a quarter of the dim one). */
export const HALO = { gain: 0.8, size: 0.25 } as const;
/** Added to a lamp's `decay` (its bright share, 0 to 1) when the halo is on. */
export const HALO_FLAG = 10;

/** A lamp's `decay`: its bright share, flagged for the halo when that is on. */
export function decayOf(brightShare: number, halo: boolean): number {
  return brightShare + (halo ? HALO_FLAG : 0);
}

/** Atlas's falloff: full inside the bright share (`decayExponent`), dim in the band beyond, fading out at each edge; plus Atlas's halo when flagged. */
const ATLAS_FALLOFF = `float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	if ( cutoffDistance <= 0.0 ) return 1.0;
	bool flagged = decayExponent >= ${(HALO_FLAG / 2).toFixed(1)};
	float share = flagged ? decayExponent - ${HALO_FLAG.toFixed(1)} : decayExponent;
	float t = lightDistance / cutoffDistance;
	float bright = 1.0 - smoothstep( share * 0.85, share + 0.04, t );
	float edge = 1.0 - smoothstep( 0.88, 1.0, t );
	float sigma = max( max( share, 0.25 ) * ${HALO.size.toFixed(2)}, 1e-3 );
	float halo = flagged ? ${HALO.gain.toFixed(2)} * exp( -0.5 * ( t * t ) / ( sigma * sigma ) ) : 0.0;
	return ( mix( ${DIM_SHARE.toFixed(2)}, 1.0, bright ) + halo ) * edge;
}

`;

(function replaceFalloff(): void {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  const start = chunk.indexOf('float getDistanceAttenuation(');
  const end = chunk.indexOf('float getSpotAttenuation(');
  if (start < 0 || end < start) return;
  THREE.ShaderChunk.lights_pars_begin = chunk.slice(0, start) + ATLAS_FALLOFF + chunk.slice(end);
})();

/** A light's strength on the board for Atlas's intensity 1, against the board's daylight. */
const STRENGTH = 2.6;
/** Shadow maps of a point light are six of this size; kept small, they are many. */
const SHADOW_PX = 512;

/** The most lamps all the board's surface lights together are made of, and of one. */
const AREA_LAMPS = 12;
const LAMPS_PER_AREA = 4;
/** How high over its surface a surface light's lamps hang, in squares. */
const AREA_HEIGHT = 0.6;

interface Entry {
  light: BoardLight;
  lamp: THREE.PointLight | THREE.SpotLight;
  /** A surface light's other lamps, spread over it (none for any other). */
  extra: THREE.PointLight[];
  bulb: THREE.Mesh | null;
  seed: number;
  height: number;
  /** The bright radius's share of the dim one (a surface light's lamps: null, they get no halo). */
  share: number | null;
}

const BULB_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);

export class LightRig {
  readonly object3d = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private signature = '';
  /** Below the lit threshold: only then do flames flicker (in daylight nobody sees it, and it would cost frames). */
  private dark = false;
  /** Whether flames get Atlas's halo. */
  private halo = false;

  constructor() {
    this.object3d.name = 'lights';
  }

  /** Turns Atlas's halo round each flame on or off. */
  setHalo(on: boolean): void {
    if (on === this.halo) return;
    this.halo = on;
    for (const entry of this.entries.values()) if (entry.share !== null) entry.lamp.decay = decayOf(entry.share, on);
  }

  /** Whether any light flickers: the board then redraws a few times a second. */
  get animated(): boolean {
    if (!this.dark) return false;
    for (const entry of this.entries.values()) if (entry.lamp.visible && entry.light.animation !== 'none') return true;
    return false;
  }

  /** Puts up the map's lights; a light whose look did not change keeps its lamp. */
  update(lights: readonly BoardLight[], layout: LightLayout & { litThreshold: number }): void {
    this.dark = layout.ambient < layout.litThreshold;
    const signature = JSON.stringify(lights.map((light) => [light.id, light.bright, light.dim, light.color, light.angle, light.darkness, light.tokenId, light.area ?? null]));
    if (signature !== this.signature) {
      this.clear();
      this.signature = signature;
      const budget = areaBudget(lights, AREA_LAMPS);
      for (const light of lights) this.add(light, layout, budget.get(light.id) ?? LAMPS_PER_AREA);
    }
    for (const light of lights) {
      const entry = this.entries.get(light.id);
      if (!entry) continue;
      entry.light = light;
      entry.height = layout.heightOf(light);
      const on = !light.hidden && !light.darkness && light.dim > 0 && (light.activeBelowAmbient === null || layout.ambient <= light.activeBelowAmbient);
      entry.lamp.visible = on;
      for (const lamp of entry.extra) lamp.visible = on;
      if (entry.bulb) {
        (entry.bulb.material as THREE.MeshBasicMaterial).color.set(on ? light.color : 0x555555);
        entry.bulb.scale.setScalar(layout.cell * 0.09);
      }
      if (!light.tokenId) this.place(light.id, light.x, light.y);
      this.aim(entry);
    }
  }

  private add(light: BoardLight, layout: LightLayout, lamps: number): void {
    if (light.area) { this.addArea(light, layout, lamps); return; }
    const reach = unitsToPx(light.dim, layout.unitDistance, layout.cell);
    const color = new THREE.Color(light.color);
    // `decay` carries the bright radius's share of the dim one (see the falloff above).
    const brightShare = light.dim > 0 ? light.bright / light.dim : 0;
    const lamp = light.angle === null
      ? new THREE.PointLight(color, 0, reach, decayOf(brightShare, this.halo))
      : new THREE.SpotLight(color, 0, reach, THREE.MathUtils.degToRad(light.angle / 2), 0.35, decayOf(brightShare, this.halo));
    lamp.shadow.mapSize.set(SHADOW_PX, SHADOW_PX);
    lamp.shadow.bias = -0.002;
    lamp.shadow.camera.near = layout.cell * 0.05;
    lamp.shadow.camera.far = Math.max(reach, layout.cell);
    lamp.userData.lightId = light.id;
    this.object3d.add(lamp);
    if (lamp instanceof THREE.SpotLight) this.object3d.add(lamp.target);
    let bulb: THREE.Mesh | null = null;
    if (!light.tokenId) {
      bulb = new THREE.Mesh(BULB_GEOMETRY, new THREE.MeshBasicMaterial({ color: light.color }));
      bulb.userData.lightId = light.id;
      bulb.userData.gmOnly = true;
      this.object3d.add(bulb);
    }
    this.entries.set(light.id, { light, lamp, extra: [], bulb, seed: seedOf(light.id), height: layout.heightOf(light), share: brightShare });
  }

  /**
   * A surface light: `lamps` point lamps over its area (none when the board's budget is spent), each reaching its radii
   * past the part of the area it stands for, low over the surface (unless the GM hung it), never casting shadows.
   */
  private addArea(light: BoardLight, layout: LightLayout, lamps: number): void {
    const dim = unitsToPx(light.dim, layout.unitDistance, layout.cell);
    const bright = unitsToPx(light.bright, layout.unitDistance, layout.cell);
    const { spots, spread } = areaSpots(light.area ?? [], lamps, Math.max(dim, layout.cell) * 0.6);
    const reach = dim + spread;
    const height = light.ownHeight != null ? layout.heightOf(light) : AREA_HEIGHT * layout.cell;
    const made = spots.map((spot) => {
      const lamp = new THREE.PointLight(new THREE.Color(light.color), 0, reach, reach > 0 ? Math.min(1, (bright + spread) / reach) : 0);
      lamp.castShadow = false;
      lamp.position.set(spot.x, height, spot.y);
      lamp.userData.lightId = light.id;
      lamp.userData.surface = true;
      this.object3d.add(lamp);
      return lamp;
    });
    const [lamp, ...extra] = made;
    // A light with no lamp to spare still gets one, dark, so its bulb and its entry stand.
    const first = lamp ?? new THREE.PointLight(new THREE.Color(light.color), 0, reach, 0);
    if (!lamp) { first.position.set(light.x, height, light.y); first.userData.lightId = light.id; first.userData.surface = true; first.userData.spare = true; this.object3d.add(first); }
    const bulb = new THREE.Mesh(BULB_GEOMETRY, new THREE.MeshBasicMaterial({ color: light.color }));
    bulb.userData.lightId = light.id;
    bulb.userData.gmOnly = true;
    this.object3d.add(bulb);
    this.entries.set(light.id, { light, lamp: first, extra, bulb, seed: seedOf(light.id), height, share: null });
  }

  /** Moves a light (a token's, as the token moves) to a point of the map. */
  place(id: string, x: number, y: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    // A surface light's lamps stand over its surface: only its bulb is at its middle.
    if (entry.lamp.userData.surface) { entry.bulb?.position.set(x, entry.height, y); return; }
    entry.lamp.position.set(x, entry.height, y);
    entry.bulb?.position.set(x, entry.height, y);
    this.aim(entry);
  }

  /** A beam faces its rotation: 0 up the map, 90 to the right. */
  private aim(entry: Entry): void {
    if (!(entry.lamp instanceof THREE.SpotLight)) return;
    const turn = THREE.MathUtils.degToRad(entry.light.rotation);
    const { x, z } = entry.lamp.position;
    entry.lamp.target.position.set(x + Math.sin(turn) * entry.lamp.distance, 0, z - Math.cos(turn) * entry.lamp.distance);
  }

  /** Sets each light's strength at time `t`, flickering. */
  step(t: number): void {
    for (const entry of this.entries.values()) {
      if (!entry.lamp.visible) continue;
      const strength = STRENGTH * entry.light.intensity * (this.dark ? flicker(entry.light.animation, t, entry.seed) : 1);
      entry.lamp.intensity = entry.lamp.userData.spare ? 0 : strength;
      for (const lamp of entry.extra) lamp.intensity = strength;
    }
  }

  /** Lets the `count` lights nearest `target` cast shadows; returns whether that changed. */
  castShadows(count: number, target: { x: number; z: number }): boolean {
    const lit = [...this.entries.values()].filter((entry) => entry.lamp.visible && !entry.lamp.userData.surface)
      .sort((a, b) => Math.hypot(a.lamp.position.x - target.x, a.lamp.position.z - target.z) - Math.hypot(b.lamp.position.x - target.x, b.lamp.position.z - target.z))
      .slice(0, count);
    let changed = false;
    for (const entry of this.entries.values()) {
      const cast = lit.includes(entry);
      if (entry.lamp.castShadow !== cast) { entry.lamp.castShadow = cast; changed = true; }
    }
    return changed;
  }

  /** The bulbs are the GM's. */
  show(viewer: 'gm' | 'player'): void {
    for (const entry of this.entries.values()) if (entry.bulb) entry.bulb.visible = viewer === 'gm';
  }

  /** The placed light whose bulb a ray hits. */
  lightAt(raycaster: THREE.Raycaster): string | null {
    const bulbs = [...this.entries.values()].flatMap((entry) => (entry.bulb ? [entry.bulb] : []));
    // A bulb is small: it is hit within twice its size.
    const grown = bulbs.map((bulb) => { const scale = bulb.scale.x; bulb.scale.setScalar(scale * 2); bulb.updateMatrixWorld(true); return scale; });
    const hit = raycaster.intersectObjects(bulbs, false)[0];
    bulbs.forEach((bulb, i) => { bulb.scale.setScalar(grown[i]); bulb.updateMatrixWorld(true); });
    return (hit?.object.userData.lightId as string | undefined) ?? null;
  }

  /**
   * Lets go of the lamps' shadow maps while every renderer that drew them is alive, so each frees its own side; the next
   * draw makes them again. A renderer disposed first would leave its listener on a shared map that throws when the map is freed.
   */
  releaseShadows(): void {
    for (const entry of this.entries.values()) {
      entry.lamp.shadow.map?.dispose();
      entry.lamp.shadow.map = null;
    }
  }

  private clear(): void {
    for (const entry of this.entries.values()) {
      for (const lamp of entry.extra) { lamp.removeFromParent(); lamp.dispose(); }
      entry.lamp.removeFromParent();
      if (entry.lamp instanceof THREE.SpotLight) entry.lamp.target.removeFromParent();
      entry.lamp.shadow.map?.dispose();
      entry.lamp.dispose();
      if (entry.bulb) {
        entry.bulb.removeFromParent();
        (entry.bulb.material as THREE.Material).dispose();
      }
    }
    this.entries.clear();
  }

  dispose(): void {
    this.clear();
    this.object3d.removeFromParent();
  }
}

/** Twice an area's size, by its corners. */
const areaOf = (ring: readonly { x: number; y: number }[]): number => Math.abs(ring.reduce((sum, p, k) => { const q = ring[(k + 1) % ring.length]!; return sum + p.x * q.y - q.x * p.y; }, 0));

/** How many lamps each surface light gets of `total`: the largest surfaces first, up to `LAMPS_PER_AREA` each, at least one while any is left. */
export function areaBudget(lights: readonly BoardLight[], total: number): Map<string, number> {
  const surfaces = lights.filter((light) => light.area && !light.darkness).sort((a, b) => areaOf(b.area!) - areaOf(a.area!));
  const out = new Map<string, number>();
  let left = total;
  // One each first, the largest first; then the rest to the largest again.
  for (const light of surfaces) { const give = left > 0 ? 1 : 0; out.set(light.id, give); left -= give; }
  for (const light of surfaces) { if (left <= 0) break; const give = Math.min(LAMPS_PER_AREA - 1, left); out.set(light.id, (out.get(light.id) ?? 0) + give); left -= give; }
  return out;
}
