import type { SoundId } from './catalog';

/** The 5e conditions that have a sound of their own, by their English names. */
const KNOWN = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'] as const;

/** Portuguese and Spanish names for the same conditions, as tables write them (without accents, see `conditionKey`). */
const ALIASES: Record<string, (typeof KNOWN)[number]> = {
  cego: 'blinded', cegado: 'blinded', enfeiticado: 'charmed', encantado: 'charmed', surdo: 'deafened', exaustao: 'exhaustion',
  assustado: 'frightened', amedrontado: 'frightened', agarrado: 'grappled', incapacitado: 'incapacitated', invisivel: 'invisible',
  paralisado: 'paralyzed', petrificado: 'petrified', envenenado: 'poisoned', caido: 'prone', derrubado: 'prone', impedido: 'restrained',
  contido: 'restrained', atordoado: 'stunned', inconsciente: 'unconscious',
  hechizado: 'charmed', ensordecido: 'deafened', agotamiento: 'exhaustion', asustado: 'frightened',
  paralizado: 'paralyzed', derribado: 'prone', apresado: 'restrained', aturdido: 'stunned',
};

/** A condition name as compared: lower case, without accents, trimmed, and without the number Atlas's valued conditions end in. */
export function conditionKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s*\d+$/, '').trim();
}

/** The sound for a condition put on a token; any condition without a sound of its own gets the generic one. */
export function conditionSound(name: string): SoundId {
  const key = conditionKey(name);
  const known = (KNOWN as readonly string[]).includes(key) ? (key as (typeof KNOWN)[number]) : ALIASES[key];
  return known ? (`condition.${known}` as SoundId) : 'condition.applied';
}
