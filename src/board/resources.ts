/**
 * A token's resources (HP, stress, spell slots, AC…) as Atlas 0.8 keeps them, ported from its `src/app/resources/`
 * so the board shows, edits and saves them by Atlas's own rules:
 * - each collection defines up to six resources (`settings.resources`); each takes a socket on a token: the first two
 *   are bars, the rest wheels;
 * - in memory a token holds `resources` (`{ current, max }` by key) and `overriddenMax`; the map file keeps the fields
 *   older Atlas wrote (`hp`, `stress`/`maxStress`, `hope`, `statblockResources`, the override switches), so every
 *   version of Atlas reads it. `tokenFromFile` and `tokenToFile` convert, exactly as Atlas does.
 * Pure, so it is tested without Obsidian.
 */

/** `drains` starts full and goes down, `fills` starts at 0 and goes up, `static` is one number (an armour class). */
export type ResourceDirection = 'drains' | 'fills' | 'static';

export interface ResourceDefinition {
  key: string;
  name: string;
  field: string;
  direction: ResourceDirection;
  /** `#rrggbb`. */
  color: string;
  /** Spent (0 when draining, full when filling) marks the token defeated. */
  defeatedWhenSpent?: boolean;
  visibleToPlayers: boolean;
  /** The socket it takes on a token, 0 to 5; without one, the first free socket in list order. */
  slot?: number;
}

/** `current` counts in the resource's direction: remaining when draining, used when filling. */
export interface ResourceValue {
  current: number;
  max: number;
}

export interface ResourceHolder {
  resources?: Record<string, ResourceValue> | undefined;
  /** Keys whose maximum was set by hand. */
  overriddenMax?: string[] | undefined;
}

export interface VisibleResource {
  definition: ResourceDefinition;
  value: ResourceValue;
  /** Its socket: 0 and 1 are bars, 2 to 5 wheels. */
  slot: number;
}

/** A token has this many sockets; the first `BAR_SLOTS` are bars. */
export const MAX_RESOURCES = 6;
export const BAR_SLOTS = 2;

export const HP_RESOURCE: Readonly<ResourceDefinition> = {
  key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: false,
};

export const STRESS_RESOURCE: Readonly<ResourceDefinition> = {
  key: 'stress', name: 'Stress', field: 'stress', direction: 'fills', color: '#a855f7', visibleToPlayers: false,
};

/** The second bar of a game without a name for it. */
const SECONDARY_RESOURCE: Readonly<ResourceDefinition> = { ...STRESS_RESOURCE, name: 'Secondary resource' };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isSocket = (slot: unknown): slot is number => typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < MAX_RESOURCES;

/** A stored definition, or null when a required part is missing or invalid. */
function parseResourceDefinition(raw: unknown): ResourceDefinition | null {
  if (!isRecord(raw)) return null;
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
  const key = text(raw.key);
  const name = text(raw.name);
  const field = text(raw.field);
  if (!key || !name || !field) return null;
  if (raw.direction !== 'drains' && raw.direction !== 'fills' && raw.direction !== 'static') return null;
  if (typeof raw.color !== 'string' || !HEX_COLOR.test(raw.color)) return null;
  return {
    key, name, field: field.trim(), direction: raw.direction, color: raw.color,
    ...(raw.defeatedWhenSpent === true && raw.direction !== 'static' && { defeatedWhenSpent: true }),
    visibleToPlayers: raw.visibleToPlayers === true,
    ...(isSocket(raw.slot) && { slot: raw.slot }),
  };
}

/** The valid definitions of a stored list, without duplicates, at most `MAX_RESOURCES`. */
export function parseResourceDefinitions(raw: unknown): ResourceDefinition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map(parseResourceDefinition).filter((definition): definition is ResourceDefinition => {
    if (!definition || seen.has(definition.key)) return false;
    seen.add(definition.key);
    return true;
  }).slice(0, MAX_RESOURCES);
}

