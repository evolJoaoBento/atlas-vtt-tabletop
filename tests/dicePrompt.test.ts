import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DicePrompt, NOTICE_MS } from '../src/dice/dicePrompt';

/** Just enough of a DOM for the line: elements with children, classes and listeners; timers that run when told. */
class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  type = '';
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly ownerDocument: FakeDocument) {}
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  appendChild(child: FakeElement): FakeElement { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  append(...kids: FakeElement[]): void { for (const kid of kids) this.appendChild(kid); }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; }
  addEventListener(type: string, fn: (event: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  fire(type: string, event: unknown = { stopPropagation: () => {} }): void { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  find(className: string): FakeElement { return [this, ...this.children.flatMap((child) => [child, ...child.children])].find((el) => el.className === className)!; }
}

class FakeDocument extends FakeElement {
  timers = new Map<number, { at: number; fn: () => void }>();
  now = 0;
  next = 1;
  defaultView = {
    setTimeout: (fn: () => void, ms: number): number => { const id = this.next++; this.timers.set(id, { at: this.now + ms, fn }); return id; },
    clearTimeout: (id: number): void => { this.timers.delete(id); },
  };
  constructor() { super(null as unknown as FakeDocument); }
  createElement(): FakeElement { return new FakeElement(this); }
  tick(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) if (timer.at <= this.now) { this.timers.delete(id); timer.fn(); }
  }
}

function line() {
  const doc = new FakeDocument();
  const container = new FakeElement(doc);
  let thrown = 0;
  const prompt = new DicePrompt(container as unknown as HTMLElement, () => { thrown++; });
  const root = container.children[0];
  return { doc, container, prompt, root, text: root.find('atlas-tabletop-dice-prompt__text'), button: root.find('atlas-tabletop-dice-prompt__throw'), thrown: () => thrown };
}

test('the line says what the roll waits on, with a Throw that throws it; null hides it', () => {
  const { prompt, root, text, button, thrown } = line();
  assert.equal(root.className, 'atlas-tabletop-dice-prompt');
  assert.equal(root.hidden, true);
  prompt.show('d10 exploded: throw another d10');
  assert.equal(root.hidden, false);
  assert.equal(text.textContent, 'd10 exploded: throw another d10');
  assert.equal(button.hidden, false);
  button.fire('click');
  assert.equal(thrown(), 1);
  prompt.show(null);
  assert.equal(root.hidden, true);
});

test('a notice has no Throw and goes by itself; the next line takes its place at once', () => {
  const { doc, prompt, root, text, button } = line();
  prompt.notice("Couldn't send the roll to the GM.");
  assert.equal(root.hidden, false);
  assert.equal(button.hidden, true);
  assert.equal(text.textContent, "Couldn't send the roll to the GM.");
  doc.tick(NOTICE_MS - 1);
  assert.equal(root.hidden, false);
  doc.tick(1);
  assert.equal(root.hidden, true);
  assert.equal(doc.timers.size, 0);
  prompt.notice('again');
  prompt.show('d20 caught');
  assert.equal(doc.timers.size, 0, 'the notice timer goes with it');
  assert.equal(button.hidden, false);
  doc.tick(NOTICE_MS);
  assert.equal(root.hidden, false, 'the line about the roll stays');
});

test('a press on the line is not the board\'s', () => {
  const { root } = line();
  let stopped = false;
  root.fire('pointerdown', { stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
});

test('dispose takes the line away and its timer with it', () => {
  const { doc, container, prompt } = line();
  prompt.notice('gone soon');
  prompt.dispose();
  assert.equal(container.children.length, 0);
  assert.equal(doc.timers.size, 0);
});
