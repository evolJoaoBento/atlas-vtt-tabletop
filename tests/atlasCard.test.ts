import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rollLabel, routeCardRolls } from '../src/sheets/atlasCard';

/** A dice link of Atlas's card, as far as the router reads one. */
function link(formula: string, context: { label?: string; trait?: string } = {}) {
  const found = (name: string | undefined) => (name ? { textContent: ` ${name} `, querySelector: () => ({ textContent: ` ${name} ` }) } : null);
  const element: { dataset: { formula: string }; closest(selector: string): unknown } = {
    dataset: { formula },
    closest: (selector: string) => (selector === '[data-formula]' ? element : selector.includes('atlas-sb-labelled') ? found(context.label) : selector.includes('atlas-sb-trait') ? found(context.trait) : null),
  };
  return element;
}

function root(contained = true) {
  const listeners = new Map<string, { fn: (event: unknown) => void; capture: unknown }>();
  const fire = (type: string, target: unknown, extra: object = {}) => {
    const log = { prevented: false, stopped: false };
    listeners.get(type)?.fn({ type, target, preventDefault: () => { log.prevented = true; }, stopPropagation: () => { log.stopped = true; }, shiftKey: false, altKey: false, ...extra });
    return log;
  };
  return {
    contains: () => contained,
    addEventListener: (type: string, fn: (event: unknown) => void, capture: unknown) => listeners.set(type, { fn, capture }),
    removeEventListener: (type: string) => listeners.delete(type),
    click: (target: unknown, modifiers: object = {}) => fire('click', target, modifiers),
    key: (target: unknown, key: string, modifiers: object = {}) => fire('keydown', target, { key, ...modifiers }),
    context: (target: unknown) => fire('contextmenu', target),
    listening: () => listeners.size > 0,
    capture: () => [...listeners.values()].every((entry) => entry.capture === true),
  };
}

test("a dice link of Atlas's card rolls with the board's dice, named as the card names it", () => {
  const rolls: Array<[string, string, string | undefined]> = [];
  const card = root();
  routeCardRolls(card as never, (formula, label, side) => rolls.push([formula, label, side]));
  assert.equal(card.capture(), true, 'caught on its way down, before Atlas hears it');
  const first = card.click(link('+5', { label: 'Perception' }));
  card.click(link('2d6+3', { trait: 'Bite.' }), { shiftKey: true });
  card.click(link('1d20'), { altKey: true });
  assert.deepEqual(rolls, [['+5', 'Perception', undefined], ['2d6+3', 'Bite', 'advantage'], ['1d20', '1d20', 'disadvantage']]);
  assert.equal(first.prevented && first.stopped, true, "Atlas's own dice tool never rolls it too");
});

test('Enter and Space roll a link as a click does, other keys are left alone, and a right-click rolls nothing', () => {
  const rolls: Array<[string, string | undefined]> = [];
  const card = root();
  routeCardRolls(card as never, (formula, _label, side) => rolls.push([formula, side]));
  const target = link('+2', { label: 'Dex' });
  assert.equal(card.key(target, 'Enter').stopped, true);
  card.key(target, ' ', { shiftKey: true });
  const tab = card.key(target, 'Tab');
  assert.equal(tab.stopped || tab.prevented, false, 'a key that rolls nothing is not taken');
  const menu = card.context(target);
  assert.equal(menu.stopped, true, "Atlas's own right-click on a dice link never runs");
  assert.deepEqual(rolls, [['+2', undefined], ['+2', 'advantage']]);
});

test('a click that is no dice link, or has no formula, rolls nothing and is left alone', () => {
  const rolls: string[] = [];
  const card = root();
  routeCardRolls(card as never, (formula) => rolls.push(formula));
  const plain = card.click({ closest: () => null });
  card.click(link(' '));
  assert.deepEqual(rolls, []);
  assert.equal(plain.stopped, false);
  assert.equal(root(false).click(link('+1')).stopped, false);
});

test('the router stops listening when told to', () => {
  const card = root();
  const stop = routeCardRolls(card as never, () => {});
  assert.equal(card.listening(), true);
  stop();
  assert.equal(card.listening(), false);
});

test('a roll is named by its label, else its trait, else its formula', () => {
  assert.equal(rollLabel(link('+3', { label: 'Dex' }) as never, '+3'), 'Dex');
  assert.equal(rollLabel(link('1d8', { trait: 'Claw:' }) as never, '1d8'), 'Claw');
  assert.equal(rollLabel(link('1d8') as never, '1d8'), '1d8');
});
