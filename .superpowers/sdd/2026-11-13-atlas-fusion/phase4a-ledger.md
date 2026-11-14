# SDD ledger — plan: docs/superpowers/plans/2026-11-14-atlas-fusion-phase4a.md

Ruling: Phase 4 is run as six sub-plans (program doc), each closed before the next; started without a go-ahead as the user said on 2026-11-14 — cost: the sub-plan order and the program's rulings (which moves ask first) reach the user in the reports.
Pre-flight: Task 2 produces BoardWall.extra / extrasOf consumed by Tasks 4-5; Task 3 produces writer.setWallExtras / setLightHeight consumed by Tasks 4-5; no conflicts found.
Task 1: complete (probe: wall, door, placed light, token all keep `tabletop` in the store, the file, after Atlas's own edits and a map switch; updateWall(id,{tabletop: undefined}) removes it; updateLight exists)
Task 2: Ruling: the recordExtras tests were written before the code but first run after it (a missing module is the only RED seen) — cost: weaker RED evidence; each case pins a value.
Task 2: complete (tests: npm test → 1047 pass; tsc)
Task 3: complete (tests: npm test → 1051 pass; 4 writer cases watched failing first)
Task 4: Ruling: BoardData's readers of the seven records went with its setters (one read path: extrasOf); tests that pinned the setters were rewritten onto records or the legacy read, three were dropped (their bounds are pinned in recordExtras) — cost: none known.
Task 4: Ruling: a change of extras shows at once from the store (showExtras patches the read map's walls and lights in place and refreshes), since the map's next read is debounced 300 ms; only extras are patched, geometry waits for the read — no unit test (BoardView needs Obsidian); the live check covers it.
Task 4: complete (tests: npm test → 1049 pass; tsc; build; harness wall|door|light|window|material|layer 161/161)
Task 5: Ruling: the planner's tests were written first and first run with the code (the writer's apply and the no-undo-step case were watched failing).
Task 5: Ruling: the move is no step of the board's undo (a snapshot step would bring the moved records back into data.json and run the move again); migration 1's re-keying still records one, as before.
Task 5: Ruling: a value the record already has is not overwritten by data.json's (the record wins; counted as dropped) — so an interrupted move repeats safely — cost: none known (before 4A nothing wrote these keys to records).
Task 5: complete (tests: npm test → 1054 pass; tsc; build)
Task 6: complete (docs 39ec522; Connect vendor c85aafa; sync d22d9d3)
Task 7: IN PROGRESS: harness/live/phase4a.cjs written and committed; steps 32-35 PASS in a partial run; step 36 failed only because that run never opened Fusion Rooms; a FULL chain run was started in the background (log: %TEMP%/p4a-live.log, results .superpowers/sdd/2026-11-13-atlas-fusion/phase4a-live/results.json) and its result was NOT read. Still to do for 4A: read that run (rerun once if Phase 1 steps 3/4 fail: known artifact after a partial run), write phase4a-live-report.md, one fresh reviewer over Tabletop a81ba9f..HEAD and Connect d1d436b..HEAD, one fix pass, copy this ledger to phase4a-ledger.md, report. Then 4B (water to liquids) per the program doc.
Task 7: live run read: phase4a.cjs 6/6 (Phase 1 16/16 incl. the rooms map's settings moved onto Atlas's walls, Phase 2 6/6, Phase 3 10/10), builds Tabletop d22d9d3 / Connect c85aafa. Evidence committed. Still to do: phase4a-live-report.md, the fresh review, the fix pass, phase4a-ledger.md, the report; then 4B.
Task 7: complete (live: node harness/live/phase4a.cjs → 6/6; report phase4a-live-report.md)

## Final review (one fresh reviewer, Tabletop a81ba9f..2f1a8e7) and the one fix pass (aa4c68b; vendor a9f2719)

Note on RED: the fix pass's tests (`tests/extrasReview.test.ts`) were written before the code and first run after it (their imports did not exist: the build failed, no case ran); one case then failed on the order of the move's checks and was fixed. Weaker RED evidence than a watched failure per case.

- Final: fixed C1 the players' look went out with no wall settings for a tick after every Atlas save — `a scene whose file changed is still answered for…` (LayerIndex) and `the look of a map Atlas holds is read from Atlas's store…` (`lookMaps`), suite 1062/1062. `main.ts`'s use of them has no unit test.
- Final: fixed I1 extras reached players only through the file (late, and never after an undo) — same tests: a held map's look is read from the store; `showExtras` tells Connect (`lookChanged`), no unit test (BoardView).
- Final: fixed I2 a renamed material folder or door prop was no longer followed — `a material folder or a door prop renamed…` (`MovedPaths`, `followMovedPaths`). Ruling: renames of folders and `.glb` files are remembered in Tabletop's saved data and followed at read, for good (records in maps Atlas does not hold cannot be rewritten) — cost: a small table that only grows; a deleted material stays named on its record (spec section 10).
- Final: fixed I3 Atlas's undo of a step from before the move would wipe a moved setting — `the move is written outside Atlas's undo or not at all, and Atlas's older steps… are let go`. Ruling: the move clears Atlas's undo history for that map, once (the reviewer's other option, waiting for an empty history, could wait for ever) — cost: the GM loses Atlas's undo steps made on that map before its first open in 3D after this update (spec section 10, README).
- Final: fixed I4 a map with stale 0.14 room keys and no rooms never moved — `old room-wall names wait for Atlas only while Atlas still holds rooms…` (`roomsAwaitAtlas`).
- Final: fixed I5 right after the move the board could draw without the extras — the board is read again after the move, and a held scene's other levels are read from the store; no unit test (BoardView).
- Final: fixed I6 an older board undo brought the seven records back — `once a map's 3D settings moved, an undo of something older…` (`BoardData.restore` keeps a migration's result; migration 1's re-keying is no step).
- Final: re-graded Minor 1 (two boards: two backups and notices) to fix — the in-flight set is shared and the legacy data is checked again after the backup; no unit test.
- Final: re-graded Minor 2 (the notice counted values the record already had as "Atlas no longer has") to fix — `the move tells what went nowhere apart…` (`orphaned`).
- Final: re-graded Minor 3 (a move half written without `untracked` or a missing action) to fix — same test as I3.
- Final: re-graded Minor 4's no-op steps to fix — `setting what a wall already has is no step of anyone's undo…`.
- Final: minor (deferred): the writers lost the old setters' bounds (a window opening on a zero-height wall can write `{bottom: 0, top: 0}`, which the reader ignores).
- Final: minor (deferred): `showExtras` scans every wall when only tokens changed.
- Final: minor (deferred): data.json and Atlas's map are each saved 500 ms after a change, so a crash between them can leave data.json cleared before the map file has the records (the backup has them).
- Final: minor (deferred): `tests/noExtraStorage.test.ts` reads source text; `showExtras`, `moveExtras` and `main.ts`'s look have no unit test (covered live only in part).
- Final: Ruling: Atlas's `placeDoor` drops the field from the pieces it makes of a wall, and Atlas does not save an undo's result until the next write — Atlas's own behaviour — stands; cost: a wall cut by a door placed in Atlas loses its 3D settings, as its old id did before.
- Final: Ruling: the `own === null` transient that predated 4A (level layers, default materials) is fixed by the same change as C1.
- Final: Ruling: one Atlas undo step per stepper click (against its 50-step history) — as the board's own undo did — stands.
- Final: Ruling: Obsidian Sync bringing an un-moved data.json from another device re-runs the move there (the record wins, nothing doubles) — not planned for — stands.
- Final: harness wall|door|light|window|material|layer|player 160/161 (known flake: layers camera glide).
- Final: verification after the fix pass: npm test 1062/1062, tsc, build; Connect vendor test, build, build:page; live phase4a.cjs 6/6 (Phases 1-3: 16/16, 6/6, 10/10) on Tabletop 8f56fa8 / Connect a9f2719.
