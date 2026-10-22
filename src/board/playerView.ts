/**
 * What the players' picture of the board leaves out, by Atlas's rules for its player window: hidden tokens, and
 * whatever stands under the fog; copy numbers counted again among the tokens players see (Atlas's
 * `vision/instanceNumbers.ts`, ported), so a look-alike they cannot see neither counts nor takes a number. Which
 * resources they see is `visibleResources(…, 'player')`. Pure, so it is tested without Obsidian.
 */
import type { FogArea } from './fog';

interface Point {
  x: number;
  y: number;
}

function inRing(point: Point, ring: readonly Point[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

/** Whether fog covers a point of the map: inside an area, and not in a hole erased out of it. */
export function insideFog(areas: readonly FogArea[], point: Point): boolean {
  return areas.some((area) => inRing(point, area.outer) && !area.holes.some((hole) => inRing(point, hole)));
}

/** Whether players see a token standing at `at`: not hidden by the GM, its centre not under the fog. */
export function playerSees(token: { hidden: boolean }, at: Point, fog: readonly FogArea[]): boolean {
  return !token.hidden && !insideFog(fog, at);
}

/** A token players see: what groups it for copy numbers (its art) and what orders it (the GM's copy number). */
export interface TokenInView {
  readonly id: string;
  readonly art: string;
  readonly rank: number;
}

/** Which number each token in view shows, and how many tokens of each art are in view. */
export interface InstanceNumbers {
  readonly numbers: ReadonlyMap<string, { readonly art: string; readonly number: number }>;
  readonly counts: ReadonlyMap<string, number>;
}

export const NO_INSTANCE_NUMBERS: InstanceNumbers = Object.freeze({ numbers: new Map(), counts: new Map() });

function byRank(a: TokenInView, b: TokenInView): number {
  const finiteA = Number.isFinite(a.rank);
  const finiteB = Number.isFinite(b.rank);
  if (finiteA && finiteB) return a.rank - b.rank;
  return finiteA === finiteB ? 0 : finiteA ? -1 : 1;
}

/**
 * Numbers the tokens players see. One already numbered with the same art keeps its number; any other takes the
 * smallest number free among the tokens of its art, by rank. Returns `previous` itself while nothing changed.
 */
export function numberTokensInView(previous: InstanceNumbers, inView: readonly TokenInView[]): InstanceNumbers {
  const listed = new Set<string>();
  const tokens = inView.filter((token) => (listed.has(token.id) ? false : (listed.add(token.id), true)));
  if (tokens.length === previous.numbers.size && tokens.every(({ id, art }) => previous.numbers.get(id)?.art === art)) return previous;
  const taken = new Map<string, Set<number>>();
  const entries = new Map<string, { readonly art: string; readonly number: number }>();
  const newcomers: TokenInView[] = [];
  for (const token of tokens) {
    const before = previous.numbers.get(token.id);
    if (before?.art !== token.art) {
      newcomers.push(token);
      continue;
    }
    entries.set(token.id, before);
    taken.set(token.art, (taken.get(token.art) ?? new Set()).add(before.number));
  }
  for (const { id, art } of [...newcomers].sort(byRank)) {
    const held = taken.get(art) ?? new Set<number>();
    let number = 1;
    while (held.has(number)) number++;
    entries.set(id, { art, number });
    taken.set(art, held.add(number));
  }
  const numbers = new Map<string, { readonly art: string; readonly number: number }>();
  const counts = new Map<string, number>();
  for (const { id, art } of tokens) {
    const entry = entries.get(id)!;
    numbers.set(id, entry);
    counts.set(art, (counts.get(art) ?? 0) + 1);
  }
  return { numbers, counts };
}

/** The number a token's badge shows players: none unless badges are on and two or more of its art are in view. */
export function badgeNumberInView(numbers: InstanceNumbers, tokenId: string, badgesOn: boolean): number | null {
  const entry = numbers.numbers.get(tokenId);
  if (!badgesOn || !entry || (numbers.counts.get(entry.art) ?? 0) < 2) return null;
  return entry.number;
}
