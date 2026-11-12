import type { DamageType } from '../board/spells';
import type { SoundId } from './catalog';
import { nearness, type Listener } from './placement';

/** The impact sound for a spell of damage `effect`; a spell without one gets the plain magical impact. */
export function spellImpactSound(effect: DamageType | null | undefined): SoundId {
  return `spell.impact.${effect ?? 'plain'}` as SoundId;
}

/** The damage types of weapon blows, whose lasting spells stand silent: they have no loop sound. */
const SILENT_WHILE_STANDING: ReadonlySet<string> = new Set(['bludgeoning', 'piercing', 'slashing']);

/** The loop sound for a lasting spell of damage `effect`, or null for a type that has none (its spell is silent while it stands). */
export function spellLoopSound(effect: DamageType | null | undefined): SoundId | null {
  if (effect && SILENT_WHILE_STANDING.has(effect)) return null;
  return `spell.loop.${effect ?? 'plain'}` as SoundId;
}

/**
 * The ids of the casts to announce: those not in `seen` yet, none on the first load (spells already on a map when it
 * is opened appear whole and silent). The caller records what it has seen.
 */
export function castsToAnnounce(seen: ReadonlySet<string>, firstLoad: boolean, castIds: readonly string[]): string[] {
  if (firstLoad) return [];
  return castIds.filter((id) => !seen.has(id));
}

/**
 * How loud each damage type's loop is: the loudest nearness (to the camera's eye) among that type's lasting spells,
 * `reach` the distance past which it is silent. A type with a lasting spell gets an entry (0 when out of reach); a type
 * with none gets none. A spell without a damage type has the plain loop; a spell of a type with no loop adds nothing.
 */
export function spellLoopGains(
  spells: ReadonlyArray<{ id: string; effect: DamageType | null; at: { x: number; y: number; z: number }; lasting: boolean }>,
  listener: Listener,
  reach: number,
): Map<SoundId, number> {
  const gains = new Map<SoundId, number>();
  for (const spell of spells) {
    if (!spell.lasting) continue;
    const id = spellLoopSound(spell.effect);
    if (!id) continue;
    const distance = Math.hypot(spell.at.x - listener.eye.x, spell.at.y - listener.eye.y, spell.at.z - listener.eye.z);
    gains.set(id, Math.max(gains.get(id) ?? 0, nearness(distance, reach)));
  }
  return gains;
}
