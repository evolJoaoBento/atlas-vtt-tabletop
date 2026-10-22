/**
 * Tabletop's link to a stock Atlas VTT's dice: which map view a GM's roll is logged on, how that map's collection rolls
 * dice, and the roll handed to Atlas's roll log, toast and player window. Atlas 0.9 has no extension API, so all of it
 * goes through a map view's private objects; every member is checked before use and a failed check reads as "nothing
 * there" (Atlas's default rules, no route) rather than throwing.
 */
import type { DieType } from './kit/faces';
import { DEFAULT_RULES, defaultDie, type DiceRules, type RolledDie } from './rollRules';

/** Atlas's map view type. */
const ATLAS_VIEW_TYPE = 'atlas-vtt';

/** A workspace view as far as the dice read it; Atlas's members unchecked. */
export interface MapViewLike {
  getViewType(): string;
  file?: { path: string } | null;
  serviceManager?: unknown;
  atlasStore?: unknown;
}

/** The slice of Atlas's extension API (when one exists) a roll needs. */
export interface DicePublisher {
  dice?: { publish?(roll: object, options?: { throw?: boolean }): void };
}

/** A finished roll as `RollSession.result()` gives it. */
export interface RollResult {
  rolls: RolledDie[];
  modifier: number;
  total: number;
  crit?: 'success' | 'failure';
  label?: string;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null;

/** Calls a method of an object by name when it has one; undefined when it has none or it throws. */
function call(target: unknown, method: string, ...args: unknown[]): unknown {
  if (!isObject(target)) return undefined;
  const fn = target[method];
  if (typeof fn !== 'function') return undefined;
  try {
    return (fn as (...a: unknown[]) => unknown).apply(target, args);
  } catch {
    return undefined;
  }
}

/** The map view's store state: its map and whether it is another plugin's read-only view. */
function stateOf(view: MapViewLike): Rec | null {
  const state = call(view.atlasStore, 'getState');
  return isObject(state) ? state : null;
}

/** The map the view shows: its scene tab's (Atlas 0.9's tabs), else the file it opened. */
function mapPathOf(view: MapViewLike): string | null {
  const path = stateOf(view)?.mapPath;
  if (typeof path === 'string' && path !== '') return path;
  return typeof view.file?.path === 'string' ? view.file.path : null;
}

/** An Atlas map view the GM rolls on; another plugin's read-only view of a map is no table to log in. */
function isRollView(view: MapViewLike | null): view is MapViewLike {
  try {
    return !!view && view.getViewType() === ATLAS_VIEW_TYPE && stateOf(view)?.remoteView == null;
  } catch {
    return false;
  }
}

/**
 * The map view a roll on `mapPath` is logged on: the one showing that map (as a scene tab, or the file it opened),
 * else `recent` when it is a map view, else the first map view; null without one.
 */
export function rollViewFor(views: readonly MapViewLike[], recent: MapViewLike | null, mapPath: string): MapViewLike | null {
  const usable = views.filter(isRollView);
  return usable.find((view) => mapPathOf(view) === mapPath)
    ?? usable.find((view) => view.file?.path === mapPath)
    ?? (isRollView(recent) ? recent : null)
    ?? usable[0]
    ?? null;
}

const CRITS: ReadonlySet<string> = new Set(['natural', 'roll-under', 'doubles', 'high-total', 'none']);
const isFaceCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** `NdS` of a dice set's groups (`[{count, sides}]`); null for mixed dice, which have no one default die. */
function groupsRoll(groups: unknown[]): string | null {
  let count = 0;
  let sides: unknown = null;
  for (const group of groups) {
    if (!isObject(group) || !isFaceCount(group.count) || group.count < 1) return null;
    if (sides !== null && group.sides !== sides) return null;
    sides = group.sides;
    count += group.count;
  }
  return count > 0 && typeof sides === 'number' ? `${count}d${sides}` : null;
}

/**
 * Dice rules as Atlas stores them, checked field by field (Atlas's defaults for each field it cannot read): a
 * collection's `dice` (`DiceRules`, `defaultRoll`) or a dice set (`dice: [{count, sides}]`). A default roll Tabletop
 * has no die for reads as the default.
 */
function readRules(raw: Rec): DiceRules {
  const written = Array.isArray(raw.dice) ? groupsRoll(raw.dice) : raw.defaultRoll;
  const defaultRoll = typeof written === 'string' && defaultDie({ defaultRoll: written, crit: 'none' }) ? written : DEFAULT_RULES.defaultRoll;
  const crit = typeof raw.crit === 'string' && CRITS.has(raw.crit) ? raw.crit as DiceRules['crit'] : DEFAULT_RULES.crit;
  const rules: DiceRules = { defaultRoll, crit };
  const explode = raw.explode;
  if (isObject(explode) && (explode.dice === 'default' || explode.dice === 'all') && typeof explode.repeats === 'boolean'
    && isFaceCount(explode.highFaces) && isFaceCount(explode.lowFaces)) {
    rules.explode = { dice: explode.dice, repeats: explode.repeats, highFaces: explode.highFaces, lowFaces: explode.lowFaces };
  }
  return rules;
}

/**
 * The dice rules of the collection holding the view's map, read where stock Atlas 0.9 keeps them:
 * - the view's dice tool (`serviceManager.getToolController().getDiceTool().getDiceRules()`): the dice set Atlas's own
 *   toolbar rolls for that map, its `diceSetId` (built-in or the vault's dice sets) or `dice` already resolved;
 * - else the collection's stored settings (`getAssetService().getCollectionSettings(getCollectionForMap(map)).dice`);
 * - else Atlas's defaults.
 * `mapPath`: the map the roll is for, when the view may show another (`rollViewFor` fell back to it); the dice tool
 * rolls the view's own map, so then only that map's collection settings are read.
 */
export function diceRulesOf(view: MapViewLike | null, forMap?: string): DiceRules {
  if (!view) return { ...DEFAULT_RULES };
  const shown = mapPathOf(view);
  const mapPath = forMap ?? shown;
  if (mapPath === shown) {
    const tool = call(call(view.serviceManager, 'getToolController'), 'getDiceTool');
    const set = call(tool, 'getDiceRules');
    if (isObject(set)) return readRules(set);
  }
  const assets = call(view.serviceManager, 'getAssetService');
  const collectionId = mapPath ? call(assets, 'getCollectionForMap', mapPath) : undefined;
  const settings = typeof collectionId === 'string' && collectionId !== '' ? call(assets, 'getCollectionSettings', collectionId) : undefined;
  return isObject(settings) && isObject(settings.dice) ? readRules(settings.dice) : { ...DEFAULT_RULES };
}

/** A tag colour Atlas keeps: `#rrggbb`. */
const tagColour = (color: unknown): string | undefined => (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined);

/** Characters Atlas refuses in a tag name: markup, backticks, control characters and invisible formatting. */
function refusedInTag(char: string): boolean {
  const c = char.charCodeAt(0);
  return '<>[]`'.includes(char) || c < 32 || (c >= 127 && c <= 159) || c === 173 || (c >= 8203 && c <= 8207)
    || (c >= 8232 && c <= 8238) || (c >= 8288 && c <= 8292) || c === 65279;
}

/** A tag name Atlas keeps: plain text, trimmed, at most 32 characters, no markup or control characters. */
function tagName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed && trimmed.length <= 32 && ![...trimmed].some(refusedInTag) ? trimmed : undefined;
}

