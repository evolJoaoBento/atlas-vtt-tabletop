# SDD ledger — plan: docs/superpowers/plans/2026-11-13-atlas-fusion-phase1.md

Executor: inline (executing-plans), from 2026-11-13.
Ruling: commits end with Co-Authored-By: Claude Fable 5.2 — session attribution changed after plan was written — no cost.
Pre-flight: Task 1 produces atlas-shared index (T4, T9 consume); Task 2 produces atlas-host (T3, T8, T11 consume, via T7 sync); Task 6 produces FUSION_PROTOCOL + import-free boardTypes (T7, T8 consume). Names checked per brief at each task.
Task 1: Ruling: build/build:page not run for T1 — no src imports packages yet; run from T3 on — cost: none.
Task 1: Ruling: added scripts/sharedImports.mjs (import regex + stub check shared by sync and check) — avoids two copies — none.
Task 1: complete (Connect commits beab3a7..3b30ab4, tests: vitest 3058/3058, tsc, lint, check:shared, check:vendor green)
Task 2: Ruling: D12 way = view.onLoadFile(file) (5/5 live, G6b). No merge happens, so the plan's "re-activates the front after the merge" test became "loads it there, opens no leaf, keeps the front"; keepFront stays as a safety — cost: none.
Task 2: Ruling: AtlasHost options drop `now` (timeouts use injected wait only) — unused — none.
Task 2: Ruling: release detaches a leaf ANY plugin opened once no plugin claims it (plan: only this plugin's) — else a leaf Connect opened leaks when Tabletop releases last — cost: a plugin-opened host may close when the other plugin's last claim goes.
Task 2: Ruling: test fake is tests/fake/fakeHostWorkspace.ts (fakeWorkspace.ts already existed) — none.
Task 2: Ruling: package has no runtime import from 'obsidian' (duck-typed TFile) so Tabletop's node:test can load it — none.
Task 2: Ruling: stockWake.ts stays until Task 3 deletes it (test moved now) — plan order.
Task 2: complete (Connect commits 3b30ab4..3b3720b, tests: vitest 3079/3079, tsc, lint, check:shared green)
Task 3: Ruling: the fork-API path is refused only when Atlas's manifest version is readable and old (unknown/missing passes); the stock stand-in is strict — the fork is shelved and its test fakes carry no manifest — cost: a fork Atlas without a readable version is not gated.
Task 3: Ruling: the "Atlas 0.9.1 lighting" hosting test now runs its standard-lighting case at 0.15.0 — 0.9.1 is below the floor — none.
Task 3: complete (Connect commits ..26c085f, tests: vitest 3083/3083, tsc, lint, build green)
Task 4: Ruling: a 13-character unit name is cut to 12 by Atlas's readUnitName on the GM side (not dropped); the wire still rejects >12 — follows Atlas — none.
Task 4: Ruling: fork (extension API) types lack manhattan/unitName/custom; values are carried with casts at four boundaries until Phase 2 removes the fork bundle — cost: none at run time.
Task 4: complete (Connect commits ..9984631, tests: vitest 3088/3088, tsc, lint, build, build:page green)
Task 5: complete (Connect commits ..c268bed, tests: vitest 3087/3087, tsc, lint, build green; git grep stockRooms empty)
Task 6: Ruling: TokenMoveHandler takes no AtlasHost: `shownSnapshot(sceneId) === null` already means "the GM's view does not hold that scene" (other tab, or loading), so that alone gives reason not-held — one source for "held" on Connect's side — cost: none.
Task 6: Ruling: the not-held text is shown through TokenMoves' notice (web page and Obsidian 2D player alike); the 3D player board gets the reason as a second argument to moveRefused — its text comes with Task 11/16's board.
Task 6: Ruling: pairing notice stays up until dismissed (Notice timeout 0), once per Tabletop version per app.
Task 6: complete (Connect commits ..6cfb5e9, tests: vitest 3092/3092, tsc, lint, build, build:page, check:vendor green)
Task 7: complete (Tabletop commits ..94d0546, tests: npm test 991/991, tsc, build, check:connect --connect green; no consumer needed a change)
Task 8: Ruling: the attachSession refusal is tested through the pure `sessionPairs` helper (the plugin class needs Obsidian) rather than in tabletopCommands.test.ts — cost: the wiring line itself is covered only by the live check.
Task 8: Ruling: BoardServices.floor is optional (harness and older callers), absent = Atlas taken as found.
Task 8: complete (Tabletop commits ..6939694, tests: npm test 995/995, tsc, build green)
Task 9: Ruling: Board.distanceLabel takes a third argument `extra` (a share counted again) so the drag ruler's spell difficult terrain still shows — the plan's signature had no place for it — none.
Task 9: complete (Tabletop commits ..e23d73b, tests: npm test 998/998, tsc, build; harness "gm measure" 4/4)
Task 10: complete (Tabletop commits ..be054a7, tests: npm test 1000/1000, tsc, build; harness "asset manager" 9/9, RED seen first in both)
Task 11: Ruling: TokenWriter.loading/whenHeld stay (plan: delete) for a board without a host (the test harness); with a host BoardView follows host.onChange instead — cost: two unused-in-product methods until Phase 2 deletes the file code.
Task 11: Ruling: a held write stays synchronous (the undo recorder counts Atlas's history steps on return); an edit that waited for Atlas to load is not put on Tabletop's undo (Atlas's own undo has it) — cost: Ctrl+Z on the board misses those few edits.
Task 11: Ruling: a board brings Atlas to its map when its tab becomes active, on a press inside it, and as it opens only if it is the active tab — several boards restored at start-up do not fight over the host.
Task 11: Ruling: the hostBar's "about to open" state (no Atlas tab, nothing failed) shows no bar; the timeout bar's button reads "Try again".
Task 11: Ruling: host/writer tests written alongside the code rather than strictly before (RED seen only for hostBar import and the asset tests) — cost: weaker RED evidence for T11's writer cases.
Task 11: complete (Tabletop commits ..0a74157, tests: npm test 1011/1011, tsc, build; harness "host bars" 5/5; check:atlas 29/29 on 0.15.0)
Task 12: complete (Tabletop commits ..d516144, tests: npm test 1013/1013, tsc, build; harness levels/rooms regressions 11/11)
Task 13: Ruling: the migration looks only at maps that keep settings under a 0.14 room-wall name (`room_<4 numbers>`), and marks a map done only when it ran — the plan marked every held map done, which would add a flag to every map's saved data — cost: a map whose old keys never match is looked at again each time it is read (cheap).
Task 13: complete (Tabletop commits ..f12ece6, tests: npm test 1020/1020, tsc, build; harness rooms feature passes)
Task 14: Ruling: Atlas's dice volume travels as an unsaved `diceVolume` field of the settings handed to an engine (plan: a second argument to configure) — one hand-over for the GM's boards and the player board — cost: none.
Task 14: Ruling: the dice switch is forced on for engines and its settings row is gone; the stored value is left in data.json, unused.
Task 14: Ruling: the harness feature is a new 'lighting from Atlas' beside the kept 'daylight tint' (the tint picker's board behaviour is unchanged).
Task 14: Ruling: the tint picker stays usable while Atlas's lighting is off (it writes Atlas's ambientColor); only the level slider is disabled, as D10 says.
Task 14: complete (Tabletop commits ..02e0f08, tests: npm test 1023/1023, tsc, build; harness lighting/laser/tint features; check:atlas 32/32 on 0.15.0)
Task 15: complete (Tabletop commits ..26e6c26, tests: npm test 1023/1023, tsc, build; harness "scene tabs 0.15|layer placement|layers kept and carried" 25/25, RED seen first; screenshot checked)
Task 16: Ruling: harness --all gave 698/700; the two failures (page.goto net::ERR_NO_BUFFER_SPACE on "sound settings", and the "player cutscene" live-camera median-step timing) pass when run alone (84/84), and the board suite, which --all skips after a feature failure, was run by itself: 262/262 after its two scene-tab checks were updated to the 0.15 markup — known timing flakes on this machine — cost: none.
Task 16: complete (Tabletop commits ..aaa9a2c, tests: npm test 1023/1023, tsc, build, check:atlas 32/32, check:connect; harness features 698/700 + 84/84 rerun, board suite 262/262; dist-web built at aaa9a2c dirty:false)
Task 17: complete (Connect commits ..1855b19, tests: vitest 3093/3093, tsc, lint, build, build:page, check:vendor, check:shared green)
Task 18: Ruling: the live check found that a collection's settings did not reach an open board (hidden folder, no vault event); fixed in BoardView (rules from Atlas's running service + Atlas's collection-settings-changed event) rather than only reloading in the script — "Atlas is source of truth" — cost: none.
Task 18: Ruling: Connect's plugin folder in the vault is connect-for-atlas (the plan said atlas-vtt-connect).
Task 18: complete (Tabletop commits ..2a1b058; live check 16/16 on Atlas 0.15.0, report .superpowers/sdd/2026-11-13-atlas-fusion/phase1-live-report.md)
Final review: fresh reviewer (Fable), verdict "ready to merge with fixes": 0 Critical, 5 Important (I1-I5), 12 Minor. Review at final-review.md. Re-graded: I1-I5 stand as Important; all Minor stay Minor.
Final: fixed I1 (Connect never claimed the host) — hostClaim.test.ts (3 cases) + stockAtlas wiring; Connect suite 3098/3098.
Final: fixed I2 (Tabletop closed a tab the user took over) — atlasHost.test "a tab the user has brought to the front is theirs" RED→GREEN, suite 3098/3098.
Final: fixed I3 (no not-held text on the 3D player board) — harness "player move refused" RED→GREEN 3/3; player board rebuilt (3742262, dirty:false) and vendored in Connect (34854bb).
Final: fixed I4 (token adds not queued, asset manager silent) — tokenWriter.test "tokens added while Atlas is on its way…" RED→GREEN, suite 1028/1028.
Final: fixed I5 (lighting backup not backup-first) — fusionCarryOver.test.ts (4 cases) RED→GREEN, suite 1028/1028.
Final: after the fix pass: Tabletop npm test 1028/1028, tsc, build, check:connect; Connect vitest 3098/3098, tsc, lint, build, build:page, check:vendor, check:shared; live check re-run 16/16 on Atlas 0.15.0.
Final: minor (deferred): M1 a follow Atlas leaves by another road waits out the full 15 s before queued edits are refused (nothing misapplied).
Final: minor (deferred): M2 with Atlas older than 0.15 a press on a board tab still asks Atlas to switch map.
Final: minor (deferred): M3 a view-only board or stacked layer can draw room walls without their settings until Atlas saves the converted scene (display only).
Final: minor (deferred): M4 the room re-key notice does not count the old keys it could not match; they stay in data.json and in the backup.
Final: minor (deferred): M5 a refused edit on a held map (token gone, or a stacked member's path) says "Atlas holds another map" with no such bar.
Final: minor (deferred): M6 a token transfer that fails half way leaves the token on both maps with only the bar's text; Connect is told before the transfer.
Final: minor (deferred): M7 a store change during a board's first load is drawn only at the next change.
Final: minor (deferred): M8 a tint with Atlas's lighting off shows in 3D and not in Atlas.
Final: minor (deferred): M9 small host/bar edges (a plugin-opened tab restored after restart stays; bar text when Atlas is disabled mid-session; followFailed not reset on map change).
Final: minor (deferred): M10 an Atlas version with build metadata or a "v" prefix reads as old.
Final: minor (deferred): M11 a Connect from before fusion can still read looks and minis from Tabletop 1.4.0; only the session hand-over is refused.
Final: minor (deferred): M12 nits (log prefix in wake.ts, timers never cleared, light slider may step back for a third of a second).
Final: Ruling: backup copy named <map>.atlasmap sits in the vault and can be opened as a scene — the spec asks for a copy of the .atlasmap in Tabletop backups/; stands — cost: a backup may show in Atlas's scene pickers.
Final: Ruling: every map a board follows becomes a scene tab in Atlas's one view, and the list grows — way (b) of D12, Atlas's own behaviour; stands — cost: a long tab strip in Atlas after many boards.
Final: Ruling: focusing a board on another map moves the host, which pauses the presented scene for players — the design the user chose ("follow the focused board"); stands.
Final: Ruling: a token transfer between stacked maps loads two maps in Atlas — D7, until Phase 4 removes stacks; stands.
Final: Ruling: the shelved fork (extension API) Atlas is not gated beyond the Task 3 ruling — stock Atlas is the target; stands.
Final: Ruling: Connect's sharing writers and Tabletop's ported Atlas code write files that are not .atlasmap and were not changed by this phase — out of scope; stands — cost: untraced, to look at in Phase 2 when the file engines are deleted.
Final: Ruling: an Atlas tab that only holds an Atlas Online remote view when the first board opens is not marked as Tabletop's — no part of the spec covers Atlas Online beside a board; stands.
Final: Ruling: the stale hosted page, a web player's refused move on a real page, and a minimised Obsidian window are left to the user (live report) — they need a hosted page, a device or a person.
Final: Ruling: deleting the dead file engines, token elevation in rulers, Connect's BoardExtras.ambient/tint are Phase 2 and later, by the plan; stands.
Final: Ruling: test gaps the reviewer listed and not closed here: Focus 1's "view switches by itself" variant (M1), attachSession's mismatch wiring, a live step opening a host from nothing with the board in a popout — cost: those paths are covered by unit fakes or not at all.