/** HP plus the secondary bar when it is wanted, as Atlas reads a list saved before resources existed. */
function withLegacyBars(widgets: Raw | undefined, usedInScenes: boolean): ResourceDefinition[] {
  const wanted = usedInScenes || widgets?.stressBar === true;
  return wanted ? [{ ...HP_RESOURCE }, { ...SECONDARY_RESOURCE }] : [{ ...HP_RESOURCE }];
}

/**
 * The resources tokens on a map track (Atlas's `mapResources`): its collection's list; HP and the secondary bar for a
 * map outside every collection; HP for a map in a collection the index does not know. A collection saved before
 * resources existed (Atlas stores its list at start-up) reads as HP, with the secondary bar when switched on.
 *
 * @param settings The collection's settings, or null when the index has none for the map.
 * @param inCollection Whether the map lies in a collection's folder.
 */
export function mapDefinitions(settings: Raw | null, inCollection: boolean): ResourceDefinition[] {
  if (settings) {
    if (Array.isArray(settings.resources)) return parseResourceDefinitions(settings.resources);
    const widgets = isRecord(settings.defaultWidgets) ? settings.defaultWidgets : undefined;
    return withLegacyBars(widgets, false);
  }
  return inCollection ? [{ ...HP_RESOURCE }] : withLegacyBars(undefined, true);
}

/** Each resource with its socket, in socket order: a stored socket holds (the first to claim it), the rest fill in. */
export function slottedResources(definitions: readonly ResourceDefinition[]): Array<{ definition: ResourceDefinition; slot: number }> {
  const sockets = new Map<number, ResourceDefinition>();
  const waiting: ResourceDefinition[] = [];
  for (const definition of definitions) {
    if (isSocket(definition.slot) && !sockets.has(definition.slot)) sockets.set(definition.slot, definition);
    else waiting.push(definition);
  }
  for (let slot = 0; slot < MAX_RESOURCES && waiting.length > 0; slot++) {
    if (!sockets.has(slot)) sockets.set(slot, waiting.shift()!);
  }
  return [...sockets].sort(([a], [b]) => a - b).map(([slot, definition]) => ({ definition, slot }));
}

/** Whether a value shows: a static one may be 0, a counting one needs a maximum above 0. */
function holdsValue(definition: ResourceDefinition, value: ResourceValue): boolean {
  return definition.direction === 'static' ? value.max >= 0 : value.max > 0;
}

/**
 * The resources a viewer sees on a token, in socket order: the GM those the map does not hide; players those the
 * collection shows them (`visibleToPlayers`), whatever the map hides from the GM, as Atlas's player window does.
 */
export function visibleResources(token: ResourceHolder, definitions: readonly ResourceDefinition[], hidden: readonly string[], viewer: 'gm' | 'player' = 'gm'): VisibleResource[] {
  const shown: VisibleResource[] = [];
  for (const { definition, slot } of slottedResources(definitions)) {
    if (viewer === 'gm' ? hidden.includes(definition.key) : !definition.visibleToPlayers) continue;
    const value = token.resources?.[definition.key];
    if (!value || !holdsValue(definition, value)) continue;
    shown.push({ definition, value, slot });
  }
  return shown;
}

export function clampValue(value: ResourceValue): ResourceValue {
  const max = Math.max(0, value.max);
  return { current: Math.max(0, Math.min(max, value.current)), max };
}

export function withCurrent(value: ResourceValue, current: number): ResourceValue {
  return clampValue({ current: Number.isFinite(current) ? current : value.current, max: value.max });
}

/** Used up: 0 when draining, full when filling. A value without a maximum, or a static one, is never spent. */
function isSpent(definition: ResourceDefinition, value: ResourceValue): boolean {
  if (value.max <= 0 || definition.direction === 'static') return false;
  return definition.direction === 'drains' ? value.current <= 0 : value.current >= value.max;
}

export function isDefeated(token: ResourceHolder, definitions: readonly ResourceDefinition[]): boolean {
  return definitions.some((definition) => {
    const value = token.resources?.[definition.key];
    return definition.defeatedWhenSpent === true && value !== undefined && isSpent(definition, value);
  });
}

