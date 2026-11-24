import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atlasViewFor } from '../src/palette/atlasViewProxy';

/** Atlas's map view as it is: `atlasStore` a getter giving zustand's store, a function carrying getState/subscribe. */
class FakeAtlasView {
  private readonly store: ((selector?: (s: unknown) => unknown) => unknown) & { getState: () => { mapPath: string }; subscribe: () => () => void };
  constructor() {
    const state = { mapPath: 'a.atlasmap' };
    this.store = Object.assign((selector?: (s: unknown) => unknown) => (selector ? selector(state) : state), { getState: () => state, subscribe: () => () => {} });
  }
  get atlasStore(): FakeAtlasView['store'] { return this.store; }
  viewName(): string { return this.constructor.name; }
}

test("the palette's view keeps Atlas's zustand store whole (getState on a function store)", () => {
  const view = atlasViewFor(new FakeAtlasView(), {}) as unknown as FakeAtlasView;
  assert.equal(typeof view.atlasStore.getState, 'function');
  assert.equal(view.atlasStore.getState().mapPath, 'a.atlasmap');
  assert.equal(typeof view.atlasStore.subscribe, 'function');
});

test("the palette's view calls Atlas's methods on Atlas's view, and the board's own answers win", () => {
  const view = atlasViewFor(new FakeAtlasView(), { isInPlayerMode: () => false }) as unknown as FakeAtlasView & { isInPlayerMode: () => boolean };
  const { viewName } = view;
  assert.equal(viewName(), 'FakeAtlasView');
  assert.equal(view.isInPlayerMode(), false);
});
