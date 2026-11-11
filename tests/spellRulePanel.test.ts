import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SpellRulePanel, type RuleReview } from '../src/board/spellRulePanel';

/** Just enough of the DOM for the panel: elements that hold children and listeners. */
class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly ownerDocument: FakeDocument) {}
  append(...nodes: FakeElement[]): void { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  addEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  fire(type: string, event: unknown = {}): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  all(): FakeElement[] { return [this, ...this.children.flatMap((child) => child.all())]; }
}
class FakeDocument { createElement(): FakeElement { return new FakeElement(this); } }

const review = (title: string, log: string[]): RuleReview => ({ title, lines: [], apply: 'Apply', run: () => log.push(`ran ${title}`), skip: () => log.push(`skipped ${title}`) });
const panelOf = () => {
  const root = new FakeElement(new FakeDocument());
  return { root, panel: new SpellRulePanel(root as unknown as HTMLElement), titles: () => root.all().filter((el) => el.className === 'atlas-tabletop-spellpicker__title').map((el) => el.textContent) };
};

test("a new cast's review dismisses the reviews of the cast before, as skipped", () => {
  const log: string[] = [];
  const { panel, titles } = panelOf();
  panel.offer(review('Thunderwave: push 10 ft', log), 'a');
  panel.offer(review('Misty Step: teleport', log), 'b');
  assert.deepEqual(titles(), ['Misty Step: teleport']);
  assert.deepEqual(log, ['skipped Thunderwave: push 10 ft']);
});

test("one cast's reviews wait their turn; dismiss takes them all; Escape on the panel too", () => {
  const log: string[] = [];
  const { root, panel, titles } = panelOf();
  panel.offer(review('Teleport', log), 'a');
  panel.offer(review('Push', log), 'a');
  assert.deepEqual(titles(), ['Teleport']);
  panel.dismiss();
  assert.equal(panel.showing, false);
  assert.deepEqual(titles(), []);
  assert.deepEqual(log, ['skipped Teleport', 'skipped Push']);
  panel.offer(review('Summon', log), 'c');
  root.children[0]!.fire('keydown', { key: 'Escape', stopPropagation: () => {}, preventDefault: () => {} });
  assert.equal(panel.showing, false);
  assert.deepEqual(log.at(-1), 'skipped Summon');
});

test('pendingFor says whether a review of a cast is showing or waiting', () => {
  const log: string[] = [];
  const { panel } = panelOf();
  panel.offer(review('Teleport', log), 'a');
  panel.offer(review('Push', log), 'a');
  assert.equal(panel.pendingFor('a'), true);
  assert.equal(panel.pendingFor('b'), false);
  panel.dismiss();
  assert.equal(panel.pendingFor('a'), false);
});
