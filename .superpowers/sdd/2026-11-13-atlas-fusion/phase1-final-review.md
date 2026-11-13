# Final review: Atlas fusion Phase 1 (Tabletop 1.4.0, Connect 0.10.0, fusion 1)

Reviewed read-only on 2026-11-13.
- Tabletop `C:\Users\joaoo\2075\atlas-vtt-tabletop`, `feat/atlas-fusion`, `c734667..2a1b058` (clean tree).
- Connect `C:\Users\joaoo\2075\atlas-vtt-connect-cutscenes-wt`, `feat/atlas-fusion`, `beab3a7..1855b19` (clean tree).
- Against the spec (sections 4.1, 4.2, 5, 6 migration 1, 8 Phase 1, 11), the plan, the ledger's rulings and the live report.
- Atlas's behaviour was checked in the stock 0.15.0 source (`atlas-view.ts`, `MapService.ts`, `plugin/atlasLeaves.ts`, `lighting/legacyRooms.ts`, `MapPersistence.ts`, `SettingsService.ts`).

**Verdict: ready to merge with fixes.** No Critical issue. Five Important issues, none of which loses or corrupts a map.

## How this review was done (coverage)

One reviewer, several passes, no subagents, no test or build runs.
- Read as whole files: `packages/atlas-host/src/atlasHost.ts`, `atlasFloor.ts`, `hostLeaf.ts`, `pairing.ts`, `index.ts` and most of `wake.ts` (both repos' `packages/` are byte-identical, checked with `diff -r`); Tabletop's `roomWallMigration.ts`, `backups.ts`, `atlasFloorGate.ts`, `measure.ts`, `scripts/sync-connect.mjs`.
- Read as full diff hunks (with their 10 lines of context, plus the surrounding code where a finding needed it): Tabletop's `tokenWriter.ts`, `BoardView.ts`, `main.ts`, `boardData.ts`, `mapModel.ts`, `hostBar.ts`, `atlasBridge.ts`, `AssetWindow.tsx`, `board.ts`; Connect's `atlasLink.ts`, `tabletopMinis.ts`, `TokenMoveHandler.ts`, `gmSessionAdmission.ts`, `protocol.ts`, `pageScreen.ts`, `stockAtlas.ts`, `PlayerSession.ts`.
- Read as changed lines only (no context): `toolbar.ts`, `sceneTabBar.ts`, `soundEngine.ts`, `soundSettings.ts`, `boardLook.ts`, `playerBoard.ts`, `connectContract.ts`; Connect's measurement changes (`stockRules.ts`, `projectForPlayers.ts`, `sceneValidation.ts`, `toolGrid.ts`, `playerSceneRecords.ts`) and its page and player-side plumbing for the refusal reason.
- Tests: read the test names of both diffs and the bodies of the host tests that carry Review Focus 1 and the claim test. The other test bodies were not read.
- Checked by hand or by a scratch script: the version parser on 13 odd strings; `src/connectWire.ts` equals Connect's `boardTypes.ts` after the header line; `connect-sync.json`'s commit (`6cfb5e9`) is the last Connect commit that touched `packages/` or `boardTypes.ts`.
- Not reviewed: `styles.css`, the READMEs beyond their first lines, the harness and live scripts, `scripts/check-atlas-members.mjs`, Connect's `sync-atlas-shared.mjs`, `check-shared.mjs` and `sharedImports.mjs`, the test fakes, and what the diffs leave out by design (the copied Atlas files, the generated wire file's content, the vendored player board bundle, lock files).

## Strengths