/** Whether the token holds a resource that defeats it when spent: its menu offers Kill. */
export function isKillable(token: ResourceHolder, definitions: readonly ResourceDefinition[]): boolean {
  return definitions.some((definition) => definition.defeatedWhenSpent === true && token.resources?.[definition.key] !== undefined);
}

/** The token update that sets one resource; a hand-set maximum is remembered in `overriddenMax`. */
export function resourceUpdate(token: ResourceHolder, key: string, next: ResourceValue, maxEdited: boolean): { resources: Record<string, ResourceValue>; overriddenMax?: string[] } {
  const resources = { ...token.resources, [key]: clampValue(next) };
  const overridden = token.overriddenMax ?? [];
  if (!maxEdited || overridden.includes(key)) return { resources };
  return { resources, overriddenMax: [...overridden, key] };
}

/** The token's resources with every one that defeats it spent (Kill). */
export function defeatedResources(token: ResourceHolder, definitions: readonly ResourceDefinition[]): Record<string, ResourceValue> | undefined {
  if (!token.resources) return undefined;
  const next = { ...token.resources };
  for (const definition of definitions) {
    const value = next[definition.key];
    if (value && definition.defeatedWhenSpent) next[definition.key] = { current: definition.direction === 'drains' ? 0 : value.max, max: value.max };
  }
  return next;
}

export type ResourceField = keyof ResourceValue;

/** Atlas's editor: an absolute number or a signed change for one field, current clamped into 0..max; null when invalid. */
export function parseValueInput(raw: string, value: ResourceValue, field: ResourceField = 'current'): ResourceValue | null {
  const single = /^([+-]?)(\d+)$/.exec(raw.trim());
  if (!single) return null;
  const [, sign, digits] = single;
  const amount = Number(digits);
  const next = sign === '+' ? value[field] + amount : sign === '-' ? value[field] - amount : amount;
  if (!Number.isSafeInteger(next)) return null;
  const max = field === 'max' ? next : value.max;
  const current = field === 'current' ? next : value.current;
  if (max <= 0) return null;
  return { current: Math.max(0, Math.min(max, current)), max };
}

/** The colour a resource shows in: a defeating one turns yellow below 70% left, red below 30%. */
export function resourceColor(definition: ResourceDefinition, value: ResourceValue): string {
  if (!definition.defeatedWhenSpent) return definition.color;
  const share = value.max > 0 ? Math.max(0, Math.min(1, value.current / value.max)) : 0;
  const left = definition.direction === 'drains' ? share : 1 - share;
  if (left >= 0.7) return definition.color;
  return left >= 0.3 ? '#eab308' : '#ef4444';
}

/** A wheel's gauge, in radians clockwise from the top; a whole maximum of 2 to 8 is cut into one segment per point. */
export interface WheelGauge {
  share: number;
  end: number;
  ticks: number[];
}

const MAX_WHEEL_SEGMENTS = 8;
const TOP = -Math.PI / 2;

export function wheelGauge({ current, max }: ResourceValue): WheelGauge | null {
  if (!(max > 0)) return null;
  const share = Math.max(0, Math.min(1, current / max));
  const segmented = Number.isInteger(max) && max > 1 && max <= MAX_WHEEL_SEGMENTS;
  return { share, end: TOP + Math.PI * 2 * share, ticks: segmented ? Array.from({ length: max }, (_, i) => TOP + ((Math.PI * 2) / max) * i) : [] };
}

// ── The map file's form ─────────────────────────────────────────────────────

const BARE_HP_MAX = 100;
const BARE_STRESS_MAX = 10;
const FILE_FIELDS = ['hp', 'stress', 'maxStress', 'hope', 'statblockResources', 'maxHpOverridden', 'maxStressOverridden'] as const;

