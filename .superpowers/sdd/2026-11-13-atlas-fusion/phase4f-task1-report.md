# Task 1 report: ported Atlas panels re-synced at 0.15.0 (fusion 4F)

**Status: DONE.** Every check passes on the final tree. One board-suite focus flake passed on rerun.

## Commits (branch feat/atlas-fusion, local, not pushed)
- `4ce5848` feat(atlas): ported panels are copies of Atlas 0.15.0, not 0.12.0
- `014b76f` fix(atlas): 0.15 port: every text a copy names, a read-only preview, scene checks
- (this report lives under the git-ignored `.superpowers/`, like the brief and inventory: not committed)

## What was done
`node scripts/sync-atlas-port.mjs ../atlas-vtt-0.15-ref` copies Atlas 0.15.0 into `src/atlasPort/app` and `src/atlasPort/utils`
(`../atlas-vtt-0.15-ref` is now also the script's default, so a bare `npm run sync:atlas` does the same). Result: 734 files
(616 at HEAD; 1 removed: `packages/components/primitives/useScrollbarGutter.ts`, which 0.15 no longer imports). Every
copy's header reads `@ 0.15.0`. `atlasTextData.ts` holds 824 keys in en, ru and zh.

HEAD's copies were not a clean 0.12 sync. Commits 825c362, d783a80 and 244ea09 hand-edited copies so they looked like
Atlas 0.14: the palette's OverlayScroll, a hand-written `ui/dialogShell.ts` redirect, `confirmDialog.ts`,
`encounterSaveService.ts`, and the `FileTableImport.tsx` ToggleLabel. A sync from 0.12 no longer ran at all: it threw on
the OverlayScroll patch anchor. Atlas 0.15's own source has all of these, so the re-sync replaces every hand edit with
Atlas's code. No copy is edited by hand now; all copies are verbatim apart from the boundaries and the 2 patches.

## Manifest changes (`scripts/atlasPortList.mjs`)
- **ALLOWED_PACKAGES:** added `clipper2-ts`. It is reached by AssetManager → useContextMenus → assetContextMenu →
  sceneMenuEntries → mapScenes → sceneBackground → MapPersistence → legacyRooms → lighting/polygonClip. Tabletop
  already bundles it.
- **PATCHES:** the 3 OverlayScroll patches are dropped, because Atlas 0.15's palette already renders its options as the
  plain scrolling `<div ref={optionsContainerRef} className="atlas-command-palette-options">`. The 2 tabletopCommands
  patches still apply unchanged.
- **BOUNDARIES added:**
  - `host/portalHost.ts` → `portalHost.ts` (new shim; see below).
  - `react/components/command-palette/LightingSettingsPanel.tsx` → `palettePages.tsx`. Atlas 0.14's lighting page
    reads and writes `state.lighting` / `setSceneLighting` of Atlas's map view, which the board's palette store does not
    have. The parity row was already `atlas`.
  - `packages/components/asset-manager/components/BestiaryTokensOffer.tsx` and
    `.../hooks/useStarterOfferDismissal.ts` → `assetHandOffs.tsx`. The 0.15 starter tokens offer downloads a token pack
    and statblocks into the vault (`stockPacks/verifiedFetch`, `requestUrl`) and pulled in collectionBundle/*,
    SceneSnapshotService and pathRemap. That would be a second writer beside Atlas, so it is Atlas's to do.
    Cutting it took the copy from 782 to 747 files.
  - `statblocks/render/shared/noteCounters.tsx` → `handOffs.tsx`. Atlas 0.15's pressable Counters pips in a statblock
    preview write the note through Atlas's `NoteFieldWriter` (gated by Atlas's `statblockEditor` flag). That would be a
    second note writer beside Atlas's, so the board's preview stays read only, as it was at 0.12. Cutting it took the copy
    from 747 to 734 files (statblocks/notes/NoteFieldWriter, noteSource, writeQueue, openEditors and the rest are gone).
- **BOUNDARY removed:** `ui/dialogShell.ts`. Atlas 0.15's own dialog shell is now copied. It has a header, body and
  footer like the old 0.14 hand-port, plus 0.15's keyboard hold: Tab stays inside the dialog, and keys do not reach the
  asset manager behind it, which since 0.15 acts on Tab, letters and digits. The hand-ported shim
  `shims/dialogShell.ts` is deleted.

## Shims added or changed (`src/atlasPort/shims/`)
- **`portalHost.ts` (new).** Atlas 0.15's floating UI (tooltips, menus, toasts, dialogs, pickers; 12 copies) joins a
  host under `<body>`. Atlas's own `portalHost()`, the first time it makes a host, removes every
  `body > .atlas-portal-host` it does not track. Copied verbatim, it would remove the running Atlas's host and everything
  in it, and Atlas would then remove Tabletop's. The stand-in works like this:
  - It joins the running Atlas's `body > .atlas-portal-host` when there is one, so Atlas's `.atlas-portal-host` rules
    style what is in it, including the asset-card tooltips and field borders. It never removes that host.
  - Without one, it makes Tabletop's own `atlas-tabletop-portal-host` with `display: contents`. It deliberately does not
    use Atlas's class, so Atlas never takes it for one of its own stale hosts.
  - `releasePortalHosts()` removes only Tabletop's own hosts. It is wired into `main.ts` `onunload`.
  - `styles.css` restates Atlas's "hide tooltips while a dialog is open" rule for Tabletop's own host.
- **`boardOpen.ts` (useOpenAsset @ 0.15).** It follows 0.15's API: `useOpenAsset(deps, tab)`, `deps.collectionId`, a
  stable callback (Atlas's `useStableCallback`), and the scenes of the maps read ahead on the Maps tab.
  - New `openScene(deps, id)` returns a boolean: it opens the scene on the board and is false when the scene, its map
    file or the board is gone.
  - New `openMap(deps, map)` opens the collection's latest scene on that map on the board, using Atlas's copied
    `MapScenes` and `latestSceneOn`. A map with no scene yet is handed to Atlas's asset manager, as before. It does not
    dispatch Atlas's `create-scene-from-map` window event, which Atlas's own running manager also listens to.
- **`handOffs.tsx`.** Added `openStatblockNote(app, path)`, which opens the note the Obsidian way and returns
  `'missing'` when the note is gone, so the copy opens its link dialog, which hands off to Atlas. Removed
  `editInStatblockPane`, which the 0.15 copies no longer import.
- **`assetHandOffs.tsx`.** Added `collectionsByName` (Atlas's sort), the `BestiaryTokensOffer` stand-in and
  `useStarterOfferDismissal`. In the stand-in, the empty Tokens tab shows its own "create" button (Atlas's `fallback`)
  and the sidebar shows no offer.
- **`settingsService.ts`.** Added `isExperimentalOn`, passed through to Atlas's settings service and false without
  Atlas. The 0.15 copies call `settings?.isExperimentalOn(...)` in the board hotkey handler (`useMapHotkeys`) and in
  statblock counters, so without it every hotkey would throw.
- **`handOffs.tsx` also** stands in for `PressableCounters`: it renders the preview as it is (read only).
- **`palettePages.tsx`.** Added `LightingSettingsPanel`, an "Open in Atlas" page on `lighting-settings`. That is a valid
  Atlas 0.15 palette page, opened through BoardView's existing `openInAtlas`.
- **Headers:** every boundary shim's header now names `@ 0.15.0`. Each was checked against what the 0.15 copies import
  from it, with a scratch walker over the import graph listing the names imported per boundary at 0.12 and at 0.15. The
  only new names were the ones listed above.
  - Methods the copies call on stand-in objects were checked: the SettingsService methods, and the palette's
    `state.*`, `view.*` and `store.getState().*`. 0.15's CommandPalette reads no store or view member that 0.12's did
    not. The thumbnail service calls are unchanged.

## Tabletop code changed (outside src/atlasPort)
- **`main.ts`:** calls `releasePortalHosts()` on unload.
- **`styles.css`:** one rule for Tabletop's own portal host while it holds a dialog.
- **`harness/obsidian-stub.ts`:** adds `MarkdownView`, which the 0.15 copy `statblocks/notes/openEditors.ts` imports.
- **`harness/features-test.cjs`:** new feature `portal host`:
  - Without an Atlas host, a dialog goes into Tabletop's own host (`display: contents`, not Atlas's class).
  - With a seeded `body > .atlas-portal-host` holding Atlas content, the dialog joins it and Atlas's content stays.
- **`scripts/sync-atlas-port.mjs`:**
  - The default source is `../atlas-vtt-0.15-ref`.
  - Texts: every dotted string literal in a copy that is an Atlas key is now copied too. Before this, keys held in a
    table or a ternary and handed to `t()` later were silently dropped, and the GM saw the raw key. Examples:
    `am.spawned`, `am.beside` (the encounter spawn notice, already missing at HEAD), the 0.15
    `assetGrid.results.*` / `assetGrid.noResults.*` announcements, `count.*` move notices, and `loot.empty.*`. A scratch
    scan of every literal in the copies against Atlas 0.15's en table now finds 0 missing (23 before).
- **`harness/dom-polyfill.ts`:** adds Obsidian's `removeClass`. 0.15's dialog shell calls it on the portal host when
  the dialog closes; the first full run logged `pageerror: host.removeClass is not a function` in two features. This is
  harness-only: Obsidian has `removeClass`.
- **`harness/board.ts`:** the harness asset service also holds a scene (`Cove`, on `maps/cove.atlasmap`, whose map
  file's background is `art/cove.png`) and its map (`Cove map`). `getAssets` honours the type filter, and the board's
  `openMap` calls are recorded (`boardTest.openedMaps`).
- **`harness/features-test.cjs`:** new feature `asset manager scenes`:
  - A double-click on the Scenes tab opens the scene on the board, and the manager closes.
  - A double-click on the map on the Maps tab opens its latest scene on the board, through MapScenes/latestSceneOn.
  - No page error or console error is logged.
- **`scripts/check-atlas-members.mjs`:** checks `isExperimentalOn`. A parity row with `droppedIn` that is gone from the
  build prints `warn  dropped in Atlas <v>` instead of failing.
- **`docs/atlas-parity.md`:** default source, 0.15.0 source table, and the hand-port paragraph replaced: the copies are
  0.15's own, and the portal host stand-in is explained.
- **Unchanged and still working:** AssetWindow, PaletteWindow, LootWindow, the loot store, boardAtlasTools, atlasTools,
  atlasToolIcons and the BoardView builtInTemplates import. Their exported APIs did not change: AssetManager's props are
  the same, and tokenSpawnService only adds `onTarget`.

## Parity tables (`src/parity`)
- The ids already matched installed Atlas 0.15.0, and the 0.15 copy's palette ids are 0.12's plus `lighting-settings` and
  `lighting-all-settings`, which already had rows. No row was added or removed.
- Doc comments now say 0.15.0. The `maps` tab note says a map opens its latest scene on the board.
- New optional `ParityRow.droppedIn` field. The toolbar row `text` carries `droppedIn: '0.16.0'`: Atlas 0.16 took the
  Text tool off its toolbar catalog (only its hotkey stays), while the 0.15 floor still has it.

## Checks
All rows below are on the final tree (`014b76f`).

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm test` | 1122 tests: 1120 pass, 0 fail, 2 skipped |
| `npm run build` | ok |
| `npm run check:atlas -- .../atlas-0.15.0/main.js` | All 34 members found; parity tables match (exit 0) |
| `npm run check:atlas -- .../atlas-0.16.0/main.js` | All 34 members found; `warn dropped in Atlas 0.16.0: text (toolbar)`; tables match (exit 0). At HEAD this failed with `GONE from Atlas: text`. |
| UI `"random tables\|asset manager\|command palette\|loot"` (ATLAS_CSS 0.15.0) | 31/31 (includes the new `asset manager scenes`), no console errors |
| UI full `"."` | 717/717, no console or page errors |
| Board suite `harness/board-test.cjs .ui-build .ui-build/shots` | 262/262. The first run on this tree was 261/262: "Edit Initiative opens Atlas's popup ... (focused)" failed on focus timing in Tabletop's own initiative panel, which is not a port. The rerun was 262/262. |

On the first tree (`4ce5848`), the full run was 709/711. `solid-props` and `player cutscene live` failed and passed alone
(3/3, 4/4), and that run logged `pageerror: host.removeClass is not a function` (the polyfill gap, fixed).
`portal host` failed once on its own regex before the fix; it was then 14/14 with `asset manager scenes` and
`atlas css restated`.

## Behaviour a GM would notice
- **The asset manager is Atlas 0.15's rewritten window:**
  - keyboard grid navigation and announcements, type-to-search;
  - folder move and rename with Undo toasts;
  - scene markers on cards: the scene open on the board is marked, because `state.mapPath` is the board's;
  - the statblock badge opens the note;
  - the delete confirmation states what is affected.
- **Maps tab:**
  - A map's main action (Enter or double-click) and the new "Open scene of X" menu entry open that map's latest scene
    on the board.
  - A map with no scene still hands off to Atlas's asset manager to make one.
- **Hidden:**
  - The Tokens tab's 0.15 "starter tokens" download offer, both in the sidebar and as the empty-tab offer. The empty
    tab shows its plain create button instead.
  - Atlas's asset manager tours (`shouldShowTutorial` is false, as before).
  - The 0.15 pressable Counters pips in a statblock preview. The preview stays read only, as at 0.12.
- **Texts:** the encounter spawn notice ("N tokens of X spawned" / "beside the map") had no text at HEAD, and the loot
  window's empty states and the 0.15 grid and move announcements would have had none either. They are now Atlas's texts
  in every language Atlas speaks.
- **Command palette:**
  - "Lighting settings" is now a page of 0.15's palette. On the board it says the settings are Atlas's, with "Open in
    Atlas", like the grid and token pages.
  - Its options column is Atlas 0.15's own, not a patched copy.
- **Dialogs (confirm, save encounter, input):** they are Atlas 0.15's. Tab stays inside, and keys no longer leak to the
  asset manager behind.
- **Floating UI:** it now joins Atlas's host under `<body>` instead of `<body>` itself. With an Atlas host present,
  Atlas's 0.15 asset-manager tooltip and field styles apply.

## File counts: src/atlasPort/app/{grid,levels,lighting,vision}
| Folder | before (HEAD, 0.12) | after (0.15) |
| --- | --- | --- |
| grid | 6 | 7 |
| levels | 2 | 7 |
| lighting | 6 | 17 |
| vision | 3 | 17 |
| total | 17 | 48 |

(Unchanged by the noteCounters boundary.) Almost all of the growth comes from the asset manager's scene menus (mapScenes → sceneBackground → MapPersistence →
levels/lighting/vision), as decision F5 expects. Tabletop's own code imports none of the four folders.

## Left over and concerns
- **`create-scene-from-map` window event (pre-existing, also in 0.12).** The copied asset manager's effects listen on
  `window`, and so does Atlas's running global manager. When Atlas's own manager dispatches it for a map with no scene,
  Tabletop's mounted copy also records "create scene open". The next time Tabletop's manager opens, its CreateSceneModal
  stand-in hands off, with a Notice plus Atlas's manager on the scenes tab. This cannot be fixed without editing a
  copy, or making `useAssetManagerEffects` a boundary.
- **Copies that write.** Folder and scene rename (sceneRename) and the asset moves are Atlas 0.15's own code running
  against Atlas's running AssetService, as at 0.12. The new 0.15 write-side files (`MapPersistence`,
  `sceneFileWriter`) are reached for reading scenes (mapScenes). F5 accepts them, but Task 2's reviewer may want to
  confirm that no board path writes a scene file through them. The note writer is cut (noteCounters boundary).
- **Not covered by the harness.** Encounter spawn and the right-click "Open scene" / "Open scene of X" menu entries
  have no harness check. They are the same `openScene` / `openMap`, and the encounter spawn code (tokenSpawnService)
  only gains `onTarget`. Live step 55 (Task 2) should cover them.
- **Harness errors.** The harness collects page and console errors and prints them as `console errors (n)` without
  failing on them. Every run's output was grepped for TypeError, `is not a function`, Uncaught and pageerror; the only
  hit was the polyfill gap above, now fixed.
- **portalHost.** If Atlas makes its host after Tabletop made its own, later Tabletop UI goes into Atlas's host and open
  UI stays where it was. Nothing is ever removed across the two plugins.
- **`.superpowers/.../phase4e-live/results.json`** was already modified in the working tree before this task. It is
  not mine and was left uncommitted.
