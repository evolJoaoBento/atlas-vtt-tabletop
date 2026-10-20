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
 * one, in `decay`, which nothing else reads.
 */
import * as THREE from 'three';
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

/** Atlas's falloff: full inside the bright share (`decayExponent`), dim in the band beyond, fading out at each edge. */
const ATLAS_FALLOFF = `float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	if ( cutoffDistance <= 0.0 ) return 1.0;
	float t = lightDistance / cutoffDistance;
	float bright = 1.0 - smoothstep( decayExponent * 0.85, decayExponent + 0.04, t );
	float edge = 1.0 - smoothstep( 0.88, 1.0, t );
	return mix( ${DIM_SHARE.toFixed(2)}, 1.0, bright ) * edge;
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

interface Entry {
  light: BoardLight;
  lamp: THREE.PointLight | THREE.SpotLight;
  bulb: THREE.Mesh | null;
  seed: number;
  height: number;
}

const BULB_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);

export class LightRig {
  readonly object3d = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private signature = '';
  /** Below the lit threshold: only then do flames flicker (in daylight nobody sees it, and it would cost frames). */
  private dark = false;

  constructor() {
    this.object3d.name = 'lights';
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
    const signature = JSON.stringify(lights.map((light) => [light.id, light.bright, light.dim, light.color, light.angle, light.darkness, light.tokenId]));
    if (signature !== this.signature) {
      this.clear();
      this.signature = signature;
      for (const light of lights) this.add(light, layout);
    }
    for (const light of lights) {
      const entry = this.entries.get(light.id);
      if (!entry) continue;
      entry.light = light;
      entry.height = layout.heightOf(light);
      const on = !light.hidden && !light.darkness && light.dim > 0 && (light.activeBelowAmbient === null || layout.ambient <= light.activeBelowAmbient);
      entry.lamp.visible = on;
      if (entry.bulb) {
        (entry.bulb.material as THREE.MeshBasicMaterial).color.set(on ? light.color : 0x555555);
        entry.bulb.scale.setScalar(layout.cell * 0.09);
      }
      if (!light.tokenId) this.place(light.id, light.x, light.y);
      this.aim(entry);
    }
  }

  private add(light: BoardLight, layout: LightLayout): void {
    const reach = unitsToPx(light.dim, layout.unitDistance, layout.cell);
    const color = new THREE.Color(light.color);
    // `decay` carries the bright radius's share of the dim one (see the falloff above).
    const brightShare = light.dim > 0 ? light.bright / light.dim : 0;
    const lamp = light.angle === null
      ? new THREE.PointLight(color, 0, reach, brightShare)
      : new THREE.SpotLight(color, 0, reach, THREE.MathUtils.degToRad(light.angle / 2), 0.35, brightShare);
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
    this.entries.set(light.id, { light, lamp, bulb, seed: seedOf(light.id), height: layout.heightOf(light) });
  }

  /** Moves a light (a token's, as the token moves) to a point of the map. */
  place(id: string, x: number, y: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
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
      entry.lamp.intensity = STRENGTH * entry.light.intensity * (this.dark ? flicker(entry.light.animation, t, entry.seed) : 1);
    }
  }

  /** Lets the `count` lights nearest `target` cast shadows; returns whether that changed. */
  castShadows(count: number, target: { x: number; z: number }): boolean {
    const lit = [...this.entries.values()].filter((entry) => entry.lamp.visible)
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
    bulbs.forEach((bulb, i) => { bulb.scale.setScalar(grown[i]!); bulb.updateMatrixWorld(true); });
    return (hit?.object.userData.lightId as string | undefined) ?? null;
  }

  private clear(): void {
    for (const entry of this.entries.values()) {
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
