# Atlas fusion Phase 3: live check on Atlas 0.15.0

Run 2026-11-14 in the throwaway vault (`C:\Users\joaoo\fusion-gate-vault`), Obsidian role `fusion` on port 9311, with
Tabletop 1.6.0 (c69df6e, with the final review's fixes; first run on 1f26db6) and Connect 0.12.0 (d1d436b; first run on e4e9e31) installed by `harness/live/install.cjs`, Atlas 0.15.0, fixtures
written by `harness/live/fixtures.cjs`. Script: `harness/live/phase3.cjs`. Results: `phase3-live/results.json`;
Phase 2's own: `phase2-live/results.json`; Phase 1's own: `phase1-live/results.json`.

**10/10 steps passed** (step 0 is Phase 2's whole check, 6/6, which runs Phase 1's, 16/16).

| Step | What | Result | Evidence |
|---|---|---|---|
| 0 | Phases 1 and 2 again: nothing regressed | PASS 16/16 and 6/6 | |
| 23 | A cast that lasts (through the board's own caster path) is one measure in Atlas's store and one step of its undo; the board draws it from there; it is in the map file after the save; the view keeps no list of its own | PASS | 1 measure, `shape: circle`, `tabletop.kind: spell`, name kept, 1 undo step, shown at once, in the file |
| 24 | Atlas's undo takes the spell off the board, its redo brings it back; the board's remove is one more step | PASS | gone and back within 1 ms of the store's change; remove = 1 step |
| 25 | A circle with an effect and a kept ruler made in Atlas show flat on the board (the ruler as its two legs) and go when Atlas deletes them; neither is a spell | PASS | 3 marks, all `kind: area`, no cast |
| 26 | A spell whose measure is moved in Atlas (`updateMeasure` of its points) moves on the board, same size | PASS | (700, 700) to (910, 630), size 140 kept |
| 27 | What a spell stands is Atlas's own, outside the undo: a wall spell's wall (`chainId: spell:<id>`), a web's difficult ground (a map feature of 32 corners, `terrain.difficult`), a light's light (bright 20, dim 40); the board builds no map wall for them; they are in the file; the wall follows the measure when it is moved; all go with the spell | PASS | stood after 295 ms; 2 casts = 2 undo steps; board map walls +0, rule walls 1; file: 1 wall, 1 feature; followed in 202 ms; cleaned in 204 ms; 2 removes = 2 steps |
| 28 | An instantaneous spell goes off on the board and is kept nowhere | PASS | 0 measures, 0 undo steps, gone from the board after 3.0 s |
| 29 | A measure written and one removed on a map Atlas does not hold are refused; nothing changes | PASS | 2 × `NotHeldError`, no `.atlasmap` mtime changed, Atlas still on the cellar |
| 30 | A board closed and opened again on a map with a kept spell (one with a push rule) shows it standing | PASS | no `spell.impact.*` sound, no fresh cast, nothing growing, no review open, 0 undo steps, still one measure |
| 31 | No console error from Tabletop or Connect; the map is left with no measure, wall or ground of a spell | PASS | 0 errors; the two Phase 0 probe records (a `tabletop` field that is no spell's, on a measure and on a map feature) were read as plain records and never touched |

The run was made twice: before the final review (10/10) and again on the builds with its fixes (10/10, the table's
evidence is the first run's; the second's is in `phase3-live/results.json`).

## What went wrong on the way

- The first run of the new steps failed step 31 on the script's own check: it counted every record with a `tabletop`
  field, and the vault still holds the Phase 0 gate probes' records (`tabletop: { probe: 1 }`). The check now counts only
  spells, templates and what stands for a spell; the probes' records staying untouched is itself Review Focus 1.
- A full run started right after that single-step run failed Phase 1's steps 3 and 4 (the host's Atlas tab was not
  hidden): the same artifact Phase 2's report names, a run begun from the workspace a partial run left. The clean run
  above, started from a full run's end state with fresh fixtures, passes them.

## Not checked live

- The final review's fixes that need a player or the player window: hidden measures left out of the players' window
  (unit tests and the harness's `hidden measures`), a measure following a token, the upkeep with no board open, the
  level a player's measure lands on, a player's refusal words (unit tests).
- A player's cast, template, refusal and limits, and what players are sent (no player session in this run): covered by
  Connect's unit tests (`measureHost`, `projectMeasures`, `sceneMeasures`, `sceneMarks`, `stockMeasures`).
- A measure dragged with the mouse in Atlas's own UI: the step moves it through the same store action (`updateMeasure`).
- Darkness (a round spell's) in Atlas's lighting, and Atlas's sight and movement honouring the derived walls and ground:
  the records are there as Atlas's own tools make them; how Atlas draws and applies them was not looked at.
