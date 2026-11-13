import type { SoundId } from './catalog';

/** What a person is told about a sound: its name in the settings list and when it plays. */
export interface SoundInfo { name: string; when: string }

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const DAMAGE = ['acid', 'bludgeoning', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder', 'plain'] as const;
const NO_LOOP: readonly string[] = ['bludgeoning', 'piercing', 'slashing'];
const CONDITIONS = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'] as const;
const WATER = { ripples: 'Ripples', flow: 'Flowing water', waves: 'Waves', still: 'Still water' } as const;
const WATER_WHEN = {
  ripples: 'Painted water that ripples, while the camera is near it.',
  flow: 'Painted water that flows one way, while the camera is near it.',
  waves: 'Painted water that rolls in waves, while the camera is near it.',
  still: 'Painted still water, while the camera is near it (very quiet).',
} as const;

function build(): Record<SoundId, SoundInfo> {
  const info: Record<string, SoundInfo> = {
    'dice.hit': { name: 'Die hits the table', when: 'A die hits the table, a wall or another die. Louder for a harder hit; many play at once in a big roll.' },
    'dice.caught': { name: 'Die caught on an edge', when: 'A die comes to rest cocked on an edge or against something, and is highlighted.' },
    'mini.pickup': { name: 'Mini picked up', when: 'A token is lifted by dragging it.' },
    'mini.putdown': { name: 'Mini put down', when: 'A dragged token lands.' },
    'door.open': { name: 'Door opens', when: 'A door is opened, by you or by someone else on the map.' },
    'door.shut': { name: 'Door shuts', when: 'A door is closed.' },
    'door.locked': { name: 'Door locked', when: 'Someone tries a locked door.' },
    'wall.crumble': { name: 'Wall crumbles', when: 'A wall is swapped for another, such as a wall that falls.' },
    'fog.chime': { name: 'Fog revealed', when: 'Fog is placed or revealed on the map (not line-of-sight discovery).' },
    'turn.horn': { name: 'Turn horn', when: 'A turn begins in a fight.' },
    'condition.applied': { name: 'Other condition', when: 'A condition without a sound of its own is put on a token.' },
  };
  for (const condition of CONDITIONS) info[`condition.${condition}`] = { name: `${cap(condition)} (condition)`, when: `The ${condition} condition is put on a token.` };
  for (const type of DAMAGE) {
    const label = type === 'plain' ? 'Plain magic' : cap(type);
    info[`spell.impact.${type}`] = { name: `${label} impact`, when: type === 'plain' ? 'A spell with no damage type lands.' : `A spell of ${type} damage lands.` };
    // Weapon-blow spells have no loop: a lasting one is silent while it stands.
    if (NO_LOOP.includes(type)) continue;
    info[`spell.loop.${type}`] = { name: `${label} (lingering, loop)`, when: type === 'plain' ? 'Under a lasting spell with no damage type, while it stays on the map.' : `Under a lasting ${type} spell, while it stays on the map.` };
  }
  for (const kind of Object.keys(WATER) as Array<keyof typeof WATER>) info[`water.${kind}`] = { name: `${WATER[kind]} (loop)`, when: WATER_WHEN[kind] };
  return info as Record<SoundId, SoundInfo>;
}

/** The name and the occasion of every sound id. */
export const SOUND_INFO: Record<SoundId, SoundInfo> = build();

export function isSoundId(id: string): id is SoundId {
  return Object.prototype.hasOwnProperty.call(SOUND_INFO, id);
}
