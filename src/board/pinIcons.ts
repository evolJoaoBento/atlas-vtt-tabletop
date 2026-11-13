/**
 * How a pin looks, read as Atlas reads it: its colour and glyph by icon id (unknown ids are plain pins, the Lucide ids
 * older pins store are mapped to today's icons), and the title the board floats over it.
 */
import { DEFAULT_PIN_ICON, PIN_GLYPHS, PIN_TONES, resolvePinIcon } from './pinIconData';
import type { BoardPin } from './mapModel';

/** Pins that show their label instead of a glyph. */
const LABEL_KINDS = new Set(['number', 'letter']);
const DEFAULT_ICON = DEFAULT_PIN_ICON;

/** Atlas's own rule, for an icon that is not a label kind. */
const resolve = (icon: string): string => resolvePinIcon(icon);

/** The pin's colour (Atlas's dark-theme tone). Label pins take the default pin's. */
export function pinTone(icon: string): string {
  return PIN_TONES[resolve(icon)] ?? PIN_TONES[DEFAULT_ICON];
}

/** The glyph's SVG path on a 512 × 512 canvas, or null for a pin that shows its label. */
export function pinGlyph(icon: string): string | null {
  if (LABEL_KINDS.has(icon)) return null;
  return PIN_GLYPHS[resolve(icon)] ?? null;
}

/**
 * The name floated over a pin on the map, as Connect sends it to players: only where the pin has "show name" on
 * (Atlas 0.14), and then the GM's name, else its note's. A label alone is never floated.
 */
export function pinShownName(pin: Pick<BoardPin, 'notePath' | 'label' | 'name' | 'showName'>): string {
  if (pin.showName !== true) return '';
  return pinTitle({ ...pin, label: null });
}

/** The title over a pin: the note's heading when it links to one, else the note's name, else the pin's label. */
export function pinTitle(pin: Pick<BoardPin, 'notePath' | 'label' | 'name'>): string {
  // Atlas 0.14: the name the GM gave the pin, else its note's.
  if (pin.name) return pin.name;
  if (pin.notePath) {
    const [file, heading] = pin.notePath.split('#', 2);
    if (heading) return heading;
    const name = file.split('/').pop()!.replace(/\.[^.]+$/, '');
    if (name) return name;
  }
  return pin.label ?? '';
}
