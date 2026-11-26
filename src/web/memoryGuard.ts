/**
 * Keeping the web player board within an old tablet's memory. Safari gives a page no reading of its memory: when the
 * 3D board fills it, the tab is killed and the page loads again, and again. So the board marks itself running while it
 * is up, and clears the mark when the page is left (`pagehide`, hidden) or the board closes; a mark found at the next
 * load means the last one died. Each such death draws the board leaner (`MemoryMode`): smaller textures, a lower
 * resolution, then no layers. Three days without one, it draws as usual again. A phone, or a device with two cores or
 * less (an old iPad mini) or that says it has 2 GB or less, starts lean; a small phone (four cores or less, or 4 GB or
 * less where it says) starts leanest. A board that died even at the leanest is not started again by itself: the page
 * opens on the 2D map (`boardGaveOut`) and the player chooses 3D.
 */
import type { MemoryMode } from '../board/quality';

export interface MemoryMark {
  /** The board was up and the page not left since. */
  running: boolean;
  /** Deaths counted, and when the last one was found (ms). */
  crashes: number;
  last: number;
}

export const MEMORY_KEY = 'atlas-tabletop-board-memory';
const FORGET_AFTER = 3 * 24 * 60 * 60 * 1000;
const MODES: readonly MemoryMode[] = ['normal', 'lean', 'leanest'];

/** The mode a board starts in, and the mark it leaves while it runs; `floor` is the device's own (`deviceFloor`), in steps leaner. */
export function startMemory(mark: MemoryMark | null, now: number, floor: number): { mode: MemoryMode; mark: MemoryMark } {
  let crashes = mark?.crashes ?? 0;
  let last = mark?.last ?? 0;
  if (mark?.running) {
    crashes += 1;
    last = now;
  } else if (crashes > 0 && now - last > FORGET_AFTER) {
    crashes = 0;
  }
  const level = Math.min(MODES.length - 1, crashes + floor);
  return { mode: MODES[level], mark: { running: true, crashes, last } };
}

export function readMark(raw: string | null): MemoryMark | null {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<MemoryMark> | null;
    if (!value || typeof value !== 'object') return null;
    return { running: value.running === true, crashes: Number.isFinite(value.crashes) ? Math.max(0, Math.min(10, Number(value.crashes))) : 0, last: Number.isFinite(value.last) ? Number(value.last) : 0 };
  } catch {
    return null;
  }
}

/** Whether this browser is an old, small device: two cores or less, or 2 GB or less where it says. */
export function oldDevice(nav: DeviceNavigator | undefined): boolean {
  if (!nav) return false;
  const cores = nav.hardwareConcurrency;
  const memory = nav.deviceMemory;
  return (typeof cores === 'number' && cores > 0 && cores <= 2) || (typeof memory === 'number' && memory > 0 && memory <= 2);
}

type DeviceNavigator = { hardwareConcurrency?: number; deviceMemory?: number };

/**
 * How many steps leaner than usual a board starts on this device: none on a computer; one on a phone or an old, small
 * device; two on a small phone (four cores or less, or 4 GB or less where the browser says).
 */
export function deviceFloor(nav: DeviceNavigator | undefined, phone: boolean): number {
  const old = oldDevice(nav);
  if (!phone) return old ? 1 : 0;
  const cores = nav?.hardwareConcurrency;
  const memory = nav?.deviceMemory;
  const small = (typeof cores === 'number' && cores > 0 && cores <= 4) || (typeof memory === 'number' && memory > 0 && memory <= 4);
  return old || small ? 2 : 1;
}

/** Whether the last board in this browser died while it was already drawn the leanest: the page should not start another by itself. */
export function gaveOut(mark: MemoryMark | null, floor: number): boolean {
  return mark?.running === true && Math.min(MODES.length - 1, mark.crashes + floor) >= MODES.length - 1;
}

function storageOf(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

function readStored(storage: Storage | null): MemoryMark | null {
  let raw: string | null = null;
  try { raw = storage?.getItem(MEMORY_KEY) ?? null; } catch { raw = null; }
  return readMark(raw);
}

/** `gaveOut` for this browser: the last board died even at the leanest (and was not left cleanly since). */
export function boardGaveOut(win: Window, phone: boolean): boolean {
  return gaveOut(readStored(storageOf(win)), deviceFloor(win.navigator as Navigator & DeviceNavigator, phone));
}

/**
 * The mode for a board starting now in this page, its mark set; `stop` clears the mark (the board closed). Storage
 * that throws (a private window) leaves the mode to the device alone.
 */
export function guardMemory(win: Window, phone = false): { mode: MemoryMode; stop: () => void } {
  const storage = storageOf(win);
  const write = (mark: MemoryMark): void => {
    try { storage?.setItem(MEMORY_KEY, JSON.stringify(mark)); } catch { /* full or blocked: no mark kept */ }
  };
  const start = startMemory(readStored(storage), Date.now(), deviceFloor(win.navigator as Navigator & DeviceNavigator, phone));
  let mark = start.mark;
  write(mark);
  const left = (): void => { mark = { ...mark, running: false }; write(mark); };
  const back = (): void => { mark = { ...mark, running: true }; write(mark); };
  const visibility = (): void => { if (win.document.visibilityState === 'hidden') left(); else back(); };
  win.addEventListener('pagehide', left);
  win.addEventListener('pageshow', back);
  win.document.addEventListener('visibilitychange', visibility);
  if (start.mode !== 'normal') console.info(`Tabletop: drawing the board ${start.mode} on memory (${mark.crashes} reload${mark.crashes === 1 ? '' : 's'} seen).`);
  return {
    mode: start.mode,
    stop: () => {
      left();
      win.removeEventListener('pagehide', left);
      win.removeEventListener('pageshow', back);
      win.document.removeEventListener('visibilitychange', visibility);
    },
  };
}
