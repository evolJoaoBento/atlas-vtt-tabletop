/**
 * Presses on the thrower's dice, taken before the board's own handling: a press on a die the roll waits on (caught on
 * an edge) is the dice's, anything else the board's. Let go, the die is thrown the way the pointer went over its last
 * stretch; a click tosses it gently. Shared by the GM's board and a Connect player's.
 */
import { DRAG_PX, FLICK_MS, GENTLE, type Flick } from './throwInput';

export interface DiePressDeps {
  /** The board's root: presses are taken here first. */
  container: HTMLElement;
  /** The board's canvas: a press on anything else (a button, a panel) is never the dice's. */
  canvas(): EventTarget;
  /** The throw a press on the die under the pointer makes once let go; null when the press is not the dice's. */
  pickUp(clientX: number, clientY: number): ((flick: Flick) => void) | null;
}

/** Listens until the returned function is called, which also lets go of a press in progress, unthrown. */
export function listenForDiePresses(deps: DiePressDeps): () => void {
  const { container } = deps;
  const win = container.ownerDocument.defaultView ?? window;
  let pressing: (() => void) | null = null;
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || event.target !== deps.canvas()) return;
    const release = deps.pickUp(event.clientX, event.clientY);
    if (!release) return;
    event.stopPropagation();
    event.preventDefault();
    pressing?.();
    const samples = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
    const move = (moved: PointerEvent): void => {
      if (moved.pointerId !== event.pointerId) return;
      samples.push({ x: moved.clientX, y: moved.clientY, t: moved.timeStamp });
      if (samples.length > 32) samples.shift();
    };
    const up = (lifted: PointerEvent): void => {
      if (lifted.pointerId !== event.pointerId) return;
      stop();
      const last = { x: lifted.clientX, y: lifted.clientY, t: lifted.timeStamp };
      const dragged = Math.hypot(last.x - event.clientX, last.y - event.clientY) > DRAG_PX;
      const from = samples.find((sample) => last.t - sample.t <= FLICK_MS) ?? last;
      release(dragged ? { dx: last.x - from.x, dy: last.y - from.y, ms: Math.max(1, last.t - from.t) } : GENTLE);
    };
    const stop = (): void => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('pointercancel', stop, true);
      if (pressing === stop) pressing = null;
    };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', stop, true);
    pressing = stop;
  };
  container.addEventListener('pointerdown', down, true);
  return () => {
    container.removeEventListener('pointerdown', down, true);
    pressing?.();
  };
}
