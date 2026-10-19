/**
 * What a token shows besides itself, laid out the way the GM asked for it:
 * - its name on top, with its HP bar (and stress bar, when the map shows one) right under it, above its head;
 * - its conditions as coloured rings on its base, one wider than the next, named on hover;
 * - its other stats (the stat block's resources, and Atlas's copy number when several tokens share the art) as
 *   Atlas-style stepped circles beside it, alternating left and right, named on hover.
 * What is shown follows Atlas: only characters get a name, bars and conditions, and each only when Atlas would draw
 * it. Labels keep one size on screen and stay fully opaque on a hidden token.
 */
import * as THREE from 'three';
import { conditionLabel, resourceLabel, type CollectionRules } from './conditions';
import { conditionRingRadii, sideBadgeSlots } from './geometry';
import type { BoardToken, Meter, TokenSettings } from './mapModel';
import type { PoseContext } from './pieces';
import { canvasTexture, plateTexture } from './textures';

/** Sizes on screen, in pixels. */
const NAME_PX = 22;
const BAR_PX = { width: 110, height: 14 };
const BADGE_PX = 30;
const GAP_PX = 3;
/** The most steps a badge's ring is cut into; above it, the ring is a plain arc. */
const MAX_STEPS = 20;
const HP_COLORS = { good: '#22c55e', hurt: '#eab308', low: '#ef4444' };
const STRESS_COLOR = '#a855f7';

/** Something on a token that names itself on hover. */
export interface HoverTarget {
  object: THREE.Object3D;
  label: string;
}

interface Badge {
  value: number;
  max: number;
  color: string;
  label: string;
}

function barTexture(meter: Meter, color: string): THREE.CanvasTexture {
  const scale = 3;
  const width = BAR_PX.width * scale;
  const height = BAR_PX.height * scale;
  return canvasTexture(width, height, (context) => {
    const r = height / 2;
    context.fillStyle = '#1a1a1a';
    context.strokeStyle = '#888888';
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(1, 1, width - 2, height - 2, r - 1);
    context.fill();
    context.stroke();
    const share = meter.max > 0 ? Math.max(0, Math.min(1, meter.current / meter.max)) : 0;
    if (share > 0) {
      const fill = context.createLinearGradient(0, 0, 0, height);
      fill.addColorStop(0, '#ffffff');
      fill.addColorStop(0.25, color);
      fill.addColorStop(1, color);
      context.fillStyle = fill;
      context.beginPath();
      context.roundRect(4, 4, (width - 8) * share, height - 8, r - 4);
      context.fill();
    }
    if (meter.current <= 0) {
      context.fillStyle = 'rgba(0,0,0,0.4)';
      context.fillRect(0, 0, width, height);
    }
    context.font = `bold ${Math.round(height * 0.72)}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 4;
    context.strokeStyle = '#000000';
    const text = `${meter.current} / ${meter.max}`;
    context.strokeText(text, width / 2, height / 2 + 1);
    context.fillStyle = '#ffffff';
    context.fillText(text, width / 2, height / 2 + 1);
  });
}

/** Atlas's round stat badge: a dark disc with the number, ringed by `max` steps of which `value` are lit. */
function badgeTexture(badge: Badge): THREE.CanvasTexture {
  const px = 96;
  return canvasTexture(px, px, (context) => {
    const c = px / 2;
    const outer = c - 4;
    const ring = 9;
    context.fillStyle = '#16161a';
    context.beginPath();
    context.arc(c, c, outer, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = ring;
    const start = -Math.PI / 2;
    const share = badge.max > 0 ? Math.max(0, Math.min(1, badge.value / badge.max)) : 0;
    const mid = outer - ring / 2;
    if (badge.max > 1 && badge.max <= MAX_STEPS) {
      const step = (Math.PI * 2) / badge.max;
      const gap = Math.min(0.12, step * 0.25);
      for (let i = 0; i < badge.max; i++) {
        context.strokeStyle = i < badge.value ? badge.color : 'rgba(255,255,255,0.14)';
        context.beginPath();
        context.arc(c, c, mid, start + i * step + gap / 2, start + (i + 1) * step - gap / 2);
        context.stroke();
      }
    } else {
      context.strokeStyle = 'rgba(255,255,255,0.14)';
      context.beginPath();
      context.arc(c, c, mid, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = badge.color;
      context.beginPath();
      context.arc(c, c, mid, start, start + Math.PI * 2 * share);
      context.stroke();
    }
    context.fillStyle = '#ffffff';
    context.font = `bold ${Math.round(px * 0.36)}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(badge.value), c, c + 2);
  });
}

function hpColor(meter: Meter): string {
  const share = meter.max > 0 ? meter.current / meter.max : 0;
  return share >= 0.7 ? HP_COLORS.good : share >= 0.3 ? HP_COLORS.hurt : HP_COLORS.low;
}

const sprite = (texture: THREE.Texture): THREE.Sprite => {
  const made = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, transparent: true, depthTest: false }));
  made.renderOrder = 20;
  return made;
};

