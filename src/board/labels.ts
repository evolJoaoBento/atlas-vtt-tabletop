/**
 * What a token shows besides itself, laid out the way the GM asked for it:
 * - its name on top, with its bars (Atlas's first two resource sockets: HP, stress, or what the collection puts there)
 *   right under it, above its head;
 * - its conditions as coloured rings on its base, one wider than the next, named on hover;
 * - its other resources (Atlas's wheels: sockets 2 to 5, spell slots, inspiration…), and Atlas's copy number when
 *   several tokens share the art, as Atlas-style wheels beside it, alternating left and right, named on hover.
 * Which resources show, in which socket and colour, follows Atlas (`resources.ts`); bars and wheels are drawn in its
 * look. Only characters get a name, resources and conditions. Labels keep one size on screen and stay fully opaque on
 * a hidden token. The players' picture has labels of its own (`LabelLook`): the resources shown to players, and copy
 * numbers counted among the tokens players see.
 */
import * as THREE from 'three';
import { conditionLabel, type CollectionRules } from './conditions';
import { conditionRingRadii, sideBadgeSlots } from './geometry';
import type { BoardToken, TokenSettings } from './mapModel';
import type { PoseContext } from './pieces';
import { BAR_SLOTS, resourceColor, visibleResources, wheelGauge, type ResourceDefinition, type ResourceValue } from './resources';
import { canvasTexture, plateTexture } from './textures';

/** Sizes on screen, in pixels: Atlas's bar is 64 × 10 and its wheel two bar heights across. */
const NAME_PX = 22;
export const BAR_PX = { width: 96, height: 15 };
export const WHEEL_PX = 30;
const GAP_PX = 3;
/** Atlas's resource look: a thin grey border, a dark track, a fill set in from the border, faint ticks. */
const LOOK = { border: '#888888', track: '#1a1a1a', tick: 'rgba(51,51,51,0.5)' };

/** Whose labels these are, and the copy number the badge shows them (null: no badge). */
export interface LabelLook {
  viewer: 'gm' | 'player';
  badge: number | null;
}

/** Something on a token that names itself on hover. */
export interface HoverTarget {
  object: THREE.Object3D;
  label: string;
}

/** A resource drawn on a token, which the selected token's controls sit on. */
export interface ResourceTarget {
  object: THREE.Sprite;
  definition: ResourceDefinition;
  value: ResourceValue;
  kind: 'bar' | 'wheel';
  /** Its size on screen, in pixels. */
  width: number;
  height: number;
  /** Which side of the token a wheel hangs on: -1 left, 1 right; 0 for a bar. */
  side: -1 | 0 | 1;
}

interface Badge {
  /** The resource it shows; none for the copy number. */
  definition: ResourceDefinition | null;
  value: ResourceValue;
  color: string;
  label: string;
}

