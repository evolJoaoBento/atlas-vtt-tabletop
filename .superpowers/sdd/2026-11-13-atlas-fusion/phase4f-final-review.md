# 4F review: ported panels re-synced from Atlas 0.15.0

Reviewer: fresh reviewer (Opus), read-only. I did not open Obsidian or a vault, and did not run the UI harness, which was running.

## What I verified
- **The copies are verbatim.** I re-ran the sync from the clean 0.15.0 ref into a scratch directory. It made 734 files and 824 texts, and `diff -r` against `app`, `utils`, `atlasTextData.ts` and `atlasTypes.ts` finds no difference.
- **Unit tests:** `npm test` gives 1120 pass, 0 fail, 2 skipped.
- **Parity checker:** `check:atlas` exits 0 on 0.15.0 and on 0.16.0 (0.16 warns about `text`). On scratch builds:
  - a missing `isExperimentalOn` exits 1;
  - a renamed palette id exits 1;
  - a 0.15 build without `text` exits 0 (M4).
- **The writers are the same in 0.15 and 0.16.** All ten copies that write (encounter save, loot history, table notes, folder and scene moves and renames, trash) are identical in both refs. The asset service calls they make exist in both builds.

## Critical
None.

## Important

**I1. The board's asset manager refuses to rename or move a scene, and to rename or move a folder that holds one.**
- **Where:** `src/atlasPort/shims/boardLeaves.ts:7`, reached from `app/services/sceneRename.ts:15`.
- **Cause:** `saveOpenScene` calls `getLoadedAtlasView(app).getTabMetaStore()`. The stand-in returns `boardAtlasView()`, which has neither `getTabMetaStore` nor `saveMap`.
- **Probe:** a scratch bundle with a board set gives `TypeError: view?.getTabMetaStore is not a function`.
- **What the GM sees:**
  - "Rename scene" shows "Could not rename the scene".
  - Dragging a scene into a folder shows "Could not move X: view?.getTabMetaStore is not a function".
  - New in 0.15: renaming or moving a Scenes-tab folder that holds a scene rejects (`assetFolderRename.ts:39`, `assetFolderTree.ts:92`).
  - The implementer's report lists folder rename and move with Undo as a gain, but on the Scenes tab they fail.
- **Old and new:** scene rename and scene move had the same throw at 51f206a. The folder paths are new.
- **How it fails:** closed. The throw comes before any map file is renamed.
- **One edge case on move:** `assetFolderMove.ts:76`'s catch then runs `moveSceneThumbnail(newPath → old)`. If the target folder holds a stale thumbnail of the same name, that stale thumbnail replaces the scene's own, and the scene's own goes to the trash. Only a thumbnail is touched.
- **The trap:** do not fix this with a stub or a null return. The call stops Atlas's pending save from recreating the `.atlasmap` at its old path, and Atlas's host view does hold the board's map. A stub would give two writers of one file. A board with no map already skips the save for that reason.
- **Fix:**
  - `getLoadedAtlasView` has one caller, `saveOpenScene`. Spawning uses `loadAtlasView`.
  - So make `getLoadedAtlasView` return Atlas's real loaded view (`mapViews(app)` / `tabViewOf`), and keep `loadAtlasView` on the board.
  - Add a unit test: a fake Atlas view holding the map gets `saveMap`, and with none the save resolves.
  - Add a harness check for scene rename.

## Minor

**M1. The board's manager hears Atlas's create-scene-from-map event.**
- **Where:** `useAssetManagerEffects.ts:142-148`. The listener has no `isOpen` guard, and `AssetWindow` keeps the manager mounted after its first open.
- **Scenario:** in Atlas's own manager, the GM double-clicks a map with no scene. The next time each board's manager opens, the CreateSceneModal stand-in hands off: a Notice, and Atlas's manager opens on Scenes.
- **History:** this was already there at 0.12.
- **Fix:** a third option to the report's two, a manifest `PATCHES` entry that adds the guard. The sync's anchor check would notice when Atlas moves it.

**M2. Joined-host case: Atlas's unload removes Tabletop's UI.**
- **Where:** `shims/portalHost.ts:13-14` (the join), and `ContextMenuContext.tsx:192`, which caches the host at mount.
- **Cause:** Atlas's `releasePortalHosts()` on Atlas unload or reload removes the host Tabletop joined, with Tabletop's open UI. That goes against "nothing is ever removed across the two plugins".
- **What the GM sees:** the Asset, Loot and Palette windows keep their `ContextMenuProvider` mounted. After an Atlas update or toggle mid-session, their right-click menus render into a detached node and never show until the board is reopened.
- **Fix:** re-key the provider in each window's `open()` when its host is no longer `isConnected`.

**M3. Own-host case: Atlas's styles are missing.**
- **Cause:** Tabletop's own host, used while no Atlas host exists yet (Atlas's tab deferred), gets none of Atlas's `.atlas-portal-host` rules. `styles.css:2319` restates only the `--dialog` rule.
- **What the GM sees:** asset-card tooltips stay at `z-index: 100000` instead of 200, so they can cover the menus and dialogs opened from them.
- **Fix:** restate the card-tooltip rules for `.atlas-tabletop-portal-host`.

