import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hoverPosition, StatblockHoverCard } from '../src/sheets/hoverCard';
import type { CardHost } from '../src/sheets/atlasCard';

const VIEW = { width: 1000, height: 700 };

test("the card is placed as Atlas places its own: beside the pointer, flipped where it would leave the window, then clamped", () => {
  const size = { width: 400, height: 300 };
  assert.deepEqual(hoverPosition({ x: 100, y: 200 }, size, VIEW), { left: 115, top: 215, maxHeight: 660 });
  assert.equal(hoverPosition({ x: 800, y: 200 }, size, VIEW).left, 385, 'left of the pointer: 800 - 400 - 15');
  assert.equal(hoverPosition({ x: 100, y: 600 }, size, VIEW).top, 285, 'above the pointer: 600 - 300 - 15');
  // Neither side has room: against the far edge, never out of the window.
  assert.equal(hoverPosition({ x: 200, y: 200 }, { width: 900, height: 100 }, VIEW).left, 80, '1000 - 900 - 20');
  assert.equal(hoverPosition({ x: 200, y: 50 }, { width: 100, height: 690 }, VIEW).top, 20, 'not above the window');
  assert.equal(hoverPosition({ x: 5, y: 5 }, { width: 100, height: 100 }, VIEW).left, 20);
});

class Box {
  className = '';
  removed = false;
  styles: Record<string, string> = {};
  children: Box[] = [];
  append(...kids: Box[]): void { this.children.push(...kids); }
  remove(): void { this.removed = true; }
  replaceChildren(...kids: Box[]): void { this.children = kids; }
  querySelector(selector: string): Box | null { return this.children.find((child) => child.className.split(' ').includes(selector.slice(1))) ?? null; }
  querySelectorAll(): Box[] { return []; }
  getBoundingClientRect() { return { width: 300, height: 200 }; }
  setCssStyles(styles: Record<string, string>): void { this.styles = styles; }
  attributes: Record<string, string> = {};
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(): void {}
  removeEventListener(): void {}
}

function setup() {
  const body = new Box();
  const timers: Array<() => void> = [];
  const keyups: Array<(event: { key: string }) => void> = [];
  const win = {
    innerWidth: 1000, innerHeight: 700,
    createDiv: () => new Box(),
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => {},
    addEventListener: (_type: string, fn: (event: { key: string }) => void) => keyups.push(fn),
    removeEventListener: () => {},
  };
  const doc = { body, defaultView: win } as unknown as Document;
  const released: string[] = [];
  const card = new StatblockHoverCard(doc, () => {}, () => released.push('released'), async () => {});
  const host = (draws: boolean, log: string[] = []): CardHost => ({
    render: async (into) => {
      if (!draws) return;
      const made = new Box();
      made.className = 'atlas-statblock';
      (into as unknown as Box).append(made);
    },
    dispose: () => { log.push('disposed'); },
  });
  return { body, card, host, timers, release: () => keyups.forEach((fn) => fn({ key: 'Control' })), released };
}

test("Atlas's card opens by the pointer, and letting go of Ctrl closes it after its fade", async () => {
  const t = setup();
  const log: string[] = [];
  await t.card.show(t.host(true, log), { x: 100, y: 350 }, () => assert.fail('a card was drawn'));
  const box = t.body.children[0]!;
  assert.equal(box.className, 'atlas-statblock-preview-window', "Atlas's own classes: its surface and fade");
  assert.equal(box.attributes['data-tabletop-card'], 'true', "marked as this card's own, so the page-wide routing of Atlas's window leaves it");
  assert.deepEqual(box.styles, { left: '115px', top: '365px', maxHeight: '660px' });
  t.release();
  assert.equal(box.className, 'atlas-statblock-preview-window atlas-statblock-preview-window--closing');
  assert.deepEqual(t.released, ['released'], 'the board is told, so Ctrl pressed again opens the card again');
  assert.equal(box.removed, false);
  t.timers.forEach((fn) => fn());
  assert.equal(box.removed, true);
  assert.deepEqual(log, ['disposed']);
});

test('an Atlas that draws no card runs the fallback and leaves nothing behind', async () => {
  const t = setup();
  const log: string[] = [];
  let fell = 0;
  await t.card.show(t.host(false, log), { x: 10, y: 10 }, () => { fell += 1; });
  assert.equal(fell, 1);
  assert.equal(t.body.children[0]!.removed, true);
  assert.deepEqual(log, ['disposed']);
});

test("another token's card takes the place of the one before, and one still being drawn never lands", async () => {
  const t = setup();
  const first: string[] = [];
  const second: string[] = [];
  await t.card.show(t.host(true, first), { x: 10, y: 10 }, () => {});
  await t.card.show(t.host(true, second), { x: 20, y: 20 }, () => {});
  assert.equal(t.body.children[0]!.removed, true);
  assert.deepEqual(first, ['disposed']);
  assert.equal(t.body.children[1]!.removed, false);
  // Hidden while the second is still being drawn: the draw is dropped when it finishes.
  const slow = t.card.show(t.host(true, second), { x: 30, y: 30 }, () => assert.fail('dropped'));
  t.card.hide();
  await slow;
  assert.equal(t.body.children[2]!.removed, true);
});

test("Atlas's own window is closed with the card's rules: Ctrl let go, another token, hide", async () => {
  const t = setup();
  const closed: string[] = [];
  t.card.adopt(() => closed.push('atlas'));
  t.release();
  assert.deepEqual(closed, ['atlas']);
  assert.deepEqual(t.released, ['released'], 'the board is told, so Ctrl pressed again opens it again');
  t.release();
  assert.deepEqual(closed, ['atlas'], 'closed once');
  // Another token's card (drawn here) takes Atlas's window away first.
  t.card.adopt(() => closed.push('atlas again'));
  await t.card.show(t.host(true), { x: 10, y: 10 }, () => {});
  assert.deepEqual(closed, ['atlas', 'atlas again']);
  // Hiding closes it too.
  t.card.adopt(() => closed.push('third'));
  t.card.hide();
  assert.equal(closed.at(-1), 'third');
});
