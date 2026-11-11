# Atlas toolbar parity (random tables, asset manager, command palette) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Atlas 0.12.0's Random tables (loot), Asset manager and Command palette on Tabletop's 3D board, working on the same data and acting on the board, with a parity table and a drift check covering every Atlas toolbar tool, palette entry and asset tab.

**Architecture:** Plain-DOM redraws of Atlas's panels using Atlas's own markup and class names under an `.atlas-vtt-plugin` root (Atlas's live `styles.css` styles them). Atlas's pure logic is ported verbatim-as-possible into `src/atlasPort/` with source headers. Data and library/settings writes go through Atlas's running instances via one bridge module; map writes go through `TokenWriter` (Atlas's store when it holds the map, else `vault.process`). Three parity tables in `src/parity/` drive the toolbar, palette and asset tabs, and `npm run check:atlas` compares them with ids pulled from Atlas's built `main.js`.

**Tech Stack:** TypeScript 5.8, esbuild, Obsidian API, three.js board (existing), node:test via `tests/run.mjs`, Playwright UI harness (`harness/`).

**Spec:** `docs/superpowers/specs/2026-11-02-atlas-toolbar-parity-design.md`

**Repos and branches:** Tabletop `C:\Users\joaoo\2075\atlas-vtt-tabletop`, new branch `feat/atlas-toolbar-parity` from `master`. Atlas 0.12.0 reference source (read-only) `C:\Users\joaoo\2075\atlas-vtt-0.12-ref`. Installed Atlas build `C:\Users\joaoo\2075\.obsidian\plugins\atlas-vtt\main.js` (0.12.0).

## Global Constraints

