/**
 * Spells cast from a token's eyes: a sphere, a cube, a cylinder (a beam), a cone or a wall, standing in the board's 3D
 * space. Each is cast either from the caster (`self`: the sphere's and the cube's middle, the cylinder's top and the
 * cone's tip on the caster's eye, the shape running the way they look, and cut off by the walls round them, as if it
 * came out of them) or at a point the caster sees (`point`: always the shape's middle there, turned as they set it). A
 * wall runs between two points on the floor. Everything is in map pixels (`at.h` and the sizes too), so every board of
 * the map draws it the same. Pure: the shapes, what they hold, and what they hit.
 *
 * The board's space: x is the map's x, z is the map's y, y is up. A shape's turn is (pitch, yaw, roll) in that order of
 * Euler YXZ, a camera's; it runs along its forward, -Z turned.
 */
import * as THREE from 'three';
import { canSee } from './lineOfSight';
import type { BoardWall, Point } from './walls';
import { readSpellRules, type SpellRules } from './spellRules';

export const SPELL_SHAPES = ['sphere', 'cube', 'cylinder', 'cone', 'wall'] as const;
/** D&D's damage types, and an explosion: each a look of its own for a spell (`spellEffects.ts`). Connect's list must stay the same. */
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const;
export type DamageType = typeof DAMAGE_TYPES[number];
export const DAMAGE_NAMES: Record<DamageType, string> = {
  acid: 'Acid', bludgeoning: 'Bludgeoning', cold: 'Cold', explosion: 'Explosion', fire: 'Fire', force: 'Force', lightning: 'Lightning', necrotic: 'Necrotic',
  piercing: 'Piercing', poison: 'Poison', psychic: 'Psychic', radiant: 'Radiant', slashing: 'Slashing', thunder: 'Thunder',
};
export const isDamageType = (value: unknown): value is DamageType => typeof value === 'string' && (DAMAGE_TYPES as readonly string[]).includes(value);
export type SpellShape = typeof SPELL_SHAPES[number];
export type SpellFrom = 'self' | 'point';

export interface Spell {
  shape: SpellShape;
  from: SpellFrom;
  /** The shape's anchor, map pixels; `h` its height over the floor. A wall's first end, `h` its foot. */
  at: { x: number; y: number; h: number };
  /** A wall's other end (its foot at `at.h`). */
  to?: Point;
  yaw: number;
  pitch: number;
  roll: number;
  /** Map pixels: a sphere's or a cylinder's radius, a cube's side, a cone's length, a wall's thickness. */
  size: number;
  /** Map pixels: a cylinder's length, a wall's height; 0 for the rest. */
  length: number;
  /** A cone's opening, radians. */
  angle: number;
  /** The token it was cast from (left out of what it hits). */
  caster?: string;
  /** Its damage's look; plain without one. */
  effect?: DamageType;
}

/** A spell on a scene, as everyone has it. */
export interface CastSpell {
  id: string;
  owner: string;
  color: string;
  spell: Spell;
  /** What it does beyond its shape, sent beside it. */
  rules?: SpellRules;
  /** The spell's name and words, beside it: shown with Ctrl over it. */
  name?: string;
  about?: SpellAbout;
}

/**
 * A spell the GM asks of a token (Connect's `SpellAsk`; the fields must stay the same): its shape, where it starts and
 * its sizes, map pixels, with a name. The player only aims it. Shaped so a prepared spell can fill it later.
 */
export interface SpellAsk {
  name?: string;
  shape: SpellShape;
  from: SpellFrom;
  size: number;
  /** A cylinder's length, a wall's height; 0 for the rest. */
  length: number;
  /** A cone's opening, radians; the scene's own without it. */
  angle?: number;
  /** A wall's longest run. */
  longest?: number;
  /** Its damage's look: the cast takes it. */
  effect?: DamageType;
  /** The spell's words (from a spell note), shown to the player first. */
  about?: SpellAbout;
  /** What it does beyond its shape (`spellRules.ts`): the cast takes them. */
  rules?: SpellRules;
}

/** A spell's words as an ask carries them (Connect's `SpellAbout`): its level line, its properties and its description. */
export interface SpellAbout {
  line: string;
  properties: Array<[string, string]>;
  /** Markdown, shown as text (bold and italic only). */
  text: string;
}

