/**
 * Presses on the thrower's dice, taken before the board's own handling: a press on a die at rest is the dice's,
 * anything else the board's. The die (with Ctrl, every die at rest, bundled round it) is carried under the pointer
 * while it is held, and let go, it is thrown the way the pointer went over its last stretch; a click tosses it gently.
 * Shared by the GM's board and a Connect player's.
 */
import { DRAG_PX, FLICK_MS, GENTLE, type Flick } from './throwInput';

/** A die (or a bundle) in hand: carried while the pointer moves, thrown when it is let go. */
export interface PressedDie {
  move(clientX: number, clientY: number): void;
  release(flick: Flick): void;
}

export interface DiePressDeps {
  /** The board's root: presses are taken here first. */
  container: HTMLElement;
  /** The board's canvas: a press on anything else (a button, a panel) is never the dice's. */
  canvas(): EventTarget;
  /** The die under the pointer picked up (`all`: Ctrl held, every die at rest with it); null when the press is not the dice's. */
  pickUp(clientX: number, clientY: number, all: boolean): PressedDie | null;
}

/** Listens until the returned function is called, which also lets go of a press in progress, unthrown. */
export function listenForDiePresses(deps: DiePressDeps): () => void {
  const { container } = deps;
  const win = container.ownerDocument.defaultView ?? window;
  let pressing: (() => void) | null = null;
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || event.target !== deps.canvas()) return;
    const all = event.ctrlKey === true || event.metaKey === true;
    const grabbed = deps.pickUp(event.clientX, event.clientY, all);
    if (!grabbed) return;
    event.stopPropagation();
    event.preventDefault();
    pressing?.();
    const samples = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
    let carried = false;
    const move = (moved: PointerEvent): void => {
      if (moved.pointerId !== event.pointerId) return;
      samples.push({ x: moved.clientX, y: moved.clientY, t: moved.timeStamp });
      if (samples.length > 32) samples.shift();
      // Carried once it is dragged: a click leaves it where it lies until the gentle toss (a bundle is gathered at once).
      if (!carried && !all && Math.hypot(moved.clientX - event.clientX, moved.clientY - event.clientY) <= DRAG_PX) return;
      carried = true;
      grabbed.move(moved.clientX, moved.clientY);
    };
    const up = (lifted: PointerEvent): void => {
      if (lifted.pointerId !== event.pointerId) return;
      stop();
      const last = { x: lifted.clientX, y: lifted.clientY, t: lifted.timeStamp };
      const dragged = Math.hypot(last.x - event.clientX, last.y - event.clientY) > DRAG_PX;
      const from = samples.find((sample) => last.t - sample.t <= FLICK_MS) ?? last;
      grabbed.release(dragged ? { dx: last.x - from.x, dy: last.y - from.y, ms: Math.max(1, last.t - from.t) } : GENTLE);
    };
    const stop = (): void => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('pointercancel', cancel, true);
      if (pressing === stop) pressing = null;
    };
    // The pointer went (the window lost it): a die in hand is let fall, not left hanging over the table.
    const cancel = (): void => {
      stop();
      if (carried) grabbed.release(GENTLE);
    };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', cancel, true);
    pressing = stop;
  };
  container.addEventListener('pointerdown', down, true);
  return () => {
    container.removeEventListener('pointerdown', down, true);
    pressing?.();
  };
}