function valueOf(raw: unknown, bareMax: number): ResourceValue | null {
  if (isFiniteNumber(raw)) return { current: raw, max: Math.max(raw, bareMax) };
  if (isRecord(raw) && typeof raw.current === 'number' && typeof raw.max === 'number') return { current: raw.current, max: raw.max };
  return null;
}

/** A token as a map file holds it, read the way Atlas holds it in memory (`resources`, `overriddenMax`). */
export function tokenFromFile<T extends object>(token: T): T & ResourceHolder {
  const file = token as Raw;
  if (!FILE_FIELDS.some((field) => field in file)) return token;
  const resources: Record<string, ResourceValue> = {};
  const put = (key: string, value: ResourceValue | null): void => { if (value) resources[key] = value; };
  const bareStressMax = typeof file.maxStress === 'number' && file.maxStress > 0 ? file.maxStress : BARE_STRESS_MAX;
  put('hp', valueOf(file.hp, BARE_HP_MAX));
  put('stress', valueOf(file.stress, bareStressMax));
  put('hope', valueOf(file.hope, BARE_STRESS_MAX));
  if (isRecord(file.statblockResources)) {
    for (const [key, value] of Object.entries(file.statblockResources)) if (!(key in resources)) put(key, valueOf(value, 0));
  }
  const overridden = new Set([
    ...(file.maxHpOverridden === true ? ['hp'] : []),
    ...(file.maxStressOverridden === true ? ['stress'] : []),
    ...(Array.isArray(file.overriddenMax) ? (file.overriddenMax as string[]) : []),
  ]);
  const next: Raw = { ...file };
  for (const field of FILE_FIELDS) delete next[field];
  delete next.overriddenMax;
  const merged = { ...(isRecord(file.resources) ? file.resources : {}), ...resources };
  if (Object.keys(merged).length > 0) next.resources = merged;
  if (overridden.size > 0) next.overriddenMax = [...overridden];
  return next as T & ResourceHolder;
}

/** A token as a map file holds it; `tokenFromFile` reads it back unchanged. */
export function tokenToFile<T extends ResourceHolder>(token: T): object {
  const { resources, overriddenMax, ...rest } = token;
  if (!resources && !overriddenMax) return token;
  const { hp, stress, hope, ...others } = resources ?? {};
  const overridden = overriddenMax ?? [];
  const otherOverrides = overridden.filter((key) => key !== 'hp' && key !== 'stress');
  return {
    ...rest,
    ...(hp && { hp }),
    ...(stress && { stress, maxStress: stress.max }),
    ...(hope && { hope }),
    ...(Object.keys(others).length > 0 && { statblockResources: others }),
    ...(overridden.includes('hp') && { maxHpOverridden: true }),
    ...(overridden.includes('stress') && { maxStressOverridden: true }),
    ...(otherOverrides.length > 0 && { overriddenMax: otherOverrides }),
  };
}

/** What an initiative entry copies of its token's resources, as Atlas writes it. */
export function initiativeVitals(token: ResourceHolder): Raw {
  const { hp, stress } = token.resources ?? {};
  return { ...(hp && { hp }), ...(stress && { stress }), isDefeated: !!hp && hp.current <= 0 };
}

/**
 * The resource keys a map hides, from its token settings as the file holds them: the two old switches decide for HP
 * and the secondary bar (off unless switched on), beside the list naming any other.
 */
export function hiddenResourcesOf(settings: unknown): string[] {
  if (!isRecord(settings)) return [];
  let hidden = Array.isArray(settings.hiddenResources) ? settings.hiddenResources.filter((key): key is string => typeof key === 'string') : [];
  const hasSwitches = 'showHPBars' in settings || 'showStressBars' in settings;
  const set = (key: string, isHidden: boolean): void => {
    if (hidden.includes(key) === isHidden) return;
    hidden = isHidden ? [...hidden, key] : hidden.filter((other) => other !== key);
  };
  if (hasSwitches) {
    set('hp', settings.showHPBars === false);
    set('stress', settings.showStressBars !== true);
  } else if (settings.showResources === false) {
    hidden = ['hp', 'stress'];
  }
  return hidden;
}
