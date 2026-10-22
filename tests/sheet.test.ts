import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advantageSide, buildSheet, mayHaveAdvantage, sheetRollFormula, sheetRollLabel, textParts, toRollFormula, type PlayerSheet } from '../src/sheets/sheet';
import { SheetDrawer } from '../src/sheets/sheetDrawer';
import { parseFormula } from '../src/dice/rollRules';
import { stockRoll } from '../src/dice/atlasDice';

const GOBLIN = {
  name: 'Goblin', path: 'Bestiary/Goblin.md', image: 'secret/goblin.png', size: 'Small', type: 'humanoid', subtype: 'goblinoid', alignment: 'neutral evil',
  ac: 15, hp: 7, hit_dice: '2d6', speed: '30 ft.', stats: [8, 14, 10, 10, 8, 8],
  saves: [{ dexterity: 4 }], skillsaves: [{ stealth: 6 }, { bad: 'x' }],
  senses: 'darkvision 60 ft., passive Perception 9', languages: ['Common', 'Goblin'], cr: '1/4',
  traits: [{ name: 'Nimble Escape', desc: 'The goblin can take the Disengage or Hide action as a bonus action.' }],
  actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +5 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.' }, ['Shortbow', 'Ranged: +4 to hit. Hit: 1d6+2.']],
  notes: 'GM only: the goblin is a spy',
};

test('a 5e creature builds its abilities, saves, skills, lines and actions, and only those, as text', () => {
  const sheet = buildSheet(GOBLIN)!;
  assert.equal(sheet.name, 'Goblin');
  assert.equal(sheet.subtitle, 'Small humanoid (goblinoid), neutral evil');
  assert.equal(sheet.ac, '15');
  assert.equal(sheet.hp, '7 (2d6)');
  assert.equal(sheet.speed, '30 ft.');
  assert.deepEqual(sheet.stats, [8, 14, 10, 10, 8, 8]);
  assert.deepEqual(sheet.saves, [{ label: 'Dexterity', bonus: 4 }]);
  assert.deepEqual(sheet.skills, [{ label: 'Stealth', bonus: 6 }]);
  assert.deepEqual(sheet.lines, [{ label: 'Senses', text: 'darkvision 60 ft., passive Perception 9' }, { label: 'Languages', text: 'Common, Goblin' }, { label: 'Challenge', text: '1/4' }]);
  assert.deepEqual(sheet.sections.map((section) => [section.title, section.items.map((item) => item.name)]), [['Traits', ['Nimble Escape']], ['Actions', ['Scimitar', 'Shortbow']]]);
  const json = JSON.stringify(sheet);
  for (const hidden of ['Bestiary', 'secret', 'spy']) assert.ok(!json.includes(hidden), hidden);
});

test('an attack rolls 1d20+5: its bonus alone, thrown with the default d20', () => {
  const sheet = buildSheet(GOBLIN)!;
  const attack = { kind: 'text', section: 1, item: 0, index: 0, text: 'Attack: +5' } as const;
  assert.equal(sheetRollFormula(sheet, attack), '+5');
  assert.equal(sheetRollLabel(sheet, attack), 'Scimitar');
  const request = parseFormula(sheetRollFormula(sheet, attack)!)!;
  assert.deepEqual(request, { dice: { d20: 1 }, modifier: 5 });
  const logged = stockRoll({ rolls: [{ die: 'd20', value: 11, max: 20 }], modifier: 5, total: 16, label: 'Scimitar' }, undefined, { abilityName: 'Scimitar', tokenId: 'gob' }) as { formula: string; source: unknown };
  assert.equal(logged.formula, '1d20+5');
  assert.deepEqual(logged.source, { type: 'statblock', abilityName: 'Scimitar', tokenId: 'gob' });
});

test('the rolls of a sheet: checks, saves, skills and the dice in a text, by where they are and what they say', () => {
  const sheet = buildSheet(GOBLIN)!;
  assert.equal(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1, text: '1d6 + 2' }), '1d6+2');
  assert.equal(sheetRollFormula(sheet, { kind: 'check', index: 1 }), '+2');
  assert.equal(sheetRollFormula(sheet, { kind: 'check', index: 0 }), '-1');
  assert.equal(sheetRollFormula(sheet, { kind: 'save', index: 0 }), '+4');
  assert.equal(sheetRollFormula(sheet, { kind: 'skill', index: 0 }), '+6');
  assert.equal(sheetRollLabel(sheet, { kind: 'save', index: 0 }), 'Dexterity save');
  assert.equal(sheetRollLabel(sheet, { kind: 'check', index: 1 }), 'DEX check');
  assert.equal(sheetRollLabel(sheet, { kind: 'skill', index: 0 }), 'Stealth');
});

