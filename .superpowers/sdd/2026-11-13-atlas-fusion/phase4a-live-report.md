# Atlas fusion Phase 4A: live check on Atlas 0.15.0

Run 2026-11-14 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.6.0 (d22d9d3) and Connect 0.12.0 (c85aafa) installed by `harness/live/install.cjs`, Atlas 0.15.0, fixtures
written by `harness/live/fixtures.cjs`. Script: `harness/live/phase4a.cjs`. Results: `phase4a-live/results.json`
(and `phase3-live/`, `phase2-live/`, `phase1-live/` for the earlier phases' own steps). Gate probe before the plan:
`harness/live/phase4a-probe.cjs`, `phase4a-probe.json` (a `tabletop` field survives on walls, placed lights and tokens).

**6/6 steps passed** (step 0 is Phase 3's whole check, 10/10, which runs Phase 2's, 6/6, and Phase 1's, 16/16).

| Step | What | Result | Evidence |
|---|---|---|---|
| 0 | Phases 1 to 3 again: nothing regressed | PASS | 16/16, 6/6, 10/10 |
| 1.10 | (Phase 1's rooms step, changed for 4A) the rooms map's old wall settings, re-keyed by migration 1, end on Atlas's own walls | PASS | `room__5600_1120_1120_1120.tabletop.height = 3`, `room__1120_1120_1120_4480.tabletop.material = Materials/stone`; none of the seven records left in Tabletop's data; `extrasMoved`; both notices; backups written |
| 32 | A wall's height set from the board (its own setter) is on Atlas's wall, in the map file, one step of Atlas's undo, read back at once; Atlas's undo takes it back | PASS | on the record in 1 ms, 1 undo step, in the file, undone at once; nothing in Tabletop's data |
| 33 | A material, a width, a window's opening, a door's prop and a door's turn each go onto the record beside what is there; back to the default takes each key off, and the field with it | PASS | 5 writes = 5 undo steps; read back at once; both fields gone after |
| 34 | A placed light's height is on the light's record, a carried light's on its token; both in the file; taken off again | PASS | `lights[id].tabletop.height = 3`, `tokens[id].tabletop.lightHeight = 1.5`, in the file, cleared |
| 35 | On a map Atlas does not hold a wall setting, a light's height and a move are refused | PASS | 3 × `NotHeldError`, no `.atlasmap` mtime changed, Tabletop's data unchanged |
| 36 | No console error from Tabletop or Connect; no map Atlas held keeps a 3D setting in Tabletop's data | PASS | 0 errors; only `The Gilded Flagon.atlasmap`, which the run never brought Atlas to, still keeps its own (it moves when Atlas first holds it) |

## What went wrong on the way

- A partial run of the new steps alone failed step 36: it never opened the rooms map, so that map's settings had not
  moved. The step now names the maps the run brings Atlas to; the full run passes it.

## Not checked live

- The players' boards and the GM's player window drawing the same heights and materials as before (no player session
  in this run): the look sent to players (`boardLook`, `boardLayers`) is covered by unit tests fed from records.
- A wall deleted, split or copied in Atlas's own UI carrying or dropping its extras: Atlas keeps the field on the
  record (probe), so it goes or comes with the record; not driven through Atlas's UI here.
- The move on a real vault's maps: only the fixture map and the probe cellar were moved.
