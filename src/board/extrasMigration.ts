/**
 * The move of the GM's 3D settings of walls, doors and lights from Tabletop's data.json onto Atlas's own records
 * (`recordExtras.ts`). Tabletop kept seven records per map, keyed by Atlas's ids; each value goes to the record of its
 * id: a wall's or door's to `objects.walls[id]`, a placed light's height to `objects.lights[id]`, the height of a
 * light a token carries to `objects.tokens[id]`. It loses nothing Atlas still has a record for, so it runs on its own,
 * once per map, when Atlas comes to hold the map, after a backup (`BoardView`). What the record already says stays:
 * only what it lacks is moved, so a move run again (interrupted before data.json was cleared) finds nothing to do. A
 * value whose record Atlas no longer has, or that no wall or light may have, is dropped; it is in the backup.
 * Pure: this only says what to write.
 */
import { readLightHeight, readWallExtra, type LegacyExtras, type WallExtra, type WallExtraChange } from './recordExtras';

export interface ExtrasMove {
  /** For each wall or door that gets something: the keys to set on its record. */
  walls: Array<{ id: string; change: WallExtraChange }>;
  /** Placed lights and the height each gets. */
  lights: Array<{ id: string; height: number }>;
  /** Tokens that carry a light, and the height that light gets. */
  tokens: Array<{ id: string; height: number }>;
  /** How many values go onto a record, and how many go nowhere (the backup has them). */
  moved: number;
  dropped: number;
  /** Of those that go nowhere, the ones whose wall, light or token Atlas no longer has; the rest the record already had, or no record may have. */
  orphaned: number;
}

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const recordOf = (records: unknown, id: string): Raw | null => (isObj(records) && Object.hasOwn(records, id) && isObj(records[id]) ? records[id] : null);

/** What moving `legacy` onto the records of `objects` (Atlas's store, every level) comes to. */
export function planExtrasMove(legacy: LegacyExtras, objects: { walls?: unknown; lights?: unknown; tokens?: unknown }): ExtrasMove {
  const plan: ExtrasMove = { walls: [], lights: [], tokens: [], moved: 0, dropped: 0, orphaned: 0 };
  // What data.json says of each wall, as the record's field would say it.
  const kept = new Map<string, Raw>();
  const note = (records: Readonly<Record<string, unknown>> | undefined, fields: (value: unknown) => Raw): void => {
    for (const [id, value] of Object.entries(records ?? {})) kept.set(id, { ...(kept.get(id) ?? {}), ...fields(value) });
  };
  note(legacy.wallMaterials, (material) => ({ material }));
  note(legacy.wallHeights, (height) => ({ height }));
  note(legacy.wallWidths, (width) => ({ width }));
  note(legacy.windows, (window) => ({ window }));
  note(legacy.doorProps, (prop) => ({ prop }));
  note(legacy.doorFlips, (flip) => (isObj(flip) ? { ...(flip.hinge === true ? { hinge: true } : {}), ...(flip.side === true ? { side: true } : {}) } : {}));
  for (const [id, said] of kept) {
    const all = Object.keys(said).length;
    const record = recordOf(objects.walls, id);
    const valid = readWallExtra(said) ?? {};
    const has = record ? readWallExtra(record.tabletop) ?? {} : {};
    const change: WallExtraChange = {};
    if (record) for (const key of Object.keys(valid) as Array<keyof WallExtra>) if (has[key] === undefined) (change as Raw)[key] = valid[key];
    const moving = Object.keys(change).length;
    if (moving > 0) plan.walls.push({ id, change });
    plan.moved += moving;
    plan.dropped += all - moving;
    if (!record) plan.orphaned += all;
  }
  for (const [id, value] of Object.entries(legacy.lightHeights ?? {})) {
    const height = readLightHeight({ height: value }, 'height');
    const light = recordOf(objects.lights, id);
    const token = light ? null : recordOf(objects.tokens, id);
    if (height !== null && light && readLightHeight(light.tabletop, 'height') === null) { plan.lights.push({ id, height }); plan.moved += 1; }
    else if (height !== null && token && readLightHeight(token.tabletop, 'lightHeight') === null) { plan.tokens.push({ id, height }); plan.moved += 1; }
    else {
      plan.dropped += 1;
      if (!light && !token) plan.orphaned += 1;
    }
  }
  return plan;
}
