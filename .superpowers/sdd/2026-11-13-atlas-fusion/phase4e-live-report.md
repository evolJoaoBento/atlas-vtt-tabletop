# Atlas fusion 4E: dice look, one sheet model, the board's light — live check

Run 2026-11-15 in the throwaway vault (its 0.15 copy put back before each run), role `fusion`, port 9311. Script:
`ATLAS_BUILD=<build> node harness/live/phase4e.cjs` (it runs 4D's, which runs 4C … 1 first). Results:
`phase4e-live/atlas-0.16.0/`, `phase4e-live/atlas-0.15.0/` (the chains, with Tabletop c5ce967 / Connect 29ddb80, before
the review's fix pass), and steps 54 and 50 again after it (Tabletop 862fe1d, sync 5e359f8, Connect 2c22a13).

| Phase | Atlas 0.16.0 | Atlas 0.15.0 |
|---|---|---|
| 1 | 16/16 | 16/16 |
| 2 | 6/6 | 6/6 |
| 3 | 10/10 | 10/10 |
| 4A | 6/6 | 6/6 |
| 4B | 8/8 | 8/8 |
| 4C | 10/10 | 10/10 |
| 4D | 3/3 | 3/3 |
| 4E (0, 54, 50) | 3/3; after the fix pass 54, 50: 2/2 | 3/3; after the fix pass 54, 50: 2/2 |

## Step 54

Through Atlas's own `settingsService.setDiceLook`: dark gives the board's dice Atlas's dark body `#1f1e21`, accent the
theme's accent as `#rrggbb`, light the pack's own colour (none); Atlas's look is put back.

## Not checked live

- The digits' light ink on dark dice and the roll log's set names (unit-tested: `diceInk`, `atlasDice`).
- The shared sheet model in a player session (Connect unit tests; UI harness sheet features).
- Connect's join page still draws Atlas's default dice look (its vendored bundle cannot be given another; deferred).
