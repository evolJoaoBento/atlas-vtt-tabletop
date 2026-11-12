import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardChanges, type HeardMap } from '../src/sound/boardChanges';

const map = (over: Partial<HeardMap> = {}): HeardMap => ({ id: 'a', fogIds: ['f1'], tokens: [{ id: 't1', conditions: ['Prone'] }, { id: 't2', conditions: [] }], turnKey: '1:e1', turnTokens: ['t1'], ...over });
const NOTHING = { fogAdded: false, conditionsAdded: [], turnChanged: null };

test('a first map with fog, conditions and a turn reports nothing', () => {
  assert.deepEqual(new BoardChanges().next(map()), NOTHING);
});

test('a new fog id is added, a removed one is not', () => {
  const changes = new BoardChanges();
  changes.next(map());
  assert.equal(changes.next(map({ fogIds: ['f1', 'f2', 'f3'] })).fogAdded, true);
  assert.equal(changes.next(map({ fogIds: ['f1'] })).fogAdded, false);
});

test('a token gaining a condition is listed, one losing it is not', () => {
  const changes = new BoardChanges();
  changes.next(map());
  const gained = changes.next(map({ tokens: [{ id: 't1', conditions: ['Prone', 'Stunned'] }, { id: 't2', conditions: [] }] }));
  assert.deepEqual(gained.conditionsAdded, [{ tokenId: 't1', name: 'Stunned' }]);
  assert.deepEqual(changes.next(map({ tokens: [{ id: 't1', conditions: ['Prone'] }, { id: 't2', conditions: [] }] })).conditionsAdded, []);
});

test('a condition whose number changes, and a token that is new, are not listed', () => {
  const changes = new BoardChanges();
  changes.next(map({ tokens: [{ id: 't1', conditions: ['Exhaustion 1'] }] }));
  assert.deepEqual(changes.next(map({ tokens: [{ id: 't1', conditions: ['Exhaustion 2'] }, { id: 'new', conditions: ['Prone'] }] })).conditionsAdded, []);
});

test('the turn key changing reports the turn with its tokens, once', () => {
  const changes = new BoardChanges();
  changes.next(map());
  assert.deepEqual(changes.next(map({ turnKey: '1:e2', turnTokens: ['t2'] })).turnChanged, { tokens: ['t2'] });
  assert.equal(changes.next(map({ turnKey: '1:e2', turnTokens: ['t2'] })).turnChanged, null);
});

test('a fight starting or ending is no turn passing', () => {
  const changes = new BoardChanges();
  changes.next(map({ turnKey: null, turnTokens: [] }));
  assert.equal(changes.next(map()).turnChanged, null);
  assert.equal(changes.next(map({ turnKey: null, turnTokens: [] })).turnChanged, null);
});

test('a different map id reports nothing again', () => {
  const changes = new BoardChanges();
  changes.next(map());
  assert.deepEqual(changes.next(map({ id: 'b', fogIds: ['z'], tokens: [{ id: 't1', conditions: ['Stunned'] }], turnKey: '9:x' })), NOTHING);
  assert.equal(changes.next(map({ id: 'b', fogIds: ['z', 'y'] })).fogAdded, true);
});
