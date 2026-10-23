import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiceLogPanel, LOG_LIMIT, MAX_SHOWN_DICE, MAX_TOASTS, TOAST_MS, logEntryOf, withEntry, type LogEntry } from '../src/board/diceLog';

const roll = (extra: object = {}) => ({
  id: 'r1',
  timestamp: 1700000000000,
  formula: '2d6+3',
  rolls: [
    { die: 'd6', value: 4, max: 6, min: 1, colour: '#ff0000', name: 'Red' },
    { die: 'd6', value: 2, max: 6, min: 1, dropped: true },
  ],
  modifiers: 3,
  total: 7,
  player: 'Tabletop for Atlas VTT',
  source: { type: 'toolbar' },
  ...extra,
});

test('logEntryOf reads a toolbar roll: the GM, no label, the dice with their colour and set-aside flag', () => {
  assert.deepEqual(logEntryOf(roll()), {
    id: 'r1',
    who: 'GM',
    formula: '2d6+3',
    dice: [{ die: 'd6', value: 4, colour: '#ff0000' }, { die: 'd6', value: 2, dropped: true }],
    total: 7,
    time: 1700000000000,
  });
});

test('logEntryOf reads who rolled and the statblock ability as the label', () => {
  const entry = logEntryOf(roll({ rolledBy: 'Anna', source: { type: 'statblock', abilityName: 'Longsword', tokenId: 't1' } }));
  assert.equal(entry?.who, 'Anna');
  assert.equal(entry?.label, 'Longsword');
});

// Connect publishes a player's physical sheet roll as a toolbar roll that names the ability and the token.
test('logEntryOf reads the ability as the label from any source type', () => {
  const entry = logEntryOf(roll({ rolledBy: 'Bea', source: { type: 'toolbar', tokenName: 'Bea', abilityName: 'Stealth' } }));
  assert.equal(entry?.label, 'Stealth');
  assert.equal(logEntryOf(roll({ source: { type: 'toolbar', abilityName: '  ' } }))?.label, undefined, 'a blank ability is no label');
  assert.equal(logEntryOf(roll({ source: { type: 'toolbar', abilityName: 7 } }))?.label, undefined, 'nor is a number');
});

test('logEntryOf reads a critical as Atlas logs it, and tolerates success and failure', () => {
  assert.equal(logEntryOf(roll({ crit: 'high' }))?.crit, 'success');
  assert.equal(logEntryOf(roll({ crit: 'low' }))?.crit, 'failure');
  assert.equal(logEntryOf(roll({ crit: 'success' }))?.crit, 'success');
  assert.equal(logEntryOf(roll({ crit: 'failure' }))?.crit, 'failure');
  assert.equal(logEntryOf(roll({ crit: 'maybe' }))?.crit, undefined);
  assert.equal(logEntryOf(roll())?.crit, undefined);
});

test('logEntryOf gives a roll without an id or a time one of its own, and a blank roller the GM', () => {
  const entry = logEntryOf(roll({ id: undefined, timestamp: undefined, rolledBy: '  ' }));
  assert.ok(entry && entry.id !== '' && Number.isFinite(entry.time));
  assert.equal(entry.who, 'GM');
});

test('logEntryOf returns null for garbage', () => {
  for (const bad of [null, undefined, 5, 'roll', [], {}, roll({ total: 'x' }), roll({ total: NaN }), roll({ formula: 3 }), roll({ rolls: [] }), roll({ rolls: 'd6' }), roll({ rolls: [{ die: 'd6' }] }), roll({ rolls: [null] }), roll({ rolls: [{ die: 6, value: 1 }, null] })]) {
    assert.equal(logEntryOf(bad), null, JSON.stringify(bad));
  }
});

test('withEntry puts the newest first and keeps the 50 newest', () => {
  let list: readonly LogEntry[] = [];
  for (let i = 0; i < LOG_LIMIT + 5; i++) list = withEntry(list, { id: `r${i}`, who: 'GM', formula: 'd20', dice: [], total: i, time: i });
  assert.equal(list.length, 50);
  assert.equal(list[0].id, `r${LOG_LIMIT + 4}`);
  assert.equal(list[49].id, 'r5');
});

test('withEntry ignores a roll it already has', () => {
  const entry: LogEntry = { id: 'r1', who: 'GM', formula: 'd20', dice: [], total: 1, time: 1 };
  const list = withEntry([], entry);
  assert.equal(withEntry(list, entry), list);
});

test('logEntryOf skips a die that does not read and keeps the roll', () => {
  const entry = logEntryOf(roll({ rolls: [null, { die: 'd6', value: 'x' }, { die: 'd8', value: 5 }] }));
  assert.deepEqual(entry?.dice, [{ die: 'd8', value: 5 }]);
  assert.equal(entry?.total, 7);
});

test('logEntryOf caps the dice kept (noting the rest) and the length of the text', () => {
  const many = Array.from({ length: 5000 }, () => ({ die: 'd6', value: 3 }));
  const entry = logEntryOf(roll({ rolls: many, formula: 'x'.repeat(10000), rolledBy: 'n'.repeat(500), source: { type: 'statblock', abilityName: 'a'.repeat(500) } }));
  assert.equal(entry?.dice.length, MAX_SHOWN_DICE);
  assert.equal(entry?.more, 5000 - MAX_SHOWN_DICE);
  assert.equal(entry?.formula.length, 80);
  assert.equal(entry?.who.length, 64);
  assert.equal(entry?.label?.length, 64);
});

