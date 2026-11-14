# Atlas fusion Phase 4B: live check on Atlas 0.15.0

Run 2026-11-14 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.7.0 (6458aae) and Connect 0.13.0 (f5398da), fusion 4, installed by `harness/live/install.cjs`, Atlas 0.15.0,
fixtures written by `harness/live/fixtures.cjs`. Script: `harness/live/phase4b.cjs`. Results:
`phase4b-live/results.json` (and `phase4a-live/`, `phase3-live/`, `phase2-live/`, `phase1-live/` for the earlier
phases' own steps).

**6/6 steps passed** (step 0 is Phase 4A's whole check, 6/6, which runs Phase 3's, 10/10, Phase 2's, 6/6, and Phase 1's, 16/16).

| Step | What | Result | Evidence |
|---|---|---|---|
| 0 | Phases 1 to 4A again: nothing regressed | PASS | 16/16, 6/6, 10/10, 6/6 |
| 37 | A brush mask and its motion put in Tabletop's data as a vault of before had them (two rectangles) are moved to Atlas's liquids when the move runs: a backup first; two brush-made liquids of four corners each, in the tint, flowing right, with the motion; in the map file; nothing left in Tabletop's data; the notice | PASS | 2 liquids, `colors.surface #336699`, `flow {1, 0}`, motion kept; in the file; backup written; `waterMoved`; Atlas's 47 older undo steps let go; drawn by the board 0.4 s later |
| 38 | A mask handed over as when the brush is let go is one brush liquid on the level shown and one step of Atlas's undo; painted on, the brush's liquids are replaced in one more step; both in the file; Atlas's undo goes back a stroke at a time until the board is dry; nothing in Tabletop's data | PASS | 1 step, 4 corners, level `level_probe_ground`; then 2 liquids, 2 steps; file 2; undone to 1, then to none |
| 39 | A lava liquid added in Atlas (with `art`) is drawn on the board; a stroke that is dry over it, and one that covers it, leave it as it is and make no brush water over it; a motion change (two in a row) re-writes only the brush's liquid, once | PASS | lava unchanged (`art`, colours, no `tabletop`); 1 brush liquid; re-tinted to `#113355`, still, no `flow`, a new id; 1 undo step for the two motion changes |
| 40 | Liquids written and a move on a map Atlas does not hold are refused | PASS | 2 × `NotHeldError`, no `.atlasmap` mtime changed, no liquid added |
| 41 | No console error from Tabletop or Connect; the cellar is left with no brush water and none in Tabletop's data | PASS | 0 errors |

## What went wrong on the way

Nothing in the live steps: the five new steps passed on their first run, alone and in the full chain.

## Not checked live

- The brush and bucket driven with the mouse (the steps hand the board's host a mask, as the board does when a stroke
  ends): the board's own path is covered by the UI harness (`water`, 42 checks).
- The players' boards and the GM's player window drawing the water (no player session): the wire's outlines and their
  reading are covered by unit tests in both repos.
- How Atlas's own 2D view draws the brush's liquids (colour, flow): the records are as Atlas's reader takes them; not looked at.
- A mask painted on an image of another size (left in the backup): unit-tested only.
