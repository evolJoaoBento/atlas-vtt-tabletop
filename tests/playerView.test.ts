import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fogAreas } from '../src/board/fog';
import { insideFog, playerSees } from '../src/board/playerView';
import { HP_RESOURCE, visibleResources, type ResourceDefinition } from '../src/board/resources';

const room = fogAreas([
  { id: 'a', type: 'rectangle', timestamp: 1, isErasing: false, offsetX: 0, offsetY: 0, x: 0, y: 0, width: 100, height: 100 },
  { id: 'b', type: 'rectangle', timestamp: 2, isErasing: true, offsetX: 0, offsetY: 0, x: 40, y: 40, width: 20, height: 20 },
]);

test('a point is under fog inside an area, not inside a hole erased out of it', () => {
  assert.equal(insideFog(room, { x: 10, y: 10 }), true);
  assert.equal(insideFog(room, { x: 50, y: 50 }), false);
  assert.equal(insideFog(room, { x: 150, y: 10 }), false);
  assert.equal(insideFog([], { x: 10, y: 10 }), false);
});

test('players see a token that is not hidden and not under fog', () => {
  assert.equal(playerSees({ hidden: false }, { x: 150, y: 10 }, room), true);
  assert.equal(playerSees({ hidden: true }, { x: 150, y: 10 }, room), false);
  assert.equal(playerSees({ hidden: false }, { x: 10, y: 10 }, room), false);
  assert.equal(playerSees({ hidden: false }, { x: 50, y: 50 }, room), true);
});

test('players see the resources the collection shows them, whatever the map hides from the GM', () => {
  const defs: ResourceDefinition[] = [
    { ...HP_RESOURCE, visibleToPlayers: false },
    { key: 'ac', name: 'AC', field: 'ac', direction: 'static', color: '#64748b', visibleToPlayers: true },
  ];
  const token = { resources: { hp: { current: 5, max: 9 }, ac: { current: 15, max: 15 } } };
  assert.deepEqual(visibleResources(token, defs, ['ac'], 'player').map((r) => r.definition.key), ['ac']);
  assert.deepEqual(visibleResources(token, defs, ['ac']).map((r) => r.definition.key), ['hp']);
});
