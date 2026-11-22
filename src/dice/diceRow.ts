/**
 * The dice tray's row (Atlas 0.18's `diceRow`): the dice and saved rolls a collection put in the tray, in the order the GM
 * set. What the row holds, read and changed, is Atlas's own (`atlasPort/.../dice/diceShelf.ts`, copied); here are the
 * board's parts of it: what each place does on the board's dice, the pin of a saved roll, and the drag that moves a place
 * (Atlas's `useRowDrag`, as pure arithmetic). Pure: the tray (`dicePicker.ts`) draws it.
 */
import { at } from '../atlasPort/atlasText';
import { MAX_ROW, STANDARD_ROW, withPinToggled, type DiceShelf, type ShelfChange } from '../atlasPort/app/react/components/dice/diceShelf';
import { DIE_TYPES, type DieType } from './kit/faces';
import { noDieText, type SavedRoll } from './savedRolls';

/** A place of the row as settings hold it: a die of any size, or a saved roll by its id. */
export type DiceRowSlot = DiceShelf['row'][number];

/** One place of the row as the board's tray shows it. */
export interface RowPlace {
  slot: DiceRowSlot;
  kind: 'die' | 'preset';
  /** The name under it: `d12`, or a saved roll's name. */
  caption: string;
  /** The die the board throws for it (a die place); null where the board has no body for it (`d3`) or the place is a saved roll. */
  die: DieType | null;
  /** The saved roll of a preset place. */
  preset?: SavedRoll;
  /** Why the place cannot be used on the board; null while it can. */
  problem: string | null;
}

/** The row's places as the tray shows them: the collection's own row, else the seven standard dice; a roll no longer saved is left out. */
export function rowPlaces(shelf: DiceShelf | null): RowPlace[] {
  const row = shelf?.row ?? STANDARD_ROW;
  return row.flatMap((slot): RowPlace[] => {
    if (slot.kind === 'die') {
      const name = `d${slot.sides}`;
      const die = (DIE_TYPES as readonly string[]).includes(name) ? (name as DieType) : null;
      return [{ slot, kind: 'die', caption: name, die, problem: die ? null : noDieText(slot.sides) }];
    }
    const preset = shelf?.presets.find((candidate) => candidate.id === slot.id) as SavedRoll | undefined;
    return preset ? [{ slot, kind: 'preset', caption: preset.name, die: null, preset, problem: null }] : [];
  });
}

/** Places in one line of the row: more wrap into a second, so the tray stays as wide as eight dice (Atlas's `ROW_COLUMNS`). */
export const ROW_COLUMNS = 8;

/** The columns of a row of `places`: as many as it has, at most `ROW_COLUMNS`. */
export const rowColumns = (places: number): number => Math.min(Math.max(places, 1), ROW_COLUMNS);

/** The number key of a place in the row: 1 to 9, then 0. */
export const placeKey = (place: number): string => String((place + 1) % 10);

/** What the Pin entry of a saved roll's menu is: its words (by whether it is in the row), whether it can be used, and the change it writes. */
export interface PinEntry {
  pinned: boolean;
  label: string;
  disabled: boolean;
  description?: string;
  change: ShelfChange | null;
}

export function pinEntry(shelf: DiceShelf, id: string): PinEntry {
  const pinned = shelf.row.some((slot) => slot.kind === 'preset' && slot.id === id);
  const change = withPinToggled(shelf, id);
  const label = at(pinned ? 'diceRoll.presetUnpin' : 'diceRoll.presetPin');
  if (change) return { pinned, label, disabled: false, change };
  return { pinned, label, disabled: true, description: at('diceRoll.presetRowFull', { max: MAX_ROW }), change: null };
}

export interface Point {
  x: number;
  y: number;
}

/** The place whose centre lies nearest where the held place (from `centres[from]`, moved by `delta`) is now. */
export function dragTarget(centres: readonly Point[], from: number, delta: Point): number {
  const held = centres[from]!;
  const point = { x: held.x + delta.x, y: held.y + delta.y };
  let best = from;
  let distance = Number.POSITIVE_INFINITY;
  centres.forEach((centre, index) => {
    const d = (centre.x - point.x) ** 2 + (centre.y - point.y) ** 2;
    if (d < distance) { best = index; distance = d; }
  });
  return best;
}

/**
 * How far each place stands from its own while the place `from` is held over `to`, as CSS `translate`: the held place follows
 * the pointer (`delta`), the places between take one step towards where it came from.
 */
export function dragOffsets(centres: readonly Point[], from: number, to: number, delta: Point): string[] {
  return centres.map((own, index) => {
    if (index === from) return `${delta.x}px ${delta.y}px`;
    const step = from < to && index > from && index <= to ? -1 : to < from && index >= to && index < from ? 1 : 0;
    if (step === 0) return '0 0';
    const into = centres[index + step]!;
    return `${into.x - own.x}px ${into.y - own.y}px`;
  });
}
