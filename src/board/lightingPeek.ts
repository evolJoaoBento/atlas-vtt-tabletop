/**
 * Atlas's lighting peek on the board: the `lightingPeek` key (H) held shows the map as the players see it, the GM view switch
 * unmoved; on a touch screen, which has no key to hold, a button of the bar's end (`PeekButton.tsx`) holds it. Pure.
 */
import type { BoardMode } from './toolbar';

export type PointerKind = 'fine' | 'coarse';

/**
 * Atlas's `pointerKindOf` (`platform/deviceProfile.ts`): a coarse primary pointer is a finger. On a mobile device a fine one
 * counts only where it hovers (a mouse or trackpad): a pen as the primary pointer still shares the screen with fingers.
 */
export function pointerKindOf(isMobile: boolean, coarse: boolean | null, mouse: boolean): PointerKind {
  if (coarse === true) return 'coarse';
  return isMobile && !mouse ? 'coarse' : 'fine';
}

/** Atlas's media queries for the pointer (`mediaPointerSource`). */
const COARSE_QUERY = '(pointer: coarse)';
const MOUSE_QUERY = '(pointer: fine) and (hover: hover)';

/** The pointer as `win`'s media queries tell it; a window without them cannot be asked. */
export function pointerNow(win: Pick<Window, 'matchMedia'> | undefined, isMobile: boolean): PointerKind {
  if (typeof win?.matchMedia !== 'function') return pointerKindOf(isMobile, null, false);
  return pointerKindOf(isMobile, win.matchMedia(COARSE_QUERY).matches, win.matchMedia(MOUSE_QUERY).matches);
}

/** What the peek button is in the bar now. */
export interface PeekButtonState {
  /** Offered at all: a finger, the GM's Play or Edit mode (where the GM view switch is), a board that has the peek. */
  shown: boolean;
  /** In session view the map shows the players' picture already: the button takes no press (Atlas's `aria-disabled`). */
  disabled: boolean;
  /** Held down (Atlas's `aria-pressed` and `is-active`). */
  pressed: boolean;
}

export function peekButtonState(on: { coarse: boolean; mode: BoardMode | null; hasPeek: boolean; gmView: boolean; held: boolean }): PeekButtonState {
  const shown = on.coarse && on.hasPeek && (on.mode === 'play' || on.mode === 'edit');
  return { shown, disabled: !on.gmView, pressed: on.gmView && on.held };
}
