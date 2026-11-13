# Atlas Fusion Phase 1 (Breaks, Floor and Host) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both plugins require Atlas 0.15, pair by a `fusion` number, write only through one Atlas host that follows the focused board, and take distances, unit names, light level, laser and dice volume from Atlas, with 0.14 room-wall settings carried over.

**Architecture:** Connect gets two plain TypeScript folders, `packages/atlas-shared` and `packages/atlas-host`.
- `atlas-shared` holds stock Atlas 0.15.0 files, copied verbatim by a sync script. It is browser-safe.
- `atlas-host` is Obsidian-side code: the version floor, the pairing notice, the single host that follows a board, and the deferred-leaf wake that moves out of `stockWake.ts`.

Tabletop copies both folders to the same paths, and generates its wire contract from Connect's `boardTypes.ts`, with one script and an offline hash check. The board then edits only through the host's store, reads from that store while it holds the map, and shows a bar otherwise. No file is ever written as a fallback.

**Tech Stack:** TypeScript.
- Tabletop: esbuild, node:test (`npm test`), and the Playwright harness (`harness/run-ui.mjs`).
- Connect: vite, vitest, eslint, and the web page build (`build:page`).
- Live check: Obsidian over the DevTools protocol (Playwright `connectOverCDP`).

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` (sections 4.1, 4.2, 5, 6 migration 1, 8 Phase 1, 11). Phase 0 results: `.superpowers/sdd/2026-11-13-atlas-fusion/phase0-report.md`.

**Base commits:** line numbers below are at these commits.
- Tabletop `e6689fb` on `feat/atlas-fusion`.
- Connect `beab3a7` on `feat/cutscenes`.

Anchor edits in `src/board/board.ts` and `src/board/BoardView.ts` by method name, because they drift.

## Global Constraints

**Versions, pairing and repos**
- Atlas floor: `0.15.0`, read from `app.plugins.manifests['atlas-vtt'].version` at load and whenever Atlas reloads.
- Floor notices, verbatim:
  - Tabletop: `Tabletop needs Atlas VTT 0.15 or later (found X)`
  - Connect: `Connect needs Atlas VTT 0.15 or later (found X)`
- Atlas source: tag `0.15.0` of `https://github.com/atlas-vtt/atlas-vtt`. The shared tag and `MIN_ATLAS_VERSION` must be equal, and a test fails when they are not.
- `FUSION_PROTOCOL = 1` for Phase 1. A missing number is refused exactly as a wrong one is.
- Stale page text, verbatim: `This table needs the updated player page`.
- Both repos are AGPL-3.0-only. Copied Atlas files stay byte-identical (CRLF counts as LF), keep their headers, and are credited in `SOURCE.json`.
- No third repo, no npm publishing, no `git push`.
- Tabletop and Connect ship Phase 1 together: Tabletop 1.4.0 and Connect 0.10.0, both with `FUSION_PROTOCOL` 1.

**Writes and the host**
- No code path writes an `.atlasmap`. Every Atlas edit goes through store actions of the one Atlas view that holds the map.
- Map M is held when the host store has `mapPath === M`, `mapLoaded !== false` and `isMapLoading !== true`.
- The host load timeout is `HOST_LOAD_MS = 15_000`.
- Bar texts, verbatim:
  - `View only. Atlas holds <map>.`, with the button `Edit here`.
  - `Atlas closed this map. Editing is paused.`, with the button `Reopen`.
- Player refusal text, verbatim: `The GM's Atlas is on another map; try again in a moment.`
- Background-host recipe (Phase 0, G6):
  1. `getLeaf('tab')`.
  2. `setActiveLeaf(front, { focus: true })`.
  3. `setViewState({ type: 'atlas-vtt', state: { file } })`.

  Step 2 must come before step 3. `active: false` has no effect, in either position.
- A host that Tabletop opened is detached when its last board closes. A host the user opened is never detached by a plugin.
- The board harness never opens a real Atlas leaf. It uses fakes.

**Migrations and copy**
- Every migration:
  - writes a backup first, to `Tabletop backups/<YYYY-MM-DD>/` in the vault;
  - runs once per map;
  - shows one summary notice, `… ; backup in Tabletop backups/<date>/`;
  - never deletes the backup.
- User-facing copy: plain English, sentence case, no em dashes.
- Commits end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tabletop's `packages/` and `src/connectWire.ts` are never edited by hand. A fix goes into Connect, then `npm run sync:connect` runs again.

**Checks and builds**
- Run the Tabletop UI harness as:
  `PLAYWRIGHT_MODULE="C:/Users/joaoo/dnd store/node_modules/playwright" ATLAS_CSS=C:/Users/joaoo/2075/sound-downloads/atlas-0.15.0/styles.css node harness/run-ui.mjs "<feature>"`
- Connect's checks, all green at the end of every Connect task: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run build:page`, `npm run check:vendor`, and from Task 1 `npm run check:shared`.
- Tabletop's checks, all green at the end of every Tabletop task: `npm test`, `npx tsc --noEmit`, `npm run build`.

## Review Focus

1. **An edit queued for map A while the host loads A, and the host ends on B instead.** This happens when the user switches Atlas's tab, or another board takes focus. Each queued edit must be refused with the bar's text. It must never be applied to B's store, and never written to A's file. Test: Task 2 (`whenHeld resolves null when the host lands on another map`) and Task 11 (`a queued move is refused when the host moves on`).
2. **Store churn.** Camera moves, selection, `isDragging`, popovers and the dice tray all replace the store state many times a second. None of them may reload the 3D board. Test: Task 12 (`mapStateChanged ignores camera, selection and tool state`).
3. **Odd version strings.** These are `0.15.0-beta.1` (old), `0.15` (ok), `0.15.10` (ok), `1.0.0` (ok), `''`, `undefined` and `'x.y'`. The last three read as missing or old, never as ok. Test: Task 2 (`compareVersions orders pre-releases and short versions`).
4. **Room re-key on awkward data.** The cases are:
   - level ids that contain underscores, and the empty level (`room__…`);
   - negative coordinates;
   - an old edge stored in the opposite direction;
   - two levels with the same edge.

   Matching is by the new wall's endpoints and `chainId`, never by parsing the level out of the id. Test: Task 13.
5. **The board sits in a popout window or a sidebar when the host must be opened.** The Atlas leaf is created in a main-window tab group, because Atlas moves it there otherwise and shows `view.mainWindowOnly`. The board stays the active leaf. Test: Task 2 (`a board in a popout opens the host in the main window`) and the live check (Task 18, step 6).

---

## Decisions (builder choices the spec leaves open)

- **D1: Package wiring.**
  - Connect owns `packages/atlas-shared/` and `packages/atlas-host/` as plain TypeScript folders, with no `package.json`, workspaces or aliases.
  - Tabletop copies both, byte for byte, to the same paths with `npm run sync:connect`.
  - Both repos import them by relative path: `packages/atlas-shared/src/index.ts` and `packages/atlas-host/src/index.ts`. That needs no change to Tabletop's four esbuild configs or to Connect's vite, page and vitest configs. Connect's `@atlas-vtt/shared/*` keeps meaning the shelved fork bundle until Phase 2 removes it.
  - Both `tsconfig.json` `include` lists gain `packages/**/*.ts`.
  - Connect's ESLint ignores `packages/atlas-shared/src/app/**` (verbatim Atlas code and generated stubs) and lints the rest.
  - Package code is written to Connect's stricter compiler options (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), so it compiles in both repos.
- **D2: The fusion number.**
  - `export const FUSION_PROTOCOL = 1` is defined once, in Connect's `src/app/online/scene/boardTypes.ts`. That file is page-safe and is the file Tabletop generates its wire contract from.
  - The number equals the fusion phase: each phase's first Connect task bumps it.
  - It travels in three places:
    - Tabletop's API as `api.fusion`;
    - Connect's board session as `session.fusion`;
    - the join message as `join.fusion`.
  - A missing or different number is refused in all three places.
  - The page is refused with the existing `'version'` deny reason, whose text becomes `This table needs the updated player page`. A page from before fusion still shows its own baked-in text for that reason, and is refused all the same.
- **D3: The contract generator.**
  - Tabletop's `scripts/sync-connect.mjs --connect <checkout>` copies the two packages.
  - It writes `src/connectWire.ts` as a generated header plus Connect's `boardTypes.ts`, verbatim. Task 6 makes that file import-free.
  - It records the Connect commit and a sha256 for every copied file in `connect-sync.json`.
  - `--check` re-hashes offline. `tests/connectSync.test.ts` runs it, so `npm test` fails on a hand edit; the spec leaves the choice between a pre-build step and a test, and this is a test.
  - `--check --connect <checkout>` also fails when Tabletop's `packages/atlas-shared/SOURCE.json` or `connectWire.ts` differs from the checkout's.
  - Only the wire half is generated. The API shapes in `connectContract.ts` (`BoardSession`, `BoardLook`, `PlayerCutsceneHandle`, …) stay hand-kept. The fusion number guards that half.
- **D4: The `atlas-shared` file list for Phase 1.**
  - Copied verbatim:
    - `src/app/grid/gridDistance.ts`, `hexGeometry.ts` and `measurementFormat.ts`;
    - `src/app/measure/areaRules.ts`;
    - `src/app/types/collectionSettingsTypes.ts` and `gridTypes.ts`.
  - "One file" is not closed: `gridDistance.ts` value-imports `hexGeometry.ts`, and unit names need `measurementFormat.ts` and `areaRules.ts`.
  - A type-only import of a file that is not listed gets a generated stub at the import's own path. Examples are `grid/GridSystem.ts`, which pulls in pixi, and `measure/movementRules.ts`. The stub has a `// Generated type stub` header and one `export type Name = any;` per imported name. This is the convention `sync-atlas-port.mjs` already uses, so the copied files stay verbatim.
  - A value import of an unlisted file, or any non-relative import, fails the sync.
- **D5: Below the floor.**
  - Atlas older than 0.15 puts the plugin in a disabled state (§5): one notice, no API published (so no connection), and board tabs show the reason instead of a board.
  - Atlas missing entirely gives the §4.1 failure: boards open read-only with `Atlas VTT is not enabled. View only.`.
- **D6: File engines.**
  - Phase 1 makes every file write unreachable. Tabletop's `TokenWriter` gets a `process` dependency that throws `NotHeldError`, and it waits for the host first.
  - Phase 2 deletes the dead file code (§8).
- **D7: Token transfer between stacked maps** (until Phase 4 deletes stacks). It runs through the host in two held steps:
  1. follow `to` and `addToken`;
  2. follow `from` and `deleteTokens`.

  It stops before the delete if either step is not held. Stacked layers keep reading their member files for display only.
- **D8: What a view-only board still edits.** It refuses Atlas-record edits only: tokens, doors, walls, pins, initiative and lighting. Tabletop's own 3D data (minis, props, wall heights, materials, windows' openings) stays editable, because Atlas stores none of it.
- **D9: Scene tab bar.**
  - The bar is rebuilt in 0.15 markup. The host is a hidden tab (0×0), so "drive Atlas's own tab strip" (§12.7) has nothing beside the board to drive.
  - Tabletop's layers button has no slot in 0.15 markup. It moves into the tab's context menu (right-click already opens `layerMenu`), and the layer label becomes a badge inside `__label`.
