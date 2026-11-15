# 4F inventory (2026-11-15, Explore agent, read-only)

## sync:atlas
- `package.json:17` → `node scripts/sync-atlas-port.mjs [<atlas checkout>] [--dry]`; default source `../atlas-vtt-0.12-ref` (`scripts/sync-atlas-port.mjs:6,14`), version from its manifest.json (:17).
- Manifest `scripts/atlasPortList.mjs`: `PORT_ENTRIES` (:6) — 9 random-table files, 5 loot files, lootRollerSlice, LootHistoryStore, plugin/host/dom, RandomTablesPanel.tsx, asset-manager/AssetManager.tsx, CommandPalette.tsx, plus their runtime imports; type-only imports of left-out files → generated `shims/atlasTypes.ts` (`any`).
- `BOUNDARIES` (:34) ~50 → 24 stand-ins in `src/atlasPort/shims/` (useOpenAsset→boardOpen.ts, atlasLeaves→boardLeaves.ts, token creator/encounter builder/transfer dialogs→assetHandOffs.tsx, palette settings pages→palettePages.tsx, player window→palettePlayer.ts).
- `PATCHES` (:101) 5, all CommandPalette.tsx: 2 add tabletopCommands (:106,111), 3 remove OverlayScroll (:117,122,127).
- Writes: deletes src/atlasPort/app + utils, headers with source version, atlasTypes.ts, atlasTextData.ts (all languages). `ALLOWED_PACKAGES` (:91).
- Parity: `check:atlas` (`package.json:14`) → `scripts/check-atlas-members.mjs` (~35 private members in installed main.js, default ../../atlas-vtt/main.js) + toolbar/palette/assetTabs ids vs `src/parity/*`. `ATLAS_CHECKED_VERSION = '0.15.0'` (`src/parity/index.ts:7`).
- Ported files: 613, all "@ 0.12.0". A dry run at 0.12 finds 617.
- Blockers to 0.15/0.16: `lighting/polygonClip.ts imports the package clipper2-ts` (AssetManager → sceneMenuEntries → mapScenes → sceneBackground → MapPersistence → legacyRooms) — Tabletop already depends on clipper2-ts (package.json:36); the 3 OverlayScroll patch anchors are gone in 0.15/0.16 (sync throws; --dry exits before patches); 0.16 adds palette pages not yet boundaries (PlayerViewSettingsPanel, LightingSettingsPanel, paletteSearch).

## atlasPort tree
- asset-manager 103, statblocks ~170, randomTables 29, react/components ~57, services 30, gameSystems 44, creatures 19, loot 11, shims 24.
- grid(6) levels(2) lighting(6) vision(3) = 17 files; pulled in by AssetManager (16 at 0.12, 47 at 0.15), sceneLevels also by palette; 0.15 palette pulls lighting/sceneLightingOptions. Random tables / loot: none. Tabletop's own code never imports these four folders.
- Tabletop's own imports of atlasPort: three window files, BoardView.ts:73 builtInTemplates, atlasToolIcons.tsx:7 CoinIcon, atlasTools.ts:7 + boardAtlasTools.ts:5,11 keyboard/mapHotkeys, loot/boardStore.ts, loot/historyStore.ts; shims import tokenSpawnService, assetPaths, mapHotkeys.
- 19 of atlas-shared's 58 files also exist in the port (versions differ: port 0.12, shared 0.16).

## Panels
- Random tables + loot: `src/loot/LootWindow.tsx:11`, `boardAtlasTools.ts:44`; unchanged since 0.12 but for rewritten imports.
- Command palette: `src/palette/PaletteWindow.tsx:10,113`, `boardAtlasTools.ts:61`; CommandPalette differs 42/144/166 lines vs 0.12/0.15/0.16.
- Asset manager: `src/assets/AssetWindow.tsx:84`, `boardAtlasTools.ts:49`; AssetManager 8/375/375 (rewritten in 0.15); tokenSpawnService 8/15/15.
- Initiative: NOT a sync port: hand-written DOM port of Atlas 0.8's tracker (`src/board/initiativePanel.ts`, logic `initiative.ts`), mounted `BoardView.ts:343`; Atlas 0.16's tracker is React (13 components, ~30 initiative/* files). Spec line 270 / program 4F say sync:atlas re-syncs it.
- 141 of 613 ported files changed 0.12→0.16.

## Asset manager vs Atlas's global one
- Tabletop spawns via `AssetWindow.open` → `setSpawnBoard` (:56); `shims/boardOpen.ts` runs Atlas's `spawnTokenAsset` / `spawnEncounterTokens` (:28, :37), scenes open on the board (:31), maps to Atlas's global manager (:25); `assets/boardTarget.ts:53` presents the board as an Atlas view, `addTokens` through TokenWriter (:66).
- Atlas 0.15/0.16 global manager exposes no drop payload (card drags set internal state only, `useAssetCardHandlers.ts:56-60`, `ContentPane.tsx:140-141`; only `application/x-atlas-sound-rows`); `GlobalAssetManagerService.open(tab)` mounts with `view: null`, spawn via `getSpawnTarget` → Atlas's own map view. → the spec's else-branch: re-sync the port.

## Tests
- Unit: atlasPortLoot (9), lootHistoryStore (5), atlasPortAssetService (2), boardSpawn (3), atlasText (5), parity (5), builtInSheets, initiative (18).
- Harness features-test: random tables (:1486), asset manager (:1515), asset manager without Atlas (:1626), command palette (:1638, OverlayScroll CSS check ~:1557); board-test initiative cards (~:788).
