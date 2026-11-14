# Atlas fusion Phase 4B: live check on Atlas 0.15.0

Run 2026-11-14 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.7.0 (abab880, the review's fix pass in) and Connect 0.13.0 (0d277fd), fusion 4, installed by
`harness/live/install.cjs`, Atlas 0.15.0, fixtures written by `harness/live/fixtures.cjs`. Script:
`harness/live/phase4b.cjs`. Results: `phase4b-live/results.json` (and `phase4a-live/`, `phase3-live/`, `phase2-live/`,
`phase1-live/` for the earlier phases' own steps).

**8/8 steps passed** (step 0 is Phase 4A's whole check, 6/6, which runs Phase 3's, 10/10, Phase 2's, 6/6, and Phase 1's, 16/16).
The first run of this script, before the review (Tabletop 6458aae, Connect f5398da), passed its 6 steps; steps 42 and
43 were added with the review's fixes and have only run on fixed builds (35ad6e0, then abab880): both passed each time.

| Step | What | Result | Evidence |
|---|---|---|---|
| 0 | Phases 1 to 4A again: nothing regressed | PASS | 16/16, 6/6, 10/10, 6/6 |
| 37 | A brush mask and its motion put in Tabletop's data as a vault of before had them (two rectangles) are moved to Atlas's liquids when the move runs: a backup first; two brush-made liquids of four corners each, in the tint, flowing right, with the motion; in the map file; nothing left in Tabletop's data; the notice | PASS | 2 liquids, `colors.surface #336699`, `flow {1, 0}`, motion kept; in the file; backup written; `waterMoved`; Atlas's older undo steps let go; drawn by the board |
| 38 | A mask handed over as when the brush is let go is one brush liquid on the level shown and one step of Atlas's undo; painted on, the brush's liquids are replaced in one more step; both in the file; Atlas's undo goes back a stroke at a time until the board is dry; nothing in Tabletop's data | PASS | 1 step, 4 corners, level `level_probe_ground`; then 2 liquids, 2 steps; file 2; undone to 1, then to none |
| 39 | A lava liquid added in Atlas (with `art`) is drawn on the board; a stroke that is dry over it, and one that covers it, leave it as it is and make no brush water over it; a motion change (two in a row) re-writes only the brush's liquid, once | PASS | lava unchanged (`art`, colours, no `tabletop`); 1 brush liquid; re-tinted to `#113355`, still, no `flow`, a new id; 1 undo step for the two motion changes |
| 40 | Liquids written and a move on a map Atlas does not hold are refused | PASS | 2 × `NotHeldError`, no `.atlasmap` mtime changed, no liquid added |
| 42 | Two strokes handed over one after the other, before the map is read again (painted, then painted over with less): the second replaces what the first wrote; the board draws it from Atlas's store at once. A motion chosen and a stroke before the sliders' wait is over: the stroke carries the motion, nothing more is written, nothing is left chosen | PASS | 1 brush liquid at once and after 1.5 s (never 3); 2 undo steps; wet and dry texels right at once; then 1 liquid `#445566`, still, 1 step; `chosenMotion` empty, no wait pending |
| 43 | Old water waits while the upper level is shown (its image is another one), and moves on its own once the first level is shown again; on the cove a mask made for an image of another size stays in Tabletop's data, with no backup and nothing written | PASS | upper shown: mask still in data, 0 brush liquids; ground shown: 1 brush liquid on the first level, mask gone; cove: size known, mask still in data, 0 liquids added, 0 new backup files |
| 41 | No console error from Tabletop or Connect; the cellar is left with no brush water and none in Tabletop's data | PASS | 0 errors |

(Step 41 runs last: it is the run's last look at the console.)

## What went wrong on the way

Nothing in the live steps: the new steps passed on their first run. They were never seen failing (they did not exist
on the builds of before the fix pass); what they pin is also pinned by unit tests watched failing, except the chosen
motion's handling (view glue).

## Not checked live

- The brush and bucket driven with the mouse (the steps hand the board's host a mask, as the board does when a stroke
  ends): the board's own path, and its drawing again what was kept where that is not what was painted, are covered by
  the UI harness (`water` and `water-liquids`).
- The players' boards and the GM's player window drawing the water (no player session): the wire's outlines and their
  reading are covered by unit tests in both repos.
- How Atlas's own 2D view draws the brush's liquids (colour, flow): the records are as Atlas's reader takes them; not looked at.
- The move staying where the level has no room, or where Atlas would not keep a patch (needs 256 liquids or a mask of
  257 patches), and on a board whose image failed to load: the decision is unit-tested (`legacyWaterMove`), its
  notices are not driven.
- Water over Atlas's limits (2048 corners): unit-tested only.
