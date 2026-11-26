/**
 * Tabletop's player board for a plain browser: Connect's join page loads this (as a chunk of its own) to draw the 3D
 * board for a player who joined from a browser, as Connect's player tab in Obsidian draws it with the Tabletop plugin.
 * three.js is left out: the page gives its own. On a phone the board draws at the low quality and starts lean on memory
 * (maps to 4096 pixels, other pictures to 1024, the screen's own resolution at most), a small phone leanest; a device that
 * ran out of memory with it (its page reloading) draws it leaner still, and one that died at the leanest opens on the 2D
 * map (`boardGaveOut`, `memoryGuard.ts`).
 */
import './webDom';
import { playerBoardFactory, type PlayerBoardFactory, type PlayerBoardHandle } from '../playerBoard';
import { vendoredPack } from '../dice/dicePack';
import { DEFAULT_DICE_SETTINGS } from '../dice/diceSettings';
import type { MemoryMode, Quality } from '../board/quality';
import { boardGaveOut, guardMemory } from './memoryGuard';
import { mountSoundControl, webSound } from './soundControl';
import { DEFAULT_SKY } from '../board/look';

export { deviceQuaternion, headingOf } from '../board/eyeView';

/** Whether this browser looks like a phone or tablet: a coarse pointer, or a small screen. */
function onPhone(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) < 700;
  } catch {
    return false;
  }
}

/** The player board, made for this browser. */
export function webPlayerBoard(quality: Quality = onPhone() ? 'low' : 'medium'): PlayerBoardFactory {
  const pack = vendoredPack();
  let memory: MemoryMode = 'normal';
  // The painted look, under its sky, as the GM's board has it by default; a board short of memory (a big sky picture,
  // 3072 by 1536) keeps the plain dark room.
  const sound = webSound();
  const factory = playerBoardFactory(() => quality, () => ({ tiltShift: false, occlusion: false, painted: memory === 'normal', sky: DEFAULT_SKY }), { settings: () => DEFAULT_DICE_SETTINGS, pack: () => pack }, () => null, () => memory, sound);
  return Object.freeze({
    ...factory,
    create: (parent: HTMLElement, host: Parameters<PlayerBoardFactory['create']>[1]): PlayerBoardHandle => {
      // Each board marks itself running while it is up; the mode is read from the marks the last ones left.
      const guard = guardMemory(window, onPhone());
      memory = guard.mode;
      const handle = factory.create(parent, host);
      const unmount = mountSoundControl(parent, sound);
      const dispose = handle.dispose.bind(handle);
      handle.dispose = () => { guard.stop(); unmount(); dispose(); };
      return handle;
    },
  });
}

/** Whether the board died in this browser even drawn its leanest: the page opens on the 2D map, and 3D waits for the player. */
export function boardDiedLeanest(): boolean {
  return boardGaveOut(window, onPhone());
}