/** An ask's words, those well formed, cut to Connect's limits. */
export function readSpellAbout(raw: unknown): SpellAbout | null {
  const about = raw as Partial<SpellAbout> | null;
  if (typeof about !== 'object' || about === null || typeof about.line !== 'string' || typeof about.text !== 'string' || !Array.isArray(about.properties)) return null;
  const properties = about.properties.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string')
    .slice(0, 10).map(([label, value]): [string, string] => [label.slice(0, 30), value.slice(0, 200)]);
  return { line: about.line.slice(0, 120), properties, text: about.text.slice(0, 4000) };
}

/** An ask as it reaches the token's player: its id and the token. */
export interface SpellRequest {
  id: string;
  tokenId: string;
  ask: SpellAsk;
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e5;

/** The asks Connect sends, those well formed. */
export function readSpellRequests(raw: unknown): SpellRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: SpellRequest[] = [];
  for (const entry of raw.slice(0, 20)) {
    const value = entry as Partial<SpellRequest> | null;
    const ask = value?.ask as Partial<SpellAsk> | undefined;
    if (typeof value !== 'object' || value === null || typeof value.id !== 'string' || typeof value.tokenId !== 'string' || !ask) continue;
    if (!(SPELL_SHAPES as readonly string[]).includes(ask.shape as string) || (ask.from !== 'self' && ask.from !== 'point') || !positive(ask.size)) continue;
    const length = typeof ask.length === 'number' && Number.isFinite(ask.length) ? ask.length : 0;
    if ((ask.shape === 'wall' || ask.shape === 'cylinder') && !(length > 0)) continue;
    out.push({
      id: value.id, tokenId: value.tokenId,
      ask: {
        ...(typeof ask.name === 'string' && ask.name.trim() ? { name: ask.name.trim().slice(0, 60) } : {}),
        shape: ask.shape as SpellShape, from: ask.shape === 'wall' ? 'point' : ask.from, size: ask.size, length,
        ...(positive(ask.angle) && ask.angle < Math.PI ? { angle: ask.angle } : {}),
        ...(positive(ask.longest) ? { longest: ask.longest } : {}),
        ...(isDamageType(ask.effect) ? { effect: ask.effect } : {}),
        ...(readSpellAbout(ask.about) ? { about: readSpellAbout(ask.about)! } : {}),
        ...(readSpellRules(ask.rules) ? { rules: readSpellRules(ask.rules)! } : {}),
      },
    });
  }
  return out;
}

/** What a spell may hit: a token or a prop, by the points tried (board space). */
export interface SpellTarget {
  id: string;
  points: readonly THREE.Vector3[];
}

/** The longest a size may be, in map pixels (a hundred squares of a big grid). */
export const SPELL_MAX_SIZE = 20000;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7;
const isPoint = (value: unknown): value is Point => typeof value === 'object' && value !== null && isNumber((value as Point).x) && isNumber((value as Point).y);
const isSize = (value: unknown): value is number => isNumber(value) && value >= 0 && value <= SPELL_MAX_SIZE;

/** A spell as sent, or null for anything that is not one. */
export function readSpell(raw: unknown): Spell | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Partial<Record<keyof Spell, unknown>>;
  if (typeof value.shape !== 'string' || !(SPELL_SHAPES as readonly string[]).includes(value.shape)) return null;
  if (value.from !== 'self' && value.from !== 'point') return null;
  const at = value.at as { h?: unknown } | undefined;
  if (!isPoint(at) || !isNumber(at.h)) return null;
  if (!isNumber(value.yaw) || !isNumber(value.pitch) || !isNumber(value.roll)) return null;
  if (!isSize(value.size) || value.size <= 0 || !isSize(value.length)) return null;
  if (!isNumber(value.angle) || value.angle <= 0 || value.angle >= Math.PI) return null;
  const shape = value.shape as SpellShape;
  if (shape === 'wall' && (!isPoint(value.to) || value.length <= 0)) return null;
  if (shape === 'cylinder' && value.length <= 0) return null;
  if (value.caster !== undefined && (typeof value.caster !== 'string' || value.caster.length > 200)) return null;
  return {
    shape, from: value.from, at: { x: at.x, y: at.y, h: at.h as number },
    ...(shape === 'wall' && isPoint(value.to) ? { to: { x: value.to.x, y: value.to.y } } : {}),
    yaw: value.yaw, pitch: value.pitch, roll: value.roll, size: value.size, length: value.length, angle: value.angle,
    ...(typeof value.caster === 'string' ? { caster: value.caster } : {}),
    ...(isDamageType(value.effect) ? { effect: value.effect } : {}),
  };
}