test('an unknown roll is null: no such place on the sheet, or other text there', () => {
  const sheet = buildSheet(GOBLIN)!;
  assert.equal(sheetRollFormula(sheet, { kind: 'skill', index: 5 }), null);
  assert.equal(sheetRollFormula(sheet, { kind: 'save', index: 3 }), null);
  assert.equal(sheetRollFormula(sheet, { kind: 'text', section: 0, item: 0, index: 0 }), null);
  assert.equal(sheetRollFormula(sheet, { kind: 'text', section: 9, item: 0, index: 0, text: '+5' }), null);
  assert.equal(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1, text: '+5' }), null);
  assert.equal(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1 }), null);
  assert.equal(sheetRollFormula(buildSheet({ name: 'No stats' })!, { kind: 'check', index: 0 }), null);
});

test('dice notation in a text: expressions, bare bonuses and attack bonuses; not dashes, ranges or words', () => {
  const linked = (text: string): string[] => textParts(text).filter((part) => 'roll' in part).map((part) => part.text);
  const parts = textParts('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.');
  assert.equal(parts.map((part) => part.text).join(''), 'Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.');
  assert.deepEqual(linked('Hit: 19 (2d10 + 8) slashing'), ['2d10 + 8']);
  assert.deepEqual(linked('(2d6+3) piercing, bite (d8), claws (+5)'), ['2d6+3', 'd8', '+5']);
  assert.deepEqual(linked('(1d4 − 1) or (−1)'), ['1d4 − 1', '−1']);
  assert.deepEqual(linked('2d6 - 1d4 fire'), ['2d6 - 1d4']);
  assert.deepEqual(linked('Take 2d6!'), ['2d6']);
  assert.deepEqual(linked('Claws - Very Close - 1d12+2 phy'), ['1d12+2']);
  assert.deepEqual(linked('x2d6 and 5d'), []);
  assert.deepEqual(linked('Recharge 5-6, levels 1–3'), []);
  assert.equal(toRollFormula('ATK: +4'), '+4');
  assert.equal(toRollFormula('1d4 − 1'), '1d4-1');
  assert.equal(toRollFormula('3d6 + -1'), '3d6-1');
});

test('refuses what is no creature, keeps a fallback name, cleans control characters and caps long texts', () => {
  assert.equal(buildSheet({ ac: 3 }), null);
  assert.equal(buildSheet({ ac: 3 }, 'Fallback')?.name, 'Fallback');
  assert.equal(buildSheet('Goblin'), null);
  const sheet = buildSheet({ name: 'A\u0000b\u0007\nc', actions: [{ name: 'X', desc: 'y'.repeat(5000) }] })!;
  assert.equal(sheet.name, 'Ab c');
  assert.equal(sheet.sections[0]?.items[0]?.desc.length, 2000);
});

test('Shift asks for advantage, Alt for disadvantage, both cancel; advantage only where a d20 is thrown', () => {
  assert.equal(advantageSide(true, false), 'advantage');
  assert.equal(advantageSide(false, true), 'disadvantage');
  assert.equal(advantageSide(true, true), null);
  assert.equal(advantageSide(false, false), null);
  assert.equal(mayHaveAdvantage('+5'), true);
  assert.equal(mayHaveAdvantage('1d20+3'), true);
  assert.equal(mayHaveAdvantage('1d6+2'), false);
  assert.equal(mayHaveAdvantage('1d200'), false);
});

// ── The drawer ───────────────────────────────────────────────────────────