const numberFont = (px: number): string => `600 ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;

function outlinedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign): void {
  context.textAlign = align;
  context.lineWidth = 4;
  context.strokeStyle = '#000000';
  context.lineJoin = 'round';
  context.strokeText(text, x, y);
  context.fillStyle = '#ffffff';
  context.fillText(text, x, y);
}

/** Atlas's bar: a pill with ten faint ticks, filled in the resource's colour, "x / y" (a static value: its number). */
function barTexture(definition: ResourceDefinition, value: ResourceValue): THREE.CanvasTexture {
  const scale = 3;
  const width = BAR_PX.width * scale;
  const height = BAR_PX.height * scale;
  const fixed = definition.direction === 'static';
  return canvasTexture(width, height, (context) => {
    const border = 2;
    context.strokeStyle = LOOK.border;
    context.lineWidth = border;
    context.beginPath();
    context.roundRect(border / 2, border / 2, width - border, height - border, (height - border) / 2);
    context.stroke();
    const inner = { x: border, y: border, width: width - border * 2, height: height - border * 2 };
    context.fillStyle = LOOK.track;
    context.beginPath();
    context.roundRect(inner.x, inner.y, inner.width, inner.height, inner.height / 2);
    context.fill();
    context.strokeStyle = LOOK.tick;
    context.lineWidth = 1.5;
    for (let i = 1; i < 10; i++) {
      const x = inner.x + (inner.width / 10) * i;
      context.beginPath();
      context.moveTo(x, inner.y + 3);
      context.lineTo(x, inner.y + inner.height - 3);
      context.stroke();
    }
    const share = fixed ? 1 : value.max > 0 ? Math.max(0, Math.min(1, value.current / value.max)) : 0;
    const inset = 3;
    if (share > 0) {
      context.fillStyle = resourceColor(definition, value);
      context.beginPath();
      const fillHeight = inner.height - inset * 2;
      context.roundRect(inner.x + inset, inner.y + inset, Math.max(fillHeight, (inner.width - inset * 2) * share), fillHeight, fillHeight / 2);
      context.fill();
    }
    context.font = numberFont(Math.round(height * 0.7));
    context.textBaseline = 'middle';
    const middle = height / 2 + 1;
    if (fixed) {
      outlinedText(context, String(value.max), width / 2, middle, 'center');
    } else {
      // Current and maximum hug a central slash, as Atlas lays them out.
      const gap = 4.5 * scale;
      outlinedText(context, String(value.current), width / 2 - gap, middle, 'right');
      outlinedText(context, '/', width / 2, middle, 'center');
      outlinedText(context, String(value.max), width / 2 + gap, middle, 'left');
    }
  });
}

/** Atlas's wheel: the bar's border and track, a ring gauge in the resource's colour cut into points, its number inside. */
function wheelTexture(badge: Badge): THREE.CanvasTexture {
  const px = 96;
  return canvasTexture(px, px, (context) => {
    const c = px / 2;
    const border = 2.4;
    const outer = c - border / 2;
    context.strokeStyle = LOOK.border;
    context.lineWidth = border;
    context.beginPath();
    context.arc(c, c, outer, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = LOOK.track;
    context.beginPath();
    context.arc(c, c, outer - border / 2, 0, Math.PI * 2);
    context.fill();
    const ring = 14;
    const radius = c - border - 3 - ring / 2;
    context.lineWidth = ring;
    context.strokeStyle = LOOK.tick;
    context.beginPath();
    context.arc(c, c, radius, 0, Math.PI * 2);
    context.stroke();
    // The copy number and a static value are a whole ring around their number.
    const fixed = badge.definition === null || badge.definition.direction === 'static';
    const gauge = fixed ? { share: 1, end: 0, ticks: [] as number[] } : wheelGauge(badge.value);
    context.strokeStyle = badge.color;
    if (gauge && gauge.share >= 1) {
      context.beginPath();
      context.arc(c, c, radius, 0, Math.PI * 2);
      context.stroke();
    } else if (gauge && gauge.share > 0) {
      context.beginPath();
      context.arc(c, c, radius, -Math.PI / 2, gauge.end);
      context.stroke();
    }
    if (gauge) {
      context.strokeStyle = LOOK.track;
      context.lineWidth = 3.5;
      for (const angle of gauge.ticks) {
        context.beginPath();
        context.moveTo(c + Math.cos(angle) * (radius - ring / 2), c + Math.sin(angle) * (radius - ring / 2));
        context.lineTo(c + Math.cos(angle) * (radius + ring / 2), c + Math.sin(angle) * (radius + ring / 2));
        context.stroke();
      }
    }
    const text = String(badge.definition?.direction === 'static' ? badge.value.max : badge.value.current);
    context.font = numberFont(Math.round(px * 0.34 * Math.min(1, 2 / text.length)));
    context.textBaseline = 'middle';
    outlinedText(context, text, c, c + 2, 'center');
  });
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
  private resources: ResourceTarget[] = [];
  private sideRadius = 0;
  /** What the labels were last placed for. */
  private placed = '';

  constructor(token: BoardToken, settings: TokenSettings, rules: CollectionRules, look: LabelLook) {
    this.object3d.add(this.top, this.side);
    this.update(token, settings, rules, look);
  }

  /** The resources drawn on the token, bars then wheels, which its controls sit on when it is selected. */
  get resourceTargets(): readonly ResourceTarget[] {
    return this.resources;
  }

  /** Everything drawn over the token: a press on any of it is a press on the token. */
  get sprites(): THREE.Sprite[] {
    return [...this.stack.map((entry) => entry.sprite), ...this.badges];
  }

  get hoverTargets(): readonly HoverTarget[] {
    return this.hover;
  }

  update(token: BoardToken, settings: TokenSettings, rules: CollectionRules, look: LabelLook): void {
    this.clear();
    const character = token.kind === 'character';
    // A Connect player's board colours each bar as Connect worked it out for this token.
    const own = token.resourceColors;
    const shown = (character ? visibleResources(token, rules.definitions, settings.hiddenResources, look.viewer) : []).map((entry) => {
      const color = own?.[entry.definition.key];
      return color ? { ...entry, definition: { ...entry.definition, color, defeatedWhenSpent: false } } : entry;
    });
    // Top to bottom: name, then the bars in socket order.
    if (character && (settings.showNameplates || token.showNameplate) && token.name) {
      const plate = plateTexture(token.name);
      this.stack.push({ sprite: sprite(plate.texture), width: NAME_PX * (plate.width / plate.height), height: NAME_PX });
    }
    for (const resource of shown.filter((entry) => entry.slot < BAR_SLOTS)) {
      const bar = sprite(barTexture(resource.definition, resource.value));
      this.stack.push({ sprite: bar, width: BAR_PX.width, height: BAR_PX.height });
      this.resources.push({ object: bar, definition: resource.definition, value: resource.value, kind: 'bar', width: BAR_PX.width, height: BAR_PX.height, side: 0 });
    }
    for (const entry of this.stack) {
      entry.sprite.center.set(0.5, 0);
      this.top.add(entry.sprite);
    }

    const badges: Badge[] = [];
    if (look.badge !== null) {
      badges.push({ definition: null, value: { current: look.badge, max: 0 }, color: '#555555', label: `Copy ${look.badge}` });
    }
    for (const resource of shown.filter((entry) => entry.slot >= BAR_SLOTS)) {
      const { definition, value } = resource;
      const amount = definition.direction === 'static' ? `${value.max}` : `${value.current} / ${value.max}`;
      badges.push({ definition, value, color: resourceColor(definition, value), label: `${definition.name} ${amount}` });
    }
    const slots = sideBadgeSlots(badges.length);
    badges.forEach((badge, index) => {
      const made = sprite(wheelTexture(badge));
      this.side.add(made);
      this.badges.push(made);
      this.hover.push({ object: made, label: badge.label });
      if (badge.definition) {
        this.resources.push({ object: made, definition: badge.definition, value: badge.value, kind: 'wheel', width: WHEEL_PX, height: WHEEL_PX, side: slots[index].side < 0 ? -1 : 1 });
      }
    });

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
    // Called every frame: the rings are rebuilt only when the token's shape changed.
    const key = `${figureHeight}|${baseRadius}|${baseY}|${this.rings.length}`;
    if (key === this.placed) return;
    this.placed = key;
    this.top.position.y = figureHeight + baseRadius * 0.15;
    this.side.position.y = Math.max(baseY, figureHeight * 0.55);
    this.sideRadius = baseRadius * 1.15;
    const width = baseRadius * 0.12;
    const gap = baseRadius * 0.05;
    const radii = conditionRingRadii(baseRadius, this.rings.length, width, gap);
    this.rings.forEach((ring, index) => {
      const radius = radii[index];
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(radius - width / 2, radius + width / 2, 64).rotateX(-Math.PI / 2);
      ring.position.y = baseY + 0.2;
    });
  }

  /** Keeps the labels one size on screen and the side wheels beside the token as the camera turns. */
  pose(context: PoseContext): void {
    let rise = 0;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i];
      entry.sprite.scale.set(context.pixel * entry.width, context.pixel * entry.height, 1);
      entry.sprite.center.set(0.5, -rise / entry.height);
      rise += entry.height + GAP_PX;
    }
    // Screen right, on the board, for a camera turned by `yaw`.
    const right = new THREE.Vector3(Math.cos(context.yaw), 0, -Math.sin(context.yaw));
    const slots = sideBadgeSlots(this.badges.length);
    this.badges.forEach((badge, index) => {
      const slot = slots[index];
      badge.position.copy(right).multiplyScalar(slot.side * this.sideRadius);
      badge.scale.set(context.pixel * WHEEL_PX, context.pixel * WHEEL_PX, 1);
      // Outward from the token on its side, and stacked downward a row at a time.
      badge.center.set(slot.side < 0 ? 1 : 0, 0.5 + slot.row * ((WHEEL_PX + GAP_PX) / WHEEL_PX));
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
    this.resources = [];
    this.placed = '';
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