- **D10: Overrides that stop existing.**
  - `MapData.ambient`/`tint` are written to a backup (`board-lighting.json`), followed by one notice (§10 lists them as lost).
  - `settings.laser` is written once into Atlas with `setLaserPointerSettings` when Atlas's own laser is at its defaults, then dropped.
  - The board's dice-sound toggle is removed. Dice loudness is Atlas's `getDiceVolume()`, and a stored `groups.dice: false` is mentioned in the same notice.
  - The ambient slider is disabled, titled `Turn on lighting in Atlas to set the light level.`, while the scene's lighting is off.
- **D11: Connect and moving the host.**
  - Connect's automatic switch after waking (`ensurePresented`, `stockAtlas.ts:404-421`) no longer calls `switchToTab`.
  - The GM's own clicks in Connect stay. These are Present and assigning a player to a tab (`present`, `showTab` and `splitActions.assignToTab`), read as "the user in Atlas".
- **D12: The host exists but lacks the map** (a case the spec's steps do not cover). Phase 0 did not gate it, so Task 2 Step 0 probes it live before any host code is written. The three ways, in order of preference:
  1. **(a)** Add the tab in the host's own store, with `tabMetaStore.addTab` and then `switchToTab`. This avoids `revealLeaf`.
  2. **(b)** `view.loadFile(file)`.
  3. **(c)** Open a background leaf with the recipe. Atlas merges it in as a tab and calls `revealLeaf`, so the board's leaf is activated again once the merge's `layout-change` fires.

  The first way that keeps the board in front in 5 of 5 tries is the one built. If none does, the fallback is (c), with the board re-activated: the board may flash once, and that is recorded in the report. The live check verifies the chosen way again (Task 18, step 4).
- **D13: Height in Phase 1** (an ambiguity between §8 Phase 1 and Phase 2). Phase 1 routes every distance through Atlas's `cellsByRule` with its `rise`, which is 0 until Phase 2 feeds token `elevation` into rulers.

---

## File Structure

**Connect** (`C:\Users\joaoo\2075\atlas-vtt-connect-cutscenes-wt`, new branch `feat/atlas-fusion`)
- `packages/atlas-shared/`
  - `files.mjs`: the file list.
  - `SOURCE.json`: tag, commit, file hashes, stub hashes.
  - `README.md`: source and licence.
  - `src/index.ts`: our own exports.
  - `src/app/**`: verbatim files and generated stubs.
- `packages/atlas-host/src/`
  - `index.ts`
  - `atlasFloor.ts`: version floor.
  - `pairing.ts`: pairing notice.
  - `hostLeaf.ts`: the background-leaf recipe.
  - `atlasHost.ts`: the single host.
  - `wake.ts`: moved from `src/connect/stockWake.ts`.
- `scripts/sync-atlas-shared.mjs` and `scripts/check-shared.mjs`.
- Modified:
  - `package.json`, `tsconfig.json`, `eslint.config.mjs`;
  - `src/connect/atlasLink.ts`, `stockAtlas.ts`, `stockRules.ts`, `stockTokens/stockTokens.ts`, `tabletopMinis.ts`;
  - `src/app/online/scene/boardTypes.ts`, `sceneTypes.ts`, `sceneValidation.ts`, `projectForPlayers.ts`;
  - `src/app/online/tools/arTable.ts`, `BoardSessionHub.ts`;
  - `src/app/online/protocol.ts`, `GmSession.ts`, `gmSessionAdmission.ts`, `PlayerSession.ts`, `page/pageScreen.ts`;
  - `src/app/online/control/TokenMoveHandler.ts`;
  - `src/app/online/obsidian/joinFlow.ts`, `playerSceneRecords.ts`, `remote/toRemoteScene.ts`;
  - `src/app/online/view/tools/toolGrid.ts`;
  - `online-client/main.mts`, `mapView.mts`;
  - `vendor/tabletop/*`, `README.md`, `manifest.json`, `versions.json`, `THIRD_PARTY_NOTICES.md`.
- Deleted: `src/connect/stockWake.ts`, `src/connect/stockRooms/**`, `tests/unit/connect/stockRooms.test.ts`.

**Tabletop** (`C:\Users\joaoo\2075\atlas-vtt-tabletop`, `feat/atlas-fusion`)
- New:
  - `packages/atlas-shared/**` and `packages/atlas-host/**` (synced copies);
  - `connect-sync.json`, `scripts/sync-connect.mjs`, `src/connectWire.ts` (generated);
  - `src/board/hostBar.ts`, `src/board/roomWallMigration.ts`, `src/backups.ts`;
  - `harness/live/*`.
- Modified:
  - `main.ts`, `package.json`, `tsconfig.json`;
  - `src/connectContract.ts`, `src/atlas.ts`, `src/atlasBridge.ts`;
  - `src/atlasPort/shims/assetService.ts`, `src/assets/AssetWindow.tsx`;
  - `src/board/measure.ts`, `board.ts`, `BoardView.ts`, `tokenWriter.ts`, `mapModel.ts`, `boardData.ts`, `toolbar.ts`, `sceneTabBar.ts`, `atlasRooms/rooms.ts`;
  - `src/boardLook.ts`, `src/playerBoard.ts`, `src/sound/soundEngine.ts`, `src/parity/index.ts`;
  - `scripts/check-atlas-members.mjs`, `styles.css`, `harness/board.ts`, `harness/features-test.cjs`;
  - `README.md`, `manifest.json`, `versions.json`, `docs/atlas-parity.md`.

---

### Task 1 (Connect): Branch, Atlas 0.15.0 source, and `atlas-shared`

**Files:**
- Create:
  - `packages/atlas-shared/files.mjs`, `SOURCE.json`, `README.md`, `src/index.ts`, and the `src/app/**` copies and stubs;
  - `scripts/sync-atlas-shared.mjs`, `scripts/check-shared.mjs`.
- Modify:
  - `package.json`: scripts `sync:shared` and `check:shared`.
  - `tsconfig.json`: `include` gains `"packages/**/*.ts"`.
  - `eslint.config.mjs`: ignores `packages/atlas-shared/src/app/**`.
  - `THIRD_PARTY_NOTICES.md`: Atlas 0.15.0 files.
- Test: `tests/unit/connect/atlasShared.test.ts`, `tests/unit/connect/syncShared.test.ts`. These sit under `tests/unit/connect/`, which both `tsconfig.json` and `eslint.tests.config.mjs` already cover.

**Interfaces:**
- Produces `packages/atlas-shared/src/index.ts`:
  - From `gridDistance.ts`: `cellsByRule`, `flatCells`, `pathLengthInCells`, `type FlatCells`, `type GridGeometry`.
  - From `measurementFormat.ts`: `resolveMeasurementSettings`, `formatDistance`, `formatGameUnits`, `readUnitName`, `sceneUnitName`, `collectionUnitName`, `unitLabelFor`, `MAX_UNIT_NAME`, `type MeasurementSettings`.
  - From `collectionSettingsTypes.ts`: `type DiagonalRule`, `type GridUnitType`, `type CollectionGridDefaults`.
  - From `gridTypes.ts`: `type GridState`.
- Atlas's signatures, unchanged:
  - `pathLengthInCells(grid: GridGeometry, points: readonly Point[], diagonalRule: DiagonalRule, rise = 0): number`
  - `formatDistance(cells: number, settings: MeasurementSettings): string`
  - `resolveMeasurementSettings(collection: CollectionGridDefaults | undefined, grid: GridState | null | undefined): MeasurementSettings`
- `SOURCE.json` shape:

  ```json
  { "repository": "atlas-vtt/atlas-vtt", "tag": "0.15.0", "commit": "<sha>",
    "files": { "<path>": "<sha256>" }, "stubs": { "<path>": "<sha256>" } }
  ```

  Paths are relative to `packages/atlas-shared`. Hashes use `scripts/vendorHash.mjs` `hashFile`.

- [ ] **Step 1: Create the branch and fetch the source**

```bash
cd C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt && git checkout -b feat/atlas-fusion
git clone --depth 1 --branch 0.15.0 https://github.com/atlas-vtt/atlas-vtt.git C:/Users/joaoo/2075/atlas-vtt-0.15-ref
```
Expected: `C:/Users/joaoo/2075/atlas-vtt-0.15-ref/manifest.json` has `"version": "0.15.0"`.

- [ ] **Step 2: Write the failing tests**

`tests/unit/connect/atlasShared.test.ts` imports from `../../../packages/atlas-shared/src/index`. Paths in Steps 2 and 4 use `at(cx, cy) = { x: 35 + 70*cx, y: 35 + 70*cy }` on a square grid of `size: 70`.

`cellsByRule` and `pathLengthInCells`:
- The path `at(0,0)→at(3,3)→at(5,3)` gives:
  - `manhattan` 8;
  - `equidistant` 5;
  - `alternating` 6;
  - `euclidean` `hypot(3,3)+2` (to within 1e-9).
- The single leg `at(0,0)→at(2,0)` with `rise` 3 gives:
  - `equidistant` 3;
  - `manhattan` 5;
  - `alternating` 4;
  - `euclidean` `hypot(2,3)`.

`resolveMeasurementSettings` and `formatDistance`:
- The collection `{ measurementMode: 'metric', unitType: 'custom', unitName: ' mi ', unitDistance: 1, diagonalRule: 'manhattan' }` gives `unitName === 'mi'`. `formatDistance(6, s)` is `'6 mi'`.
- The same collection with the grid `{ unitNameOverride: 'ly' }` gives `formatDistance(6, s) === '6 ly'`.
- `{ measurementMode: 'metric', unitType: 'meters', unitDistance: 1.5 }` gives `formatDistance(1.4142, s) === '2.1m'`.
- Feet with `unitDistance` 5 gives `formatDistance(6, s) === '30ft'`.

`tests/unit/connect/syncShared.test.ts` runs `scripts/check-shared.mjs` as a child process:
- It exits 0 on the committed tree.
- On a temp copy with one byte changed in `gridDistance.ts`, it exits 1 and prints `changed: src/app/grid/gridDistance.ts`.
- A stub that holds anything besides comments and `export type X = any;` lines makes it fail with `stub has code`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/connect/atlasShared.test.ts tests/unit/connect/syncShared.test.ts`
Expected: FAIL, because the index module is not found.

- [ ] **Step 4: Write `scripts/sync-atlas-shared.mjs --atlas <checkout>` and `scripts/check-shared.mjs`**

The sync script:
- Refuses unless the checkout's `manifest.json` version is `0.15.0` and `git -C <checkout> describe --tags --exact-match` prints `0.15.0`.
- Records `git rev-parse HEAD`.
- Copies each `FILES` entry of `packages/atlas-shared/files.mjs` byte for byte to `packages/atlas-shared/src/app/<path>`.
- Walks each copied file's imports. Reuse `isTypeOnly` and `typeNamesOf`, copied from Tabletop's `scripts/sync-atlas-port.mjs:33-44`.
  - A value import must resolve to a listed file. Otherwise the script fails: `<file> imports <spec> at run time; list it`.
  - A non-relative import fails: `<file> imports the package <spec>`. This is how the "no Obsidian, Node or DOM imports" rule is checked.
  - A type-only import of an unlisted file adds its names to that path's stub.
- Writes the stubs, then `SOURCE.json`.

`check-shared.mjs`:
- Re-hashes `files` and `stubs` offline.
- Checks that every stub holds only comments and `export type <Name> = any;` lines.
- Prints `packages/atlas-shared matches Atlas 0.15.0 (<commit7>)`.

Run: `npm run sync:shared -- --atlas C:/Users/joaoo/2075/atlas-vtt-0.15-ref`

- [ ] **Step 5: Write `src/index.ts` (our own exports, listed in Interfaces) and `README.md`**

The README says:
- where the files come from (the tag and commit);
- that they must not be edited by hand;
- the AGPL credit;
- how to upgrade: bump `FILES` and the tag, run `sync:shared`, run both test suites, and bump `MIN_ATLAS_VERSION` (Task 2).

- [ ] **Step 6: Run the tests and all Connect checks**

Run: `npx vitest run tests/unit/connect/atlasShared.test.ts tests/unit/connect/syncShared.test.ts && npx tsc --noEmit && npm run lint && npm run check:shared`
Expected: PASS. tsc compiles the verbatim files under Connect's options. If one does not compile, the list is wrong; a file is never edited.

- [ ] **Step 7: Commit**

```bash
git add packages/atlas-shared scripts/sync-atlas-shared.mjs scripts/check-shared.mjs package.json tsconfig.json eslint.config.mjs THIRD_PARTY_NOTICES.md tests/unit/connect/atlasShared.test.ts tests/unit/connect/syncShared.test.ts
git commit -m "feat(shared): atlas-shared, verbatim Atlas 0.15.0 grid distance and units" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2 (Connect): `atlas-host`: floor, pairing notice, the single host, and the wake

**Files:**
- Create: `packages/atlas-host/src/index.ts`, `atlasFloor.ts`, `pairing.ts`, `hostLeaf.ts`, `atlasHost.ts`, `wake.ts`
- Create, outside the repos: `C:\Users\joaoo\fusion-gate-vault\.probe\d12.js`, the gate probe for Step 0. It is not product code.
- Test:
  - `tests/unit/connect/atlasFloor.test.ts`
  - `tests/unit/connect/atlasHost.test.ts`
  - `tests/unit/connect/hostWake.test.ts`: `tests/unit/connect/stockWake.test.ts`, moved and re-pointed.
  - `tests/fake/fakeWorkspace.ts`

**Interfaces:**
- Consumes `packages/atlas-shared/SOURCE.json` `tag` (test only).
- Produces:

```ts
// atlasFloor.ts
export const MIN_ATLAS_VERSION = '0.15.0';
/** <0, 0, >0. Missing parts are 0 ('0.15' = '0.15.0'). A pre-release sorts before its release. Unparsable sorts lowest. */
export function compareVersions(a: string, b: string): number;
export type AtlasFloor = { state: 'ok'; version: string } | { state: 'old'; version: string } | { state: 'missing' };
/** 'missing' when app.plugins.plugins['atlas-vtt'] is absent; else the manifests' version against MIN_ATLAS_VERSION. */
export function atlasFloor(app: App): AtlasFloor;
export const FLOOR_POLL_MS = 2000;
/** Calls `listener` whenever the floor changes (plugin object or version). Polls every FLOOR_POLL_MS. Returns the stop. */
export function watchAtlasFloor(app: App, listener: (floor: AtlasFloor) => void, every?: (ms: number, fn: () => void) => () => void): () => void;
export function floorNotice(plugin: 'Tabletop' | 'Connect', found: string): string;  // `${plugin} needs Atlas VTT 0.15 or later (found ${found})`
// pairing.ts
/** `Tabletop for Atlas VTT ${t ?? 'unknown'} and Connect for Atlas VTT ${c ?? 'unknown'} do not match: update both to the same release.` */
export function pairingNotice(tabletopVersion: string | null, connectVersion: string | null): string;
// hostLeaf.ts
/** Phase 0's G6 recipe. The leaf goes in a main-window tab group (the front's own one when it is in the root split). */
export function openBackgroundLeaf(app: App, file: TFile, front: WorkspaceLeaf): Promise<WorkspaceLeaf>;
// atlasHost.ts
export const HOST_LOAD_MS = 15_000;
/** Property on the Atlas leaf, shared by both plugins' copies: who opened it and who needs it. */
export const HOST_MARK = '__atlasFusionHost';
export interface HostMark { openedBy: string | null; claims: Map<string, number> }  // plugin id -> open claims
export interface HostState { mapPath: string | null; mapLoaded?: boolean; isMapLoading?: boolean; remoteView?: unknown; [key: string]: unknown }
export interface HostStore { getState(): HostState; subscribe(listener: () => void): () => void }
export type HostStatus = { kind: 'none' } | { kind: 'loading'; mapPath: string | null } | { kind: 'held'; mapPath: string };
export type FollowResult = 'held' | 'timeout' | 'no-atlas' | 'no-file' | 'superseded';
export class AtlasHost {
  constructor(app: App, options: { pluginId: string; wait?: (ms: number) => Promise<void>; now?: () => number });
  status(): HostStatus;
  holds(mapPath: string): boolean;
  /** The host's store while it holds mapPath; else null. */
  store(mapPath: string): HostStore | null;
  /** Makes the host hold mapPath, the front leaf staying in front (algorithm below). */
  follow(mapPath: string, front: WorkspaceLeaf): Promise<FollowResult>;
  /** The store at once when held. While a follow or load of mapPath is under way: waits, resolving in call order.
   *  null when nothing is under way, the host ends on another map, it closes, or HOST_LOAD_MS passes. */
  whenHeld(mapPath: string): Promise<HostStore | null>;
  /** Records a claim of this plugin on the host leaf. The release detaches the leaf when this plugin opened it and no claim of any plugin is left. */
  claim(): () => void;
  /** The leaf was detached while claimed, and not by a release. Cleared by the next follow. */
  closedByUser(): boolean;
  onChange(listener: () => void): () => void;
  dispose(): void;
}
// wake.ts: loadDeferredLeaves, wakeAtlasForHosting, WAKE_LOAD_MS, HostingWakeDeps, moved from src/connect/stockWake.ts
// unchanged (its Disposer import becomes a local `type Disposer = () => void`).
```

The `follow` algorithm (§4.1 plus D12):
```
if holds(M) -> 'held'
file = vault.getAbstractFileByPath(M); not a TFile -> 'no-file'; no Atlas plugin -> 'no-atlas'
view = the one non-remote Atlas view (getLeavesOfType('atlas-vtt'))
if a follow of M is in flight -> return that same promise (no second leaf, no second switch)
if view and view.tabMetaStore has a tab with filePath M -> await view.switchToTab(tab.id)
else if a deferred Atlas leaf exists -> await leaf.loadIfDeferred(); then retry the step above once
else if view exists (host without M) -> the way Step 0 chose (D12: addTab+switchToTab | loadFile | background leaf)
else -> openBackgroundLeaf(app, file, front); mark.openedBy ??= pluginId (only when no Atlas leaf existed before)
after a merge (layout-change with Atlas leaves count back to 1) -> setActiveLeaf(front, { focus: true }) if front is not active
wait for holds(M) up to HOST_LOAD_MS -> 'held' | 'timeout'; a later follow() of another map makes this one 'superseded'
```

The recipe's own `setActiveLeaf(front)` fires `active-leaf-change`, and Task 11 wires that event to `follow`. The in-flight rule makes that re-entrant call join the running one.

- [ ] **Step 0: Gate D12 live (no product code)**

Run the probe against `C:\Users\joaoo\fusion-gate-vault` on the `fusion` profile, port 9311:
- the launcher is `C:\Users\joaoo\tabletop-promo-session\real\launch.cjs fusion 9311 C:/Users/joaoo/fusion-gate-vault`;
- the evaluator is Phase 0's `run.cjs`, copied next to the probe.

Each try uses a board (or a note) in front and a hidden host on `Probe Cellar`, then brings `Probe Cove` into the host by way (a), (b) or (c) of D12. A try records:
- whether the front is still the active leaf and visible;
- the number of Atlas leaves;
- whether the store holds Cove within 15 s.

Run 5 tries of each way. Then kill the profile (`kill.ps1 -Role fusion`).
Expected: a table of the results, written into `.superpowers/sdd/2026-11-13-atlas-fusion/phase0-report.md` as a new "G6b" section, with the chosen way named. The fake workspace in Step 1 models that way.

- [ ] **Step 1: Write the failing tests**

`tests/fake/fakeWorkspace.ts`:
- Leaves have `isDeferred`, `loadIfDeferred`, `setViewState`, `detach`, `getRoot` and `parent`.
- Its `layout-change` merge folds a second Atlas leaf into the first, as stock 0.15 does: the new leaf is detached, its file becomes an internal tab of the first, the store switches, and `revealLeaf` makes that leaf active.
- `activeLeaf` and the store are fakes.

`atlasFloor.test.ts`:
- `compareVersions orders pre-releases and short versions`:
  - `compareVersions('0.15.0-beta.1','0.15.0') < 0`;
  - `('0.15','0.15.0') === 0`;
  - `('0.15.10','0.15.2') > 0`;
  - `('x.y','0.0.1') < 0`.
- `atlasFloor`:
  - `'0.15.0'` gives `{state:'ok'}`;
  - `'0.14.0'` gives `{state:'old',version:'0.14.0'}`;
  - no plugin gives `{state:'missing'}`;
  - an `undefined` version gives `old`, with version `'unknown'`.
- `floorNotice('Tabletop','0.14.0') === 'Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)'`.
- `MIN_ATLAS_VERSION` equals `SOURCE.json`'s `tag`, read with `fs`.
- `watchAtlasFloor` calls its listener once when the fake plugin object is swapped for one at 0.14.0.

`atlasHost.test.ts`:
- `holds is false while loading and true once loaded`.
- `follow switches to an existing internal tab and never opens a leaf`.
- `follow loads a deferred leaf`.
- `follow opens a background leaf and keeps the front active`. After the call, `activeLeaf === front`, and the recorded call order is `getLeaf → setActiveLeaf(front) → setViewState`.
- `follow into an existing host without the map re-activates the front after the merge` (D12).
- `a board in a popout opens the host in the main window`: the front's `getRoot()` is a popout, and the leaf's parent is in `rootSplit`.
- `follow times out after HOST_LOAD_MS`, with an injected clock.
- `a second follow supersedes the first`.
- `a follow of the same map in flight joins it`. Two calls for M, the second fired from the recipe's own `active-leaf-change`, open exactly one leaf, and both resolve `'held'`.
- `whenHeld resolves null when the host lands on another map`. Three calls for A resolve in order once A loads. A switch to B before A loads resolves all three to null.
- `release detaches only a leaf this plugin opened, once no plugin claims it`. Plugins `tabletop-for-atlas` and `atlas-vtt-connect` share one `HOST_MARK`, and a user-opened leaf is never detached.
- `closedByUser after the leaf is detached while claimed`.

`wake.test.ts`: the existing `stockWake` cases, imported from the package.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/connect/atlasFloor.test.ts tests/unit/connect/atlasHost.test.ts tests/unit/connect/hostWake.test.ts`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement `atlasFloor.ts`, `pairing.ts`, `hostLeaf.ts`, `atlasHost.ts`, `wake.ts` and `index.ts` (signatures above)**

`hostLeaf.ts`:
- The main-window tab group is `front.parent` when `front.getRoot() === workspace.rootSplit`.
- Else it is the parent of `workspace.getMostRecentLeaf(workspace.rootSplit)`.
- Else use `workspace.getLeaf('tab')` after `setActiveLeaf` on a root-split leaf.
- Create the leaf with `createLeafInParent(group, group.children.length)`, then follow the recipe order (Global Constraints).

`AtlasHost`:
- Subscribe to the one view's store, and re-bind on every `layout-change`.
- Fire `onChange` on any change to `status()` or to `closedByUser()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/atlas-host tests/unit/connect/atlasFloor.test.ts tests/unit/connect/atlasHost.test.ts tests/unit/connect/hostWake.test.ts tests/fake/fakeWorkspace.ts
git commit -m "feat(host): atlas-host: Atlas 0.15 floor, pairing notice, one host that follows a board" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C C:/Users/joaoo/2075/atlas-vtt-tabletop add .superpowers/sdd/2026-11-13-atlas-fusion/phase0-report.md
git -C C:/Users/joaoo/2075/atlas-vtt-tabletop commit -m "docs(sdd): gate G6b, bringing a map into an existing Atlas host" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 (Connect): Floor and host in Connect; no automatic host moves

**Files:**
- Modify:
  - `src/connect/atlasLink.ts:95-130` (`useStockAtlas`, `followStockAtlas`)
  - `src/connect/stockAtlas.ts`:
    - line 30: the import of the wake from the package;
    - `ensurePresented` (404-421): drop the `switchToTab` branch;
    - `wokenView` (389-397);
    - `stockAtlasApi` around 700-720: `wakeAtlasForHosting`.
- Delete: `src/connect/stockWake.ts`, `tests/unit/connect/stockWake.test.ts` (moved in Task 2).
- Test: `tests/unit/connect/atlasLink.test.ts`, `tests/unit/connect/stockAtlasHosting.test.ts`

**Interfaces:**
- Consumes: `atlasFloor`, `watchAtlasFloor`, `floorNotice`, `loadDeferredLeaves` and `wakeAtlasForHosting` (Task 2).

- [ ] **Step 1: Write the failing tests**

`atlasLink.test.ts`:
- A fake stock Atlas with manifest version `0.14.0`:
  - `useStockAtlas` attaches nothing;
  - `notify` is called once with `Connect needs Atlas VTT 0.15 or later (found 0.14.0)`;
  - a second `followStockAtlas` tick does not notify again.
- At `0.15.0`, it attaches.
- Swapping the plugin for one at `0.14.0` detaches.

`stockAtlasHosting.test.ts`:
- When hosting starts with a presented scene whose tab is not active, `ensurePresented` does not call `switchToTab`.
- With nothing presented, it sets the presented scene to the loaded tab, as before.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/connect/atlasLink.test.ts tests/unit/connect/stockAtlasHosting.test.ts`
Expected: FAIL.

- [ ] **Step 3: Gate `attachStock` on `atlasFloor(app).state === 'ok'`**

- Notify once per found version.
- The fork API path (`atlas-vtt:api-ready`) is gated the same way.
- Re-point the imports to `packages/atlas-host/src/index`, and delete `stockWake.ts`.

- [ ] **Step 4: Run all Connect checks**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/connect tests/unit/connect
git commit -m "feat(connect): require Atlas 0.15; wake through atlas-host; never switch Atlas's tab on its own" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 (Connect): Distances and unit names from `atlas-shared`

**Files:**
- Modify:
  - `src/connect/stockRules.ts:98-132` (`readGridDefaults`): accept `'manhattan'`, plus `unitName` when `unitType === 'custom'`, through `readUnitName`.
  - `src/app/online/scene/sceneTypes.ts:307-336`:
    - `PLAYER_DIAGONAL_RULES` gains `'manhattan'`;
    - `PlayerMeasurement` gains `unitName?: string`.
  - `src/app/online/scene/sceneValidation.ts:271-272`: `unitName` is absent, or a string of 1..`MAX_UNIT_NAME` characters.
  - `src/app/online/scene/projectForPlayers.ts:300-323` (`projectMeasurement`): use `atlas-shared`'s `resolveMeasurementSettings`, and send `unitName`.
  - `src/app/online/view/tools/toolGrid.ts:46`: the label is `formatDistance(pathLengthInCells(geometry, points, m.diagonalRule), m)` from `atlas-shared`.
  - `src/app/online/obsidian/playerSceneRecords.ts:42-50` (`gridUnits`): keep `unitType: 'custom'`, and add `unitNameOverride: unitName`.
- Test:
  - `tests/unit/online/projectForPlayers.test.ts` (existing)
  - `tests/unit/online/dragRulerTool.test.ts` (existing; the `toolGridOf` label cases go here)
  - `tests/unit/connect/stockRules.test.ts` (existing)
  - `tests/unit/online/playerSceneRecords.test.ts` (new)
  - `tests/unit/online/sceneProtocol.test.ts` (existing; the `isPlayerMeasurement` cases)

**Interfaces:**
- Consumes: `resolveMeasurementSettings`, `formatDistance`, `pathLengthInCells`, `readUnitName` and `MAX_UNIT_NAME` (Task 1).
- Produces: `PlayerMeasurement.unitName?: string`, and `PLAYER_DIAGONAL_RULES` with `'manhattan'`. Task 17's player board reads both.

- [ ] **Step 1: Write the failing tests**
- `stockRules`: `{ unitType:'custom', unitName:' mi ', measurementMode:'metric', unitDistance:1, diagonalRule:'manhattan' }` reads with `diagonalRule === 'manhattan'` and `unitName === 'mi'`.
- `projectMeasurement` of that collection gives `{ diagonalRule:'manhattan', unitName:'mi', unitType:'custom' }`.
- A grid `unitNameOverride: 'ly'` gives `unitName:'ly'`.
- `isPlayerMeasurement` accepts `diagonalRule:'manhattan'`, and rejects a 13-character `unitName`.
- `toolGridOf(scene).label([at(0,0), at(3,3), at(5,3)])`:
  - manhattan, feet, 5: `'40ft'`;
  - custom `mi`, 1: `'8 mi'`.
- `gridUnits` of a custom `mi` measurement includes `unitType:'custom', unitNameOverride:'mi'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/online/projectForPlayers.test.ts tests/unit/online/dragRulerTool.test.ts tests/unit/connect/stockRules.test.ts tests/unit/online/playerSceneRecords.test.ts tests/unit/online/sceneProtocol.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the field changes listed under Files**

- [ ] **Step 4: Run all Connect checks, including the page build**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npm run build:page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(online): Manhattan and custom unit names, measured with Atlas 0.15's own code" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5 (Connect): Delete the rooms port

**Files:**
- Delete: `src/connect/stockRooms/` (`stockRooms.ts` and `ported/*`), `tests/unit/connect/stockRooms.test.ts`.
- Modify:
  - `src/connect/stockAtlas.ts:15,221-222`: `objects: objectsOnLevel(...)`, without `withRoomWalls`.
  - `src/connect/stockTokens/stockTokens.ts`:
    - lines 16 and 173: walls as the level has them;
    - the `rooms?: unknown` field at 38-40.
- Test: `tests/unit/connect/stockTokens.test.ts`, `tests/unit/connect/stockAtlas.test.ts`

- [ ] **Step 1: Write the failing test**

`stockTokens.test.ts`: `a 0.15 scene's room walls stop a token`. The fixture is a scene with walls `room__0_0_800_0` (`chainId: 'rooms_'`, `closed: true`) and no `objects.rooms`. A move across that wall stops before it. Also `grep -r stockRooms src` must return nothing (checked in Step 4).

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/connect/stockTokens.test.ts`
Expected: PASS already for the walls case (they are real walls). This test pins the behaviour before the delete.

- [ ] **Step 3: Delete the port and its two call sites**

- [ ] **Step 4: Run all Connect checks**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build` and `git grep -n stockRooms -- src` (expected: no output).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "refactor(connect): drop the Atlas 0.14 rooms port; 0.15 rooms are walls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6 (Connect): Pairing by `fusion`, and the not-held refusal

**Files:**
- Modify:
  - `src/app/online/scene/boardTypes.ts`:
    - add `FUSION_PROTOCOL`;
    - move `ArTableGroup` and `ArTable` in from `tools/arTable.ts`, so the file imports nothing.
  - `src/app/online/tools/arTable.ts:14-36`: import and re-export those two types from `boardTypes`.
  - `src/app/online/protocol.ts`:
    - the `join` type (85) and validator (202-203) gain `fusion?: number`;
    - `token-move-refused` (109, 228) gains `reason?: 'not-held'`.
  - `src/app/online/gmSessionAdmission.ts:24-30` (`joinSession`): `message.fusion !== FUSION_PROTOCOL` gives `host.refuse(link, 'version')`.
  - `src/app/online/page/pageScreen.ts:29`: the `version` text is `This table needs the updated player page`.
  - `src/app/online/PlayerSession.ts:342` sends `fusion`; lines 74 and 393-394 make it `onMoveRefused(tokenId, reason?)`.
  - `online-client/main.mts:406,422-424`, `online-client/mapView.mts:244` and `src/app/online/obsidian/joinFlow.ts:110` show the not-held text.
  - `src/app/online/control/TokenMoveHandler.ts:61-66,78-92`:
    - when the scene the player has is not held (`shownSnapshot` null, or `!host.holds(slot.mapPath)`; `SceneSlot.mapPath` is at `SceneSlot.ts:48`), send `reason: 'not-held'`;
    - other refusals stay without a reason.
  - `src/app/online/tools/BoardSessionHub.ts:60` (`BoardSession`) gains `readonly fusion: number`, and the hub at 190 gives `FUSION_PROTOCOL`.
  - `src/connect/tabletopMinis.ts`:
    - `isTabletopApi` (31-36) and `boardApi` (173-178) need `api.fusion === FUSION_PROTOCOL`;
    - a Tabletop API without it binds nothing, and shows one `pairingNotice(...)` per Tabletop version.
- Test:
  - `tests/unit/online/protocol.test.ts`
  - `tests/unit/online/gmSession.test.ts`
  - `tests/unit/online/pageScreen.test.ts`
  - `tests/unit/online/tokenMoveHandler.test.ts`
  - `tests/unit/connect/tabletopMinis.test.ts`
  - `tests/unit/connect/tabletopBoard.test.ts`

**Interfaces:**
- Produces:
  - `FUSION_PROTOCOL: 1`, from `boardTypes.ts`.
  - `BoardSession.fusion: number`.
  - `join.fusion`.
  - `token-move-refused.reason?: 'not-held'`.
  - `NOT_HELD_TEXT = "The GM's Atlas is on another map; try again in a moment."`, exported from `src/app/online/page/pageScreen.ts`.
- Consumes: `pairingNotice` (Task 2), and an `AtlasHost` instance passed to `TokenMoveHandler` (constructed in `stockAtlasApi` with `pluginId: 'atlas-vtt-connect'`).

- [ ] **Step 1: Write the failing tests**

Protocol and admission:
- `decodeControl` keeps `fusion: 1` on a join.
- A join with `fusion: 2`, or with none, is refused by the GM session with `{ type: 'denied', reason: 'version' }`. One with `fusion: 1` waits for the GM.
- `pageScreen` of `denied`/`version` shows `This table needs the updated player page`.

Token moves:
- `TokenMoveHandler` sends `{ type:'token-move-refused', tokenId, reason:'not-held' }` when the player's scene is not the held map.
- An uncontrolled token gives no `reason`.

Pairing:
- `tabletopBoard` with a fake Tabletop API at `fusion: 1` is `available()`.
- At `fusion` absent or `2`, it is not available, and `notify` is called once with `Tabletop for Atlas VTT 1.3.0 and Connect for Atlas VTT 0.9.0 do not match: update both to the same release.`.
- `boardTypes.ts` has no `import` line (read the file in the test).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/online tests/unit/connect/tabletopMinis.test.ts tests/unit/connect/tabletopBoard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the changes listed under Files**

- [ ] **Step 4: Run all Connect checks**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npm run build:page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src online-client tests
git commit -m "feat(online): fusion pairing number; refuse mismatched Tabletop, sessions and pages; say when Atlas is on another map" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7 (Tabletop): `sync:connect`: copy the packages and generate the wire contract

**Files:**
- Create:
  - `scripts/sync-connect.mjs`;
  - `connect-sync.json`;
  - `src/connectWire.ts` (generated);
  - `packages/atlas-shared/**` and `packages/atlas-host/**` (copied).
- Modify:
  - `src/connectContract.ts:10-115`: the wire half becomes `export * from './connectWire'`. The API half, 116 to the end, is kept, and it imports its wire types from `./connectWire`.
  - `package.json`: scripts `sync:connect` and `check:connect`.
  - `tsconfig.json`: `include` gains `"packages/**/*.ts"`.
  - The consumers that tsc flags after the switch (Connect's shapes are the truth).
- Test: `tests/connectSync.test.ts`

**Interfaces:**
- Consumes: Connect's `packages/*` and `src/app/online/scene/boardTypes.ts` at the Connect commit from Task 6.
- Produces:
  - `src/connectWire.ts`, exporting everything `boardTypes.ts` exports, including `FUSION_PROTOCOL`.
  - `connect-sync.json`: `{ "connect": { "commit": "<sha>" }, "files": { "<repo path>": "<sha256>" } }`.

- [ ] **Step 1: Write the failing test**

`tests/connectSync.test.ts`:
- `node scripts/sync-connect.mjs --check` exits 0.
- On a temp copy of the tree with a changed byte in `src/connectWire.ts`, it exits 1 with `changed: src/connectWire.ts`.
- `packages/atlas-host/src/atlasFloor.ts`'s `MIN_ATLAS_VERSION` equals `packages/atlas-shared/SOURCE.json` `tag`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL, because `scripts/sync-connect.mjs` is not found.

- [ ] **Step 3: Write `scripts/sync-connect.mjs`**

Modes:
- `--connect <dir>` copies. It requires `git -C <dir> status --porcelain -- packages src/app/online/scene/boardTypes.ts` to be empty.
- `--check` verifies offline.
- `--check --connect <dir>` also compares `packages/atlas-shared/SOURCE.json` and the generated wire with the checkout.

Copy mode:
- Copies `packages/atlas-shared` and `packages/atlas-host`.
- Writes `src/connectWire.ts` as this line, then `boardTypes.ts` verbatim:
  `// Generated by scripts/sync-connect.mjs from Connect <commit7> src/app/online/scene/boardTypes.ts. Do not edit; run npm run sync:connect.`
- Writes `connect-sync.json`, with hashes from the same CRLF-as-LF `hashFile` that Connect's `scripts/vendorHash.mjs` uses (copy the function).

Run: `npm run sync:connect -- --connect C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt`

- [ ] **Step 4: Switch `connectContract.ts` and fix the type errors**

Run: `npx tsc --noEmit`, then fix each consumer to Connect's shape. For example, `BoardWater` becomes an interface, and `BoardExtras.arTable?` appears. Never edit `connectWire.ts`.

- [ ] **Step 5: Run the Tabletop checks**

Run: `npm test && npx tsc --noEmit && npm run build && npm run check:connect -- --connect C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync-connect.mjs connect-sync.json src/connectWire.ts src/connectContract.ts packages package.json tsconfig.json tests/connectSync.test.ts src
git commit -m "build(connect): copy atlas-shared and atlas-host, generate the wire contract from Connect" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8 (Tabletop): Atlas 0.15 floor and pairing

**Files:**
- Modify:
  - `main.ts`:
    - `onload` (192-458): publish the API and attach boards only while the floor is ok;
    - `api` (407-455): add `fusion: FUSION_PROTOCOL`;
    - `attachSession` (737-757): refuse `session.fusion !== FUSION_PROTOCOL` with `pairingNotice`, and return a no-op release;
    - `onunload`: withdraw on a floor change.
  - `src/board/BoardView.ts`:
    - a `showNoAtlas(text)` beside `showNoWebgl` (1092-1115);
    - `read()` (925-972) draws nothing while the floor is not ok.
  - `src/connectContract.ts`: `BoardSession` gains `readonly fusion: number`.
- Test: `tests/atlasFloor.test.ts`, `tests/tabletopCommands.test.ts`

**Interfaces:**
- Consumes: `atlasFloor`, `watchAtlasFloor`, `floorNotice` and `pairingNotice` (Task 2, synced), and `FUSION_PROTOCOL` (Task 7).
- Produces:
  - `BoardServices.floor(): AtlasFloor`.
  - `TabletopApi.fusion: number`.

- [ ] **Step 1: Write the failing tests**

`tests/atlasFloor.test.ts` covers a `floorState(floor: AtlasFloor): { publish: boolean; boardText: string | null; notice: string | null }` helper, exported from `main.ts`'s new `src/atlasFloorGate.ts`:
- `ok` gives `{ publish: true, boardText: null, notice: null }`.
- `old 0.14.0` gives `publish: false`, the notice `Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)`, and the board text being the same sentence.
- `missing` gives `publish: true`, `notice: null` and `boardText: 'Atlas VTT is not enabled. View only.'`.

`tests/tabletopCommands.test.ts`: `attachSession` with `fusion` absent returns a function and never calls `session.onChange`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/atlasFloorGate.ts` and the wiring**

Wiring:
- The notice shows once per found version.
- A floor change publishes or withdraws the API, firing `API_READY_EVENT` or `API_UNLOAD_EVENT`, and calls `read()` on every board.

- [ ] **Step 4: Run the Tabletop checks**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add main.ts src tests
git commit -m "feat(atlas): require Atlas 0.15; pair with Connect by the fusion number" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 (Tabletop): Distances and unit names from `atlas-shared`

**Files:**
- Modify:
  - `src/board/measure.ts`, all 105 lines: keep `feetPerSquare`, and delete the rule code (`rule`, `SUFFIX`, the bodies of `pathLengthInCells` and `formatDistance`).
  - `src/board/board.ts`:
    - add `distanceLabel`;
    - use it at the measure tool label (`~3658`) and the drag ruler (`~4245-4246`);
    - `.bands` becomes `.rangeBands`.
  - `src/playerBoard.ts:153,946-950`: map Connect's `PlayerMeasurement`, including `unitName` and `'manhattan'`.
  - `src/board/BoardView.ts:697-704` (`unitDistance`): becomes `readMeasurement(this.rules.gridDefaults, this.map?.rawGrid).unitDistance` (5 when not positive). Atlas's `unitDistance` already prefers the scene's `unitDistanceOverride`, so the hand-made override read goes.
  - `src/boardLayers.ts:133-137` (`unitsOf`): unchanged. It reads one grid with no collection, and its order (the override, then the grid's distance) is the same as Atlas's `gridMeasurement`.
  - `feetPerSquare` (`measure.ts:27-36`): reads `ruleDistance`, the collection's square. Spell feet are rules squares, and Atlas converts presets with `ruleDistance`.
- Test: `tests/measure.test.ts`, rewritten.

**Interfaces:**
- Consumes: `resolveMeasurementSettings`, `pathLengthInCells`, `formatDistance` and `readUnitName` (Task 1, synced).
- Produces:
  - `type Measurement = MeasurementSettings`, re-exported from `src/board/measure.ts`.
  - `readMeasurement(collection: unknown, rawGrid: unknown): Measurement`. It sanitises the collection's `gridDefaults` as Connect's `readGridDefaults` does: unit, distance, mode, bands, `diagonalRule` (four rules), custom `unitName` and `coneAngle`. Then it calls `resolveMeasurementSettings`.
  - `pathLengthInCells(points, grid: BoardGrid, rule: DiagonalRule, rise = 0): number`, which delegates to `atlas-shared` with `{ type, size, offsetX, offsetY }`.
  - `formatDistance(cells, m)`, Atlas's own.
  - `Board.distanceLabel(points: ReadonlyArray<{x:number;y:number}>, rise = 0): string`.

- [ ] **Step 1: Write the failing tests**

Rewrite `tests/measure.test.ts`:
- Keep the existing square, hex and alternating cases.
- Add manhattan `at(0,0)→at(3,3)→at(5,3) === 8`, and the `rise` cases from Task 1.
- `readMeasurement({ measurementMode:'metric', unitType:'custom', unitName:'mi', unitDistance:1, diagonalRule:'manhattan' }, {})` gives `diagonalRule === 'manhattan'`, and `formatDistance(6, m) === '6 mi'`.
- `readMeasurement(null, { measurementType:'units', unitType:'feet', unitDistance:5, unitNameOverride:'ly' })` formats 6 as `'30 ly'`.
- `readMeasurement(collection, { unitDistanceOverride: 10 }).unitDistance === 10`. This is a fix: Tabletop used to ignore the scene's own distance.
- `formatDistance(1.4142, meters 1.5)` is `'2.1m'`, which replaces the old `'2m'`.
- A bad `diagonalRule` reads as `'equidistant'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL on manhattan and unit names.

- [ ] **Step 3: Implement `measure.ts`, `Board.distanceLabel` and the `playerBoard.ts` mapping**

- [ ] **Step 4: Run the checks and the harness ruler feature**

Run: `npm test && npx tsc --noEmit && npm run build`, then the harness with `"gm measure"` (`features-test.cjs:1786`).
Expected: PASS, with the screenshot of the ruler label in `.ui-build/shots/`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(board): Manhattan, height and custom unit names, measured with Atlas 0.15's own code" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10 (Tabletop): The asset service error on Atlas 0.15

The verified cause:
- The logged string `Initializing asset service failed` is written only at `src/atlasPort/app/packages/components/asset-manager/hooks/useAssetData.ts:213-227`. That effect runs on mount, and `AssetWindow` mounts `AssetManager` closed, as soon as the board is made.
- At that moment no Atlas view offers a service (one has not loaded yet), so `AssetService.getInstance` returns the shim's `NONE` (`src/atlasPort/shims/assetService.ts:7-11`).
- `NONE` has no `initialize`.

`src/atlasPort/app` is overwritten by `sync:atlas`, so the fix goes in the shim and in `AssetWindow`, not in the copy.

**Files:**
- Modify:
  - `src/atlasPort/shims/assetService.ts:7-11`: `NONE` gains `initialize: async () => {}`, `getCollections: async () => []` and `getDefaultCollectionId: () => 'default'`.
  - `src/assets/AssetWindow.tsx:70-80` (`render`): mount `AssetManager` only after the first successful `open()`, which is gated by `available()`, so its effect sees Atlas's running service.
- Test: `tests/atlasPortAssetService.test.ts`, plus the harness feature `asset manager without Atlas` in `harness/features-test.cjs`.

- [ ] **Step 1: Write the failing tests**

Unit test:
- `AssetService.getInstance()` with no app returns an object whose `initialize()` resolves.
- `getCollections()` resolves `[]`.

Harness feature:
- Mount a second `AssetWindow` beside the harness's own (`harness/board.ts:675`). Give it an app with no Atlas: `{ workspace: { getLeavesOfType: () => [] }, plugins: { plugins: {}, manifests: {} } }`. That way `AssetBridge.assetService()` is null, and the shim hands over `NONE`.
- Collect `page.on('console')` errors.
- Assert that none contains `Initializing asset service failed`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`, then the harness with `"asset manager without Atlas"`.
Expected: FAIL, because `initialize` is not a function, and the console error is present.

- [ ] **Step 3: Implement the two changes**

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test && npx tsc --noEmit && npm run build`, then the same harness feature.
Expected: PASS, with no console error.

- [ ] **Step 5: Commit**

```bash
git add src/atlasPort/shims/assetService.ts src/assets/AssetWindow.tsx tests/atlasPortAssetService.test.ts harness/features-test.cjs
git commit -m "fix(assets): no asset-service error before Atlas has a view (Atlas 0.15)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11 (Tabletop): The host follows the focused board; bars; read-only writes

**Files:**
- Create: `src/board/hostBar.ts`
- Modify:
  - `main.ts`:
    - construct one `AtlasHost(app, { pluginId: 'tabletop-for-atlas' })`;
    - pass it to the boards and to `TokenWriter` (219);
    - `process` becomes a function that rejects with `NotHeldError`.
  - `src/board/tokenWriter.ts:334-364`:
    - `TokenWriterDeps` gains `held(path): Promise<AtlasSceneState | null>` and `follow(path): Promise<boolean>`. `main.ts` implements `held` as `host.whenHeld(path).then((store) => store ? store.getState() as AtlasSceneState : null)`, and `views` as the host's one view.
    - Every write first uses `this.atlas`/`this.holder`, else `await deps.held(path)`, else throws `NotHeldError`.
    - `holder` stays, because `undoRecorders.ts:130,146` and Task 14 use it.
    - The old `TokenWriter.loading(path)` and `TokenWriter.whenHeld(path, ready)` are deleted. Their callers, `BoardView.sessionChanged` (1009) and `watchAtlas` (1514-1518), read `host.status()` and `host.onChange` instead.
    - `transfer` (642-668) follows D7.
  - `src/board/BoardView.ts`:
    - `onOpen` (264-311): claim the host, and follow on `pointerdown` (281) and on `active-leaf-change` for `this.leaf`;
    - `read()`: follow once on open;
    - `onClose` (359-384): release;
    - `sessionChanged` (1008-1013): drop the `Players don't see changes made here` banner;
    - the bar comes from `hostBar` through `board.setBanner`;
    - delete `openInAtlas` (1038-1065);
    - `watchAtlas` (1513-1545) follows `host.onChange`.
  - `src/atlas.ts`: `AtlasSceneState` gains `setSceneLighting?`. This is used in Task 14.
  - `scripts/check-atlas-members.mjs:13-39`: add `tabMetaStore`, `switchToTab`, `loadIfDeferred` and `setSceneLighting`.
- Test:
  - `tests/hostBar.test.ts`
  - `tests/tokenWriter.test.ts`
  - harness feature `host bars`: calls `board.setBanner` with `hostBar` output, and takes screenshots.

**Interfaces:**
- Consumes: `AtlasHost`, `HostStatus`, `HOST_LOAD_MS` (Task 2, synced).
- Produces:

```ts
// src/board/hostBar.ts
export type HostBarInput = { mapPath: string; status: HostStatus; closedByUser: boolean; failed: 'timeout' | 'no-atlas' | null; nameOf(path: string): string };
export type HostBar = { text: string; action: 'edit-here' | 'reopen' | 'retry' | null } | null;
export function hostBar(input: HostBarInput): HostBar;
// src/board/tokenWriter.ts
export class NotHeldError extends Error {}  // message: "Atlas holds another map: click Edit here first."
```

- [ ] **Step 1: Write the failing tests**

`tests/hostBar.test.ts`:
- Held: `null`.
- Held on `maps/Cove.atlasmap`: `{ text: 'View only. Atlas holds Cove.', action: 'edit-here' }`.
- `closedByUser`: `{ text: 'Atlas closed this map. Editing is paused.', action: 'reopen' }`.
- `timeout`: `{ text: 'Atlas did not open this map. View only.', action: 'retry' }`.
- `no-atlas`: `{ text: 'Atlas VTT is not enabled. View only.', action: null }`.
- Loading this map: `null`, because edits queue.

`tests/tokenWriter.test.ts`:
- `a move waits for the host and goes to its store`. With no view at the start, and `held` resolving a fake store state, `move` calls `updateToken` and never `process`.
- `queued moves keep their order`. Three moves land in the store in call order.
- `a queued move is refused when the host moves on`. `held` resolves null, `move` rejects with `NotHeldError`, and `process` is never called.
- `transfer stops before the delete when the target is not held`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `hostBar`, `NotHeldError`, the writer deps and the `BoardView` wiring**

- Button actions:
  - `edit-here` focuses the board's leaf (`setActiveLeaf(this.leaf, { focus: true })`), and the follow runs from `active-leaf-change`;
  - `reopen` and `retry` call `host.follow(path, this.leaf)`.
- `unsaved()` (1079-1082) shows a `NotHeldError` as the bar's text, not as `the … was not saved`.

- [ ] **Step 4: Run the checks and the harness feature**

Run: `npm test && npx tsc --noEmit && npm run build`, then the harness with `"host bars"`, and `npm run check:atlas -- C:/Users/joaoo/2075/sound-downloads/atlas-0.15.0/main.js`.
Expected: PASS. The members checker reports all members found.

- [ ] **Step 5: Commit**

```bash
git add main.ts src tests harness scripts/check-atlas-members.mjs
git commit -m "feat(board): one Atlas host follows the focused board; view-only bar; no file writes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12 (Tabletop): The board reads from the held store

**Files:**
- Modify:
  - `src/board/mapModel.ts:386-425`: `readMap` parses the text, then calls the new `readMapState`.
  - `src/board/BoardView.ts`:
    - `read()` (925-972): while `host.store(path)` holds the map, read `readMapState(path, store.getState(), level)`; otherwise read the file, for display only;
    - the vault `modify` handler (267-271) ignores `this.path` while it is held;
    - the store subscription (`watchAtlas`) reloads only when `mapStateChanged`.
- Test: `tests/mapModel.test.ts`

**Interfaces:**
- Produces:
  - `readMapState(path: string, state: unknown, viewedLevel?: string | null): BoardMap`
  - `MAP_STATE_KEYS = ['mapPath','background','grid','objects','levels','levelAlignments','viewedLevel','lighting','initiative','tokenSettings'] as const`
  - `mapStateChanged(prev: Record<string, unknown>, next: Record<string, unknown>): boolean`: true when any `MAP_STATE_KEYS` value differs by reference.

- [ ] **Step 1: Write the failing tests**

- `readMapState` of a store-shaped state gives the same `BoardMap` as `readMap` of `JSON.stringify({ state })`, except `rawGrid` identity. The store shape is the fixture `tests/fixtures/dungeon.atlasmap`'s `state`, with in-memory `resources` on a token and `levelAlignments`.
- `mapStateChanged ignores camera, selection and tool state`: `{...s, camera:{x:1}, selectedIds:['a'], isDragging:true, measurePopover:{}}` gives false.
- A new `objects` reference gives true.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `readMapState`, `mapStateChanged` and the `read()` source choice**

- [ ] **Step 4: Run the checks and the harness regression set**

Run: `npm test && npx tsc --noEmit && npm run build`, then the harness with `"map levels|atlas levels as layers|atlas 0.14 rooms and pin names"`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/board/mapModel.ts src/board/BoardView.ts tests/mapModel.test.ts
git commit -m "feat(board): draw from Atlas's store while it holds the map" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13 (Tabletop): Room-wall re-key (migration 1) and the doubled-wall guard

**Files:**
- Create: `src/board/roomWallMigration.ts`, `src/backups.ts`
- Modify:
  - `src/board/atlasRooms/rooms.ts:66-80`: add `hasConvertedRoomWalls`, and fix the id-format comment.
  - `src/board/mapModel.ts:420-421` (`readMapState`): skip the computed outline when `hasConvertedRoomWalls(objects.walls)`.
  - `src/board/boardData.ts`:
    - `MapData` (36-70) gains `roomWallsMoved?: true`, read and written at 140-160 and 225-250;
    - add `moveWallKeys`.
  - `src/board/BoardView.ts`:
    - after `read()` builds the map from a held store, run the migration once per map;
    - fix the stale comment at 1436-1438.
- Test: `tests/roomWallMigration.test.ts`, `tests/boardData.test.ts`, `tests/mapModel.test.ts`

**Interfaces:**
- Produces:

```ts
// src/board/atlasRooms/rooms.ts
/** Walls already hold 0.15's room walls: an id starting 'room_' with a chainId starting 'rooms_'. */
export function hasConvertedRoomWalls(walls: unknown): boolean;
// src/board/roomWallMigration.ts
export interface MigrationWall { id: string; chainId: string | null; p1: { x: number; y: number }; p2: { x: number; y: number } }
/** For each wall whose chainId starts with 'rooms_': the 0.14 key `room_${round(p1.x*8)}_${round(p1.y*8)}_${round(p2.x*8)}_${round(p2.y*8)}`, or the same key reversed, when `oldKeys` has it. One old key may map to several walls (levels sharing an edge). */
export function roomWallMoves(walls: readonly MigrationWall[], oldKeys: ReadonlySet<string>): Array<{ from: string; to: string }>;
// src/board/boardData.ts
/** Copies wallHeights, wallWidths, wallMaterials and windows from each `from` to its `to`, deletes the `from` keys, sets roomWallsMoved; returns the number of settings moved. */
moveWallKeys(mapPath: string, moves: ReadonlyArray<{ from: string; to: string }>): number;
roomWallsMoved(mapPath: string): boolean;
wallKeys(mapPath: string): Set<string>;  // every key of the four records
// src/backups.ts
/** Writes each file into `Tabletop backups/<YYYY-MM-DD>/` (a name taken gets `-2`, `-3`); returns the folder. */
export async function writeBackup(app: App, date: Date, files: ReadonlyArray<{ name: string; text: string }>): Promise<string>;
```

The run in `BoardView`:
1. Skip unless the map is held, `!roomWallsMoved(path)` holds, and `roomWallMoves(walls, wallKeys(path))` is non-empty.

   Here `walls` is every record of the held store's raw `getState().objects.walls`, on every level, read as `{ id, chainId, p1, p2 }`. It is never `BoardMap.walls`: that one is cut to the shown level and carries `chain`, not `chainId`, so it would orphan the other levels' settings once `roomWallsMoved` is set.
2. Write a backup of the `.atlasmap` text (`vault.adapter.read`) and `JSON.stringify(boardData.toJSON()[path])` as `<basename>.tabletop.json`.
3. Call `moveWallKeys`.
4. Show the notice `Tabletop: moved N wall settings to Atlas 0.15's room walls on <name>; backup in <folder>/`.

A run whose `roomWallMoves` is empty only sets `roomWallsMoved`.

- [ ] **Step 1: Write the failing tests**

`roomWallMigration.test.ts`:
- The wall `{ id:'room_L_a_x_0_0_80_0', chainId:'rooms_L_a_x', p1:{x:0,y:0}, p2:{x:10,y:0} }` with old key `room_0_0_80_0` gives `[{from:'room_0_0_80_0', to:'room_L_a_x_0_0_80_0'}]`. The level id contains underscores.
- The empty level `room__0_0_80_0` matches too.
- Negative coordinates: `p1 {x:-5,y:-2.5}` gives the key `room_-40_-20_…`.
- An old key stored reversed (`room_80_0_0_0`) matches.
- Two walls on two levels with the same endpoints both receive it.
- A wall with `chainId:'kept'` never matches.

`tests/roomWallMigration.test.ts` also covers a level that is not shown: `migrationWalls(state)` reads a store state whose `viewedLevel` is `L1`. It must return the `room_L2_…` walls of level `L2` too, so their overrides move. `migrationWalls(state: unknown): MigrationWall[]` is exported from `roomWallMigration.ts`.

`boardData.test.ts`:
- `moveWallKeys` moves height 3, width 0.2, material `Materials/stone` and window `{1,2}`, returns 4, and sets `roomWallsMoved`.
- `readBoardData` round-trips `roomWallsMoved`.

`mapModel.test.ts`:
- A state with both `objects.rooms` and converted `room_` walls with a `rooms_` chain yields only the stored walls (no doubles).
- A 0.14 file with rooms only still gets the computed outline.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement the four modules and the `BoardView` run**

- [ ] **Step 4: Run the checks and the rooms harness feature**

Run: `npm test && npx tsc --noEmit && npm run build`, then the harness with `"atlas 0.14 rooms and pin names"`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(board): carry 0.14 room-wall settings to Atlas 0.15's room walls, with a backup; no doubled outline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14 (Tabletop): Light level and tint, laser, and dice volume from Atlas

**Files:**
- Modify:
  - `src/board/tokenWriter.ts`: `setSceneLighting(path, changes: { ambient?: number; ambientColor?: string | undefined }): Promise<'atlas'>`. It is store only; `ambient` is clamped to 0..1, and an `undefined` `ambientColor` deletes it.
  - `src/board/BoardView.ts` `host()` (1318-1321):
    - `ambient()` is `map.lighting.enabled ? map.lighting.ambient : 1`;
    - `tint()` is `map.lighting.ambientColor ?? null`;
    - setters go through `writer.setSceneLighting`.
  - `src/board/toolbar.ts:652-690`: disable the ambient slider, with the D10 title, while `host.lightingOn()` is false.
  - `src/board/boardData.ts`:
    - remove `ambient`/`tint` from `MapData`, `readBoardData` (231-244), the writer (153-154) and the methods (462-519);
    - add `takeLegacyLighting(): Record<string, { ambient?: number; tint?: string }>`.
  - `src/boardLook.ts:52-53`: `ambient: null`; no `tint`.
  - `src/playerBoard.ts:961-962`: `tint` falls back to `map.lighting.ambientColor`.
  - `src/atlasBridge.ts`:
    - `laser(): LaserSettings | null`, `setLaser(changes: Partial<LaserSettings>): boolean`;
    - `diceVolume(): number` (1 without Atlas);
    - `onSettingsChange(listener: () => void): () => void`.
  - `main.ts`:
    - remove `TabletopSettings.laser` (87-88) and its use (273-276);
    - the board's `laser`/`setLaser` go to the bridge;
    - drop the dice row from the group toggles (1009-1031);
    - `soundSettings()` passes the dice volume;
    - add a once-only `fusionCarryOver()` (D10 notice and backup).
  - `src/sound/soundEngine.ts:309-318`: `configure(settings: SoundSettings, atlas: { diceVolume: number } = { diceVolume: 1 })`. The dice group's gain is `atlas.diceVolume`.
  - `scripts/check-atlas-members.mjs`: add `getLaserPointerSettings`, `setLaserPointerSettings` and `getDiceVolume`.
- Test:
  - `tests/boardData.test.ts`, `tests/atlasBridge.test.ts`, `tests/soundEngine.test.ts`, `tests/tokenWriter.test.ts`
  - harness feature `daylight tint`: update it to `lighting from Atlas`.

**Interfaces:**
- Consumes: the host store (Tasks 11 and 12).
- Produces: `AtlasBridge.laser`, `setLaser`, `diceVolume` and `onSettingsChange`, plus `TokenWriter.setSceneLighting`.

- [ ] **Step 1: Write the failing tests**

TokenWriter:
- `setSceneLighting` on a held fake store calls `setSceneLighting({ ambient: 0.4 })`, then `({ ambientColor: undefined })`.
- When the map is not held, it rejects with `NotHeldError`.

AtlasBridge, with a fake `settingsService`:
- `laser()` returns `getLaserPointerSettings()`.
- `setLaser({ color:'#00a9ff' })` calls `setLaserPointerSettings`.
- `diceVolume()` is 0.3 when `getDiceVolume()` is 0.3, and 1 without Atlas.

SoundEngine:
- `configure(settings, { diceVolume: 0.3 })` sets the dice group's gain target to 0.3, and the `minis` group's to 1.

BoardData:
- `readBoardData` of a map with `ambient: 0.5, tint: '#336699'` drops both from `toJSON()`.
- `takeLegacyLighting()` returns them once, then `{}`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement the changes listed under Files**

`fusionCarryOver` runs once, guarded by a `settings.fusion1Done` flag. It does three things:
1. It writes `Tabletop backups/<date>/board-lighting.json` when `takeLegacyLighting()` is non-empty.
2. It sets Atlas's laser from `settings.laser` when Atlas's equals Atlas's defaults (`#ff0059`, 16).
3. It shows one notice that lists what moved, and names `Dice sounds now follow Atlas's dice volume.` when `groups.dice` was false.

- [ ] **Step 4: Run the checks and the harness feature**

Run: `npm test && npx tsc --noEmit && npm run build`, then the harness with `"lighting from Atlas"`, and `npm run check:atlas -- C:/Users/joaoo/2075/sound-downloads/atlas-0.15.0/main.js`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add main.ts src tests harness scripts/check-atlas-members.mjs
git commit -m "feat(board): light level, tint, laser and dice volume are Atlas's settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15 (Tabletop): Scene tab bar in 0.15 markup

**Files:**
- Modify:
  - `src/board/sceneTabBar.ts:85-163`. Each tab is built as:
    - `[button.atlas-scene-tab__action.atlas-scene-tab__action--start (eye)]`
    - `[span.atlas-scene-tab__label: __name, an optional layer badge span.atlas-tabletop-scene-tab__layer, an optional __dirty]`
    - `[button.atlas-scene-tab__action.atlas-scene-tab__action--end (close)]`

    The tab gets `atlas-scene-tab--presented` when presented. The layers button is removed (D9): right-click keeps `layerMenu`.
  - `styles.css:1498`: the badge style, scoped to `.atlas-tabletop-scene-tabs`.
- Test: harness feature `scene tabs 0.15`, in `harness/features-test.cjs`.

- [ ] **Step 1: Write the failing harness feature**

`scene tabs 0.15`:
- Three tabs; one presented, one dirty, one with layer `+2`.
- Assert that each `.atlas-scene-tab` has exactly one `__action--start` and one `__action--end`, that `__name` is inside `__label`, and that the presented tab has `atlas-scene-tab--presented`.
- On hover, assert that the end button's `getBoundingClientRect().right` is within 8 px of the tab's right edge.
- Right-click records `['menu', id]`.
- Take a screenshot.

- [ ] **Step 2: Run it to verify it fails**

Run: the harness with `"scene tabs 0.15"`.
Expected: FAIL, because there is no `__label`.

- [ ] **Step 3: Rebuild `refresh()` to that markup**

- [ ] **Step 4: Run it to verify it passes**

Run: the harness with `"scene tabs 0.15|layer placement|layers kept and carried"`, and `npm test && npx tsc --noEmit && npm run build`.
Expected: PASS. Look at the screenshot against Atlas 0.15's own tab.

- [ ] **Step 5: Commit**

```bash
git add src/board/sceneTabBar.ts styles.css harness/features-test.cjs
git commit -m "fix(board): scene tabs in Atlas 0.15 markup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16 (Tabletop): Docs, version and the player board build

**Files:**
- Modify:
  - `README.md:3`: `**Compatible with Atlas VTT 0.15.0.** Needs Atlas VTT 0.15 or later, and Connect for Atlas VTT 0.10.0 (the same fusion release).`
  - `README.md`: a short "Editing goes through Atlas" section, explaining the host, the bar and what view-only means (D8).
  - `README.md:124`: drop the 0.13/0.14 styling lines.
  - `manifest.json`: version `1.4.0`, and a description that ends `Needs Atlas VTT 0.15 or later.`
  - `versions.json`: `"1.4.0": "1.8.7"`.
  - `package.json`: version `1.4.0`.
  - `src/parity/index.ts:7`: `ATLAS_CHECKED_VERSION = '0.15.0'`.
  - `docs/atlas-parity.md`: the checked version.
- Test: `tests/parity.test.ts`. It already compares the parity tables; add `ATLAS_CHECKED_VERSION === MIN_ATLAS_VERSION`.

- [ ] **Step 1: Write the failing assertion in `tests/parity.test.ts`**

- [ ] **Step 2: Run `npm test`. Expected: FAIL (`0.14.0 !== 0.15.0`)**

- [ ] **Step 3: Make the edits listed under Files**

- [ ] **Step 4: Run every check, then build the player board**

Run:
- `npm test && npx tsc --noEmit && npm run build`;
- `npm run check:atlas -- C:/Users/joaoo/2075/sound-downloads/atlas-0.15.0/main.js`;
- the harness with `--all`;
- `npm run check:connect -- --connect C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt`.

Expected: all PASS.

- [ ] **Step 5: Commit, then build the web board from the clean tree**

```bash
git add README.md manifest.json versions.json package.json src/parity/index.ts docs/atlas-parity.md tests/parity.test.ts
git commit -m "docs: Tabletop 1.4.0 needs Atlas VTT 0.15 and Connect 0.10 (fusion 1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --porcelain   # expected: empty, so the build records dirty:false
node scripts/build-web.mjs
```
Expected: `dist-web/SOURCE.json` has `"dirty": false` and the new commit.

---

### Task 17 (Connect): Vendor the board, docs and version

**Files:**
- Modify:
  - `vendor/tabletop/tabletop-player-board.js`, `.css`, `.d.ts`, `SOURCE.json`: copied from Tabletop's `dist-web/` by a Node copy script.
  - `README.md:3`: the same compatibility line, naming Tabletop 1.4.0.
  - `manifest.json`: version `0.10.0`, and a description that ends `Needs Atlas VTT 0.15 or later.`
  - `versions.json`, `package.json`: version `0.10.0`.
- Test: `tests/unit/connect/vendorTabletop.test.ts`: `vendor/tabletop/SOURCE.json` has `version === '1.4.0'` and `dirty === false`.

- [ ] **Step 1: Copy `dist-web` into `vendor/tabletop`**

```bash
node -e "const fs=require('fs');for(const f of ['tabletop-player-board.js','tabletop-player-board.css','SOURCE.json'])fs.copyFileSync('C:/Users/joaoo/2075/atlas-vtt-tabletop/dist-web/'+f,'vendor/tabletop/'+f)"
```
Expected: `vendor/tabletop/SOURCE.json` has `"dirty": false` and Tabletop's Task 16 commit. `build-web.mjs` emits no `.d.ts`. The hand-kept `vendor/tabletop/tabletop-player-board.d.ts` is left unchanged, because Phase 1 changes no export of the player board.

- [ ] **Step 2: Make the doc and version edits**

- [ ] **Step 3: Run every Connect check**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npm run build:page && npm run check:vendor && npm run check:shared`
Expected: all PASS. `dist-page` is built: the phase counts as done here, and hosting the page stays an open item (§5).

- [ ] **Step 4: Commit**

```bash
git add vendor/tabletop README.md manifest.json versions.json package.json tests
git commit -m "build(vendor): player board from Tabletop 1.4.0 (fusion 1); Connect 0.10.0 needs Atlas VTT 0.15" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Live check on Atlas 0.15.0 (scripted over DevTools)

The vault is `C:\Users\joaoo\fusion-gate-vault` (Atlas 0.15.0 is installed). The profile is role `fusion`, on port 9311.

**Files:**
- Create in Tabletop, under `harness/live/`:
  - `launch.cjs`, `obs.cjs` and `kill.ps1`, adapted from `C:\Users\joaoo\tabletop-promo-session\real\`. `obs.cjs` uses `PLAYWRIGHT_MODULE`, and the profile is `obs-profile\fusion`.
  - `install.cjs`: an explicit copy of the Tabletop build (`main.js`, `manifest.json`, `styles.css`) and of Connect's `dist/` into `.obsidian/plugins/tabletop-for-atlas` and `.obsidian/plugins/atlas-vtt-connect` in the vault. It never runs `deploy.mjs`.
  - `fixtures.cjs`: run with Obsidian stopped. It writes `Fusion Rooms.atlasmap` as a copy of `Probe Cellar.atlasmap` with `objects.rooms` holding two shown rooms and one hidden room, on no level. It adds Tabletop `data.json` overrides on two old ids, `room_<x1>_<y1>_<x2>_<y2>`: height 3 and material `Materials/stone`.
  - `phase1.cjs`: the steps below. It writes `.superpowers/sdd/2026-11-13-atlas-fusion/phase1-live/results.json` and screenshots there.
- Create: `.superpowers/sdd/2026-11-13-atlas-fusion/phase1-live-report.md`.

- [ ] **Step 1: Install and seed**

Run: `powershell -File harness/live/kill.ps1 -Role fusion`, then `node harness/live/install.cjs`, then `node harness/live/fixtures.cjs`.
Expected: the files are copied, and the fixture is written.

- [ ] **Step 2: Launch and run the script**

Run: `node harness/live/launch.cjs fusion 9311 C:/Users/joaoo/fusion-gate-vault`, then `node harness/live/phase1.cjs`. Each step records pass or fail with evidence. A failed step does not stop the run.

The steps:
1. **Versions:**
   - `manifests['atlas-vtt'].version === '0.15.0'`;
   - Tabletop and Connect are loaded;
   - `api.fusion === 1`;
   - Connect's Tabletop binding is available, and no pairing notice appeared.
2. **No asset-service error:** after a board opens and an Atlas view loads, the console holds no `Initializing asset service failed`.
3. **Host from nothing:**
   - Detach every Atlas leaf, then open a board on `Probe Cellar`.
   - Exactly one `atlas-vtt` leaf exists, its container has `offsetParent === null`, and the active leaf is the board.
   - The store holds Cellar loaded within 15 s.
4. **Follow and the bar:**
   - Open a second board on `Probe Cove`, and focus it.
   - The host holds Cove, the active leaf is the Cove board, and the Cellar board's banner reads `View only. Atlas holds Probe Cove.`.
   - Click `Edit here`. The host holds Cellar, the Cellar board is active, and there is still one Atlas leaf (D12).
5. **Edits:**
   - Through `leaf.view.services.writer.move(cellar, tokenId, x+70, y)` on the held board, the `.atlasmap` mtime changes within 2 s, and the token's `x` moved.
   - On the unheld Cove board, the same call rejects with `NotHeldError`, and Cove's mtime is unchanged.
6. **Popout:** move the Cove board to a popout with `workspace.moveLeafToPopout`, and focus it. The Atlas leaf stays in the main window (`getRoot() === rootSplit`), no `view.mainWindowOnly` notice appears, and the popout board is active.
7. **User closes the host:** detach the Atlas leaf. The focused board reads `Atlas closed this map. Editing is paused.`. Click `Reopen`, and the map is held again.
8. **Closing:**
   - Close both boards: there are 0 Atlas leaves, because Tabletop opened the host.
   - Open Atlas by hand on `Probe Upper`, then open and close a board. The Atlas leaf remains.
9. **Distances:**
   - With `AtlasBridge.updateCollectionSettings`, set the collection to `diagonalRule: 'manhattan'`, `unitType: 'custom'`, `unitName: 'mi'`, `unitDistance: 1`.
   - On the board, `distanceLabel` over 3 diagonal cells and 2 straight cells reads `8 mi`.
   - Restore the collection settings.
10. **Rooms migration:**
    - Open `Fusion Rooms` on a board. The host loads it, and Atlas converts it.
    - Make a trivial `updateToken` so that Atlas saves.
    - The file holds no `objects.rooms`, and holds walls `room__…` with `chainId: 'rooms_'`.
    - Tabletop's `data.json` holds the height and material under the new ids, with `roomWallsMoved: true`.
    - The backup folder `Tabletop backups/<today>/` holds `Fusion Rooms.atlasmap` (with `rooms`) and `Fusion Rooms.tabletop.json`.
    - The notice was shown, and the board's wall count equals the unique wall ids (no doubles).
11. **Light level:** with lighting on, set the slider to 0.42. The store and the file hold `lighting.ambient === 0.42`, and `data.json` holds no `ambient`.
12. **Laser and dice:**
    - Choose Sky blue on the board's laser menu: `settingsService.getLaserPointerSettings().color === '#00a9ff'`.
    - Run `settingsService.setDiceVolume(0.3)`: the board engine's dice group gain reaches 0.3 within 1 s.
    - Restore both.
13. **Scene tabs:** the board's tab bar has `__label`, `__action--start` and `__action--end`, and the presented tab has `--presented`. Take a screenshot.
14. **Pin `showName`** (verify 825c362): a pin with `showName: true` shows its name label on the board. Take a screenshot.
15. **Floor:**
    - Stop, copy `sound-downloads/atlas-0.14.0` files into the vault's `atlas-vtt` plugin, and relaunch.
    - Exactly one `Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)` notice appears, one Connect notice appears, there is no `api`, and board tabs show the reason.
    - Stop, restore the 0.15.0 files, and relaunch.
16. **Console:** across the run, no `error` entry comes from `plugin:tabletop-for-atlas` or `plugin:atlas-vtt-connect`.

- [ ] **Step 3: Stop Obsidian and write the report**

Run: `powershell -File harness/live/kill.ps1 -Role fusion`.

The report covers:
- each step's result and evidence;
- the user's checks, which need a device or ears:
  - a web player joins and drags a token while the GM's board focus is on another map, and sees `The GM's Atlas is on another map; try again in a moment.`;
  - a stale hosted page is refused (this needs the page hosted: an open item);
  - listening to dice at Atlas's volume.

Expected: every scripted step passes. If one fails, fix it in the task that owns the code, and run this task again.

- [ ] **Step 4: Commit**

```bash
git add harness/live .superpowers/sdd/2026-11-13-atlas-fusion/phase1-live-report.md .superpowers/sdd/2026-11-13-atlas-fusion/phase1-live
git commit -m "test(live): Atlas fusion Phase 1 live check on Atlas 0.15.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (§8, Phase 1):

| Requirement | Task |
|---|---|
| Version floor | 3, 8 |
| Pairing | 6, 8 (stale page via D2) |
| Single host, following the focused board | 2, 11, 12 |
| View-only bar | 11 |
| Player edits refused | 6 |
| Asset-service error | 10 |
| `atlas-shared` distances | 1, 4, 9 |
| Custom unit names | 1, 4, 9 |
| Room-wall re-key and guard | 13 |
| Delete Connect's rooms port | 5 |
| Tab bar | 15 |
| Ambient and tint, laser, dice volume | 14 |
| `showName` (verify) | 18, step 14 |
| Live check | 18 |
| READMEs, manifests, `ATLAS_CHECKED_VERSION` | 16, 17 |

Section 4.1 beyond §8:

| Requirement | Task |
|---|---|
| Queue while loading | 2, 11 |
| 15 s failure | 2, 11 |
| Closed by the user | 2, 11, 18 |
| Host opened by Tabletop closes with the last board | 2, 18 |
| Shared leaf | 2 (`HOST_MARK`) |
| Reads from the store | 12 |
| Harness never opens Atlas leaves | 11 (fakes only) |

Section 4.2 is covered as follows:
- package, sync, `SOURCE.json` and the check: 1 and 7;
- tag against the floor: 2 and 7;
- AGPL credit: 1.

Section 6, rules for migration 1:

| Rule | Where |
|---|---|
| Backup first | 13 |
| Once per map | `roomWallsMoved` |
| Notice | 13 |
| Backup never deleted | Not deleted anywhere |

Phase 2+ items, deliberately left out:
- deleting the file engines (D6);
- token elevation in rulers (D13);
- `BoardExtras.ambient`/`tint` on Connect's side (§8 Phase 4).

**Step scan:** each code step names its file, signature and spec values. The two algorithms that the signatures do not settle are written out: the `follow` order, and the re-key key. No "handle edge cases" lines remain.

**Type consistency:** the same names are used throughout:
- `AtlasHost.follow`, `whenHeld`, `holds`, `store`, `claim`, `closedByUser` and `onChange` (Tasks 2 and 11);
- `TokenWriterDeps.held`, which wraps `AtlasHost.whenHeld` (Task 11);
- `migrationWalls` (Task 13);
- `HostStatus` (Tasks 2 and 11);
- `NotHeldError` (Tasks 11 and 14);
- `FUSION_PROTOCOL` (Tasks 6, 7 and 8);
- `pairingNotice` and `floorNotice` (Tasks 2, 3, 6 and 8);
- `readMapState` (Tasks 12 and 13);
- `distanceLabel` (Tasks 9 and 18);
- `PlayerMeasurement.unitName` (Tasks 4 and 9);
- `TokenWriter.setSceneLighting` (Tasks 11 and 14);
- `moveWallKeys` and `roomWallMoves` (Task 13).

**Review Focus:** each of the five lines has a named test in its owning task, and items 1 and 5 also have live steps.

**Proportion:** about 1,500 lines, against 356 for the spec. The plan covers two repos and 18 tasks, and most of its lines are short list items. Code blocks are limited to interfaces, the follow algorithm and commands. Bodies are left to the implementer.
