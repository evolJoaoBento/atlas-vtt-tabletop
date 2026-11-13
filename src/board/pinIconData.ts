/**
 * Atlas's pin icons, so a pin on the board looks like the same pin on Atlas's map: each icon's colour (Atlas's
 * dark-theme tone) and its glyph. The glyphs are game-icons.net silhouettes (CC BY 3.0, credited in the README) on a
 * 512 × 512 canvas. Nothing is copied here: the glyphs, the tones and the old Lucide ids Atlas still reads are Atlas's
 * own files (`packages/atlas-shared`: `types/pinIconPaths.ts`, `types/pinIcons.ts`).
 */
import { pinIcons } from '../../packages/atlas-shared/src/index';

/** Icon id → the glyph's SVG path. */
export const PIN_GLYPHS: Readonly<Record<string, string>> = pinIcons.PIN_ICON_PATHS;

/** Icon id → colour. An icon Atlas offers nowhere has none, and takes the default pin's. */
export const PIN_TONES: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  (Object.keys(pinIcons.PIN_ICON_PATHS) as pinIcons.PinIconId[]).flatMap((id) => {
    try {
      return [[id, pinIcons.getPinIconDefinition(id).tone.dark] as const];
    } catch {
      return [];
    }
  }),
));

export const DEFAULT_PIN_ICON: string = pinIcons.DEFAULT_PIN_ICON;

/**
 * The icon a stored one reads as, by Atlas's rule (`resolvePinIcon`: an unknown id is the plain pin, the Lucide ids
 * older pins store are today's icons). A label pin (`number`, `letter`) is given back as it is. What is stored comes
 * from a map file, so a name every object has (`constructor`) reads as none.
 */
export function resolvePinIcon(stored: string): string {
  return pinIcons.resolvePinIcon(stored in Object.prototype ? undefined : stored);
}
