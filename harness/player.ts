/**
 * Browser harness for the players' minis (`playerMinis.ts`): draws a GLB the way Connect's player view asks for it and
 * reports what came out, on `window.result`. Not shipped.
 */
import { playerMiniPainter, type PlayerMiniEntry } from '../src/playerMinis';
import { makeRichGlb } from './richGlb';

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Opaque pixels of `canvas` and their centre, read through a 2D canvas. */
function inked(canvas: HTMLCanvasElement): { count: number; cx: number; cy: number } {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const g = copy.getContext('2d')!;
  g.drawImage(canvas, 0, 0);
  const data = g.getImageData(0, 0, copy.width, copy.height).data;
  let count = 0, sx = 0, sy = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 16) continue;
    const p = (i - 3) / 4;
    count++; sx += p % copy.width; sy += Math.floor(p / copy.width);
  }
  return { count, cx: count ? sx / count : -1, cy: count ? sy / count : -1 };
}

async function main(): Promise<void> {
  const glb = await makeRichGlb();
  const { painter, dispose } = playerMiniPainter();
  let loads = 0;
  const view = painter.create(document.createElement('canvas'), () => { loads++; });
  // A 1000 x 500 world area, one world unit to a device pixel; a token of 100 units at (250, 250).
  const area = { x: 0, y: 0, width: 1000, height: 500 };
  const entry: PlayerMiniEntry = { id: 't', asset: 'A', x: 250, y: 250, size: 100, rotation: 0, turn: 0, scale: 1 };
  const models = (asset: string): ArrayBuffer | null => (asset === 'A' ? glb : null);
  const first = view.frame([entry], models, area, 1, 1, 16);
  const readingAnimates = view.animating();
  for (let i = 0; i < 100 && loads === 0; i++) await wait(20);
  const still = view.frame([entry], models, area, 1, 1, 16);
  const atRest = still ? inked(still) : null;
  const size = still ? [still.width, still.height] : null;
  // Moves right fast: it leans and keeps drawing.
  let moved = null;
  for (let i = 1; i <= 6; i++) moved = view.frame([{ ...entry, x: 250 + i * 20 }], models, area, 1, 1, 16);
  const movingAnimates = view.animating();
  const atMove = moved ? inked(moved) : null;
  view.shake('t');
  const shaking = view.animating();
  const gone = view.frame([], models, area, 1, 1, 16);
  dispose();
  const afterDispose = view.frame([entry], models, area, 1, 1, 16);
  Object.assign(window, { result: { first, readingAnimates, loads, size, atRest, movingAnimates, atMove, shaking, gone, afterDispose } });
}

main().catch((error) => { Object.assign(window, { result: { error: String(error) } }); });
