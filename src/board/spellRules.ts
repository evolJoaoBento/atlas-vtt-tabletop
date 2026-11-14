/**
 * What a spell does beyond its shape and its damage, the same for every spell, so anyone's own spell notes can say it:
 *
 * - `wall`: the shape stands as a wall while it lasts: stopping movement, sight or both, drawn as stone, ice, force…
 * - `obscure`: nothing is seen across the area's edge (Fog Cloud); `dark` makes it magical darkness too (Darkness).
 * - `light`: bright and dim light from the area's middle (Light, Daylight).
 * - `difficult`: difficult terrain (Web, Spike Growth); moving through it costs double.
 * - `push`: what it hits is pushed this many feet away from where the spell comes from (negative: pulled closer).
 * - `teleport`: the caster goes to the spell's point, up to this many feet away (Misty Step).
 * - `portal`: a gate; two gates of the same name are linked, and a token at one can go through to the other.
 * - `summon`: tokens made at the spell's point (Spiritual Weapon, Find Familiar), from a statblock or by name alone.
 *
 * A note says them in its properties (frontmatter), each `spell-…`; what it leaves out is read from its text where the
 * SRD's wording is plain. They travel beside a spell, never in it (an older Connect turns down a spell with fields it
 * does not know). Pure: the reading, the checking, and the walls, lights and moves they make on a map.
 *
 * A kept spell is one of Atlas's measures. What its rules stand is worked out from it twice over, by the same shapes:
 * for the 3D board, which draws the spell itself (`spellRuleWalls`, `spellRuleLights`, `inDifficultSpell`), and for
 * Atlas, as records of its own (`derivedRecords`, written by `spellReconciler.ts`), so its 2D view, its sight and its
 * movement rules honour the spell too. The board reads none of those records back.
 */
import { SPELL_CHAIN, spellToMeasure } from '../../packages/atlas-host/src/spellMeasure';
import { spellUnder, type Spell } from './spells';
import type { BoardLight, BoardWall, Point } from './walls';

export const WALL_LOOKS = ['stone', 'ice', 'force', 'wood', 'thorns', 'fire', 'plain'] as const;
export type WallLook = typeof WALL_LOOKS[number];
export type WallBlocks = 'both' | 'move' | 'sight';

export interface SpellRules {
  /** The spell's name, for what the GM is asked about it. */
  name?: string;
  wall?: { blocks: WallBlocks; look: WallLook };
  obscure?: boolean;
  dark?: boolean;
  /** Feet. */
  light?: { bright: number; dim: number; color?: string };
  difficult?: boolean;
  /** Feet; negative pulls. */
  push?: number;
  /** Feet: the farthest the caster may go. */
  teleport?: number;
  /** The gate's name: gates of one name are linked. */
  portal?: string;
  summon?: { name: string; count: number; statblock?: string };
}

export const SPELL_RULE_LIMITS = { feet: 10000, name: 120, count: 20, color: 7 } as const;

const isFeet = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= SPELL_RULE_LIMITS.feet;
const isName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= SPELL_RULE_LIMITS.name;
const HEX = /^#[0-9a-f]{6}$/i;

/** Rules as sent: anything not well formed is left out (null when nothing is left). */
export function readSpellRules(raw: unknown): SpellRules | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const out: SpellRules = {};
  const wall = value.wall as Record<string, unknown> | undefined;
  if (wall && typeof wall === 'object' && (wall.blocks === 'both' || wall.blocks === 'move' || wall.blocks === 'sight') && (WALL_LOOKS as readonly string[]).includes(wall.look as string)) {
    out.wall = { blocks: wall.blocks, look: wall.look as WallLook };
  }
  if (value.obscure === true) out.obscure = true;
  if (value.dark === true) out.dark = true;
  const light = value.light as Record<string, unknown> | undefined;
  if (light && typeof light === 'object' && isFeet(light.bright) && isFeet(light.dim) && light.bright >= 0 && light.dim >= 0 && light.bright + light.dim > 0) {
    out.light = { bright: light.bright, dim: light.dim, ...(typeof light.color === 'string' && HEX.test(light.color) ? { color: light.color } : {}) };
  }
  if (value.difficult === true) out.difficult = true;
  if (isFeet(value.push) && value.push !== 0) out.push = value.push;
  if (isFeet(value.teleport) && value.teleport > 0) out.teleport = value.teleport;
  if (isName(value.portal)) out.portal = value.portal.trim();
  const summon = value.summon as Record<string, unknown> | undefined;
  if (summon && typeof summon === 'object' && isName(summon.name)) {
    const count = typeof summon.count === 'number' && Number.isInteger(summon.count) ? Math.max(1, Math.min(SPELL_RULE_LIMITS.count, summon.count)) : 1;
    out.summon = { name: summon.name.trim(), count, ...(isName(summon.statblock) ? { statblock: summon.statblock.trim() } : {}) };
  }
  if (Object.keys(out).length === 0) return null;
  // A name alone is no rule.
  return isName(value.name) ? { name: value.name.trim(), ...out } : out;
}

