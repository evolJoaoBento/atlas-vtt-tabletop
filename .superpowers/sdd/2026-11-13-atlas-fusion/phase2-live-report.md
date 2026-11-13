# Atlas fusion Phase 2: live check on Atlas 0.15.0

Run 2026-11-13 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.5.0 (cc8e7da) and Connect 0.11.0 (1fc3616) installed by `harness/live/install.cjs`, Atlas 0.15.0, fixtures
written by `harness/live/fixtures.cjs` (Phase 1's rooms map, and `Fusion Hex.atlasmap`: the cellar on a hex grid).
Script: `harness/live/phase2.cjs`. Results: `phase2-live/results.json`; Phase 1's own: `phase1-live/results.json`.

**6/6 steps passed** (step 0 is Phase 1's whole check: 16/16).

| Step | What | Result | Evidence |
|---|---|---|---|
| 0 | Phase 1's live check again (host, view only, Edit here, popout, closing Atlas's tab, distances, rooms, lighting, laser and dice volume, scene tabs, pin names, Atlas 0.14 floor, no console errors) | PASS 16/16 | |
| 17 | A token given 15 ft through Atlas's store stands 3 squares up, its drop line reaching the floor; set back, it lands | PASS | rose in 775 ms (eased), drop 420 px = 3 × 140, landed in 748 ms |
| 18 | A ruler from that token to one on the floor two squares away reads Atlas's distance with the height counted | PASS | "15ft": equidistant, 2 across and 3 up, 5 ft squares |
| 19 | Movement steps and a speed of 30: the board's drag ruler reads "20 / 30ft" in the Move step's colour over 4 squares; Atlas's drag distance "never" hides it; both restored | PASS | `{ label: '20 / 30ft', color: '#22c55e' }`, hidden: null, setting back to `always` |
| 20 | Tokens of size 1, 1.5 (Large) and 2 dragged on a hex scene land where Atlas's own `gridSystem.snapTokenCenter` puts them | PASS | 9 of 9 points within 0.5 px, `hex-vertical` |
| 21 | Moves, a resource change, a turn and a door on a map Atlas does not hold are refused, and no `.atlasmap` file changes | PASS | 4 × `NotHeldError`, no file's mtime changed |

## What went wrong on the way

- The first full run failed Phase 1's steps 1 and 5 on its own script: it still expected Tabletop 1.4.0, Connect 0.10.0 and
  fusion 1, and the writer's `'atlas'` result, which Phase 2 removed. Their evidence was right (the edit saved through
  Atlas, the other board's refused). The script now reads the versions and the fusion step from the builds, and no result.
- Step 17 failed once because it read the floor before the figure had settled; it now waits until the figure is still.
- A rerun in an Obsidian left open by single-step reruns failed Phase 1's steps 3, 4 and 10 (the host tab was not hidden,
  the rooms were converted already). They need a fresh start and fresh fixtures; the clean run above passes them.

## Not checked live

- A player's drag ruler in a browser or a second Obsidian (no player session in this run); Connect's projection and the
  page's ruler are covered by unit tests.
- Movement that adds up over a turn (`countPerTurn`): not tracked in Phase 2.
