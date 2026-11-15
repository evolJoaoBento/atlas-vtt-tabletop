# Atlas fusion 4F: ported panels re-synced from Atlas 0.15.0 — live check

Run 2026-11-15 in the throwaway vault (its 0.15 copy put back before each run), role `fusion`, port 9311, with Tabletop
52afaf7 and Connect 4c600d9. Script: `ATLAS_BUILD=<build> node harness/live/phase4f.cjs` (it runs 4E's, which runs 4D … 1
first). Results: `phase4f-live/atlas-0.16.0/`, `phase4f-live/atlas-0.15.0/`.

| Phase | Atlas 0.16.0 | Atlas 0.15.0 |
|---|---|---|
| 1 | 16/16 | 16/16 |
| 2 | 6/6 | 6/6 |
| 3 | 10/10 | 10/10 |
| 4A | 6/6 | 6/6 |
| 4B | 8/8 | 8/8 |
| 4C | 10/10 | 10/10 |
| 4D | 3/3 | 3/3 |
| 4E | 3/3 | 3/3 |
| 4F (0, 55, 50) | 3/3 | 3/3 |

## Step 55

On the cellar's board, through the board's Atlas tools: the command palette, the loot roller (with its random tables)
and the asset manager each open, draw their content (the copies of Atlas 0.15.0), and close; no console error from
Tabletop or Connect across the run.

## After the review's fix pass

The fix (feef33c: a scene renamed or moved from the board's asset manager is saved first by Atlas's own view) is
unit-tested and the UI harness asset-manager features pass; it was not checked live. Manual check: rename a scene from
the board's asset manager with the scene open in Atlas.