export const hasRules = (rules: SpellRules | null | undefined): rules is SpellRules => !!rules && Object.keys(rules).length > 0;

// ---- From a note ----

/** A note's properties, as flat text: `key: value` lines of its frontmatter (lists and nesting left out). */
export function frontmatterOf(markdown: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  const out: Record<string, string> = {};
  if (!match) return out;
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    out[field[1]!.toLowerCase()] = field[2]!.replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

const yes = (value: string | undefined): boolean => value !== undefined && /^(true|yes|on|1)$/i.test(value);
const no = (value: string | undefined): boolean => value !== undefined && /^(false|no|off|0|none)$/i.test(value);
const feetIn = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const number = Number(/-?\d+(?:\.\d+)?/.exec(value)?.[0]);
  return Number.isFinite(number) ? number : null;
};

/**
 * A spell's rules: from its note's `spell-…` properties first, then what its text says plainly (a property set to
 * `false` or `none` turns off what the text would give).
 */
export function rulesFromNote(properties: Record<string, string>, name: string, text: string, range = ''): SpellRules | null {
  const raw: Record<string, unknown> = {};
  const inferred = rulesFromText(name, text, range);
  // Walls.
  const look = properties['spell-wall'];
  if (look !== undefined && !no(look)) {
    const chosen = (WALL_LOOKS as readonly string[]).includes(look.toLowerCase()) ? look.toLowerCase() as WallLook : 'plain';
    const blocks = properties['spell-wall-blocks']?.toLowerCase();
    raw.wall = { look: chosen, blocks: blocks === 'move' || blocks === 'movement' ? 'move' : blocks === 'sight' ? 'sight' : chosen === 'force' ? 'move' : 'both' };
  } else if (!no(look) && inferred.wall) raw.wall = inferred.wall;
  const flag = (key: string, from: boolean | undefined): boolean => (properties[key] !== undefined ? yes(properties[key]) : from === true);
  if (flag('spell-obscure', inferred.obscure)) raw.obscure = true;
  if (flag('spell-dark', inferred.dark)) raw.dark = true;
  if (flag('spell-difficult', inferred.difficult)) raw.difficult = true;
  // Light: "20" (bright), "20/20" (bright/dim), with spell-dim and spell-light-color.
  const light = properties['spell-light'];
  if (light !== undefined && !no(light)) {
    const [bright, dim] = light.split('/').map((part) => feetIn(part));
    const dimmer = feetIn(properties['spell-dim']) ?? dim ?? bright ?? 0;
    raw.light = { bright: bright ?? 0, dim: dimmer, ...(properties['spell-light-color'] ? { color: properties['spell-light-color'] } : {}) };
  } else if (!no(light) && inferred.light) raw.light = inferred.light;
  const push = properties['spell-push'];
  if (push !== undefined) { if (!no(push)) raw.push = feetIn(push); } else if (inferred.push) raw.push = inferred.push;
  const teleport = properties['spell-teleport'];
  if (teleport !== undefined) { if (!no(teleport)) raw.teleport = feetIn(teleport); } else if (inferred.teleport) raw.teleport = inferred.teleport;
  const portal = properties['spell-portal'];
  if (portal !== undefined && !no(portal)) raw.portal = yes(portal) ? name : portal;
  const summon = properties['spell-summon'];
  if (summon !== undefined && !no(summon)) {
    raw.summon = { name: yes(summon) ? name : summon.replace(/^\[\[|\]\]$/g, '').split('|')[0], count: Math.round(feetIn(properties['spell-summon-count']) ?? 1), ...(properties['spell-summon-statblock'] ? { statblock: properties['spell-summon-statblock'] } : {}) };
  }
  return readSpellRules(raw);
}

