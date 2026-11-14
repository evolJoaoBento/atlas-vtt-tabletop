# Atlas fusion Phase 4: program

> Phase 4 of the design (`docs/superpowers/specs/2026-11-13-atlas-fusion-design.md`, section 8) covers six subsystems
> that do not depend on each other's code. It is run as six sub-plans, in the order below, each written when its turn
> comes (`2026-11-14-atlas-fusion-phase4<letter>.md`) and each **closed before the next starts**: committed in both
> repos, the player board re-vendored, live-checked in the throwaway vault on Atlas 0.15.0, reviewed once by a fresh
> reviewer, its ledger and reports under `.superpowers/sdd/2026-11-13-atlas-fusion/`. Wherever the work stops, the
> branch is something the user can take.

**Standing limits (the user's, 2026-11-13 and 2026-11-14):** never push; never merge; never touch a real vault (only
`C:\Users\joaoo\fusion-gate-vault`); Phase 4 runs without waiting for a go-ahead. Inline execution, one fresh reviewer
at the end of each sub-plan.

## Order, by dependency

| # | Sub-plan | What it does | Why here |
|---|---|---|---|
| 4A | 3D extras onto Atlas records | What the GM set on a wall, a door or a light in 3D (height, width, material, window opening, door prop and flips, a light's height) moves from Tabletop's data.json onto Atlas's own record, in a `tabletop` field (gates G1w, G1l passed) | First: 4C then copies records that already carry their extras |
| 4B | Water to liquids | The board draws `objects.liquids`; the brush writes polygons with `addLiquids`; the data.json mask goes | Before 4C, for the same reason |
| 4C | Stacks to levels | Migration 3 (asks first): each stack member becomes a level of its base scene; the stack UI, `BoardLayerRecord` and `tokensMoved` go | After 4A and 4B: one target format |
| 4D | Sight follows Atlas | `lineOfSight` and `sightStyle` go; the board draws Atlas's `playerSight()`; measure light and darkness come through Atlas (this settles Phase 3's ruling on the board's own `ruleWalls` / `ruleLights`) | After 4C: the stack blackout code is gone |
| 4E | Dice look, sheets, Connect's `BoardExtras` lighting | The die's colour and numerals are Atlas's `getDiceLook()`; one sheet model; `BoardExtras.lighting`, `ambient`, `tint` go | Independent |
| 4F | Panels re-synced from 0.15 | Initiative panel, palette, random tables, loot, asset manager re-synced by `sync:atlas`; `atlasPort/app/{grid,levels,lighting,vision}` shrink to what the panels pull in | Last: mechanical |

`FUSION_PROTOCOL` becomes 4 once, at the first change of the contract between the plugins.

## Rulings made for the whole program

- **Triggers of the moves the spec gives no trigger for (section 6 names only migrations 1 and 3).** A move that loses
  nothing runs on its own, once per map, when Atlas comes to hold the map, with a backup first and one notice (as
  migration 1): the 3D extras (4A). A move that loses something asks first and asks again at each start until the GM
  says Move (as migration 3): the stacks (4C). Painted water was first put here too; 4B's plan (D5) moved it to the
  moves that run on their own, since its outlines lie within a sixteenth of a square of the brush's edge. Cost if
  wrong: a GM finds their wall settings moved without having been asked (the backup holds the old data.json and map).
- **A backup is always written first**, to `Tabletop backups/<date>/` in the vault (`src/backups.ts`): the `.atlasmap`
  and Tabletop's data for it. A migration never deletes a backup and never writes a map file itself: every write goes
  through Atlas's store, on a map Atlas holds; a map Atlas does not come to hold is skipped and listed.
- **Extras ride in one field.** Every Tabletop extra on an Atlas record is under `tabletop: { v: 1, … }` (as measures
  since Phase 3), read with a per-kind allowlist; junk is ignored, never thrown on.

## In every sub-plan's Review Focus (each bit in Phase 3)

1. **The GM's local player window** is a second audience for anything newly drawn from Atlas's records: nothing Atlas
   keeps from players may show there.
2. **The players' level against the GM's viewed level**: what is written for players lands on, and what they are sent
   comes from, the level they are shown.
3. **A board on a map Atlas does not hold**: it draws from the file, edits are refused with the bar's text, nothing is
   written anywhere else.
4. **Records made or changed in Atlas's own UI**, or carrying a junk `tabletop` field: drawn as Atlas has them, never a throw.
5. **A live script that presses a migration's "Move"** refuses any vault but the throwaway one (as `install.cjs`).

## Checks that block 4C (run before its plan is written)

- Whether the GM's board and the players' boards already draw a scene's other Atlas levels at their height. If not,
  feeding `elevationLayer` from levels is the bulk of 4C: deleting the stack UI first would drop the multi-floor view.
- An inventory of everything keyed by a member map's path or ids: wall overrides and cutscene shots (the spec's), and
  minis assignments, token styles, props, materials, AR table, sounds, initiative, Connect's controllers (tokens get
  new ids?), and the record kinds newer than the spec (measures, map features, liquids). A spell's measure is copied;
  its `spell:` walls are not (the reconciler derives them again for the new id).
