/**
 * A stand-in for the Atlas view holding a map, for the tests: its store's state with the actions the writer calls
 * (`addTokens`, `updateToken`, `deleteTokens`…), each changing the state as Atlas's store would and recorded.
 */
import type { AtlasView } from '../src/atlas';
import type { TokenWriterDeps } from '../src/board/tokenWriter';

export interface FakeAtlas {
  view: AtlasView;
  state: Record<string, unknown> & { objects: { tokens: Record<string, Record<string, unknown>> } };
  calls: Array<[string, ...unknown[]]>;
  /** A writer's deps for this Atlas, holding the map (or, with `held: false`, never coming to). */
  deps(held?: boolean): TokenWriterDeps;
}

export function fakeAtlas(mapPath: string, tokens: Record<string, Record<string, unknown>> = {}, extra: Record<string, unknown> = {}): FakeAtlas {
  const calls: Array<[string, ...unknown[]]> = [];
  let next = 0;
  const state = {
    mapPath, mapLoaded: true, isMapLoading: false,
    objects: { tokens },
    addTokens: (inputs: ReadonlyArray<Record<string, unknown>>): string[] => {
      calls.push(['addTokens', inputs]);
      return inputs.map((input) => {
        const id = typeof input.id === 'string' ? input.id : `atlas${++next}`;
        tokens[id] = { kind: 'token', ...input, id };
        return id;
      });
    },
    addToken: (token: Record<string, unknown>): void => { calls.push(['addToken', token]); tokens[token.id as string] = token; },
    updateToken: (id: string, changes: Record<string, unknown>): void => { calls.push(['updateToken', id, changes]); tokens[id] = { ...tokens[id], ...changes }; },
    deleteTokens: (ids: string[]): void => { calls.push(['deleteTokens', ids]); for (const id of ids) delete tokens[id]; },
    ...extra,
  } as FakeAtlas['state'];
  const view = { viewId: 'v', atlasStore: { getState: () => state, subscribe: () => () => {} } } as unknown as AtlasView;
  return {
    view, state, calls,
    deps: (held = true) => ({ views: () => (held ? [view] : []), held: async () => (held ? state as never : null) }),
  };
}
