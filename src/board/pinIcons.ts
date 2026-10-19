/**
 * How a pin looks, read as Atlas reads it: its colour and glyph by icon id (unknown ids are plain pins, the Lucide ids
 * older pins store are mapped to today's icons), and the title the board floats over it.
 */
import { PIN_GLYPHS, PIN_LEGACY, PIN_TONES } from './pinIconData';
import type { BoardPin } from './mapModel';

/** Pins that show their label instead of a glyph. */
const LABEL_KINDS = new Set(['number', 'letter']);
const DEFAULT_ICON = 'pin';

function resolve(icon: string): string {
  if (icon in PIN_GLYPHS) return icon;
  return PIN_LEGACY[icon] ?? DEFAULT_ICON;
}

/** The pin's colour (Atlas's dark-theme tone). Label pins take the default pin's. */
export function pinTone(icon: string): string {
  return PIN_TONES[resolve(icon)] ?? PIN_TONES[DEFAULT_ICON]!;
}

/** The glyph's SVG path on a 512 × 512 canvas, or null for a pin that shows its label. */
export function pinGlyph(icon: string): string | null {
  if (LABEL_KINDS.has(icon)) return null;
  return PIN_GLYPHS[resolve(icon)] ?? null;
}

/** The title over a pin: the note's heading when it links to one, else the note's name, else the pin's label. */
export function pinTitle(pin: Pick<BoardPin, 'notePath' | 'label'>): string {
  if (pin.notePath) {
    const [file, heading] = pin.notePath.split('#', 2);
    if (heading) return heading;
    const name = file!.split('/').pop()!.replace(/\.[^.]+$/, '');
    if (name) return name;
  }
  return pin.label ?? '';
}