/** What the SRD's plain wording gives (`range` its Range line, for a teleport within range). */
export function rulesFromText(name: string, text: string, range = ''): SpellRules {
  const out: SpellRules = {};
  const plain = text.replace(/[*_]/g, '');
  // A wall of a stuff, by the spell's name: Wall of Stone, Wall of Ice, Wall of Force, Wall of Thorns.
  const wall = /^wall of (stone|ice|force|thorns|wood)\b/i.exec(name.trim());
  if (wall) {
    const look = wall[1]!.toLowerCase() as WallLook;
    // Force stops bodies, not sight (it is invisible); the rest stop both.
    out.wall = { look, blocks: look === 'force' ? 'move' : 'both' };
  }
  // An area that is heavily obscured (a fog, a cloud); magical darkness that spreads (Darkness).
  if (/\b(?:area|cloud|sphere|fog|it) is heavily obscured\b/i.test(plain)) out.obscure = true;
  if (/^darkness$/i.test(name.trim()) || /\bmagical darkness spreads\b/i.test(plain)) { out.obscure = true; out.dark = true; }
  // Ground that is, or becomes, difficult terrain (not "difficult terrain doesn't…").
  if (/\b(?:is|are|becomes?|counts? as|turns? into|into|creates?|making(?: it| the area| the ground)?) difficult terrain\b/i.test(plain) || /\bdifficult terrain for\b/i.test(plain)) out.difficult = true;
  const light = /bright light in an? (\d+)-foot[- ]radius(?: sphere)?,? and dim light for an additional (\d+) feet/i.exec(plain)
    ?? /(\d+)-foot[- ]radius[^.]*\.[^.]*\bbright light\b[^.]*\bdim light for an additional (\d+) feet/i.exec(plain);
  if (light && !out.dark) out.light = { bright: Number(light[1]), dim: Number(light[2]) };
  const push = /pushed (?:up to )?(\d+) feet (?:away|horizontally away)/i.exec(plain);
  const pull = /pull(?:s|ed)? (?:the creature |it |the target )?(?:up to )?(\d+) feet (?:closer|toward)/i.exec(plain);
  if (push) out.push = Number(push[1]);
  else if (pull) out.push = -Number(pull[1]);
  const teleport = /you teleport (?:up to )?(\d+) feet/i.exec(plain);
  const within = /\bteleport yourself\b/i.test(plain) ? Number(/(\d+) (?:feet|foot)/i.exec(range)?.[1]) : NaN;
  if (teleport) out.teleport = Number(teleport[1]);
  else if (Number.isFinite(within) && within > 0) out.teleport = within;
  return out;
}

// ---- On the map ----

/** The ground a spell covers, as a polygon round its middle (rays out to its edge), map pixels; and that middle. */
export function spellFootprint(spell: Spell, rays = 32): { middle: Point; ring: Point[] } {
  if (spell.shape === 'wall' && spell.to) {
    return { middle: { x: (spell.at.x + spell.to.x) / 2, y: (spell.at.y + spell.to.y) / 2 }, ring: [{ x: spell.at.x, y: spell.at.y }, { x: spell.to.x, y: spell.to.y }] };
  }
  const reach = Math.max(spell.size, spell.length) * 1.5 + 1;
  // Its middle: the mean of the points of a grid over its reach that it covers.
  let sx = 0;
  let sy = 0;
  let n = 0;
  const steps = 12;
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const point = { x: spell.at.x + (i / steps) * reach, y: spell.at.y + (j / steps) * reach };
      if (spellUnder(spell, point)) { sx += point.x; sy += point.y; n++; }
    }
  }
  const middle = n > 0 ? { x: sx / n, y: sy / n } : { x: spell.at.x, y: spell.at.y };
  const ring: Point[] = [];
  for (let k = 0; k < rays; k++) {
    const angle = (k / rays) * Math.PI * 2;
    const way = { x: Math.cos(angle), y: Math.sin(angle) };
    let inside = 0;
    let outside = reach * 2;
    for (let step = 0; step < 18; step++) {
      const mid = (inside + outside) / 2;
      if (spellUnder(spell, { x: middle.x + way.x * mid, y: middle.y + way.y * mid })) inside = mid; else outside = mid;
    }
    ring.push({ x: middle.x + way.x * inside, y: middle.y + way.y * inside });
  }
  return { middle, ring };
}

