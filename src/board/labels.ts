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
import { conditionLabel, type CollectionRules, type ConditionDefinition } from './conditions';
import { CONDITION_ICON_PATHS, resolveConditionIcon } from './conditionIconData';
import { sideBadgeSlots } from './geometry';
import type { BoardToken, TokenSettings } from './mapModel';
import type { PoseContext } from './pieces';
import { BAR_SLOTS, resourceColor, visibleResources, wheelGauge, type ResourceDefinition, type ResourceValue } from './resources';
import { isLightBadgeColor } from './tokenMenu';
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

/**
 * Atlas's condition badge (`ConditionBadge.ts`): a softly lit disc in the condition's colour inside a dark bezel, its
 * glyph in white (near-black on a light colour), a dark pip with its number on the lower right for a valued one. The
 * overflow badge ("+3") is a dark grey disc.
 */
const BADGE = { radius: 6, bezel: 1, bezelColor: '#111114', pip: 0.6, pipOffset: 0.72, pipColor: '#1c1c22', overflowColor: '#3a3a42', glyph: 0.62 };
/** The texture's width in badge units: the badge with its bezel, and a margin for the shadow. */
const BADGE_UNITS = (BADGE.radius + BADGE.bezel) * 2 + 2;

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const channel = (shift: number): number => {
    const part = (value >> shift) & 255;
    return Math.round(amount >= 0 ? part + (255 - part) * amount : part * (1 + amount));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function conditionBadgeTexture(definition: ConditionDefinition | null, value: number | undefined, overflow: number): THREE.CanvasTexture {
  const px = 128;
  const unit = px / BADGE_UNITS;
  return canvasTexture(px, px, (context) => {
    const c = px / 2;
    const radius = BADGE.radius * unit;
    const bezel = BADGE.bezel * unit;
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.beginPath();
    context.arc(c, c + radius * 0.18, radius + bezel + unit * 0.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = BADGE.bezelColor;
    context.beginPath();
    context.arc(c, c, radius + bezel, 0, Math.PI * 2);
    context.fill();
    const color = definition?.color ?? BADGE.overflowColor;
    if (definition) {
      const gradient = context.createLinearGradient(0, c - radius, 0, c + radius);
      gradient.addColorStop(0, shade(color, 0.18));
      gradient.addColorStop(0.55, color);
      gradient.addColorStop(1, shade(color, -0.2));
      context.fillStyle = gradient;
    } else context.fillStyle = color;
    context.beginPath();
    context.arc(c, c, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.18)';
    context.lineWidth = radius * 0.08;
    context.beginPath();
    context.arc(c, c, radius + radius * 0.04, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = definition && isLightBadgeColor(color) ? '#16161a' : '#ffffff';
    const path = definition?.icon ? CONDITION_ICON_PATHS[resolveConditionIcon(definition.icon)] : undefined;
    if (path) {
      const size = radius * 2 * BADGE.glyph;
      context.save();
      context.translate(c - size / 2, c - size / 2);
      context.scale(size / 512, size / 512);
      context.fill(new Path2D(path));
      context.restore();
    } else {
      const text = definition ? (Array.from(definition.name.trim())[0] ?? '?').toLocaleUpperCase() : `+${overflow}`;
      context.font = numberFont(Math.round(radius * (definition ? 1.1 : 0.95)));
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, c, c + unit * 0.4);
    }
    if (definition && value !== undefined) {
      const pipRadius = radius * BADGE.pip;
      const x = c + radius * BADGE.pipOffset;
      const y = c + radius * BADGE.pipOffset;
      context.fillStyle = BADGE.bezelColor;
      context.beginPath();
      context.arc(x, y, pipRadius + bezel * 0.75, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = BADGE.pipColor;
      context.beginPath();
      context.arc(x, y, pipRadius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#ffffff';
      context.font = numberFont(Math.round(pipRadius * 1.25));
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(value), x, y + unit * 0.3);
    }
  });
}

/**
 * The badges fan out in an arc of the token's ring like Atlas's (`conditionBadgeLayout.ts`), three on a medium token; here
 * below the token, since the name and bars take the space above it.
 */
const ARC_CENTRE = 0.5 * Math.PI;
const ARC_SPAN = Math.PI / 2;
/** A badge's radius, and the distance between neighbours' centres, as shares of the token's ring radius (Atlas: 7 and 15.5 of 31). */
const BADGE_SHARE = 7 / 31;
const PITCH_SHARE = 15.5 / 31;
const MAX_CONDITION_SLOTS = 6;
/** The token ring the badges are laid on is never smaller than this on screen, in pixels. */
const MIN_RING_PX = 34;

/** How many badges fit the arc, and how many conditions are left to the "+n" badge. */
export function fitConditionBadges(count: number): { shown: number; overflow: number } {
  const badgeAngle = PITCH_SHARE * ((BADGE_SHARE * 2) / PITCH_SHARE);
  const slots = Math.max(1, Math.min(MAX_CONDITION_SLOTS, Math.floor((ARC_SPAN - badgeAngle) / PITCH_SHARE) + 1));
  if (count <= slots) return { shown: count, overflow: 0 };
  return { shown: slots - 1, overflow: count - (slots - 1) };
}

/** Badge centres from the token's centre, in ring radii: right and up on screen. */
export function conditionBadgeOffsets(count: number): Array<{ x: number; y: number }> {
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = ARC_CENTRE + (middle - index) * PITCH_SHARE;
    return { x: Math.cos(angle), y: -Math.sin(angle) };
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
  private conditionBadges: THREE.Sprite[] = [];
  private ringRadius = 0;
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
    return [...this.stack.map((entry) => entry.sprite), ...this.badges, ...this.conditionBadges];
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
      const { shown: count, overflow } = fitConditionBadges(known.length);
      known.slice(0, count).forEach((id) => {
        const definition = rules.conditions.get(id)!;
        const value = definition.valued ? token.conditionValues[id] ?? 1 : undefined;
        const made = sprite(conditionBadgeTexture(definition, value, 0));
        this.side.add(made);
        this.conditionBadges.push(made);
        this.hover.push({ object: made, label: conditionLabel(definition, token.conditionValues[id]) });
      });
      if (overflow > 0) {
        const made = sprite(conditionBadgeTexture(null, undefined, overflow));
        this.side.add(made);
        this.conditionBadges.push(made);
        this.hover.push({
          object: made,
          label: known.slice(count).map((id) => conditionLabel(rules.conditions.get(id)!, token.conditionValues[id])).join(', '),
        });
      }
    }
  }

  /** Places the labels around a token `figureHeight` tall, its ring `baseRadius` across, its base's top at `baseY`. */
  place(figureHeight: number, baseRadius: number, baseY: number): void {
    // Called every frame: the rings are rebuilt only when the token's shape changed.
    const key = `${figureHeight}|${baseRadius}|${baseY}|${this.conditionBadges.length}`;
    if (key === this.placed) return;
    this.placed = key;
    this.top.position.y = figureHeight + baseRadius * 0.15;
    this.side.position.y = Math.max(baseY, figureHeight * 0.55);
    this.sideRadius = baseRadius * 1.15;
    this.ringRadius = baseRadius;
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
    // Condition badges grow with the token on screen, as Atlas's do on its ring.
    // With a floor, so they stay readable when the board is far away.
    const ringPx = Math.max(MIN_RING_PX, this.ringRadius * context.zoom);
    const offsets = conditionBadgeOffsets(this.conditionBadges.length);
    const badgePx = ringPx * BADGE_SHARE * 2 * (BADGE_UNITS / ((BADGE.radius + BADGE.bezel) * 2));
    this.conditionBadges.forEach((badge, index) => {
      badge.position.set(0, 0, 0);
      badge.scale.set(context.pixel * badgePx, context.pixel * badgePx, 1);
      badge.center.set(0.5 - (offsets[index].x * ringPx) / badgePx, 0.5 - (offsets[index].y * ringPx) / badgePx);
    });
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
    for (const badge of this.conditionBadges) this.disposeSprite(badge);
    this.stack = [];
    this.badges = [];
    this.conditionBadges = [];
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