/** Just enough of a DOM for the drawer: elements with children, text, attributes and listeners. */
class FakeElement {
  className = '';
  hidden = false;
  type = '';
  title = '';
  private ownText = '';
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly ownerDocument: FakeDocument, readonly tagName = 'div', readonly isText = false) {}
  get nodeName(): string { return this.tagName; }
  get textContent(): string { return this.isText || this.children.length === 0 ? this.ownText : this.children.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  appendChild(child: FakeElement): FakeElement { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  append(...kids: FakeElement[]): void { for (const kid of kids) this.appendChild(kid); }
  replaceChildren(...kids: FakeElement[]): void { this.children = []; this.append(...kids); }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; }
  contains(node: FakeElement): boolean { return node === this || this.children.some((child) => child.contains(node)); }
  focus(): void {}
  addEventListener(type: string, fn: (event: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (event: unknown) => void): void { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((have) => have !== fn)); }
  fire(type: string, event: object = {}): void {
    const full = { preventDefault: () => {}, stopPropagation: () => {}, shiftKey: false, altKey: false, ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(full);
  }
  find(className: string): FakeElement[] { return [...(this.className.split(' ').includes(className) ? [this] : []), ...this.children.flatMap((child) => child.find(className))]; }
  all(tag: string): FakeElement[] { return [...(this.tagName === tag ? [this] : []), ...this.children.flatMap((child) => child.all(tag))]; }
}

class FakeDocument extends FakeElement {
  constructor() { super(null as unknown as FakeDocument); }
  createElement(tag: string): FakeElement { return new FakeElement(this, tag); }
  importNode(node: FakeElement): FakeElement { return node; }
  createTextNode(text: string): FakeElement { const node = new FakeElement(this, '#text', true); node.textContent = text; return node; }
}

(globalThis as { DOMParser?: unknown }).DOMParser = class {
  parseFromString(): { documentElement: FakeElement } { return { documentElement: new FakeElement(new FakeDocument(), 'svg') }; }
};

function drawer() {
  const doc = new FakeDocument();
  const parent = new FakeElement(doc);
  const rolls: Array<[string, string, string | undefined]> = [];
  const opened: boolean[] = [];
  const made = new SheetDrawer(parent as unknown as HTMLElement, {
    onRoll: (formula, label, advantage) => rolls.push([formula, label, advantage]),
    onOpenChange: (open) => opened.push(open),
  });
  const rollButtons = () => parent.find('atlas-tabletop-sheet__roll');
  const button = (text: string) => rollButtons().find((candidate) => candidate.textContent === text)!;
  const notice = () => parent.find('atlas-tabletop-sheet__notice')[0]!;
  return { doc, parent, drawer: made, rolls, opened, rollButtons, button, notice };
}

const ANNA: PlayerSheet = buildSheet({
  name: 'Anna', stats: [10, 16, 10, 10, 10, 10], saves: [{ dexterity: 5 }],
  actions: [{ name: 'Dagger', desc: '<b>x</b> Attack: +6 to hit. Hit: 1d4 + 4.' }, { name: 'Hex', desc: 'Hit: 2d6 - 1d4 necrotic.' }],
})!;

test('the drawer writes the sheet as text, never as markup', () => {
  const t = drawer();
  t.drawer.show(ANNA);
  t.drawer.toggle();
  assert.equal(t.drawer.isOpen, true);
  assert.equal(t.parent.all('b').length, 0);
  assert.ok(t.parent.textContent.includes('<b>x</b>'));
  assert.ok(t.parent.textContent.includes('Anna'));
  assert.ok(t.parent.textContent.includes('Dagger. '));
});

test('a click rolls what it shows, labelled; Shift-click with advantage where a d20 is thrown', () => {
  const t = drawer();
  t.drawer.show(ANNA);
  t.button('Attack: +6').fire('click');
  t.button('1d4 + 4').fire('click', { shiftKey: true });
  t.button('+3').fire('click', { altKey: true });
  t.button('Dexterity +5').fire('click', { shiftKey: true });
  assert.deepEqual(t.rolls, [['+6', 'Dagger', undefined], ['1d4+4', 'Dagger', undefined], ['+3', 'DEX check', 'disadvantage'], ['+5', 'Dexterity save', 'advantage']]);
  // Enter rolls with the side its modifiers ask for.
  t.button('Attack: +6').fire('keydown', { key: 'Enter', shiftKey: true });
  assert.deepEqual(t.rolls.at(-1), ['+6', 'Dagger', 'advantage']);
});

test("a roll physical dice cannot throw rolls nothing: the drawer says so", () => {
  const t = drawer();
  t.drawer.show(ANNA);
  assert.equal(t.notice().hidden, true);
  t.button('2d6 - 1d4').fire('click');
  assert.deepEqual(t.rolls, []);
  assert.equal(t.notice().hidden, false);
  assert.equal(t.notice().textContent, "Can't roll 2d6-1d4 with physical dice.");
  // The next roll, or another sheet, takes the notice away.
  t.button('Attack: +6').fire('click');
  assert.equal(t.notice().hidden, true);
  t.button('2d6 - 1d4').fire('click');
  t.drawer.show(null);
  assert.equal(t.notice().hidden, true);
});

test('no sheet says so; a sheet shown again replaces the one before', () => {
  const t = drawer();
  t.drawer.show(null);
  assert.equal(t.rollButtons().length, 0);
  assert.ok(t.parent.textContent.includes('Select a token with a stat block'));
  t.drawer.show(ANNA);
  const count = t.rollButtons().length;
  t.drawer.show(ANNA);
  assert.equal(t.rollButtons().length, count);
});

test('the drawer opens and closes, telling its owner; the board does not take its presses, wheel or keys; dispose takes it away', () => {
  const t = drawer();
  const root = t.parent.find('atlas-tabletop-sheet')[0]!;
  assert.equal(root.hidden, true);
  t.drawer.toggle();
  assert.equal(root.hidden, false);
  let stopped = 0;
  for (const type of ['pointerdown', 'wheel', 'keydown']) root.fire(type, { key: 'a', stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 3);
  t.parent.find('atlas-tabletop-sheet__close')[0]!.fire('click');
  assert.equal(t.drawer.isOpen, false);
  t.drawer.toggle();
  root.fire('keydown', { key: 'Escape' });
  assert.equal(t.drawer.isOpen, false);
  t.drawer.toggle();
  t.drawer.dispose();
  assert.deepEqual(t.opened, [true, false, true, false, true, false]);
  assert.equal(t.parent.children.length, 0);
  t.drawer.toggle();
  assert.equal(t.drawer.isOpen, false);
});
