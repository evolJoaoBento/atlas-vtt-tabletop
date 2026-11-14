# Atlas fusion Phase 4C: final review and fix pass

One fresh reviewer (model "fable") read the sub-plan's diff in both repos (Tabletop `9429b3c..2c9b0bb`, Connect
`0d277fd..408c6db`), the plan, the spec, the ledger's rulings and Atlas 0.15's source. Verdict: **1 Critical, 8
Important** (9 numbered findings, the seventh in three parts), minors, and 20 rulings weighed. One fix pass followed (Tabletop `b4e371a`, `e39e9ed` and
after; Connect `af848fc`). Where the fix is in code a test reaches, the test was watched failing first; view glue was
checked by the UI harness or live only, and is marked so.

## Findings and what was done

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 (Critical) | A member under the base becomes the scene's first level; Atlas shows players the first level of a presented scene that names none, so players were put in the cellar | After the write, a presented base that names no level is presented at the base's level (`StackMigrationDeps.present`, Atlas's `presentedScene.set`) | Unit: the move's order now has `present Keep level_1`. Live: step 45 presents the base, moves, and reads the presented scene back at the base's level |
| 2 | The same root: the base's props and its shots that named no level fell to the member below; the base's surfaces and stairs stayed untagged; the base's old water mask would be read on the new first level | `adoptStack` gives the base's props and level-less shots the base's level; the planner tags `levelSurfaces` and `levelLinks`; a stack is skipped while the base's old water has not moved and a floor goes under it (or the scene must be set aside) | RED→GREEN: `stackAdopt` (base prop and shot `s1` on `level_base`), `stackMove` "under a member, the base's surfaces and stairs name its level too", `stackMove` skip cases, `stackMigration` "the base's old painted water…". Live: step 45 checks `s1` |
| 3 | A fitted level was drawn unfitted whenever it was not the level shown (GM's board and players') | The layer's floor is laid by its grid's stretch (`stretchPlacement`, as `BoardSurface`); the fit travels in `BoardLayerLook.grid.mapStretch` / `BoardLayerRecord.grid.mapStretch`, validated by Connect and read by the player board | RED→GREEN: UI harness `layer fit` (1/2 before, 2/2 after); Connect `projectBoard` "a level Atlas fitted … goes with its fit, and a fit that is none is refused"; Tabletop `boardLayers` player-board case |
| 4 | Raising by whole squares hit ordinary stacks, each member on its own, so floors that lined up no longer did | The whole scene goes right and down by one common amount, the base included (its own alignment and move); refused on hexes and on a base fitted already | RED→GREEN: `stackMove` "a member that lies left of or above the base's corner takes the whole scene with it…", `stackAdopt` "where the whole scene was set aside…" |
| 5 | Pixel sizes were not scaled with a member on squares of another size (fog brush, drawings, texts, sounds, a line's width) | Scaled by `k` in the copies; the "keep their size in pixels" line is gone | RED→GREEN: `stackMove` "a fitted member is aligned by Atlas; its sizes kept in pixels are scaled with it…" |
| 6 | A one-level scene's roof, `openArt` and fit were dropped; a member's `levelSurfaces` were not copied | The base's own level keeps its fields and fit; a member's one level gives its roof and `openArt`; a member fitted already is skipped (Atlas keeps one fit a level); `levelSurfaces` are copied | RED→GREEN: `stackMove` "a base that Atlas gave its one level keeps that level as it is…", skip case for a fitted member |
| 7a | A run's `keyed` list took map paths, so keys shifted between announces once two levels of one map were in a run | `keyedPlaces` names the places keyed, in key order, each with its level | RED→GREEN: `cutsceneBroadcast` "the places a run has keyed are named back in key order…" |
| 7b | In live mode a level switch never reached the run | A level change of the same scene calls the studio's `mapChanged`, which re-announces a live run on the new floor | Glue: UI harness cutscene features; not watched failing |
| 7c | A key projected at a level Atlas does not show gets the shown floor's `mapSize` | Ruling, not fixed: see below | — |
| 8 | Undo after the move brought the stack back and dropped what was adopted | The move lets go of the undo's older steps of every map `adoptStack` changed (`forget`) | Unit: the move's order has `forget Keep,Tower`. Live: step 45 checks the base has no undo left |
| 9 | A member with Atlas lighting on over a base with it off: players lose their sight limits there, said in passing | Said first in the list, plainly ("players will see everything on it that fog does not cover") | RED→GREEN: `stackMove` fitted-member case (`lost[0]`) |

Also from the minors, fixed because they sat in the same code: a spell measure's `tabletop.caster` is remapped; heights
use the units the board reads (the scene's distance, else its collection's); two members at one height are each a
storey; a Move pressed again after a timeout finishes that stack first; the backup holds other maps whose shots are
re-pointed.

## Rulings the reviewer weighed

- D3 (a member's file may be re-saved by Atlas), D13 (move transitions within one level), `FUSION_PROTOCOL` stays 4: kept.
- D14 (`BoardLayerRecord` stays): kept, and it now carries the level's fit (finding 3).
- Task 4 "level following has no unit test": overturned in part: 7a now has one; 7b stays glue.
- Task 5 "`mapSize` stays the shown floor's, unused": the premise was wrong; replaced by the ruling on 7c.
- Task 8 "`stands` stays, always none": overturned in substance (the fit now travels beside it).
- Task 3 "a member's style or mini wins": amended in the deferred minors (stale member entries).
- Task 7 "the vault's own stack kept out of the scripted Move": kept for this pass; a Move of it on a copy is deferred.

## Minors (deferred)

Listed in `phase4c-ledger.md` under `Final: minor (deferred)`.
