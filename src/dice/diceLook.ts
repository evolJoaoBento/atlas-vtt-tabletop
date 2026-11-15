/**
 * The dice's colours are Atlas's (fusion 4E): its global dice look (`diceColour`, read with `getDiceLook`) and the
 * colours a dice set gives its groups. Tabletop keeps its 3D pack, whose faces carry the numerals, so `diceFont` does
 * not reach them; only the body colour follows Atlas.
 */
import { DEFAULT_DICE_LOOK, DICE_SET_COLOURS, isDiceColour, isDiceFont, isDieColour, parseHex, type DiceLook } from '../../packages/atlas-shared/src/index';

/** The body of Atlas's dark dice (`dieSkin.ts`, which Atlas keeps to itself: it paints canvases). */
const DARK_BODY = '#1f1e21';
/** Obsidian's default accent, for a theme that reports none (Atlas's `FALLBACK_ACCENT`). */
const FALLBACK_ACCENT = '#8a5cf5';

/** Atlas's dice look as its settings hold it; anything else is Atlas's default. */
export function readDiceLook(raw: unknown): DiceLook {
  const look = (typeof raw === 'object' && raw !== null ? raw : {}) as { colour?: unknown; font?: unknown };
  return { colour: isDiceColour(look.colour) ? look.colour : DEFAULT_DICE_LOOK.colour, font: isDiceFont(look.font) ? look.font : DEFAULT_DICE_LOOK.font };
}

/**
 * The body colour of a die the look alone decides, as Atlas resolves it: none for light dice (the pack's own colour
 * stays), Atlas's dark body, or the theme's accent (`accent`, '#rrggbb'; Obsidian's default where the theme gives none).
 */
export function lookBody(look: DiceLook, accent: string | null): string | null {
  if (look.colour === 'dark') return DARK_BODY;
  if (look.colour === 'accent') return accent !== null && parseHex(accent) !== null ? accent.toLowerCase() : FALLBACK_ACCENT;
  return null;
}

/** A die's body: its dice set group's colour where it has one, else the look's. */
export function dieBody(group: unknown, look: DiceLook, accent: string | null): string | null {
  return isDieColour(group) ? group : lookBody(look, accent);
}

/** The theme's accent (`--interactive-accent`, as the document resolves it) as '#rrggbb'; null where it reads as none. */
export function themeAccent(doc: Document): string | null {
  const probe = doc.createElement('span');
  probe.style.color = 'var(--interactive-accent)';
  probe.style.display = 'none';
  doc.body.append(probe);
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(doc.defaultView?.getComputedStyle(probe).color ?? '');
  probe.remove();
  return rgb ? `#${rgb.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}` : null;
}

/** The colours the picker offers: Atlas's dice set colours, named as Atlas names them. */
export const DIE_COLOURS: ReadonlyArray<{ name: string; color: string }> = DICE_SET_COLOURS.map(({ value, label }) => ({ name: label, color: value }));