/** `1d20+2d6+3`: the dice thrown (not those an explosion added, nor the one advantage set aside) and the modifier. */
function formulaOf(result: RollResult): string {
  const counts = new Map<DieType, number>();
  for (const roll of result.rolls) {
    if (!roll.exploded && !roll.negative && !roll.dropped) counts.set(roll.die, (counts.get(roll.die) ?? 0) + 1);
  }
  const dice = [...counts].map(([die, count]) => `${count}${die}`).join('+');
  const modifier = result.modifier === 0 ? '' : `${result.modifier > 0 ? '+' : '-'}${Math.abs(result.modifier)}`;
  return `${dice}${modifier}` || '0';
}

/**
 * Atlas's stock roll for a finished Tabletop roll. Every die states its lowest face (1), which makes Atlas show the
 * roll as its result card rather than throw its own 3D dice: these dice were already thrown on the board. A die's
 * colour tag goes as Atlas 0.9 names it (`colour`, `name`); a critical as Atlas logs it (`high`, `low`). `from`: the
 * statblock ability it was rolled for; the toolbar otherwise.
 */
export function stockRoll(result: RollResult, rolledBy?: string, from?: { abilityName: string; tokenId?: string }): object {
  const now = Date.now();
  return {
    id: `tabletop_${now}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    formula: formulaOf(result),
    rolls: result.rolls.map((roll) => {
      const colour = tagColour(roll.color);
      const name = tagName(roll.colorName);
      return {
        die: roll.die,
        value: roll.value,
        max: roll.max,
        min: 1,
        ...(roll.exploded ? { exploded: true } : {}),
        ...(roll.negative ? { negative: true } : {}),
        ...(roll.dropped ? { dropped: true } : {}),
        ...(colour ? { colour } : {}),
        ...(name ? { name } : {}),
      };
    }),
    modifiers: result.modifier,
    total: result.total,
    ...(result.crit ? { crit: result.crit === 'success' ? 'high' : 'low' } : {}),
    player: 'Tabletop for Atlas VTT',
    source: from ? { type: 'statblock', abilityName: from.abilityName, ...(from.tokenId ? { tokenId: from.tokenId } : {}) } : { type: 'toolbar' },
    ...(rolledBy ? { rolledBy } : {}),
  };
}

/** A map view's event bus, as far as rolls need it. */
interface RollBus {
  emit(event: string, roll: unknown): unknown;
  on?(event: string, listener: (roll: unknown) => void): unknown;
  off?(event: string, listener: (roll: unknown) => void): unknown;
}

function busOf(view: MapViewLike | null): RollBus | null {
  const bus = view ? call(view.serviceManager, 'getEventBus') : undefined;
  return isObject(bus) && typeof bus.emit === 'function' ? bus as unknown as RollBus : null;
}

/**
 * Hands a roll to Atlas: through its extension API's `dice.publish` when there is one (only logged, not thrown again),
 * else on the map view's event bus, where Atlas's own dice tool announces rolls to its log, toast and player window.
 * False when neither takes it.
 */
export function publishRoll(view: MapViewLike | null, roll: object, ext?: DicePublisher | null): boolean {
  const dice = ext?.dice;
  if (typeof dice?.publish === 'function') {
    try {
      dice.publish(roll, { throw: false });
      return true;
    } catch (error) {
      // Atlas refused the roll before logging anything, so the bus cannot double it.
      console.warn('Tabletop: Atlas did not take the roll, logging it on the map view instead:', error);
    }
  }
  const bus = busOf(view);
  if (!bus) return false;
  try {
    bus.emit('dice-rolled', roll);
    return true;
  } catch (error) {
    console.warn('Tabletop: could not log the roll in Atlas:', error);
    return false;
  }
}

/** Hears every roll the map view logs (Atlas's own and those handed to it) until the returned function is called. */
export function onRolled(view: MapViewLike, listener: (roll: unknown) => void): () => void {
  const bus = busOf(view);
  if (!bus || typeof bus.on !== 'function' || typeof bus.off !== 'function') return () => {};
  const heard = (roll: unknown): void => listener(roll);
  try {
    bus.on('dice-rolled', heard);
  } catch {
    return () => {};
  }
  return () => {
    try { bus.off?.('dice-rolled', heard); } catch { /* the view is gone */ }
  };
}
