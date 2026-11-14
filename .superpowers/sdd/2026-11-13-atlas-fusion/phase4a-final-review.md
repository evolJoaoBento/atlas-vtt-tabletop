# Atlas fusion Phase 4A: final review

One fresh reviewer (most capable model), read-only, over Tabletop `a81ba9f..2f1a8e7` (Connect changed only its vendored
bundle), with the plan, the program, the spec, the ledger's rulings and the plan's Review Focus. Verdict: **ready to
merge with fixes**. One fix pass followed (Tabletop `aa4c68b`, vendor `a9f2719`); each fix and its test is named in
`phase4a-ledger.md`.

## Strengths the reviewer confirmed

- The field's reader is a strict allowlist, key by key, and never throws; `mergeExtra` keeps foreign keys and never
  changes what it is given.
- The move's planner is pure and repeats safely ("the record wins").
- Writes are refused cleanly on a map Atlas does not hold; no reader of the seven old records and no dead UI action is left.
- Atlas's `splitWall` and its copies of tokens and lights carry the field; untracked writes are saved by Atlas.

## Findings and what was done

| # | Finding | Done |
|---|---|---|
| C1 | After every Atlas save the players' look went out for one tick with no wall settings (the file index forgot the scene before reading it again) | Fixed: a changed scene is answered for as it was until it is read again; a held map's look is read from Atlas's store |
| I1 | Extras reached players only through the file: late, and not at all after an undo | Fixed: the store is read for a held map, and a change tells Connect at once |
| I2 | A renamed material folder or door prop was no longer followed | Fixed: renames of folders and `.glb` files are remembered and followed at read |
| I3 | Atlas's undo of a step from before the move would wipe a moved setting | Fixed by a ruling: the move lets go of Atlas's undo steps for that map, once |
| I4 | A map with stale 0.14 room keys and no rooms never moved | Fixed: old names wait only while Atlas still holds rooms it has not made walls of |
| I5 | Right after the move the board could draw without the extras | Fixed: the board is read again; a held scene's other levels are read from the store |
| I6 | An older board undo brought the seven records back into Tabletop's data | Fixed: a migration's result is never taken back; the migrations are no undo steps |
| m1 | Two boards on one map: two backups and notices | Fixed |
| m2 | The notice counted values the record already had as "Atlas no longer has" | Fixed |
| m3 | A move half written (no `untracked`, a missing action) still cleared data.json | Fixed: whole or not at all |
| m4 | Setting what is already there made undo steps; the old setters' bounds are gone | No-op steps fixed; bounds deferred |
| m5–m8 | A scan on token changes; the materials' sort; a crash window between two saves; tests that read source text | Sort fixed; the rest deferred |

Declined to judge by the reviewer, ruled in the ledger: Atlas's `placeDoor` dropping the field and Atlas not saving an
undo (Atlas's own behaviour); one Atlas undo step per stepper click; Obsidian Sync bringing an un-moved data.json.