export function readCastSpells(raw: unknown): CastSpell[] {
  if (!Array.isArray(raw)) return [];
  const out: CastSpell[] = [];
  for (const entry of raw.slice(0, 200)) {
    const value = entry as Partial<CastSpell> | null;
    if (typeof value !== 'object' || value === null || typeof value.id !== 'string' || typeof value.owner !== 'string' || typeof value.color !== 'string') continue;
    const spell = readSpell(value.spell);
    const rules = readSpellRules((value as { rules?: unknown }).rules);
    const name = (value as { name?: unknown }).name;
    const about = readSpellAbout((value as { about?: unknown }).about);
    if (spell) out.push({ id: value.id, owner: value.owner, color: value.color, spell, ...(rules ? { rules } : {}), ...(typeof name === 'string' && name.trim() ? { name: name.trim().slice(0, 60) } : {}), ...(about ? { about } : {}) });
  }
  return out;
}

/**
 * Whether a cast spell is instantaneous, as its words say (Duration: Instantaneous, like Fireball or Thunderwave): it
 * goes off and is gone, so its mark fades after the cast. A spell with a duration, concentration, or no words (a shape
 * set by hand) stays until it is taken off.
 */
export function isInstantaneous(cast: Pick<CastSpell, 'about'>): boolean {
  const duration = cast.about?.properties.find(([label]) => label.trim().toLowerCase() === 'duration')?.[1];
  return duration !== undefined && /^\s*instantaneous\s*$/i.test(duration);
}

/** The spell's anchor in board space. */
export function anchorOf(spell: Spell): THREE.Vector3 {
  return new THREE.Vector3(spell.at.x, spell.at.h, spell.at.y);
}

/** The spell's turn in board space. */
export function turnOf(spell: Pick<Spell, 'yaw' | 'pitch' | 'roll'>): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(spell.pitch, spell.yaw, spell.roll, 'YXZ'));
}

/** Whether a shape is cut off by the walls round where it starts: one cast from the caster (a wall never is). */
export function clipped(spell: Pick<Spell, 'shape' | 'from'>): boolean {
  return spell.from === 'self' && spell.shape !== 'wall';
}

/** How far from its anchor a spell reaches at most, map pixels. */
export function reachOf(spell: Spell): number {
  switch (spell.shape) {
    case 'sphere': return spell.size;
    case 'cube': return (spell.size * Math.sqrt(3)) / 2;
    case 'cylinder': return Math.hypot(spell.from === 'self' ? spell.length : spell.length / 2, spell.size);
    case 'cone': return spell.size / Math.cos(spell.angle / 2);
    case 'wall': return Math.hypot(spell.to!.x - spell.at.x, spell.to!.y - spell.at.y) + spell.length + spell.size;
  }
}

/** Whether a point of board space lies in the shape (walls aside). */
export function spellHolds(spell: Spell, point: THREE.Vector3): boolean {
  if (spell.shape === 'wall') {
    const to = spell.to!;
    if (point.y < spell.at.h - 1e-6 || point.y > spell.at.h + spell.length + 1e-6) return false;
    const dx = to.x - spell.at.x;
    const dy = to.y - spell.at.y;
    const run = dx * dx + dy * dy;
    const along = run === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - spell.at.x) * dx + (point.z - spell.at.y) * dy) / run));
    return Math.hypot(point.x - (spell.at.x + along * dx), point.z - (spell.at.y + along * dy)) <= spell.size / 2 + 1e-6;
  }
  const local = point.clone().sub(anchorOf(spell)).applyQuaternion(turnOf(spell).invert());
  const ahead = -local.z;
  const across = Math.hypot(local.x, local.y);
  const self = spell.from === 'self';
  switch (spell.shape) {
    case 'sphere': return local.length() <= spell.size + 1e-6;
    case 'cube': return Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) <= spell.size / 2 + 1e-6;
    case 'cylinder': {
      const lo = self ? 0 : -spell.length / 2;
      return ahead >= lo - 1e-6 && ahead <= lo + spell.length + 1e-6 && across <= spell.size + 1e-6;
    }
    case 'cone': {
      const fromTip = self ? ahead : ahead + spell.size / 2;
      return fromTip >= -1e-6 && fromTip <= spell.size + 1e-6 && across <= Math.max(0, fromTip) * Math.tan(spell.angle / 2) + 1e-6;
    }
  }
}