export class TokenLabels {
  readonly object3d = new THREE.Group();
  private readonly top = new THREE.Group();
  private readonly side = new THREE.Group();
  private stack: Array<{ sprite: THREE.Sprite; width: number; height: number }> = [];
  private badges: THREE.Sprite[] = [];
  private rings: THREE.Mesh[] = [];
  private hover: HoverTarget[] = [];
  private sideRadius = 0;

  constructor(token: BoardToken, settings: TokenSettings, rules: CollectionRules, sharedArt: boolean) {
    this.object3d.add(this.top, this.side);
    this.update(token, settings, rules, sharedArt);
  }

  get hoverTargets(): readonly HoverTarget[] {
    return this.hover;
  }

  update(token: BoardToken, settings: TokenSettings, rules: CollectionRules, sharedArt: boolean): void {
    this.clear();
    const character = token.kind === 'character';
    // Top to bottom: name, HP, stress.
    if (character && (settings.showNameplates || token.showNameplate) && token.name) {
      const plate = plateTexture(token.name);
      this.stack.push({ sprite: sprite(plate.texture), width: NAME_PX * (plate.width / plate.height), height: NAME_PX });
    }
    if (character && settings.showHPBars && token.hp) this.stack.push({ sprite: sprite(barTexture(token.hp, hpColor(token.hp))), width: BAR_PX.width, height: BAR_PX.height });
    if (character && settings.showStressBars && token.stress) this.stack.push({ sprite: sprite(barTexture(token.stress, STRESS_COLOR)), width: BAR_PX.width, height: BAR_PX.height });
    for (const entry of this.stack) {
      entry.sprite.center.set(0.5, 0);
      this.top.add(entry.sprite);
    }

    const badges: Badge[] = [];
    if (settings.showInstanceBadges && sharedArt && token.instanceNumber !== null) {
      badges.push({ value: token.instanceNumber, max: 0, color: '#555555', label: `Copy ${token.instanceNumber}` });
    }
    if (character) {
      for (const resource of token.resources) {
        if (settings.hiddenResources.includes(resource.key)) continue;
        const color = rules.resources.get(resource.key)?.color ?? '#64748b';
        badges.push({ value: resource.current, max: resource.max, color, label: `${resourceLabel(rules, resource.key)} ${resource.current} / ${resource.max}` });
      }
    }
    for (const badge of badges) {
      const made = sprite(badgeTexture(badge));
      this.side.add(made);
      this.badges.push(made);
      this.hover.push({ object: made, label: badge.label });
    }

    if (character) {
      const known = token.conditions.filter((id) => rules.conditions.has(id));
      for (const id of known) {
        const definition = rules.conditions.get(id)!;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0, 1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: definition.color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
        this.object3d.add(ring);
        this.rings.push(ring);
        this.hover.push({ object: ring, label: conditionLabel(definition, token.conditionValues[id]) });
      }
    }
  }

  /** Places the labels around a token `figureHeight` tall, its ring `baseRadius` across, its base's top at `baseY`. */
  place(figureHeight: number, baseRadius: number, baseY: number): void {
    this.top.position.y = figureHeight + baseRadius * 0.15;
    this.side.position.y = Math.max(baseY, figureHeight * 0.55);
    this.sideRadius = baseRadius * 1.15;
    const width = baseRadius * 0.12;
    const gap = baseRadius * 0.05;
    const radii = conditionRingRadii(baseRadius, this.rings.length, width, gap);
    this.rings.forEach((ring, index) => {
      const radius = radii[index]!;
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(radius - width / 2, radius + width / 2, 64).rotateX(-Math.PI / 2);
      ring.position.y = baseY + 0.2;
    });
  }

  /** Keeps the labels one size on screen and the side badges beside the token as the camera turns. */
  pose(context: PoseContext): void {
    let rise = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i]!;
      entry.sprite.scale.set(context.pixel * entry.width, context.pixel * entry.height, 1);
      entry.sprite.center.set(0.5, -rise / entry.height);
      rise += entry.height + GAP_PX;
    }
    // Screen right, on the board, for a camera turned by `yaw`.
    const right = new THREE.Vector3(Math.cos(context.yaw), 0, -Math.sin(context.yaw));
    const slots = sideBadgeSlots(this.badges.length);
    this.badges.forEach((badge, index) => {
      const slot = slots[index]!;
      badge.position.copy(right).multiplyScalar(slot.side * this.sideRadius);
      badge.scale.set(context.pixel * BADGE_PX, context.pixel * BADGE_PX, 1);
      // Outward from the token on its side, and stacked downward a row at a time.
      badge.center.set(slot.side < 0 ? 1 : 0, 0.5 + slot.row * ((BADGE_PX + GAP_PX) / BADGE_PX));
    });
  }

  private clear(): void {
    for (const entry of this.stack) this.disposeSprite(entry.sprite);
    for (const badge of this.badges) this.disposeSprite(badge);
    for (const ring of this.rings) {
      ring.removeFromParent();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.stack = [];
    this.badges = [];
    this.rings = [];
    this.hover = [];
  }

  private disposeSprite(made: THREE.Sprite): void {
    made.removeFromParent();
    made.material.map?.dispose();
    made.material.dispose();
  }

  dispose(): void {
    this.clear();
    this.object3d.removeFromParent();
  }
}
