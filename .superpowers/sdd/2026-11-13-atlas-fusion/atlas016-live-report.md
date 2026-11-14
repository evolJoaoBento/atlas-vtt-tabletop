# Atlas fusion: Atlas VTT 0.16 support — live check on Atlas 0.16.0 and 0.15.0

Run 2026-11-14 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.9.0 (625edab, plus the live script 59a90a2) and Connect 0.15.0 (ee5f250), fusion 4, installed by
`harness/live/install.cjs`, fixtures by `harness/live/fixtures.cjs`. The vault's 0.15 state was kept aside
(`C:\Users\joaoo\fusion-gate-vault-015-copy`) for the 0.16 run and put back for the 0.15 run. Script:
`harness/live/phase4c.cjs` (it runs 4B's, which runs 4A's, 3's, 2's and 1's first); `ATLAS_BUILD` names the build
Phase 1 expects and puts back. Results: `atlas016-live/` (0.16.0), `phase*-live/` (0.15.0, the last run).

| Phase | Atlas 0.16.0 | Atlas 0.15.0 |
|---|---|---|
| 1 | 16/16 | 16/16 |
| 2 | 6/6 | 6/6 |
| 3 | 10/10 | 10/10 |
| 4A | 6/6 | 6/6 |
| 4B | 8/8 | 8/8 |
| 4C, with 51 (a floor left of the base's corner) | 9/9 | 10/10 (with 52) |
| 52 (hidden notes and fills on Atlas itself) | 1/1, run alone after the chain | in the chain |

## New steps

| Step | What | Evidence |
|---|---|---|
| 51 | A stack whose upper floor lay 2.5 squares left of the base's corner: the whole scene goes 3 squares right. The base's own level is aligned at offset 300 and its token moved +300; the upper level at 50 (−250 + 300) with its token moved +50; Atlas reads both alignments back after a reload; the shift is said in the review | passed on its first run, on both builds |
| 52 | Through Atlas's own `addDrawing`/`addText`: a hidden pen line and a hidden text are drawn on the GM's board and left out of the players' picture; a plain line is in both; a rectangle with `fill: 'solid'`, a hole and width 0 is read so and drawn as a fill with no line | passed on its first run, on both builds |

## What went wrong on the way

The first 0.16 chain, before this sub-plan's code, failed Phase 1 steps 1 (it pinned 0.15.0), 3, 4 and 10. Phase 1
also put 0.15.0 back near its end, so the later phases had run partly on 0.15. With the build parametrised, Phase 1
alone from a fresh install passed 16/16 on 0.16, and so did the full chain: steps 3, 4 and 10 had been the known
run-order artifact.

## Not checked live

- What Connect sends players (no player session): the hidden check, fills, holes, stamps and the 2D view's drawing of
  them are unit-tested in Connect (`fogPositive`, `drawingLooks`); a player's 3D board reading them in Tabletop
  (`sceneAdapter`).
- Pin-symbol stamps and turned stamps on the board (unit-tested: `mapIcons`, the reader).