**M4. `droppedIn` does not look at the build's version.**
- **Where:** `check-atlas-members.mjs:76-79`.
- **Scenario:** a 0.15 build without `text` passes (confirmed, exit 0).
- **Fix:** read `manifest.json` beside `main.js`, and downgrade only when that version is at or above `droppedIn`.

**M5. Members the shims rely on are not in `MEMBERS`.**
- **Missing:**
  - the settings service's `getSetting` and `onChange` (`settingsService.ts:27-28`);
  - the asset service's `runExclusive`, `rewriteAssets`, `getAssetById`, `getAssets`, `initialize`, `getCollections`, `getDefaultCollectionId`.
- **Risk:** an Atlas that renamed one would pass `check:atlas` and break the board's manager. All of them are found in the 0.15 and 0.16 builds today.
- **Fix:** add the rows.

**M6. Board spawns ignore a played campaign's system.**
- **Cause:** `CampaignFiles`, `PlayedRules` and `SystemPresetFiles` are never opened in Tabletop's bundle, so `forApp` returns undefined and `mapRules.ts:18` `playedSystem` is null.
- **Effect:** spawned tokens take the collection's rolled hit points and vision defaults, not the campaign's.
- **Write paths:** none. There is no second store instance, and `updateMapRules` is unreached.
- **History:** this was already there at 0.12.
- **Fix:** a `mapRules` boundary that reads Atlas's running `PlayedRules`.

**M7. Smaller items, already there at 0.12 apart from the lighting page.**
- **The map hand-off:** for a map with no scene, the board's manager stays open, and Atlas's opens on Maps in its own collection (`boardOpen.ts:43`).
- **Two counters:** Atlas and the copy each count `atlas-asset-manager-open` separately. Closing Atlas's manager first strips the open-window styles from the board's manager.
- **"Create N scenes":** this shows the hand-off notice plus "0 scenes created" (`sceneMenuEntries.ts:52`).
- **English-only texts:** the new lighting page's "These settings are Atlas's…" / "Open in Atlas" (`palettePages.tsx:10-11`) is English in ru/zh, like the other Atlas pages.

## Verdicts
**Judge items**
1. **Write paths:** clean apart from I1.
   - The noteCounters and starter-offer boundaries cut the note writer and the pack download.
   - `MapPersistence` and `sceneFileWriter` are reached only for the pure `isPersistedMapEnvelope`.
   - Moves run under Atlas's `runExclusive`.
2. **Shims:**
   - `useOpenAsset`, the starter offer, `PressableCounters` and `isExperimentalOn` are correct.
   - So is the lighting page: `lighting-settings` is a `setCommandPaletteOpen` page in 0.15 and 0.16.
   - `portalHost` and `useOverlayBodyClass` are identical in 0.15 and 0.16.
   - Problems: I1, M2, M3.
3. **Checker:** it still fails on a missing member or id. Gaps: M4, M5.
4. **What a GM notices:**
   - No palette command or tab was added or lost (0.12's ids plus the lighting pair).
   - Texts are complete. `am.besidePartial` is missing from Atlas's own zh table, and `at()` falls back to English.
   - The window event: M1.

**Plan Review Focus**
1. Covered by the harness, apart from encounter spawn and "Open scene of X". Those share `openScene` / `openMap`, and the spawn copies differ from 0.12 only by `onTarget`.
2. Hidden or refused, never a throw, for what I swept:
   - the board-view stand-in, the one I1 fails;
   - the view-store reads outside the palette, all in `BoardState`;
   - the shims.
3. The checker passes on 0.15.0 and 0.16.0. Gaps: M4, M5.
4. Texts are complete in en, ru and zh.

## Declined to judge
- How things look in Obsidian, and the live chains.
- Whether 0.15-copy records read by Atlas 0.16 services hold beyond the identical writers above.
- The campaign and preset watchers beyond confirming they are never instantiated.
- Every copy path that reads `AtlasUIContext.view` (null on the board, as it is for Atlas's own global manager), and the palette store, which the implementer checked.
- Live step 55.

## Rulings
I disagree with none of the rulings. Two of them leave the spec to correct.

- **F1 (0.15.0 tag): agree.** The writers are identical in 0.16.
- **F2 (`clipper2-ts`): agree.**
- **F3 (initiative not re-ported): agree.** Spec line 270 and the section 9 row at line 284 still say `sync:atlas` re-syncs the tracker. Task 2 must correct them.
- **F4 (the asset manager stays a port): agree,** on the inventory's evidence (no drop payload and `view: null`).
- **F5 (the four folders): agree with the ruling.** But spec line 288 ("go when the panels are re-synced") and line 106 (`atlas-shared` replaces them) are now wrong: the folders grew from 17 to 48 files.
- **The implementer's ruling that the copies are not hand-edited: agree.** My re-sync confirms it.