- **The wrong-map guarantee holds.** Every `TokenWriter` write re-reads the holder synchronously after its wait and calls the action on the live store of the view whose `mapPath` equals the edit's path. There is no `await` between the last held check and the store action in any write, including `setSceneLighting` and both steps of `transferHeld`. A queued edit that finds the map not held falls to `process`, which the plugin wires to throw `NotHeldError` (`main.ts:242`). I found no path that applies an edit to another map's store.
- **No map file is written by the code this phase touched.** A grep of Tabletop's `src` and `main.ts` for vault and adapter writers leaves the gallery, materials, sounds, snapshots and `backups.ts`. `processFile` and `recordedProcess` are gone from `main.ts`. The one file ending in `.atlasmap` that Tabletop writes is the backup copy under `Tabletop backups/<date>/`. In Connect the session code (`src/connect`, the token move handler) has no map writer; `resourceVisibility.ts` and `partyLinks.ts` write Connect's own JSON. The sharing code's writers (`sharing/dataFile.ts`, `merge/MergeHistory.ts`, `receive/notePull.ts`) and Tabletop's ported Atlas code were not changed by this phase and I did not trace them to their paths (see "Declined to judge").
- **The held test matches what Atlas really does.** In stock 0.15, `runLoad` sets `isMapLoading` first, then `mapLoaded = false`, then `mapPath`, then clears the objects (`clearMapState` leaves both flags alone), and sets `mapLoaded = true` last. So `mapPath === M && mapLoaded !== false && isMapLoading !== true` is never true over another map's objects or over an emptied store, at any step of a tab switch or a failed load.
- **`view.onLoadFile(file)` (Task 2 ruling) is Atlas's own way.** `openMapInView` and `mergeDuplicateAtlasLeaves` call exactly that. It flushes the previous map's pending saves before it loads, so the ruling is sound.
- **Held writes stay synchronous** (`if (this.holder(path) === null) await this.ready(path)`), so the undo recorder still counts Atlas's history steps on return. This is a careful detail that a plain `await` would have broken.
- **Store churn is handled at two levels.** `AtlasHost.changed()` fires listeners only when its status key changes, and `watchAtlas` reloads only on a reference change of ten named keys, behind a 300 ms resetting debounce.
- **The room re-key is by endpoints and chain**, never by parsing the id, reads every level's walls from the raw store, tries the reversed edge, copies one old key to several walls, and aborts when the backup fails.
- **The version parser fails closed**: `''`, `undefined`, `'x.y'`, `'v0.15.0'`, `'0.15.0.1'` and `'0.15.0+build'` all read as old; `'0.15.0-beta.1'` is old; `'0.15'`, `'0.15.10'`, `'1.0.0'` and `'0.16.0-beta.1'` are ok.
- **Pairing is refused in all three places** (API, session, join), a missing number is refused like a wrong one, and a join whose `fusion` is not a safe integer is dropped by the validator.
- **The live check found and fixed a real defect** (collection settings not reaching an open board), in the product rather than in the script.
- Copy: no em dash in any added line of either diff; the floor notices, the two bar texts, the stale-page text and the player refusal text match the plan's Global Constraints letter for letter.

## Review Focus: result for each of the plan's five lines