/** Just enough of a DOM for the panel: elements with children, classes, listeners; and timers that run when told. */
class FakeElement {
  className = '';
  hidden = false;
  textContent = '';
  title = '';
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Array<(event: unknown) => void>>();
  style = { setProperty: (_name: string, _value: string) => {} };
  constructor(readonly ownerDocument: FakeDocument) {}
  get childElementCount(): number { return this.children.length; }
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  get lastElementChild(): FakeElement | null { return this.children[this.children.length - 1] ?? null; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  appendChild(child: FakeElement): FakeElement { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  append(...kids: FakeElement[]): void { for (const kid of kids) this.appendChild(kid); }
  prepend(child: FakeElement): void { child.remove(); child.parentElement = this; this.children.unshift(child); }
  replaceChildren(...kids: FakeElement[]): void { this.children = []; this.append(...kids); }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; }
  contains(node: FakeElement): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  addEventListener(type: string, fn: (event: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (event: unknown) => void): void { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((have) => have !== fn)); }
  find(className: string): FakeElement[] { return [...this.children.flatMap((child) => child.find(className)), ...(this.className.split(' ').includes(className) ? [this] : [])].sort(() => 0); }
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
  get win() { return { createEl: () => this.createElement(), createDiv: () => this.createElement(), createSpan: () => this.createElement() }; }
  tick(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers]) if (timer.at <= this.now) { this.timers.delete(id); timer.fn(); }
  }
}

function panel() {
  const doc = new FakeDocument();
  const parent = new FakeElement(doc);
  const board = new FakeElement(doc);
  const opened: boolean[] = [];
  const log = new DiceLogPanel(parent as unknown as HTMLElement, { toastParent: board as unknown as HTMLElement, onOpenChange: (open) => opened.push(open) });
  return { doc, parent, board, log, opened };
}
const entry = (n: number, extra: Partial<LogEntry> = {}): LogEntry => ({ id: `r${n}`, who: 'GM', formula: 'd20', dice: [{ die: 'd20', value: n }], total: n, time: n, ...extra });
const rows = (parent: FakeElement) => parent.find('atlas-tabletop-dice-log__entry');

test('the panel lists the newest roll first and keeps the 50 newest', () => {
  const { parent, log } = panel();
  for (let i = 0; i < LOG_LIMIT + 7; i++) log.add(entry(i));
  assert.equal(log.entries.length, LOG_LIMIT);
  assert.equal(rows(parent).length, LOG_LIMIT);
  assert.equal(rows(parent)[0].find('atlas-tabletop-dice-log__total')[0].textContent, String(LOG_LIMIT + 6));
  assert.equal(rows(parent)[LOG_LIMIT - 1].find('atlas-tabletop-dice-log__total')[0].textContent, '7');
});

test('the panel shows a roll once, however often it is added', () => {
  const { parent, board, log } = panel();
  log.add(entry(1));
  log.add(entry(1));
  assert.equal(rows(parent).length, 1);
  assert.equal(board.find('atlas-tabletop-dice-card').length, 1);
});

test('a roll shows as a card for 4 s, then the card goes; at most 3 cards, the oldest first to go', () => {
  const { doc, board, log } = panel();
  log.add(entry(1, { label: 'Longsword', crit: 'success' }));
  assert.equal(board.find('atlas-tabletop-dice-card').length, 1);
  doc.tick(TOAST_MS - 1);
  assert.equal(board.find('atlas-tabletop-dice-card').length, 1);
  doc.tick(1);
  assert.equal(board.find('atlas-tabletop-dice-card').length, 0);
  assert.equal(board.find('atlas-tabletop-dice-toasts')[0].hidden, true);
  for (let i = 0; i < MAX_TOASTS + 2; i++) log.add(entry(10 + i));
  const cards = board.find('atlas-tabletop-dice-card');
  assert.equal(cards.length, MAX_TOASTS);
  assert.equal(cards[0].find('atlas-tabletop-dice-card__total')[0].textContent, '12');
});

test('a roll with more dice than are kept says how many more', () => {
  const { parent, log } = panel();
  log.add(entry(1, { more: 40 }));
  assert.equal(parent.find('atlas-tabletop-dice-log__more')[0].textContent, '+40 more');
});

test('toggle opens and closes the panel; dispose closes it, clears the timers and takes everything away', () => {
  const { doc, parent, board, log, opened } = panel();
  log.toggle();
  assert.equal(log.isOpen, true);
  assert.equal(doc.listeners.get('pointerdown')?.length, 1);
  log.add(entry(1));
  assert.equal(doc.timers.size, 1);
  log.dispose();
  assert.deepEqual(opened, [true, false]);
  assert.equal(doc.listeners.get('pointerdown')?.length, 0);
  assert.equal(parent.listeners.get('keydown')?.length, 0);
  assert.equal(doc.timers.size, 0);
  assert.equal(parent.children.length, 0);
  assert.equal(board.children.length, 0);
  // Adding after disposal does nothing and does not throw.
  log.add(entry(2));
  assert.equal(log.entries.length, 1);
  assert.equal(doc.timers.size, 0);
});
