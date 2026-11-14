import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMap } from '../src/board/mapModel';
import { mapIconSvg } from '../src/board/mapIcons';

const wrap = (objects: Record<string, unknown>): string => JSON.stringify({ state: { objects: { tokens: {}, pins: {}, ...objects } } });
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];

test("a 0.15 scene's drawings are read as Atlas reads them: an old eraser stroke and an unknown type are passed over", () => {
  const map = readMap('m', wrap({ drawings: {
    pen: { id: 'pen', kind: 'drawing', type: 'pen', timestamp: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4, opacity: 1 },
    rubbed: { id: 'rubbed', kind: 'drawing', type: 'eraser', timestamp: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#000000', width: 20, opacity: 1 },
    odd: { id: 'odd', kind: 'drawing', type: 'spiral', timestamp: 3, points: [{ x: 0, y: 0 }], color: '#00ff00', width: 2, opacity: 1 },
    stamp: { id: 'stamp', kind: 'drawing', type: 'icon', icon: 'skull', timestamp: 4, points: [{ x: 50, y: 60 }], color: '#ffffff', width: 70, opacity: 1 },
  } }));
  assert.deepEqual(map.inks.map((ink) => ink.id), ['pen']);
  assert.deepEqual(map.inks[0], { id: 'pen', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4, opacity: 1, closed: false, fill: null, holes: [], hidden: false, rank: 0, layer: 'above' });
  assert.deepEqual(map.icons, [{ id: 'stamp', icon: 'skull', x: 50, y: 60, color: '#ffffff', size: 70, opacity: 1, rotation: 0, hidden: false, rank: 1 }]);
});

test('a 0.16 scene: what the GM hid says so; fills and their holes, a line of no width, a turned stamp, the order Atlas stacks them in', () => {
  const map = readMap('m', wrap({
    drawings: {
      box: { id: 'box', kind: 'drawing', type: 'rectangle', timestamp: 1, points: square, color: '#000000', width: 0, opacity: 1, fill: 'solid', holes: [[{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }]], order: 2 },
      secret: { id: 'secret', kind: 'drawing', type: 'pen', timestamp: 2, points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], color: '#ff0000', width: 3, opacity: 1, hidden: true, order: 1 },
      open: { id: 'open', kind: 'drawing', type: 'pen', timestamp: 3, points: [{ x: 0, y: 0 }, { x: 9, y: 0 }], color: '#00ff00', width: 3, opacity: 1, fill: 'solid' },
      star: { id: 'star', kind: 'drawing', type: 'icon', icon: 'flame', timestamp: 4, points: [{ x: 10, y: 20 }], color: '#ffaa00', width: 70, opacity: 1, rotation: 45, hidden: true },
    },
    texts: {
      note: { id: 'note', kind: 'text', x: 10, y: 20, text: 'Trap here', fontSize: 24, fontFamily: 'serif', color: '#ffffff', hidden: true },
      sign: { id: 'sign', kind: 'text', x: 10, y: 20, text: 'Inn', fontSize: 24, fontFamily: 'serif', color: '#ffffff' },
    },
  }));
  // In the order Atlas draws them: by `order`, those without one first.
  assert.deepEqual(map.inks.map((ink) => ink.id), ['open', 'secret', 'box']);
  const [open, secret, box] = map.inks;
  assert.deepEqual([box!.closed, box!.fill, box!.width, box!.holes.length, box!.hidden], [true, 'solid', 0, 1, false]);
  // An open line has no inside: no fill, whatever its record says.
  assert.deepEqual([open!.closed, open!.fill], [false, null]);
  assert.equal(secret!.hidden, true);
  assert.deepEqual(map.icons.map((icon) => [icon.id, icon.rotation, icon.hidden]), [['star', 45, true]]);
  assert.deepEqual(map.texts.map((text) => [text.id, text.hidden]).sort(), [['note', true], ['sign', false]]);
});

test("a drawing or text of another level is not this level's", () => {
  const levels = [{ id: 'ground', name: 'Ground', elevation: { bottom: 0, top: 10 } }, { id: 'upper', name: 'Upper', elevation: { bottom: 10, top: 20 } }];
  const text = JSON.stringify({ state: { levels, objects: { tokens: {}, pins: {},
    drawings: { a: { id: 'a', kind: 'drawing', type: 'pen', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#ffffff', width: 2, opacity: 1, level: 'upper' } },
    texts: { t: { id: 't', kind: 'text', x: 0, y: 0, text: 'Up', fontSize: 24, fontFamily: 'serif', color: '#ffffff', level: 'upper' } },
  } } });
  assert.deepEqual([readMap('m', text, 'ground').inks.length, readMap('m', text, 'ground').texts.length], [0, 0]);
  assert.deepEqual([readMap('m', text, 'upper').inks.length, readMap('m', text, 'upper').texts.length], [1, 1]);
});

test("a stamp is drawn by any pin symbol (Atlas 0.16) or one of the twelve stamp symbols of before; nothing for an unknown one", () => {
  const pin = mapIconSvg('pin', '#ff0000');
  assert.ok(pin && /viewBox="0 0 512 512"/.test(pin) && /fill="#ff0000"/.test(pin), String(pin));
  const old = mapIconSvg('skull', '#ffffff');
  assert.ok(old && /viewBox="0 0 24 24"/.test(old));
  assert.equal(mapIconSvg('no-such-symbol', '#ffffff'), null);
  // A colour that is no plain value is white, in both.
  assert.match(mapIconSvg('pin', 'red" onload="x')!, /fill="#ffffff"/);
});

test('drawings, texts and stamps share one order, as Atlas stacks them: each is given its place in it, and its layer', () => {
  const map = readMap('m', wrap({
    drawings: {
      box: { id: 'box', kind: 'drawing', type: 'rectangle', timestamp: 1, points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }, { x: 0, y: 0 }], color: '#000000', width: 0, opacity: 1, fill: 'solid', order: 2 },
      floor: { id: 'floor', kind: 'drawing', type: 'rectangle', timestamp: 2, points: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }, { x: 0, y: 0 }], color: '#336699', width: 0, opacity: 0.4, fill: 'solid', layer: 'map', order: 3 },
      star: { id: 'star', kind: 'drawing', type: 'icon', icon: 'pin', timestamp: 3, points: [{ x: 1, y: 1 }], color: '#ffffff', width: 70, opacity: 1, order: 4 },
    },
    texts: { trap: { id: 'trap', kind: 'text', x: 1, y: 1, text: 'Trap', fontSize: 24, fontFamily: 'serif', color: '#ffffff', order: 1 } },
  }));
  assert.deepEqual([map.texts[0]!.rank, map.inks.map((ink) => [ink.id, ink.rank, ink.layer]), map.icons[0]!.rank], [0, [['box', 1, 'above'], ['floor', 2, 'map']], 3]);
});