| # | Focus | Result |
|---|---|---|
| 1 | Edit queued for A, host ends on B | **Safe.** Never applied to B, never written to A's file. Caveat: when Atlas ends on B by anything other than a `follow` through this host, the refusal takes up to 15 s (Minor 1), and that variant has no test. |
| 2 | Store churn | **Pass.** Atlas's store is written through immer, and `setCamera`, `setSelection` and `setIsDragging` each assign only their own key (`storeFactory.ts:589`, `:804`, `:812`), so none of `MAP_STATE_KEYS` gets a new reference. Popovers and the dice tray were judged by their key names, not traced. A token dragged in Atlas does replace `objects` each step, and the resetting debounce holds the board's reload until the drag pauses. |
| 3 | Odd version strings | **Pass on the stock path.** The fork path lets an unreadable version through by ruling (see "Rulings"). |
| 4 | Room re-key on awkward data | **Pass** for the five named cases. Two neighbouring gaps are Minor 3 and Minor 4. |
| 5 | Board in a popout or sidebar | **Pass in code and in the fake.** Live step 6 ran with a host that already existed, so opening a host from nothing while the board is in a popout or a sidebar was not exercised live (Testing). |

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. Connect never claims the host, so Tabletop closes Atlas's tab under a live Connect session.**
- Where: `packages/atlas-host/src/atlasHost.ts:249-266` (release), Connect `src/connect/` (no `AtlasHost`, no `claim()` anywhere in `src` or `online-client`; `HostMark.claims` is documented as "boards or sessions").
- What is wrong: the spec has both plugins share one host leaf (section 4.1, "Both plugins on one map"), and the mark was built so a session counts as a claim. The Task 6 ruling removed the `AtlasHost` from `TokenMoveHandler` for a good reason (one source for "held"), but nothing replaced the claim.
- Failure scenario: the GM opens a 3D board with no Atlas tab open, so Tabletop opens the hidden host and marks it `openedBy: tabletop-for-atlas`. The GM starts hosting; Connect's stand-in reads that one view. The GM closes the board tab (for example to open another map's board from the file list). The release finds no claim and detaches the leaf. Connect now has no Atlas view: `presentation.current()` finds no owner for the presented scene and answers null (`stockAtlas.ts`, `current`). I did not trace what the scene hub then sends (its header says it clears when nothing is presented), so the exact player-side effect is inferred: at best a frozen last scene, at worst a cleared one, until the GM opens Atlas again and presents.
- Fix: Connect constructs an `AtlasHost` with `pluginId: 'atlas-vtt-connect'` and holds a claim while it is hosting (released when hosting stops). That also makes the Task 2 ruling ("detach a leaf any plugin opened") reachable and worth its test.

**I2. Tabletop closes an Atlas tab the user has since made their own.**
- Where: `packages/atlas-host/src/atlasHost.ts:173` (`openedBy ??=`) and `:261-263` (detach).
- What is wrong: `openedBy` is set once and never cleared. Stock Atlas sends every later "open this scene" to the one existing leaf (`openMapInView` reveals it and calls `onLoadFile`; a second leaf is folded into the first one in the main window).
- Failure scenario: the GM opens a board (Tabletop opens the hidden tab), then opens a scene in Atlas from Atlas's asset manager or dashboard. Atlas brings Tabletop's tab to the front with that scene, and the GM works there in 2D. The GM closes the 3D board. Tabletop detaches the tab the GM is looking at, with all its scene tabs. Nothing is lost (Atlas saves on close), but the user's Atlas view vanishes.
- Fix: stop treating the leaf as Tabletop's once the user has taken it. For example clear `openedBy` when the host leaf becomes the active leaf by anything other than this host's own recipe, or refuse to detach at release when the leaf is active or shown.

**I3. Players on the 3D board get no message when their move is refused as not held.**
- Where: Tabletop `src/playerBoard.ts:87` and `:340` (`moveRefused(_tokenId)` only reloads); Connect `src/app/online/obsidian/BoardSceneView.ts:154` passes the reason on to a board that ignores it.
- What is wrong: the spec's text ("The GM's Atlas is on another map; try again in a moment.") reaches the web page and the Obsidian 2D player. The Task 6 ruling deferred the 3D board's text to "Task 11/16's board", and it never arrived: the vendored bundle contains neither the reason nor the text.
- Failure scenario: a player on Tabletop's 3D player board drags their token while the GM's focus is on another map's board. The token snaps back and nothing says why. The spec's success criterion is the same behaviour "whether those players use the 2D page or the 3D board".
- Fix: take the second argument in `playerBoard.ts` and show the text (the board already has a banner), rebuild `dist-web`, vendor it again in Connect.

**I4. Adding tokens is never queued, and one caller fails without a word.**
- Where: `src/board/tokenWriter.ts:581-590` (`addTokensNow` checks `holder` once and never waits), `src/assets/boardTarget.ts:65-66` (only `console.error`), `src/board/BoardView.ts:1313-1314`.
- What is wrong: spec section 4.1 says edits made while the host loads are queued in order. Every other write waits through `ready()`. `addTokensNow` is synchronous by contract, so while Atlas is on its way to the map it goes straight to the throwing `process`, and it still returns ids for tokens that were never made.
- Failure scenario: Atlas is on its way to the board's map (the GM came back from another board a moment ago, or the map is large and still loading; the asset manager opens as soon as any Atlas view exists, `AssetWindow.available()`), or the board is view-only. The GM drops a token or an encounter from the asset manager. Nothing appears, and the only trace is a console error. A summoning spell in the same state returns ids of tokens that do not exist and shows the bar's text.
- Fix: for the asset manager and summons, wait for `held(path)` before adding (an async variant that resolves the ids), and show the refusal through `unsaved()` in `boardTarget.ts` too.

