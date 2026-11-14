# Atlas fusion 4D: sight follows Atlas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D board stops working out sight itself: what players are shown of a lit scene is Atlas's own answer, read from the Atlas tab that hosts the map, through the one module Connect already reads it with.

**Architecture:** Connect's stock-lighting reader (`src/connect/stockLighting/`: the controller's sight, light reaches and ambient light rasterised by Atlas's rules, the players' frame perception) moves into `packages/atlas-host/src/lighting/`, which Tabletop copies by `sync:connect`. Tabletop's `BoardView` watches the hosting Atlas view with it and hands the board a `BoardSight` (seen token ids, a darkness raster, or unlit / pending). The board draws the raster as its veil and hides what Atlas's players do not see; its own rays, rooms and the two settings go.

**Tech Stack:** TypeScript, three.js (Tabletop), Obsidian plugins, Vitest (Connect), node:test (Tabletop), Playwright UI harness, live DevTools harness.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` (section 8 "Sight follows Atlas", sections 9 and 10). Program: `docs/superpowers/plans/2026-11-14-atlas-fusion-phase4-program.md`. Inventory and gates: `.superpowers/sdd/2026-11-14-atlas-fusion-phase4d/` (`inventory.md`, ledger, `probe-0.15.0.json`, `probe-0.16.0.json`).

## Global Constraints

- Never push, never merge, never touch a real vault; live checks only in `C:\Users\joaoo\fusion-gate-vault` (its 0.15 copy `C:\Users\joaoo\fusion-gate-vault-015-copy` put back before a chain).
- Both plugins keep Atlas 0.15 as their floor and work on 0.16.
- `FUSION_PROTOCOL` stays 4: the wire between the plugins does not change (players' boards already draw Connect's darkness fog).
- Fail closed: whatever cannot be read is `pending`, and `pending` shows players nothing.
- Connect owns `packages/`; Tabletop copies them with `npm run sync:connect -- --connect C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt`.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions (each ledgered as a ruling)

- **D1 One module.** The four files move verbatim into `packages/atlas-host/src/lighting/` (`playerVisibility.ts` from `stockLighting.ts`, `darknessRaster.ts`, `exploredMemory.ts`, `visionRules.ts`) with `types.ts` holding structural copies of `Disposer`, `Perception`, `PlayerVisibility`, `PlayerVisibilityOptions`, `LightingApi` (Tabletop has no `@atlas-vtt/api-types`). Connect's `mapSize(view)` moves beside them as `atlasMapSize`. The log prefix becomes a dep (`label`, default `Atlas VTT Connect`).
- **D2 The GM's own picture shows everything** (as Atlas's GM view); sight is drawn in the players' picture (the GM's player window) and in a point of view the GM previews. The old "Everyone" mode goes. Spec section 10's "With lighting off, no sight is drawn" holds: unlit means no veil anywhere.
- **D3 Point of view** stays, from Atlas: `PlayerVisibilityOptions.onlyToken` rasterises only that token's regions (`currentSight().regions` by `tokenId`); a piece is seen from it where the raster shows its place. An unlit scene previews no sight.
- **D4 A board on a map Atlas does not hold** (or before the host settles) answers `pending` when the scene is saved lit, `unlit` when not (the shared module's own rule, `state.lighting.enabled`, read from the board's map).
- **D5 Sight is for the level Atlas shows** (`levelObjects`); the board's players' picture shows that level, so they agree. A board whose shown level differs from the host's viewed level answers `pending` for its players' picture.
- **D6 `ruleWalls` leave sight** (Atlas's sight has the spell's derived walls) and stay for movement; `ruleLights` stay as the drawn lamp (G-reach: a reach has no colour). Section 9's row is extended; a measure light made in Atlas's own UI gets no lamp in 3D (section 10).
- **D7 Kept helpers:** `lineOfSight.ts` keeps `visibilityPolygon`, `canSee`, `inSight` and what spells use; `sightRooms.ts` keeps `effectOn`. The settings, `SightMode`, `SightStyle`, `buildRooms`, `seenRooms`, `unseenAreas`, `seenTiles`, `connectedTiles` and their tests go where nothing else uses them.

## Review Focus

1. The GM's player window when the host is not this board's map, is loading, or the scene is being switched lit/unlit: black, never unveiled.
2. A hidden token, a token on another level, or a token in committed fog: never in the players' picture, whatever the raster.
3. Props, pins and remote marks (`p:` keys, `pointBeyond`) in the dark part of the raster: out of the players' picture.
4. A cutscene's reveal: players see what the GM's view shows (no veil), as before.
5. Old saved settings with `lineOfSight` / `sightStyle`: read without a throw, dropped.

---

### Task 1: The shared lighting module (Connect)

**Files:**
- Create: `packages/atlas-host/src/lighting/{playerVisibility,darknessRaster,exploredMemory,visionRules,types,mapSize}.ts`; export from `packages/atlas-host/src/index.ts`.
- Delete: `src/connect/stockLighting/*` (Connect imports the package).
- Modify: `src/connect/stockAtlas.ts`; tests `tests/unit/connect/stockLighting*.test.ts` import the package.

**Interfaces — Produces:** `playerVisibilityApi(deps: PlayerVisibilityDeps): LightingApi` (was `stockLightingApi`), `PlayerVisibilityDeps` (was `StockLightingDeps`, plus `label?: string`), `PlayerVisibilityOptions { maxCellsPerSide?: number; onlyToken?: string }`, `atlasMapSize(view): MapSize`, types `PlayerVisibility`, `Perception`, `LightingView`, `LightingScene`.

- [ ] Step 1: failing test `stockLighting.test.ts` "a point of view is the raster of that token's regions alone": two seers, `onlyToken: 'a'` → cells only b sees are dark; `tokens` unchanged.
- [ ] Step 2: run `npx vitest run tests/unit/connect/stockLighting.test.ts` — FAIL.
- [ ] Step 3: move the files (git mv), add `types.ts`, `onlyToken` filter before `darknessRaster` (raster cache key includes it), `label`.
- [ ] Step 4: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run check:shared` — PASS.
- [ ] Step 5: commit `refactor(shared): Atlas's player visibility reader moves into atlas-host`.

### Task 2: The board draws Atlas's sight (Tabletop)

**Files:**
- Create: `src/board/atlasSight.ts` (`BoardSight`, `boardSightOf`), `tests/atlasSight.test.ts`.
- Modify: `src/board/board.ts` (`refreshSight` → `applySight`, `pointBeyond`, `beyondSight`, `drawMain`, `showFor`), `src/board/sightVeil.ts` (`updateCells`), `src/board/BoardView.ts` (watch the host).

**Interfaces — Consumes:** Task 1's `playerVisibilityApi`, `atlasMapSize` (via sync). **Produces:**
`type BoardSight = { kind: 'unlit' } | { kind: 'pending' } | { kind: 'ready'; seen: ReadonlySet<string>; seenAt(x: number, y: number): boolean; cells: { cellSize: number; cols: number; rows: number; shown: Uint8Array } }`;
`boardSightOf(v: PlayerVisibility): BoardSight` (only `'seen'` counts); `Board.setAtlasSight(players: BoardSight, pov: BoardSight | null): void`; `SightVeil.updateCells(cells, height)`.

- [ ] Step 1: failing tests `atlasSight.test.ts`: ready → seen ids are the `'seen'` ones (not `'sensed'`); `seenAt` reads `shown[row * cols + col]`, false off the raster; unlit/pending pass through.
- [ ] Step 2: `npm test` — FAIL. Step 3: implement. Step 4: PASS.
- [ ] Step 5: board: players' sight from `BoardSight` (`pending` = nothing seen, all veiled; `unlit` = no sight); POV from the second; the veil by `updateCells`; GM's own picture unveiled (D2). UI harness `line of sight` rewritten to call `setAtlasSight` with rasters (seen token, unseen token, prop in the dark, pending → black player picture, unlit → none, POV) — watched failing first against the old board.
- [ ] Step 6: `BoardView`: while the host holds this board's map, `api.watch(hostViewId, …)` → `boardSightOf(api.playerVisibility(viewId))` (and `onlyToken` for the POV); else D4; D5 against the host's viewed level. `dynamicLighting: () => true` (Atlas ≥ 0.9.1).
- [ ] Step 7: `npm test`, `npx tsc --noEmit`, `npm run build`, UI harness `line of sight|elevation layers|cutscene|windows|spell rules` — PASS. Commit.

### Task 3: The board's own sight goes (Tabletop)

**Files:** `src/board/lineOfSight.ts`, `src/board/sightRooms.ts`, `src/main.ts`, `src/board/quality.ts`, `src/board/BoardView.ts`, `src/board/toolbar.ts`, `src/palette/tabletopCommands.ts`, `src/playerBoard.ts`, `src/i18n*`, tests `lineOfSight.test.ts`, `sightRooms.test.ts`, `quality.test.ts`, harness.

- [ ] Step 1: failing test `quality.test.ts` "presets carry no sight settings" and a settings-load test "a saved lineOfSight / sightStyle is dropped".
- [ ] Step 2: delete the settings, setters, dropdowns, toolbar actions, palette commands, quality fields, `SightMode`/`SightStyle`, and D7's unused functions with their tests; `ruleWalls` no longer reach sight.
- [ ] Step 3: `npm test`, tsc, build, full UI harness — PASS. Commit.

### Task 4: Vendor, live, records

- [ ] Vendor cycle (Tabletop build-web → Connect `vendor/tabletop/` → Connect checks → commit → sync back → build → commit).
- [ ] Live step 53 (`harness/live/phase4d.cjs`, runs 4C's chain first): a lit scene in the GM's player window: a seer seen, a token out of its sight left out, the dark veiled; the GM's board shows both; a token moved into sight through the store shows; lighting off → no veil. On 0.16 and 0.15.
- [ ] Spec sections 9 and 10 amended (D2, D3, D6); live report; one fresh reviewer; one fix pass; ledger copy `phase4d-ledger.md`, `phase4d-final-review.md`; memory.