/** Whether a point lies in a polygon. */
export function insideRing(point: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function wallOf(id: string, p1: Point, p2: Point, blocks: BoardWall['blocks']): BoardWall {
  return { id, type: 'solid', p1: { ...p1 }, p2: { ...p2 }, direction: null, closed: true, locked: false, blocks, limited: false, chain: id } as BoardWall;
}

/**
 * The walls a cast spell stands while it lasts: a wall spell's own run (or its edge, for a dome), and an obscuring
 * area's edge (sight only: no one sees in or out). Ids `spell:<id>:<n>`.
 */
export function spellRuleWalls(id: string, spell: Spell, rules: SpellRules | null | undefined): BoardWall[] {
  if (!rules || (!rules.wall && !rules.obscure)) return [];
  const { ring } = spellFootprint(spell);
  const out: BoardWall[] = [];
  const segments = (blocks: BoardWall['blocks'], tag: string): void => {
    if (ring.length === 2) { out.push(wallOf(`spell:${id}:${tag}0`, ring[0]!, ring[1]!, blocks)); return; }
    for (let k = 0; k < ring.length; k++) out.push(wallOf(`spell:${id}:${tag}${k}`, ring[k]!, ring[(k + 1) % ring.length]!, blocks));
  };
  if (rules.wall) segments(rules.wall.blocks === 'both' ? null : rules.wall.blocks === 'move' ? 'movement' : 'sight', 'w');
  if (rules.obscure && !(rules.wall && rules.wall.blocks !== 'move')) segments('sight', 'o');
  return out;
}

/** The light (or magical darkness) a cast spell sheds, from its middle; radii in the scene's units. */
export function spellRuleLights(id: string, spell: Spell, rules: SpellRules | null | undefined, unitsPerFoot: number, pxPerUnit: number): BoardLight[] {
  if (!rules || (!rules.light && !rules.dark)) return [];
  const { middle, ring } = spellFootprint(spell);
  const base = { id: `spell:${id}:light`, x: middle.x, y: middle.y, intensity: 1, animation: 'none' as const, angle: null, rotation: 0, hidden: false, activeBelowAmbient: null, tokenId: null };
  if (rules.dark) {
    // As far as the area reaches.
    const reach = Math.max(...ring.map((point) => Math.hypot(point.x - middle.x, point.y - middle.y))) / Math.max(1e-6, pxPerUnit);
    return [{ ...base, bright: reach, dim: 0, color: '#000000', darkness: true }];
  }
  const light = rules.light!;
  // As Atlas's lights: `dim` is where the light ends, the bright radius and the dim one after it.
  return [{ ...base, bright: light.bright * unitsPerFoot, dim: (light.bright + light.dim) * unitsPerFoot, color: light.color ?? SPELL_LIGHT_COLOR, darkness: false }];
}

// ---- As Atlas's own records ----

/** How a rule's feet lie on a scene: the scene's units per foot, and map pixels per unit. */
export interface RuleScale { unitsPerFoot: number; pxPerUnit: number }

/** A wall of Atlas's a spell stands (its `WallInput`): chained to the spell's measure, on the measure's level. */
export interface DerivedWall {
  type: 'solid';
  p1: Point;
  p2: Point;
  /** The one thing it stops (Atlas's `blocks`); left out, it stops bodies, sight and light. */
  blocks?: 'movement' | 'sight';
  chainId: string;
  tabletop: { spell: string };
  /** Said outright even when unset (the first level): Atlas would put a wall that says nothing on the level shown. */
  levels: string[] | undefined;
}

/** Difficult ground a spell makes, as a map feature of Atlas's (its `MapFeatureInput`). */
export interface DerivedFeature {
  polygon: Point[];
  name: string;
  terrain: { difficult: true };
  tabletop: { spell: string };
  level: string | undefined;
}

/** The light a spell's measure gives (Atlas's `LightEmission`): radii in the scene's units, `dim` where it ends. */
export interface DerivedLight {
  bright: number;
  dim: number;
  color: string;
  intensity: 1;
  animation: { type: 'none'; speed: 1; intensity: 1 };
  darkness?: true;
}

const SPELL_LIGHT_COLOR = '#fff2d0';

/**
 * What a kept spell's rules stand on the map, as Atlas's own records: the walls of a wall spell and of an obscuring
 * area (as `spellRuleWalls` stands them on the board), one map feature over difficult ground, and the light the
 * spell's measure gives. A darkness is Atlas's on a circle alone (it has a radius and no outline): on any other shape
 * it is the board's only. `id` is the measure's, `level` the measure's level.
 */
export function derivedRecords(id: string, spell: Spell, rules: SpellRules | null | undefined, scale: RuleScale, level?: string): { walls: DerivedWall[]; features: DerivedFeature[]; light: DerivedLight | null } {
  if (!rules) return { walls: [], features: [], light: null };
  const mark = { tabletop: { spell: id } };
  const walls = spellRuleWalls(id, spell, rules).map((wall): DerivedWall => ({
    type: 'solid', p1: { x: wall.p1.x, y: wall.p1.y }, p2: { x: wall.p2.x, y: wall.p2.y },
    ...(wall.blocks === 'movement' || wall.blocks === 'sight' ? { blocks: wall.blocks } : {}),
    chainId: SPELL_CHAIN(id), ...mark, levels: level === undefined ? undefined : [level],
  }));
  const { middle, ring } = spellFootprint(spell);
  const features: DerivedFeature[] = rules.difficult && ring.length >= 3
    ? [{ polygon: ring.map((point) => ({ x: point.x, y: point.y })), name: rules.name ?? 'Spell', terrain: { difficult: true }, ...mark, level }]
    : [];
  const steady = { intensity: 1 as const, animation: { type: 'none' as const, speed: 1 as const, intensity: 1 as const } };
  let light: DerivedLight | null = null;
  if (rules.dark) {
    if (spellToMeasure(spell).shape === 'circle') {
      const reach = Math.max(...ring.map((point) => Math.hypot(point.x - middle.x, point.y - middle.y))) / Math.max(1e-6, scale.pxPerUnit);
      light = { bright: 0, dim: reach, color: '#000000', ...steady, darkness: true };
    }
  } else if (rules.light) {
    light = { bright: rules.light.bright * scale.unitsPerFoot, dim: (rules.light.bright + rules.light.dim) * scale.unitsPerFoot, color: rules.light.color ?? SPELL_LIGHT_COLOR, ...steady };
  }
  return { walls, features, light };
}

/** Whether a point lies in difficult terrain a spell makes. */
export function inDifficultSpell(point: Point, spells: ReadonlyArray<{ spell: Spell; rules?: SpellRules | null }>): boolean {
  return spells.some(({ spell, rules }) => rules?.difficult === true && spellUnder(spell, point));
}

// ---- Moving tokens ----

function cross(a: Point, b: Point, c: Point, d: Point): number | null {
  // Where segment ab meets cd, as a share of ab; null if they do not meet.
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Whether a wall stops a token: solid, a shut door, a window; not one that stops only sight or light. */
export function stopsTokens(wall: BoardWall): boolean {
  if (wall.type !== 'solid' && !wall.closed) return false;
  return wall.blocks !== 'sight' && wall.blocks !== 'light';
}

/**
 * Where a token pushed from `from` to `to` stops: short of the first wall that stops it (half a square before it),
 * else at `to`; centred on a square when `snap` gives one.
 */
export function slide(from: Point, to: Point, walls: readonly BoardWall[], cell: number, snap?: (point: Point) => Point): Point {
  let share = 1;
  for (const wall of walls) {
    if (!stopsTokens(wall)) continue;
    const t = cross(from, to, wall.p1, wall.p2);
    if (t !== null && t < share) share = t;
  }
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (share < 1 && length > 0) share = Math.max(0, share - (cell * 0.5) / length);
  const end = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
  if (!snap) return end;
  const snapped = snap(end);
  // Snapping must not cross a wall either.
  return walls.some((wall) => stopsTokens(wall) && cross(from, snapped, wall.p1, wall.p2) !== null) ? end : snapped;
}

/**
 * Pushed away from (or, negative, pulled toward) where the spell comes from: its caster for a spell cast from them,
 * else its middle; `px` the distance in map pixels.
 */
export function pushTo(origin: Point, at: Point, px: number): Point {
  let dx = at.x - origin.x;
  let dy = at.y - origin.y;
  let length = Math.hypot(dx, dy);
  if (length < 1e-6) { dx = 0; dy = -1; length = 1; }
  // A pull stops at the origin, not past it.
  const move = px < 0 ? Math.max(px, -length) : px;
  return { x: at.x + (dx / length) * move, y: at.y + (dy / length) * move };
}
