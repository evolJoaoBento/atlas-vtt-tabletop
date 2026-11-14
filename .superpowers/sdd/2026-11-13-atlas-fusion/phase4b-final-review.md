# Atlas fusion Phase 4B: final review and fix pass

One fresh reviewer (model "fable") read the whole sub-plan's diff in both repos (Tabletop `de90aa9..17feba1`, Connect
`a9f2719..f5398da`), the plan, the spec and the ledger's rulings. Verdict: **0 Critical, 6 Important**, a list of
minors, and four rulings weighed. One fix pass followed (Tabletop `35ad6e0`, `1a7c001`; Connect `5b34ac8`, `0d277fd`).
A unit or harness test was watched failing first wherever the fix is in code a test can reach; what is view glue was
checked live only, on the fixed build (never watched failing), and is marked so.

## Important findings and what was done

| # | Finding | Fix | Evidence |
|---|---|---|---|
| 1 | A stroke or a motion change made before the map was read again worked from the liquids the board read last: the brush's liquids could be doubled, erased water could come back | The change is planned at the write, on the liquids Atlas's store has then (`TokenWriter.replaceLiquids` takes a plan; `liquids.ts` `strokeLiquids`); the view also refreshes the map's liquids from the store's change, ahead of the map's next read | RED→GREEN: `tests/liquidWrites.test.ts` "a stroke's write is planned on the liquids Atlas has at the moment of the write", `tests/liquids.test.ts` "a stroke is written against the liquids Atlas has at that moment". Live only: step 42 |
| 2 | The board never drew again what Atlas kept where that was not what was painted (the key was equal by construction; `paintedWater` pinned the painted source, wrong motion included) | `paintedWater` is gone. `BoardHost.saveWater` may give a promise; once it settles the board compares its mask with the host's water (`sameWet`) and draws the host's where they differ (`Board.showKeptWater`) | RED→GREEN: `tests/liquids.test.ts` "two masks are the same water"; UI harness feature `water-liquids` (3/5 on the board of before: an erased pool stayed gone; 5/5 after) |
| 3 | Past 2048 corners the shore was thinned (up to ~79 texels) before tiny holes went | `maskOutlines` gives up a step at a time: dry spots of a texel or two filled, the edge thinned to two texels, the other dry ground filled smallest first, the edge thinned further, the patch left out only when nothing fits; all counted (`OutlineReport`) and said in a notice (`givenUpText`) | RED→GREEN: `tests/liquids.test.ts` "when a liquid would pass Atlas's corners…", "an edge is thinned to fit…", "a shore is smoothed past two texels only when…", "what was given up to fit Atlas is said in words" |
| 4 | The move cleared water it could not read (the stand-in size of an image that failed to load; a board on another level; `room` cut silently) | The move runs only on a board that knows the map's size (`Board.mapSizeKnown`) with the first level shown; all of it or none (`legacyWaterMove`): an unreadable mask, patches Atlas would not keep, or no room beside the level's liquids leave it in Tabletop's data (a notice for the last two); a failed move is not tried again while Obsidian runs (no backup over and over) | RED→GREEN: `tests/liquids.test.ts` "a map's old painted water moves whole or stays…" and the amended legacy case. Live only: step 43 (another level shown; a mask of another size) |
| 5 | The chosen motion was never let go and was a map's, not a level's; the timer did not look at the level | Keyed by map and level; let go once the brush's liquids carry it or the write was refused; the wait writes to the level it was chosen on (whichever is shown by then), and a pending one is written when the board closes | Live only: step 42 (a motion and a stroke at once: one write, nothing left chosen). No unit test: view glue |
| 6 | None of 1, 2, 4, 5 was tested; the harness handed the board a mask only | The tests above; the harness host can keep water as Atlas does (`setLiquids`: outlines, a liquid the brush may not change) | as listed |

## Found in the fix pass itself (advisor), fixed in `1a7c001`

- The move was not all-or-none where Atlas would not keep a patch at all (dropped for its corners, or past 256): the
  rest moved and the old mask was cleared. Now `legacyWaterMove` gives `left-out` and the mask stays, with a notice.
- A stroke over 2048 corners vanished whole once the two-texel cap was in. Now the shore is thinned further as the
  last step, and the notice is not held back when water was left out.

## Rulings the reviewer weighed

- "The board takes the host's key after a stroke; the view hands back what was just painted": **overturned** (fix 2).
- "The motion chosen is remembered for the session": **amended** (fix 5).
- D5 (the water's move runs on its own): **kept**, with fix 4's preconditions.
- The harness's own water store: **kept**, with the outlines case added.

## Minors (deferred, in the ledger and the report)

Listed in `phase4b-ledger.md` under `Final: minor (deferred)`.