**I5. The light-level backup is not "backup first": two paths drop the old values with no backup and no notice.**
- Where: `main.ts:649` (early return), `main.ts:652-668`, `src/board/boardData.ts:234` and `:511`.
- What is wrong: `readBoardData` already leaves `ambient` and `tint` out of what is saved, and keeps them only in memory until `takeLegacyLighting()`. From that moment any `save()` writes a `data.json` without them.
  1. `fusionCarryOver` returns early when the user has a laser of their own and Atlas's settings are not there (`ownLaser && !bridge.laser()`). The lighting backup is behind the same gate. If Tabletop's data is saved in that session (placing a prop is enough) and Obsidian is closed before Atlas is enabled, the values are gone and the backup is never written.
  2. When `writeBackup` throws, the code logs a warning and still sets `fusion1Done`. The values are gone, and the notice line is skipped.
- Why it matters: the spec names "silent data loss on upgrade" as an anti-goal ("survive, or be backed up and reported"), and D10 promises this backup. What is lost is small (per-map light levels and tints the user would have to re-enter in Atlas) and the first trigger is narrow (a laser of the user's own, Atlas disabled on the first run after the update). It is graded Important because it is the one place the phase can break that anti-goal, not because of how often it will happen.
- Fix: write the lighting backup before, and independently of, the laser gate; on a backup failure keep the values (do not set `fusion1Done`, or put them back) and say so.

### Minor (Nice to Have)

1. **A follow that Atlas leaves by another road waits out the full 15 s** (`atlasHost.ts:125`, `:188-205`). `untilHeld` ends only on held, superseded-by-`follow`, or the timeout. If Atlas ends on B by Connect's Present, a fold of a second Atlas leaf, or a failed load that puts the previous map back, queued edits for A wait up to 15 s before they are refused, and a press on board A during that time joins the doomed promise instead of following again. Nothing is misapplied. Fix: finish early when the host is held on another map and not loading.
2. **The disabled state still drives Atlas** (`BoardView.ts:301`, `:1096-1111`). With Atlas older than 0.15 the board tab shows the floor text, but `onOpen` still claims the host, and a press or the tab becoming active still calls `host.follow`, which switches Atlas 0.14's map or opens a tab in it. Fix: return from `followHost` (and skip the claim) while `showFloor()` is true.
3. **After the re-key, a board that falls back to the file can show room walls without their settings** (`mapModel.ts:439`, `BoardView.ts:1060`). Atlas converts rooms as it reads the file (`MapPersistence.ts:265`), and appears not to save until something changes (I saw no save in the read path, and the live script makes a token edit "so that Atlas saves"). Until then the file still has `objects.rooms`, so a view-only board (and a stacked layer, which always reads the member's file) draws the computed outline under the old ids, while the settings now sit under the new ids. Display only, and it heals once Atlas saves or holds the map. A stacked member whose file Atlas has already saved is the mirror case: its settings stay under old ids until it is opened on a board of its own.
4. **The re-key does not report what it could not match, and overwrites a setting already on the new id** (`BoardView.ts:1066-1085`, `boardData.ts:357-378`). Old `room_` keys with no wall on the same endpoints stay in `data.json` as orphans (nothing is deleted, and the backup has them), but the notice only counts what moved and `roomWallsMoved` stops any later try. A count of what was left would meet "backed up and reported" fully.
5. **The refusal message is wrong when the board's own map is held** (`BoardView.ts:1179-1186`, `tokenWriter.ts:369-376`). `atlas(path, id)` is null when the map is held but the token is not in the store (deleted in Atlas a moment ago), and for any write aimed at a stacked member's path. `hostBanner()` is null then, so the notice reads "Atlas holds another map: click Edit here first." with no such button on screen.
6. **A token transfer that fails half way says nothing useful, and Connect is told first** (`tokenWriter.ts:727-743`, `BoardView.ts:697-706`). If the second follow is superseded (another board takes focus) the token stays on both maps; the code comment says "the caller says so", but the caller shows only the bar's text. `session.tokensMoved` is also sent before the transfer, so on any refusal Connect has moved the player to a scene their token did not go to. Both were tolerable when the file path made failure rare; now refusal is an ordinary outcome. Fix: tell Connect after the add succeeds, and give the duplicate case its own sentence.
7. **`watchAtlas` takes its baseline when it subscribes, not when the board read** (`BoardView.ts:1670`). On a board's first load with the map already held, a store change during `board.load` (a player's move through Connect) is not drawn until the next change, because `vault.on('modify')` is now ignored for a held map. Fix: subscribe before reading, or compare against the state that was read.
8. **A tint with Atlas's lighting off shows in 3D and not in Atlas** (`BoardView.ts:1464`, Task 14 ruling). `tint()` returns `ambientColor` whether or not lighting is enabled, and the picker stays live. Atlas and 2D players draw no tint then, so "one light level everywhere" does not hold for colour in that state. The ruling is defensible (nothing is stored twice), but the board could ignore the colour while lighting is off, as it does the level.
9. **Small host and bar edges.** The mark lives on the leaf object, so after an Obsidian restart a tab Tabletop opened is restored as an ordinary Atlas tab and stays for good. When Atlas is disabled or reloaded while a board is open, the bar says "Atlas closed this map. Editing is paused." until Reopen is pressed, and only then "Atlas VTT is not enabled." `followFailed` is not reset when the board's map changes.
10. **An Atlas version with build metadata or a `v` prefix reads as old** (`atlasFloor.ts:17`). Fail-closed is the right side to err on; note it for the day Atlas tags one.
11. **An older Connect can still read from Tabletop 1.4.0.** Tabletop refuses only `attachSession`. A Connect from before fusion checks no number, so it still gets `boardLook`, minis, the GM camera and the player board, and the notice appears only when it hands a session over. Probably acceptable for a transition both plugins ship together; say so in the README's upgrade line.
12. **Nits.** `wake.ts` logs as `[Atlas VTT Connect]` inside Tabletop's copy. `AtlasHost.changed()` walks `getLeavesOfType` on every store update. Each `follow` and `whenHeld` leaves a 15 s timer that is never cleared. After the light slider or the tint picker is let go, the board reads the level from its map model again (`board.ts`, `setAmbient` with `keep`), which still holds the old value until the debounced reload, so the light may step back for about a third of a second before it settles.

## Testing

Good: the pure parts are well covered (version order, bar states, re-key cases, `mapStateChanged`, the writer's queue order and refusal, the two-step transfer), and each Review Focus line has a named test.

Gaps worth closing:
- **Focus 1, first variant.** `whenHeld resolves null when the host lands on another map` moves the host with a second `follow`. The variant the plan names first (the view itself switching, no `follow`) is untested, and it is the one with the 15 s wait (Minor 1).
- **`attachSession`'s refusal wiring** (Task 8 ruling) is covered by `sessionPairs` alone. The live check ran a matched pair, so neither side's mismatch path has run outside a Connect unit test.
- **`fusionCarryOver`** has no test of its own; only `takeLegacyLighting` is tested, and no live step runs the carry-over (steps 11 and 12 check that the settings are Atlas's, not that the old ones were carried or backed up). I5 lives in that gap.
- **`BoardView`'s wiring** (the read source choice, the ignored `modify`, `moveRoomWalls`, `followHost`) is checked only by the harness bar feature and the live check. Minor 2, 5 and 7 live there.
- **Focus 5 live.** Step 6 moved a board into a popout while a host existed. Opening a host from nothing with the board in a popout or a sidebar (where the new tab lands in the main window's most recent group, and may become that group's shown tab) was not run live.
- **Claims across plugins.** The unit test builds a Connect host by hand; the product never does (I1).

## Rulings in the ledger: weighed

Every `Ruling:` line of the ledger, in its order.

| Ruling | Verdict |
|---|---|
| Commits end with the session's own attribution line | Fine; no effect on the product. |
| T1: build and page build not run for Task 1 | Fine; nothing imported the packages yet, and both ran from Task 3 on. |
| T1: `scripts/sharedImports.mjs` shared by the sync and the check | Fine (one copy of the import rule). Not read. |
| T2: `view.onLoadFile(file)` for a host without the map; `keepFront` kept as a safety | **Justified.** It is what stock Atlas calls itself, and it flushes the map being left. |
| T2: no `now` option | Fine. |
| T2: release detaches a leaf any plugin opened | Sound in principle, **unreachable today** because Connect never claims or opens (I1). |
| T2: the fake is `fakeHostWorkspace.ts` | Fine. |
| T2: no runtime import from `obsidian` (duck-typed `TFile`) | Fine, and needed for Tabletop's `node:test`. |
| T2: `stockWake.ts` stays until Task 3 | Fine; it is gone at head. |
| T3: fork path refused only when the version is readable and old | **Accepted, with a note.** It is the one place an unreadable version passes (Review Focus 3). The fork is shelved, and the stock path is strict. |
| T3: the 0.9.1 lighting test runs at 0.15.0 | Fine; 0.9.1 is below the floor. |
| T4: a 13-character unit name is cut to 12 | Fine, follows Atlas's `readUnitName`; the wire still rejects a longer one. |
| T4: casts at four boundaries for the fork's older types | Acceptable until Phase 2 removes the fork bundle; the casts hide nothing at run time. |
| T6: `TokenMoveHandler` takes no `AtlasHost` | **Justified** for the held test (`shownSnapshot` null already means not held or loading, read synchronously before `tokens.move`). Its side effect is I1. |
| T6: the 3D board's refusal text deferred to Task 11/16 | **Not delivered** (I3). |
| T6: the pairing notice stays until dismissed, once per Tabletop version | Fine; a mismatch should not scroll away. |
| T8: refusal tested through `sessionPairs` | Acceptable; see Testing. |
| T8: `BoardServices.floor` optional | Fine (harness). |
| T9: `Board.distanceLabel` takes `extra` | **Justified.** It keeps the old behaviour (`cells + cells * share`) for a spell's difficult terrain, on top of Atlas's distance; without it the drag ruler would lose that. |
| T11: `loading`/`whenHeld` kept on the writer | Fine (harness only). |
| T11: held writes synchronous; queued edits not on Tabletop's undo | **Justified**, and verified in the code. |
| T11: a board follows on focus, on a press, and at open only if active | **Good call**; it is what stops restored boards fighting. |
| T11: no bar while "about to open"; the timeout button reads "Try again" | Fine. One edge: with an Atlas view open on no map the bar is also empty (see Minor 5 for the message a refused edit then shows). |
| T11: tests written beside the code | Noted; the writer's cases still assert the refusal. |
| T13: only maps with 0.14 room-wall keys are looked at, and marked only when the migration ran | **Justified** (it avoids writing a flag into every map). |
| T14: dice volume as an unsaved `diceVolume` field | Fine. |
| T14: dice switch forced on, stored value left unused | Fine; the notice names it. |
| T14: a new harness feature beside "daylight tint" | Fine. |
| T14: tint picker live while lighting is off | Defensible; see Minor 8. |
| T16: two harness flakes rerun alone | Accepted as reported; not re-run here. |
| T18: rules read from Atlas's running service | **Good**, and the right place for the fix. |
| T18: Connect's plugin folder is `connect-for-atlas` | Fine. The manifest id is still `atlas-vtt-connect`, which is what both plugins look up (`main.ts:868`, `tabletopMinis.ts`). |

## Issues with the plan itself

- **No task has Connect claim the host.** The spec's "they share one host leaf" and the `HostMark.claims` design need a claim from Connect while it hosts. Task 6 gave Connect a host only for the held test, and when that was (rightly) dropped the claim went with it. I1 follows from the plan, not from a slip in the code.
- **"A host that Tabletop opened is closed when the last board closes" has no notion of the user taking the tab over.** Stock Atlas reuses the one leaf for everything the user opens later, so "opened by Tabletop" stops being a safe reason to close it. I2 follows from the spec's rule as written.
- **Review Focus 1 names two ways the host can end on B, and the plan's test covers one** (a second `follow`). The other (the view switching by itself) is the one with the long wait.
- **`addTokensNow` is not in Task 11's list of writes that wait.** The plan's "every write first uses ..., else `await deps.held(path)`" cannot hold for a synchronous method, and the plan does not say what it should do instead (I4).

## Declined to judge

- A backup copy named `<map>.atlasmap` inside the vault can be opened as a scene and may show in map pickers: the spec (section 6) asks for a copy of the `.atlasmap` in `Tabletop backups/<date>/`.
- Every map a board follows becomes a scene tab in Atlas's one view, and the list grows: this is way (b) of D12, chosen by gate G6b.
- A GM who focuses a board on another map moves the host, which pauses the presented scene for players: the spec's own design (the host follows the focused board).
- A token transfer loads two maps in Atlas per token: D7 accepts this until Phase 4 deletes stacks.
- The fork (extension API) Atlas beyond the floor ruling: shelved, and stock Atlas is the target.
- Connect's `sharing/receive` writers (`notePull.ts`, `MergeHistory.ts`): unchanged by this phase, they act in a player's vault, and stock Atlas offers none of `scenes`, `bundles` or `collections`.
- Vault writes inside Tabletop's ported Atlas code (`src/atlasPort/app`: `RecordFiles`, `LootHistoryStore`, table notes): unchanged by this phase; none writes an `.atlasmap`; whether each is reachable was not traced.
- An Atlas leaf that only holds a remote (Atlas Online) view when the first board opens: Tabletop's tab is then not marked as its own. No part of the plan or spec covers Atlas Online beside a board.
- The stale hosted page and the web player's refused move as seen on a real page: the report leaves both to the user, and hosting the page is an open item.
- A minimised or covered Obsidian window: left to the user by the report.
- Deleting the dead file engines, token elevation in rulers, and Connect's `BoardExtras.ambient`/`tint`: Phase 2 and later, by the plan.
- The content of the copied Atlas files and of the vendored player board bundle: left out of the diffs by design. I checked only that the two repos' `packages/` are identical and that the vendored bundle's commit (`aaa9a2c`) differs from Tabletop's head only in `BoardView.ts` and the live scripts.
- Whether the suites pass: not run, as instructed.

## Recommendations

1. Fix I1 and I2 together in `atlasHost.ts` and Connect (a session claim, and an "adopted by the user" rule), then sync to Tabletop. Add a test for each scenario above.
2. Fix I3, rebuild and re-vendor the player board (I3 needs a new `dist-web`, so do it before the release build).
3. Fix I4 and I5 in Tabletop; add a `fusionCarryOver` test that runs with Atlas absent.
4. Take Minor 1 and Minor 2 in the same pass as I1 and I2: both are a few lines in code that is open anyway.
5. Add the missing Focus 1 variant test, and a live step that opens a host from nothing with the board in a popout.
6. Before upgrading a real vault, run the room re-key on a copy of a real 0.14 map with hidden rooms and more than one level, and compare the count in the notice with the number of `room_` keys in `data.json` (Minor 4).

## Assessment

**Ready to merge? With fixes.** The core promise holds: I found no write to the wrong map, no file write, and no reload loop, and the migrations keep what they cannot move. The five Important issues are about who owns Atlas's tab (I1, I2), one message the spec names that 3D players do not get (I3), one kind of edit that is dropped instead of queued (I4), and a backup that two narrow paths skip (I5). All are small, local changes.
