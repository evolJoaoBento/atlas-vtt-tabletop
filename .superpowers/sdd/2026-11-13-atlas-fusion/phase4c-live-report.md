# Atlas fusion Phase 4C: live check on Atlas 0.15.0

Run 2026-11-14 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.8.0 (497d26a, the review's fix pass in) and Connect 0.14.0 (ec1c04d), fusion 4, installed by `harness/live/install.cjs`, Atlas 0.15.0,
fixtures written by `harness/live/fixtures.cjs` (a stack: the cove as base; over it the cellar as one floor, three
squares up, shifted, on squares of 140 px against the base's 100, with a token look, a mini, a prop, a wall height and
a cutscene shot; under it the cove again, every id colliding, hidden). Script: `harness/live/phase4c.cjs`, which
refuses any vault but the throwaway one. Results: `phase4c-live/results.json` (and the earlier phases' folders).

**8/8 steps passed** (step 0 is Phase 4B's whole check, 8/8, which runs 4A's, 6/6, Phase 3's, 10/10, Phase 2's, 6/6,
and Phase 1's, 16/16). The same chain passed 8/8 before the stack's UI was deleted (Tabletop 42b008b, Connect 6c95146) and after it (2c9b0bb, 408c6db). Step 45 now also checks, after the review: a base presented to players naming no level is presented at its own level once a floor is under it; the base's own shot names the base's level; the undo has no older step of the base left. The review's fit of a level drawn as a layer is checked by the UI harness (`layer fit`), not live.

| Step | What | Result | Evidence |
|---|---|---|---|
| 0 | Phases 1 to 4B again: nothing regressed | PASS | 16/16, 6/6, 10/10, 6/6, 8/8 |
| 44 | The ask: the notice shown since the start; the review lists the fixture's stack as Stack Lower, Stack Base, Stack Upper with what is not kept (its initiative, its lighting, pixel sizes on squares of another size), and the vault's own stack too; Later hides the notice and changes no scene file and nothing in Tabletop's data | PASS | 2 stacks pending; 0 `.atlasmap` mtimes changed; data identical |
| 45 | Move: a backup first (each scene's file, Tabletop's data for it, its minis, and `Stacks moved.md`); the base has three levels at -10, 0 and 15 units; the upper fitted (scale 0.7143, offset 200, 100) with every kind of its records on its level and moved with it (14 walls, 4 lights, 2 tokens, 1 pin, 3 measures, 2 map features, 2 liquids); the lower's three tokens under new ids (`…_s2`), the base's own naming the base's level; the upper's wall height on its record and its old water as a brush liquid; the GM on the base's level; saved as a version 5 file; Tabletop's data adopted (token look, mini, prop on its level and moved, hidden lower level, the shot re-pointed to the base and the level with its camera moved); the stack's records and journal gone; Atlas back on the cellar | PASS | the move took about 2 s; the upper's own file was re-saved by Atlas when it was held (ruling D3), the lower's was not |
| 46 | The 3D board of the base shows three floors: the base shown, the lower 2 squares down and the upper 3 up; the upper's wall stands 3 squares, its mini is on its token | PASS | layers at -2 and 3 |
| 47 | Asked again: nothing to move, no backup. A journal put back as after a stop between Atlas's save and Tabletop's side is finished at start: no level added (still 3), no prop added twice. One whose levels the file never got is dropped and its stack is as it was | PASS | |
| 48 | The re-pointed shot's place: the board goes to the upper level (Atlas's view follows), says it is there, and comes back to the base's; the map's own place is the first level, which the base is not | PASS | |
| 49 | With a session hosted nothing is moved, and it is said why | PASS | "a session is hosted in Connect (end it first)" |
| 50 | No console error from Tabletop or Connect | PASS | 0 errors |

## What went wrong on the way

Nothing in the live steps: the seven new steps passed on their first run, alone and in the chain (they were never seen
failing). The fault the tests did find was in a unit test of the move's order (the scene's identity was captured after
the journal's save), before anything ran live.

## Not checked live

- A cutscene run for players over two levels (no player session): the keys per level and Connect's projection at a
  level are unit-tested in both repos; the GM's board following a level is step 48.
- The Move pressed in the modal with the mouse (the script calls what the button calls, and presses Later on the notice).
- A turned member, a member left of or above the base's corner, a base that already has levels, a member whose file is
  gone: unit-tested (`stackMove`, `stackMigration`); the second probe covered a member below the base on Atlas itself.
- The vault's own stack (The Gilded Flagon with Upper Floor) is previewed but kept out of the scripted Move, so the
  earlier phases' scenes stay as their checks expect.
- How Atlas's own 2D view draws the moved levels; players' boards and the GM's player window on a moved scene.
