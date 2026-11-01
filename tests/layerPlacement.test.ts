import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carryView, snapTurn, turnStep, compose, inverse, isNoPlacement, NO_PLACEMENT, readPlacement, relativeTo, turnAbout, turnPoint, wrapTurn } from '../src/board/layerPlacement';

const near = (a: number, b: number, message?: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${message ?? ''} ${a} vs ${b}`);
const apply = (placement: { x: number; y: number; turn: number }, point: { x: number; y: number }): { x: number; y: number } => {
  const turned = turnPoint(point, placement.turn);
  return { x: turned.x + placement.x, y: turned.y + placement.y };
};

test('a turn is clockwise on the map: the way along x goes down the page', () => {
  const turned = turnPoint({ x: 10, y: 0 }, 90);
  near(turned.x, 0);
  near(turned.y, 10);
});

test('turns wrap to a half turn either way', () => {
  assert.equal(wrapTurn(190), -170);
  assert.equal(wrapTurn(-190), 170);
  assert.equal(wrapTurn(180), 180);
  assert.equal(wrapTurn(360), 0);
});

test('composing carries a point through the second placement, then the first', () => {
  const a = { x: 100, y: 0, turn: 90 };
  const b = { x: 0, y: 50, turn: 0 };
  const point = { x: 10, y: 10 };
  const through = apply(a, apply(b, point));
  const once = apply(compose(a, b), point);
  near(once.x, through.x);
  near(once.y, through.y);
});

test('a placement composed with its inverse is no placement', () => {
  const a = { x: 37, y: -12, turn: 63 };
  assert.ok(isNoPlacement(compose(a, inverse(a))));
  assert.ok(isNoPlacement(compose(inverse(a), a)));
});

test("a scene's placement seen from another: the played scene's own comes out", () => {
  const played = { x: 40, y: 10, turn: 30 };
  const scene = { x: -20, y: 70, turn: 100 };
  const seen = relativeTo(played, scene);
  // Playing the scene itself, it stands where it is.
  assert.ok(isNoPlacement(relativeTo(scene, scene)));
  // Playing the base, nothing comes out.
  const same = relativeTo(NO_PLACEMENT, scene);
  near(same.x, scene.x);
  near(same.turn, scene.turn);
  // A point of the scene lands in the base where it does either way round.
  const point = { x: 5, y: 9 };
  const inBase = apply(scene, point);
  const viaPlayed = apply(played, apply(seen, point));
  near(viaPlayed.x, inBase.x);
  near(viaPlayed.y, inBase.y);
});

test('turning about a point keeps that point of the plane where it is', () => {
  const placement = { x: 20, y: 30, turn: 10 };
  const about = { x: 200, y: 150 };
  const turned = turnAbout(placement, about, 40);
  assert.equal(turned.turn, 50);
  // A point of the scene that stood on `about` still stands on it: it goes about itself.
  const local = apply(inverse(placement), about);
  const now = apply(turned, local);
  const expected = turnPoint({ x: about.x - about.x, y: about.y - about.y }, 40);
  near(now.x, about.x + expected.x);
  near(now.y, about.y + expected.y);
});

test('a stored placement is read back, and one that moves nothing, or is no placement, reads as none', () => {
  assert.deepEqual(readPlacement({ x: 5, y: -3, turn: 190 }), { x: 5, y: -3, turn: -170 });
  assert.equal(readPlacement({ x: 0, y: 0, turn: 0 }), null);
  assert.equal(readPlacement(undefined), null);
  assert.equal(readPlacement('x'), null);
  assert.deepEqual(readPlacement({ x: 'a', y: 4 }), { x: 0, y: 4, turn: 0 });
});

test('a turn snaps to a quarter turn by default, 45 with Shift, 5 with Ctrl, and not at all with Alt', () => {
  assert.equal(turnStep({}), 90);
  assert.equal(turnStep({ shift: true }), 45);
  assert.equal(turnStep({ ctrl: true }), 5);
  assert.equal(turnStep({ alt: true }), 0);
  assert.equal(turnStep({ shift: true, ctrl: true }), 5);
  assert.equal(turnStep({ shift: true, alt: true }), 0);
  assert.equal(snapTurn(50, 90), 90);
  assert.equal(snapTurn(44, 90), 0);
  assert.equal(snapTurn(40, 90), 0);
  assert.equal(snapTurn(100, 45), 90);
  assert.equal(snapTurn(23.4, 5), 25);
  assert.equal(snapTurn(23.4, 0), 23.4);
  assert.equal(snapTurn(200, 90), 180);
  assert.equal(snapTurn(-200, 90), 180);
});

test('a camera carried into another frame looks at the same point of the world, with the same heading in it', () => {
  const placement = { x: 100, y: 50, turn: 90 };
  const carried = carryView({ x: 700, z: 500 }, 0.3, placement);
  const point = apply(placement, { x: 700, y: 500 });
  near(carried.x, point.x);
  near(carried.z, point.y);
  near(carried.yaw, 0.3 - Math.PI / 2);
  // No placement changes nothing.
  const same = carryView({ x: 12, z: 34 }, 1.1, NO_PLACEMENT);
  assert.deepEqual([same.x, same.z, same.yaw], [12, 34, 1.1]);
  // The eye keeps its place in the world: the offset from the target turns with the frame.
  const eye = (target: { x: number; z: number }, yaw: number) => ({ x: target.x + Math.sin(yaw) * 400, y: target.z + Math.cos(yaw) * 400 });
  const before = apply(placement, eye({ x: 700, z: 500 }, 0.3));
  const after = eye({ x: carried.x, z: carried.z }, carried.yaw);
  near(after.x, before.x);
  near(after.y, before.y);
});