- **No commits** (Tabletop house rule, `docs/TODO-atlas-0.10.2.md`). Every task ends with a green checkpoint instead of a commit step.
- Target Atlas **0.12.0**. Atlas schemas (store fields, file shapes, ids) are checked against the **built** `main.js`; ported logic is copied from the 0.12.0 source.
- Every ported file starts with: `// Atlas source: <path under src/app> @ 0.12.0 (AGPL-3.0, ported for Tabletop).`
- Every private Atlas member Tabletop reaches is added to `MEMBERS` in `scripts/check-atlas-members.mjs`.
- Never construct Atlas's `AssetService`, never register the `atlas-loot` Bases view, never listen to or fire `create-scene-from-map`, never write Atlas's library files or `loot-history/<deviceId>.json`.
- Map writes only via `TokenWriter` (Atlas's store when Atlas holds the map, else `vault.process`).
- Panels are GM only (hidden for the player audience, as the toolbar is today: `board.ts:544`).
- Keys on the board: Random tables `L`, Asset manager **`Shift+A`**, Command palette `Space` (except while a token is carried, where Space keeps dropping ruler waypoints). Keys rebound in Atlas (`hotkeys` in Atlas's settings) for these three apply.
- Text: Atlas's own strings from its locale tables (en, ru, zh) following Obsidian's language; Tabletop's own new strings go in `src/i18n.ts` (English).
- Atlas not loaded: panels open; anything needing Atlas is disabled with the text "Needs Atlas". No throw reaches the board.
- Deploy is checksum-verified (`scripts/deploy.mjs` copy, then compare sha256 of the three files).

## Review Focus

1. **Atlas disabled or not yet loaded** (plugin missing, or loaded after Tabletop): every panel still opens, Atlas-backed controls read "Needs Atlas", and nothing throws. Tests: Task 2 `bridge without Atlas`, Task 6/9/10 harness features with no Atlas fake.
2. **Atlas holds the map in a background tab:** spawned tokens go through Atlas's `addTokens` (not the file) and appear on the board without waiting for Atlas's save. Test: Task 8 `addMany routes to Atlas store when held` + board refresh from the store subscription.
3. **Atlas writes its own history file while the panel is open:** the merged list updates, Tabletop's own file is never rewritten from Atlas's rolls, and a malformed file is skipped like Atlas does. Tests: Task 5 `merges other devices`, `ignores malformed file`, `never writes another device's file`.
4. **Crowded spawn spot / big tokens / hex grids:** spawned tokens never overlap existing ones or each other and snap like Atlas. Tests: Task 8 `spawn avoids occupied squares`, `large token`, `hex grid snaps`.
5. **Space pressed while dragging a token, or typing in a panel field:** Space drops a waypoint, not the palette; keys typed into panel inputs never reach board shortcuts (WASD, L, Shift+A). Test: Task 11 `keys`.

---

### Task 1: Parity tables and the drift check

**Files:**
- Create: `src/parity/types.ts`, `src/parity/toolbar.ts`, `src/parity/palette.ts`, `src/parity/assetTabs.ts`, `src/parity/index.ts`
- Create: `scripts/atlasIds.mjs` (pure id extraction, importable by the script and tests)
- Modify: `scripts/check-atlas-members.mjs` (run the id comparison after the member check; one exit code)
- Create: `tests/fixtures/atlas-0.12.0-ids.txt` (the catalog/palette/tab snippets cut from the built `main.js`, a few KB)
- Test: `tests/parity.test.ts`

**Interfaces:**
- Produces:
  - `type ParityStatus = 'native' | 'mapped' | 'atlas' | 'not-yet'`
  - `interface ParityRow { id: string; status: ParityStatus; note: string }`
  - `ATLAS_TOOLBAR: readonly ParityRow[]` with exactly Atlas 0.12.0's catalog ids in Atlas's order: `move, fog, draw, text, measure, wall, pin, audio, dice, loot, assets, palette` plus `undo`; statuses: `move` mapped, `measure` mapped, `dice` native, `loot` native, `assets` native, `palette` native, `undo` not-yet, the rest not-yet.
  - `ATLAS_PALETTE: readonly ParityRow[]` with every `commandOptions` id from `CommandPalette.tsx` 0.12.0 in order (move-tool, fog-tool, measure-tool, note-pin-tool, open-scene-browser, scene-snapshots, scene-levels, replace-map-image, open-dice-log, open-loot-roller, toggle-player-mode, freeze-player-camera, open-player-window, transfer-player-view, show-map-in-player-window, grid-settings, token-settings, widget-settings, local-player-view-settings, dice-settings, graphics-settings, experimental-features, customize-toolbar); statuses per the spec's palette section (move/measure mapped; loot, dice log, scene-levels, scene browser native; player-window/mode entries and settings pages that write Atlas's data `atlas`; fog, note pin, graphics, customise toolbar, scene-snapshots, replace-map-image not-yet unless Task 10 serves them).
  - `ATLAS_ASSET_TABS: readonly ParityRow[]`: `scenes, maps, encounters, tokens, party`, all native.
  - `ATLAS_CHECKED_VERSION = '0.12.0'`.
  - `extractAtlasIds(source: string): { toolbar: string[]; palette: string[]; assetTabs: string[] }` in `scripts/atlasIds.mjs`.
  - `compareIds(found: string[], listed: readonly string[]): { unlisted: string[]; gone: string[] }`.

- [ ] **Step 1: Branch.** `git -C C:/Users/joaoo/2075/atlas-vtt-tabletop switch -c feat/atlas-toolbar-parity`. Expected: on the new branch, clean tree apart from the two docs.
- [ ] **Step 2: Cut the fixture** from the installed `main.js`: the toolbar catalog array (entries shaped `{id:"loot",label:"Random tables",hotkey:"lootRoller",dmOnly:!0,…}`), the palette entries (`id:"open-loot-roller",icon:`) and the asset manager tab list. Store them verbatim in `tests/fixtures/atlas-0.12.0-ids.txt`.
- [ ] **Step 3: Write the failing tests** in `tests/parity.test.ts`:

```ts
test('extracts Atlas 0.12.0 ids', () => {
  const ids = extractAtlasIds(readFileSync('tests/fixtures/atlas-0.12.0-ids.txt', 'utf8'));
  assert.deepEqual(ids.toolbar, ATLAS_TOOLBAR.map((r) => r.id));
  assert.deepEqual(ids.palette, ATLAS_PALETTE.map((r) => r.id));
  assert.deepEqual(ids.assetTabs, ['scenes', 'maps', 'encounters', 'tokens', 'party']);
});
test('compareIds reports new and dropped ids', () => {
  assert.deepEqual(compareIds(['a', 'b', 'new'], ['a', 'b', 'old']), { unlisted: ['new'], gone: ['old'] });
});
test('every row has a note and a known status', () => { /* all three tables */ });
```

- [ ] **Step 4: Run** `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 5: Implement** the tables and `extractAtlasIds` (regexes anchored on the catalog's `hideable:` / `dmOnly:` neighbours and the palette's `,icon:`; tabs from the tab-id union as it appears in the build). Extend `check-atlas-members.mjs` to print `NEW in Atlas: <id> (<table>)` / `GONE from Atlas: <id> (<table>)` and fail on either.
- [ ] **Step 6: Run** `npm test` and `npm run check:atlas -- ../.obsidian/plugins/atlas-vtt/main.js`. Expected: PASS; check prints all members found and no NEW/GONE.

### Task 2: Atlas bridge

**Files:**
- Create: `src/atlasBridge.ts`
- Modify: `src/atlas.ts` (types only, if needed), `scripts/check-atlas-members.mjs` (`MEMBERS`)
- Test: `tests/atlasBridge.test.ts`

**Interfaces:**
- Consumes: `mapViews`, `tabViewOf`, `isAtlasView` from `src/atlas.ts`.
- Produces (`class AtlasBridge`, constructed with `app: App`, all members safe when Atlas is absent):
  - `loaded(): boolean`
  - `version(): string | null` (Atlas manifest version)
  - `assetService(): AtlasAssetService | null`: Atlas's running singleton, from `plugins['atlas-vtt']` or an Atlas view's `serviceManager.getAssetService()`.
  - `settings(): AtlasSettingsService | null`: `plugins['atlas-vtt'].settingsService`.
  - `collectionFor(mapPath: string): Promise<string | null>` (`getCollectionForMap`).
  - `collectionSettings(id: string): Promise<AtlasCollectionSettings | null>`; `updateCollectionSettings(id: string, change: (s: AtlasCollectionSettings) => AtlasCollectionSettings): Promise<boolean>` (false when Atlas absent).
  - `toolbarLayout(): { order: string[]; hidden: Set<string> }` from Atlas's saved `toolbar` setting (Atlas's default order when unset).
  - `hotkey(id: 'lootRoller' | 'assets' | 'palette'): string | null` from Atlas's `hotkeys` setting.
  - `openGlobalAssetManager(tab?: AssetTab): boolean` (`globalAssetManager.open`).
  - `runInAtlas(mapPath: string, commandId: string): Promise<boolean>`: the activate-run-restore pattern moved out of `BoardView.ts:1080-1094` (BoardView then calls this).
  - `onLoaded(listener: () => void): () => void` (fires when Atlas loads after Tabletop).
  - `AtlasAssetService` / `AtlasSettingsService` / `AtlasCollectionSettings`: duck types of only the members used, with names taken from Atlas 0.12.0's `AssetService.ts` / `SettingsService.ts` and confirmed in the build.

- [ ] **Step 1: Write the failing tests** with plain-object fakes (pattern of `tests/tokenWriter.test.ts:28-38`): `bridge without Atlas` (every method returns null/false/defaults, none throws); `uses Atlas's singleton, never constructs one`; `toolbarLayout honours hidden and order`; `hotkey reads rebinding`; `runInAtlas restores the previous leaf`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/atlasBridge.ts`; replace the inline pattern in `BoardView.ts` with `runInAtlas`. Add every member used to `MEMBERS`.
- [ ] **Step 4: Run** `npm test`, `npm run check:atlas -- ../.obsidian/plugins/atlas-vtt/main.js`, `npm run build`. Expected: all pass.

### Task 3: Atlas text in Atlas's languages

**Files:**
- Create: `scripts/sync-atlas-port.mjs` (copies the locale keys Tabletop uses from `<atlas src>/src/app/i18n/locales/{en,ru,zh}` into a generated module)
- Create: `src/atlasPort/atlasText.ts` (generated table + `at(key, values?)`), `src/atlasPort/atlasTextKeys.ts` (the list of keys used, edited by later tasks)
- Modify: `src/i18n.ts` (correct the "Atlas ships no translations" comment; `setLanguage` also sets Atlas text's language), `package.json` (`"sync:atlas": "node scripts/sync-atlas-port.mjs"`)
- Test: `tests/atlasText.test.ts`

**Interfaces:**
- Produces: `at(key: AtlasTextKey, values?: Record<string, string | number>): string` (Atlas's own interpolation syntax as in its `w()`), `AtlasTextKey`, `ATLAS_LANGUAGES = ['en', 'ru', 'zh']`.

- [ ] **Step 1: Failing tests:** `at('toolbarEdit.assets.label')` equals Atlas's English; after `setLanguage('ru')` it equals Atlas's Russian; unknown language falls back to English; every key in `atlasTextKeys.ts` exists in Atlas's English table.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the sync script (`node scripts/sync-atlas-port.mjs <atlas-src-root>`, default `../atlas-vtt-0.12-ref`) and generate `atlasText.ts`.
- [ ] **Step 4: Run** `npm run sync:atlas && npm test`. Expected: PASS.

Later tasks add the keys their markup uses to `atlasTextKeys.ts` and rerun `npm run sync:atlas`.

### Task 4: Ported loot and table logic

**Files:**
- Create under `src/atlasPort/` (verbatim ports, header per Global Constraints, imports rewritten to the port tree, React/hook code left out): `randomTables/tableModel.ts`, `tableRoller.ts`, `markdownTables.ts`, `noteTables.ts`, `tableCells.ts`, `tableResults.ts`, `resultCells.ts`, `resultMarkdown.ts`, `tableSettings.ts`, `tablePaths.ts`, `generatorParts.ts`, `generatorRoller.ts`, `generatorResults.ts`, `generatorReroll.ts`, `dieRanges.ts`, `dieOdds.ts`, `tableKind.ts`, `tableLookup.ts`, `linkedItems.ts`; `loot/lootItem.ts`, `lootRoller.ts`, `lootRarity.ts`, `lootHistory.ts`, `deviceLootHistory.ts`, `lootHistoryPaths.ts`, `lootBaseItems.ts`, `baseItemDraw.ts`; `stores/lootRollerSlice.ts` (state shape and readers only, `readLootRollerState`). Port only what the closure of these needs; anything that drags in pixi, AtlasView, PlayerWindow or AssetService is stubbed behind an interface the bridge fills.
- Create: `docs/atlas-parity.md` (table: Tabletop file → Atlas source file @ 0.12.0; started here, extended by every later task)
- Test: `tests/atlasPortLoot.test.ts`

**Interfaces:**
- Produces: Atlas's own exports unchanged, e.g. `rollTable(table, { count, noRepeats, exclude, random })`, `rollLoot(items, { count, rarity, currency, random })`, `readDeviceLootHistory`, `serializeDeviceLootHistory`, `mergeLootHistories`, `withRoll`, `withoutRoll`, `clearedHistory`, `LOOT_HISTORY_LIMIT = 100`, `LOOT_HISTORY_FORMAT = 1`, `readLootRollerState`.

- [ ] **Step 1: Failing tests** (fixed `random` sequences): `rollTable` on a d6 markdown table returns Atlas's row for each roll; `noRepeats` never repeats; `rollLoot` honours excluded rarities and count; `mergeLootHistories` sorts newest first, caps at 100, drops `removed` ids; `readDeviceLootHistory('garbage')` gives the empty history; `serializeDeviceLootHistory` round-trips; `readLootRollerState` reads a `lootRoller` block from `tests/fixtures/dungeon.atlasmap` extended with one.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Port** the files. Where Atlas's own tests exist for a ported file (`tests/` in the ref tree), port their cases into `tests/atlasPortLoot.test.ts` too.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.

### Task 5: Tabletop's loot history file

**Files:**
- Create: `src/loot/historyStore.ts`
- Test: `tests/lootHistoryStore.test.ts`

**Interfaces:**
- Consumes: Task 4 history functions; `lootHistoryPaths` (folder per collection).
- Produces: `class TabletopLootHistory` (`constructor(vault: VaultLike, collectionId: string, deviceId: string)`), `rolls(): LootRoll[]` (merged), `add(roll: LootRoll): Promise<void>`, `remove(rollId: string): Promise<void>`, `clear(): Promise<void>`, `onChange(listener): () => void`, `dispose()`. `tabletopDeviceId(storage: Storage): string`: Atlas's id from `localStorage['atlas-vtt-device-id']` + `-tabletop`, else a stored `tabletop-for-atlas-device-id` + `-tabletop`. Own file: `atlas-vtt/collections/<c>/loot-history/<deviceId>.json` where deviceId already ends in `-tabletop`.

- [ ] **Step 1: Failing tests** with a fake vault (files map + modify/create/delete events): `merges other devices`; `writes only its own file` (Atlas's `<id>.json` untouched after add/remove/clear); `never writes another device's file`; `ignores malformed file`; `picks up Atlas's new roll from a modify event`; `remove of another device's roll goes into own removed list`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** (reads every `*.json` in the folder; writes own file with `vault.process`/`create`; ignores its own write echoes).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 6: Random tables panel

**Files:**
- Create: `src/loot/tableSources.ts` (tables, generators and loot bases for a map's collection), `src/loot/LootPanel.ts` (window), `src/loot/lootPanelParts.ts` (sidebar, table summary, result cards, history list, generator controls — one function per Atlas component)
- Modify: `src/board/tokenWriter.ts` (`lootRollerInText(text, change)` + `TokenWriter.lootRoller(path, change)`; via Atlas's `updateLootRoller` when held), `src/atlasPort/atlasTextKeys.ts`, `harness/features-test.cjs`, `docs/atlas-parity.md`
- Test: `tests/lootSources.test.ts`, `tests/tokenWriter.test.ts` (new cases)

**Interfaces:**
- Consumes: `AtlasBridge.collectionFor/collectionSettings/updateCollectionSettings`, Task 4 roll functions, Task 5 `TabletopLootHistory`, `at()`.
- Produces: `class LootPanel { constructor(host: HTMLElement, deps: LootPanelDeps); open(): void; close(): void; toggle(): void; isOpen(): boolean; setMap(path: string | null): void; dispose(): void }` with `interface LootPanelDeps { app: App; bridge: AtlasBridge; writer: TokenWriter; renderMarkdown(el: HTMLElement, markdown: string, sourcePath: string): Promise<void> }`. `loadTableSources(deps, mapPath): Promise<TableSources>` returning `{ tables: RandomTable[]; generators: GeneratorSource[]; bases: LootBaseSource[]; collectionId: string | null }`.
- Markup: Atlas 0.12.0 `RandomTablesPanel.tsx` and its children (`TablesSidebar`, `TableSummary`, `TablePreview`, `TableResultCard`, `GeneratorControls`, `SourceRow`, `ResultText`), same element nesting and classes, root wrapped in a `div.atlas-vtt-plugin` mounted on the board container. Floating, draggable (header) and resizable (corner) like `.atlas-loot-roller`. Window open/position/size are the board's own (kept in the board's view state per map).
- Shared choices (`lootRoller` block in the map: disabled tables, excluded rarities, count, pane, selected) read with `readLootRollerState`, written with `TokenWriter.lootRoller`.
- Loot bases: rendered by Obsidian (`renderMarkdown` of the base embed Atlas's loot view uses) so Atlas's registered `atlas-loot` view supplies items; if no items can be read, the base row shows Atlas's "open in Atlas" hand-off (`bridge.runInAtlas(map, 'atlas-vtt:toggle-loot-roller')`).
- Table rename / no-repeats / remove-with-undo go through `bridge.updateCollectionSettings`; disabled with "Needs Atlas" when it returns false. Import/paste table hands off to Atlas.
- "Give" and "Show to players" are not drawn.

- [ ] **Step 1: Failing tests:** `lootRollerInText` writes only the `lootRoller` block (rest of the file byte-identical); `TokenWriter.lootRoller routes to Atlas store when held`; `loadTableSources` lists collection tables and generators from a fake bridge and returns empty lists (not a throw) without Atlas.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** sources, writer and panel.
- [ ] **Step 4: Harness feature** `random tables`: open with the button, roll a fixture table, result card appears, history shows it, drag and resize the window; with and without a fake Atlas (no fake → "Needs Atlas" on rename). Screenshot beside one of Atlas's panel taken with Atlas's css.
- [ ] **Step 5: Run** `npm test && npm run test:ui && npm run build`. Expected: PASS.

### Task 7: Asset library reader

**Files:**
- Create: `src/assets/assetLibrary.ts`
- Test: `tests/assetLibrary.test.ts`

**Interfaces:**
- Consumes: `AtlasBridge.assetService()` read methods (named from Atlas 0.12.0 `AssetService.ts`, added to `MEMBERS`).
- Produces: `class AssetLibrary { constructor(bridge: AtlasBridge, vault: VaultLike); list(tab: AssetTab, collectionId: string | null): Promise<AssetEntry[]>; search(entries: AssetEntry[], query: string): AssetEntry[]; thumbnail(entry: AssetEntry): string | null; onChange(listener: () => void): () => void }`, `type AssetTab = 'scenes' | 'maps' | 'encounters' | 'tokens' | 'party'`, `interface AssetEntry { id: string; tab: AssetTab; name: string; path: string; folder: string; tags: string[]; raw: unknown }`. `onChange` follows Atlas's `atlas-vtt:refresh-assets` and `atlas-vtt:collection-settings-changed` workspace events (listen only).
- Without Atlas: read-only parse of Atlas's index files under `atlas-vtt/` (shape taken from the build); never writes.

- [ ] **Step 1: Failing tests:** lists each tab from a fake asset service; `search` matches Atlas's rules (name and tags, case-insensitive; port Atlas's matcher if it has one); `without Atlas reads index read-only` (fake vault records zero writes).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.

### Task 8: Spawning onto the 3D board

**Files:**
- Create: `src/atlasPort/spawn/tokenSpawnData.ts` (pure parts: `spawnRules`, `buildTokenData`, hit-point rolls, vision defaults), `src/atlasPort/encounters/encounterFormation.ts`, `src/assets/boardSpawn.ts`
- Modify: `src/board/tokenWriter.ts` (`addTokensInText(text, tokens)`, `TokenWriter.addMany(path, tokens): Promise<{ ids: string[]; via: 'atlas' | 'file' }>`, Atlas's `addTokens` when held), `src/board/BoardView.ts` (refresh tokens from the Atlas store subscription when Atlas holds the map, so store-added tokens show before Atlas saves; select spawned ids)
- Test: `tests/boardSpawn.test.ts`, `tests/tokenWriter.test.ts`

**Interfaces:**
- Consumes: `spiralSpot` (`src/board/spiral.ts`), `TokenWriter.initiative`, Atlas 0.9 `offMap` handling already in Tabletop.
- Produces: `boardSpawnTarget(board: { cameraTarget(): { x: number; y: number }; grid: GridOptions; occupied(): Occupant[] }): SpawnTarget` (Atlas's `SpawnTarget` shape: grid options, `snapTokenCenter`, pitch, viewport centre in world pixels); `spawnTokens(deps, mapPath, entries: AssetEntry[], count: number, placement: 'map' | 'fight' | 'beside'): Promise<string[]>`; `spawnEncounter(deps, mapPath, encounter: AssetEntry, placement): Promise<string[]>`.

- [ ] **Step 1: Failing tests:** `spawn avoids occupied squares`; `large token` (size 3 gets a free 3×3); `hex grid snaps` like Atlas's `snapTokenCenter`; `encounter keeps saved formation`; `fight joins initiative`; `beside adds off-map combatants`; `addMany routes to Atlas store when held` (one `addTokens` call = one undo step); `addTokensInText` keeps the rest of the file byte-identical.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.

### Task 9: Asset manager panel

**Files:**
- Create: `src/assets/AssetManagerPanel.ts`, `src/assets/assetManagerParts.ts`
- Modify: `src/board/BoardView.ts` (open a scene on the board: switch the board to that map and let Atlas follow as scene tabs do), `src/atlasPort/atlasTextKeys.ts`, `harness/features-test.cjs`, `docs/atlas-parity.md`
- Test: harness feature

**Interfaces:**
- Consumes: `AssetLibrary`, `spawnTokens` / `spawnEncounter`, `AtlasBridge.openGlobalAssetManager`, `ATLAS_ASSET_TABS`.
- Produces: `class AssetManagerPanel { constructor(host: HTMLElement, deps: AssetManagerDeps); open(tab?: AssetTab): void; close(): void; toggle(): void; isOpen(): boolean; setMap(path: string | null): void; dispose() }`.
- Markup: Atlas 0.12.0 `AssetManager.tsx` and its tab/list/card components, same classes, in `div.atlas-vtt-plugin`; full-screen over the board. Tabs drawn from `ATLAS_ASSET_TABS`. Spawn menu entries as Atlas's `spawnMenuEntries.ts` (map / fight / beside for encounters; count for tokens; multi-select).
- Hand-offs (each a parity note): new/edit token, encounter builder, create scene from map, dungeon generator, collection settings, import → `bridge.openGlobalAssetManager(tab)` or the Atlas command; disabled "Needs Atlas" when unavailable. Library edits (rename, delete, tags) through `bridge.assetService()`; "Needs Atlas" when null.

- [ ] **Step 1: Harness feature** `asset manager` (failing first): opens on `Shift+A` and the button; switches tabs; search filters; spawning a token puts it at the camera centre and selects it; spawning an encounter with "fight" adds initiative rows; opening a scene switches the board; without Atlas, edit controls read "Needs Atlas".
- [ ] **Step 2: Run** `npm run test:ui`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run test:ui && npm run build`. Expected: PASS.

### Task 10: Command palette

**Files:**
- Create: `src/palette/CommandPalette.ts`, `src/palette/paletteCommands.ts` (one handler per `ATLAS_PALETTE` row), `src/palette/pages/` (only the sub-pages Tabletop serves: `sceneLevels.ts`, `tokenSettings.ts`)
- Modify: `src/atlasPort/atlasTextKeys.ts`, `docs/atlas-parity.md`, `src/parity/palette.ts` (statuses final)
- Test: `tests/paletteCommands.test.ts`, harness feature

**Interfaces:**
- Consumes: `ATLAS_PALETTE`, `AtlasBridge.runInAtlas`, `LootPanel.toggle`, the board's dice log toggle, move tool and drag ruler, scene levels/layers, Atlas's `openSceneBrowser` (existing `BoardView.ts:1071-1078`).
- Produces: `class CommandPalette { constructor(host: HTMLElement, deps: PaletteDeps); open(page?: string): void; close(): void; toggle(): void; isOpen(): boolean; dispose() }`; `paletteCommands(deps): PaletteCommand[]` with `interface PaletteCommand { id: string; label: string; icon: string; status: ParityStatus; run(): void | Promise<void>; enabled(): boolean }`.
- Behaviour: Atlas 0.12.0 `CommandPalette.tsx` markup, order, filter and keys (type to filter, ↑/↓, Enter, Escape, sub-page back). `not-yet` rows dimmed with "Open in Atlas" (runs `bridge.runInAtlas` for that entry's equivalent or brings Atlas's leaf up). `atlas` rows run in Atlas via `runInAtlas`. Settings pages that write Atlas's data go through `bridge.settings()`; "Needs Atlas" without it.

- [ ] **Step 1: Failing tests:** `paletteCommands` returns one command per `ATLAS_PALETTE` row in order; every `native`/`mapped` row has a handler that calls the expected board dep (fake deps record calls); `not-yet` rows are enabled only with Atlas loaded; filter matches Atlas's (port Atlas's matcher).
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**, then the harness feature `command palette` (opens on Space, filters, Enter runs "Random tables" and the loot window opens, Escape closes).
- [ ] **Step 4: Run** `npm test && npm run test:ui && npm run build`. Expected: PASS.

### Task 11: Toolbar, keys and the Atlas-version notice

**Files:**
- Modify: `src/board/toolbar.ts` (an Atlas-tools group after Tabletop's groups and before the end slot, built from `ATLAS_TOOLBAR` rows with status `native` whose ids are `loot`, `assets`, `palette`, in `bridge.toolbarLayout()` order, minus hidden; joins the existing overflow `fit()`), `src/board/board.ts` (keys), `src/board/BoardView.ts` (owns the three panels, disposes them, `setMap` on map change, hides them for the player audience), `main.ts` (settings tab notice), `src/i18n.ts`
- Test: `tests/toolbarAtlasTools.test.ts`, harness feature

**Interfaces:**
- Consumes: Tasks 1, 2, 6, 9, 10.
- Produces: `atlasToolButtons(layout: { order: string[]; hidden: Set<string> }): Array<'loot' | 'assets' | 'palette'>` (pure); `boardKey(event: KeyboardEvent, state: { carrying: boolean; typing: boolean; hotkeys: AtlasHotkeys }): 'loot' | 'assets' | 'palette' | null` (pure); `atlasNewerThanChecked(installed: string | null): boolean`.
- Icons: Atlas's lucide icons (Coin, Image, Command) as inline SVG like the existing ones; reuse the unused `COMMAND_SVG` (`toolbar.ts:111`).
- Settings tab: when `atlasNewerThanChecked(bridge.version())`, one line: Tabletop's text "Atlas {installed} is newer than the version these tools were checked against ({checked}); some of Atlas's newest tools may be missing on the board." (new `i18n.ts` key `parity.newerAtlas`).

- [ ] **Step 1: Failing tests (`keys`):** `boardKey` gives `palette` for Space only when not carrying; nothing while typing in an input; `assets` for Shift+A and not for A; `loot` for L; a rebound Atlas hotkey wins; `atlasToolButtons` drops hidden ids and follows order; `atlasNewerThanChecked('0.12.1')` true, `('0.12.0')` false, `(null)` false.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**; WASD panning unchanged.
- [ ] **Step 4: Harness feature** `atlas tools on toolbar`: three buttons present for GM, absent for player audience, move into "More tools" when narrow, hidden one stays hidden.
- [ ] **Step 5: Run** `npm test && npm run test:ui && npm run build`. Expected: PASS.

### Task 12: Docs, check, deploy

**Files:**
- Modify: `README.md` (`## Use`: bold bullets for Random tables, Asset manager, Command palette, house style, British English), `docs/atlas-parity.md` (complete; "How to upgrade to a new Atlas" section: run `npm run check:atlas`, diff the listed Atlas files between versions, apply, `npm run sync:atlas`, bump `ATLAS_CHECKED_VERSION`)

- [ ] **Step 1:** Write the README and parity doc.
- [ ] **Step 2: Verify** `npm test`, `npm run test:ui:all`, `npm run check:atlas -- ../.obsidian/plugins/atlas-vtt/main.js`, `npm run build`. Expected: all pass, no NEW/GONE ids.
- [ ] **Step 3: Deploy** `npm run deploy`, then compare sha256 of `main.js`, `manifest.json`, `styles.css` between the repo and `../.obsidian/plugins/tabletop-for-atlas`. Expected: identical.
- [ ] **Step 4: Manual check in Obsidian** (user): each panel with Atlas holding the map and with Atlas's tab closed. Report results; don't claim done before.
- [ ] **Step 5:** Remove the reference worktree: `git -C ../.obsidian/plugins/atlas-vtt worktree remove ../../../atlas-vtt-0.12-ref` (only after the user confirms they're done with the build; it lives inside the vault).
