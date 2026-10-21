import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LASER_FLUSH_MS, PlayerToolState, squareCorners, conePoints, templateHit } from '../src/board/playerTools';

const at = (x: number, y: number) => ({ x, y });

test('choosing the tool in use again goes back to Move, as in Connect\'s 2D view', () => {
  const tools = new PlayerToolState();
  tools.select('measure');
  assert.equal(tools.tool, 'measure');
  tools.select('measure');
  assert.equal(tools.tool, 'move');
});

test('a ping is a click with the Ping tool, at the ground point; a drag pings nothing', () => {
  const tools = new PlayerToolState();
  tools.select('ping');
  tools.down(at(10, 20), 0);
  assert.deepEqual(tools.up(at(10, 20), 10, false), [{ type: 'ping', x: 10, y: 20 }]);
  tools.down(at(10, 20), 0);
  assert.deepEqual(tools.up(at(90, 20), 10, true), []);
});

test('measuring shows the shape while dragged and goes on release', () => {
  const tools = new PlayerToolState();
  tools.select('measure');
  tools.selectShape('cone');
  tools.down(at(0, 0), 0);
  tools.move(at(70, 0), 10);
  assert.deepEqual(tools.overlay().measure, { shape: 'cone', start: at(0, 0), end: at(70, 0) });
  assert.deepEqual(tools.up(at(70, 0), 20, true), []);
  assert.equal(tools.overlay().measure, null);
});

test('a template is asked for on release; a tap on one of the player\'s own takes it off; Clear takes all of theirs', () => {
  const tools = new PlayerToolState();
  tools.setPlayers(['me', 'you'], 'me');
  tools.select('template');
  tools.selectTemplateShape('square');
  tools.down(at(0, 0), 0);
  tools.move(at(140, 70), 5);
  assert.deepEqual(tools.overlay().draft, { shape: 'square', start: at(0, 0), end: at(140, 70) });
  assert.deepEqual(tools.up(at(140, 70), 10, true), [{ type: 'template', change: { add: { shape: 'square', start: at(0, 0), end: at(140, 70) } } }]);
  tools.receiveTemplates([
    { id: 'a', owner: 'me', shape: 'circle', start: at(500, 500), end: at(570, 500), color: '#ff0000' },
    { id: 'b', owner: 'you', shape: 'circle', start: at(800, 800), end: at(870, 800), color: '#00ff00' },
  ]);
  assert.equal(tools.ownTemplates(), true);
  tools.down(at(520, 510), 20);
  assert.deepEqual(tools.up(at(520, 510), 30, false), [{ type: 'template', change: { remove: 'a' } }]);
  tools.down(at(810, 800), 40);
  assert.deepEqual(tools.up(at(810, 800), 50, false), [], 'another player\'s template is not the player\'s to take off');
  assert.deepEqual(tools.clearOwn(), [{ type: 'template', change: { clear: true } }]);
});

test('the laser sends its points in batches with their timing, and the last with lifted', () => {
  const tools = new PlayerToolState();
  tools.select('laser');
  tools.selectLaserColor('#00ffaa');
  tools.down(at(0, 0), 1000);
  assert.deepEqual(tools.move(at(5, 0), 1010), []);
  const first = tools.move(at(10, 0), 1000 + LASER_FLUSH_MS);
  assert.deepEqual(first, [{ type: 'laser', points: [at(0, 0), at(5, 0), at(10, 0)], dt: [0, 10, LASER_FLUSH_MS - 10], lifted: false, color: '#00ffaa' }]);
  const last = tools.up(at(12, 0), 1000 + LASER_FLUSH_MS + 5, true);
  assert.deepEqual(last, [{ type: 'laser', points: [at(12, 0)], dt: [5], lifted: true, color: '#00ffaa' }]);
});

test('template geometry as Connect draws it: a square from a corner, a cone opening by its angle, hits', () => {
  assert.deepEqual(squareCorners(at(0, 0), at(140, -70)), [at(0, 0), at(140, 0), at(140, -140), at(0, -140)]);
  const cone = conePoints(at(0, 0), at(100, 0), Math.PI / 2, 2);
  assert.deepEqual(cone[0], at(0, 0));
  assert.ok(Math.abs(cone[1]!.x - 100 * Math.SQRT1_2) < 1e-9 && Math.abs(cone[1]!.y + 100 * Math.SQRT1_2) < 1e-9);
  assert.equal(templateHit({ shape: 'line', start: at(0, 0), end: at(100, 0) }, at(50, 3), 5, Math.PI / 2), true);
  assert.equal(templateHit({ shape: 'cone', start: at(0, 0), end: at(100, 0) }, at(50, 60), 0, Math.PI / 2), false);
});
