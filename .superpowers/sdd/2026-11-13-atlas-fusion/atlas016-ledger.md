# SDD ledger — plan: docs/superpowers/plans/2026-11-14-atlas-fusion-atlas016.md

Ruling: Atlas 0.16 support comes before 4D, and 0.15 stays supported (both plugins' floor stays 0.15) — the user said 0.16 is out, a GM may update today, and 0.16's hidden notes would leak through both plugins; requiring 0.16 is the user's to decide — cost if wrong: work on 0.15 compatibility the user did not want.
Ruling: Task 3 (Connect never sends hidden notes) runs first, out of the plan's order — it is the leak, and it must stand alone to cherry-pick — cost if wrong: none.
Ruling: D1 Atlas's annotation reader is vendored into atlas-shared from the 0.16.0 tag and the package's source tag becomes 0.16.0 — Atlas is the source of truth for what a drawing is; the reader is a superset that reads 0.15 records — cost if wrong: a 0.15 file read by 0.16's rules (an old eraser stroke passed over).
Pre-flight: Task 2 produces the shared reader consumed by Tasks 4, 5; Task 3 must not consume it (cherry-pick); Task 5 extends PlayerDrawing consumed by Tabletop's sceneAdapter (sync after Connect). No conflicts.
Task 3: complete (Connect d624e6f, tests: npx vitest run → 3163 pass; the hidden case watched failing first; lint; it touches projectRecords.ts and one test only, and the released Connect 0.9.0 has the same code at both hunks: it cherry-picks)
Task 3: Ruling: every path that sends a drawing or text to players goes through projectTexts/projectDrawings (the scene, a cutscene's scene, split views, a shared map's playerSafePayload): one check covers them — cost if wrong: a path that does not.
Task 1: complete (39c5613; ATLAS_BUILD=0.16.0 node harness/live/phase1.cjs → 16/16 on Atlas 0.16.0)
Task 6: Ruling: Phase 1 steps 3, 4 and 10 failing in the first 0.16 chain were the known run-order artifact (the chain was started in a vault left by an earlier run): Phase 1 alone, from a fresh install and fixtures, passes 16/16 on 0.16.0, steps 3, 4 and 10 included — the final 0.16 chain confirms it — cost if wrong: the host's Atlas tab shows over the board on 0.16.
Task 2: Ruling: the invariant 'the Atlas floor is the tag the shared files are copied from' (both repos' tests) is amended to 'the floor is no newer than that tag' — the shared rules now come from 0.16 while the floor stays 0.15; the reader reads 0.15's records — cost if wrong: a shared rule that only 0.16's records satisfy runs against a 0.15 Atlas.
Task 2: complete (Connect 2aab31a: check:shared matches Atlas 0.16.0 32cebd1, vitest, tsc, lint; Tabletop 110a60c: sync, npm test, tsc)
Task 4: Ruling: a text with no size reads 31.5 px (Atlas 0.16's reader), not Tabletop's own 24 — Atlas's reader is the truth now; the test expectation changed with it — cost if wrong: such texts (rare: Atlas always writes a size) draw a little larger.
Task 4: Ruling: Tabletop's player board (Connect's wire) reads no hidden flag: Connect never sends a hidden note (Task 3).
Task 4: complete (ebd8d7c, tests: npm test → 1123 pass; annotations tests watched failing first; UI harness 'hidden notes' 0/2 → 2/2; tsc)
Task 5: Ruling: D1 amended for Connect — its projection reads the raw records with the reader's rules for the new fields (closed: ends where it began; fill only on a closed one; width 0 only with a fill; a stamp's turn) instead of calling Atlas's readDrawing, so the cherry-picked hidden check and the established projection (simplified points, clamps) stay as they are — cost if wrong: a 0.16 shape Atlas's reader reads otherwise (an ellipse or curve whose points no longer fit its type) is sent as its points, which is what Atlas draws anyway.
Task 5: Ruling: D2 simplified — Connect's 2D view already skipped eraser records (0.15's eraser edits strokes in the store); now neither plugin draws them, as 0.16 reads none.
Task 5: Ruling: the board's 'ink fills' harness check was written after the code (the fill triangles' unit test was watched failing first, and so were the Connect and player-board cases).
Task 5: minor: Connect's surface draws a pin-symbol stamp without its opacity (pinGlyph takes none).
Task 5: complete (Tabletop 9e1d9f5, 2dd1cee; Connect a77c9d3; tests: npm test → 1126, vitest → 3166, lint, tsc; harness 'ink fills', 'hidden notes' 3/3)
Final: Ruling: the final review runs on Opus 5.5, not Fable — the Fable reviewer stopped at once: the account is out of Fable credits; Opus is the most capable model left — cost if wrong: a less able reviewer misses what Fable would have found.
Task 6: complete (Phase 1 on 0.16 passes 16/16 in the full chain: steps 3, 4, 10 were the run-order artifact)
Task 7: complete (Tabletop 1.9.0 625edab+, Connect 0.15.0 ee5f250; live: ATLAS_BUILD=0.16.0 node harness/live/phase4c.cjs → 9/9 and step 52 alone 1/1 on Atlas 0.16.0; node harness/live/phase4c.cjs → 10/10 on Atlas 0.15.0 after the 0.15 vault was put back; the earlier phases pass on both)
Final: review (Opus 5.5): 1 Critical, 7 Important (F1-F8), minors; record in .superpowers/sdd/2026-11-13-atlas-fusion/atlas016-final-review.md
Final: fixed F1 a fill the fog covers in part is dropped — drawingCover "is sent while any part of it is out of the fog…" RED→GREEN (Connect e260613, vitest 3170/3170)
Final: fixed F2 cutscene shedding drops fills — drawingCover "a cutscene too large to send sheds drawings without a fill first…" RED→GREEN (e260613)
Final: fixed F3 Tabletop's three separate stacks — annotations "drawings, texts and stamps share one order…" RED→GREEN (Tabletop f0f7d89, npm test 1129/1129)
Final: fixed F4 Connect stacks by time alone — drawingCover "is stacked in the order Atlas stacks it…" RED→GREEN (e260613)
Final: fixed F5 even-odd fills — drawingCover nonzero case, ink "a fill is Atlas's: a self-crossing outline…" RED→GREEN (e260613, f0f7d89)
Final: fixed F6 map-layer drawings over tokens — drawingCover map-layer case RED→GREEN (e260613); sceneAdapter reads layer (f0f7d89)
Final: fixed F8 tokens under an opaque box in 3D players' picture — ink "what an opaque box above the tokens covers…" RED→GREEN; UI harness 'boxes hide tokens' 1/2 with the check removed, 2/2 with it (f0f7d89)
Final: Ruling: F7 not fixed: players update Connect with the GM; an older player client draws a fill as its outline and gets no hidden note (d624e6f) — cost if wrong: an old client's player sees under a box until they update.
Final: Ruling: the player board ranks texts under drawings (Connect's wire carries no common order across texts and drawings; its 2D view lays texts under drawings too) — cost if wrong: on a player's 3D board a text drawn over a box after it sits under it.
Final: Ruling: UI harness full run 727/729 under load (vitest and builds alongside): 'engine swap' and 'authoring' camera checks (300 ms frame waits) failed; rerun alone 40/40 and 42/43 then 40/40 with a different check each time — frame-timing flakes, nothing of this pass touches the camera — cost if wrong: a camera regression missed.
Final: minor (deferred): Connect draws a pin-symbol stamp without its opacity (pinGlyph takes none).
Final: minor (deferred): a line of width 0 with no fill is skipped (Atlas 0.16 never writes one; older Atlas draws a hairline).
Final: minor (deferred): holes are not counted in Connect's point budget (capped at 64 rings).
Final: minor (deferred): simplifying a closed outline can move its closing point.
Final: minor (deferred): Atlas's convertShapes drops a drawing's fill (Atlas's).
Final: minor (deferred): eraser records on 0.15 are drawn by Atlas as strokes, by neither plugin (harmless).
Final: vendor Connect 5304910 (vitest 3170 with one load timeout rerun alone 18/18, tsc, lint, build, build:page, check:vendor, check:shared); sync Tabletop 8a87a17 (npm test 1129, tsc, build)
Final: live after the fix pass: ATLAS_BUILD=0.16.0 phase4c chain from the 0.15 copy → 10/10 (52 in the chain); 0.15: Phase 1 alone from the copy 16/16, then the chain → every own step passes but Phase 1's 10 (rooms converted by the run before); results atlas016-live/ (0.16) and phase*-live/ (0.15); report atlas016-live-report.md
Final: Ruling: the 0.15 chain started straight from the copy failed Phase 1 steps 3, 4, 10 twice (and 4B's 37 notice once, 4C's 44/45/51 in the moved vault): the known run-order artifact — Phase 1 alone from the same copy passes 16/16 and this pass touches no hosting, rooms, water or stacks — cost if wrong: a hosting regression on 0.15 hidden behind a flaky step.