/** Whether the spell reaches a point: in the shape, and (cast from the caster) not behind a wall from where it starts. */
export function spellReaches(spell: Spell, point: THREE.Vector3, walls: readonly BoardWall[]): boolean {
  if (!spellHolds(spell, point)) return false;
  if (!clipped(spell)) return true;
  return canSee({ x: spell.at.x, y: spell.at.y }, { x: point.x, y: point.z }, walls);
}

/** The ids of the targets the spell hits: any of their points reached. The caster is never hit by their own. */
export function spellHits(spell: Spell, targets: readonly SpellTarget[], walls: readonly BoardWall[]): string[] {
  const hits: string[] = [];
  for (const target of targets) {
    if (target.id === spell.caster) continue;
    if (target.points.some((point) => spellReaches(spell, point, walls))) hits.push(target.id);
  }
  return hits;
}

/** The points of a box tried for a hit: its middle and a point near the middle of each face. */
export function boxPoints(box: THREE.Box3): THREE.Vector3[] {
  if (box.isEmpty()) return [];
  const middle = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.45);
  return [
    middle,
    middle.clone().add(new THREE.Vector3(half.x, 0, 0)), middle.clone().add(new THREE.Vector3(-half.x, 0, 0)),
    middle.clone().add(new THREE.Vector3(0, half.y, 0)), middle.clone().add(new THREE.Vector3(0, -half.y, 0)),
    middle.clone().add(new THREE.Vector3(0, 0, half.z)), middle.clone().add(new THREE.Vector3(0, 0, -half.z)),
  ];
}

/** A wall's second end, no farther than `longest` from the first. */
export function clampWallEnd(from: Point, to: Point, longest: number): Point {
  const run = Math.hypot(to.x - from.x, to.y - from.y);
  if (run <= longest || run === 0) return { x: to.x, y: to.y };
  const share = longest / run;
  return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
}

/** The spell's footprint on the floor, as a point test (for the GM's eraser): the shape at its own height, or the wall. */
export function spellUnder(spell: Spell, point: Point): boolean {
  const h = spell.shape === 'wall' ? spell.at.h + spell.length / 2 : spell.at.h;
  if (spellHolds(spell, new THREE.Vector3(point.x, h, point.y))) return true;
  // A beam or a cone pointing up or down: its middle along the way.
  if (spell.shape === 'cylinder' || spell.shape === 'cone') {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(turnOf(spell));
    const half = (spell.shape === 'cone' ? spell.size : spell.length) / 2;
    const middle = anchorOf(spell).addScaledVector(forward, spell.from === 'self' ? half : 0);
    return spellHolds(spell, new THREE.Vector3(point.x, middle.y, point.y));
  }
  return false;
}

/** The words for a spell's sizes, in squares of `cell` pixels. */
export function spellLabel(spell: Spell, cell: number): string {
  const sq = (pixels: number): string => `${Math.round((pixels / cell) * 10) / 10}`;
  switch (spell.shape) {
    case 'sphere': return `Sphere, radius ${sq(spell.size)}`;
    case 'cube': return `Cube, side ${sq(spell.size)}`;
    case 'cylinder': return `${spell.from === 'self' ? 'Beam' : 'Cylinder'}, radius ${sq(spell.size)}, length ${sq(spell.length)}`;
    case 'cone': return `Cone, length ${sq(spell.size)}`;
    case 'wall': return `Wall, ${sq(Math.hypot(spell.to!.x - spell.at.x, spell.to!.y - spell.at.y))} long, ${sq(spell.length)} high, ${sq(spell.size)} thick`;
  }
}
