# Atlas VTT 0.16 support: final review and fix pass

One fresh reviewer (Opus 5.5: the account had no Fable credits left) read the sub-plan's diff in both repos (Tabletop
`110a60c..59a90a2`, Connect `d624e6f..ee5f250`), the plan, the ledger's rulings and Atlas 0.16.0's source. Verdict: **1
Critical, 7 Important** (F1-F8), minors. One fix pass followed (Connect `e260613`, vendor `5304910`; Tabletop `f0f7d89`,
sync `8a87a17`). Each fix in code a test reaches was watched failing first.

## Findings and what was done

| # | Finding | Fix | Evidence |
|---|---|---|---|
| F1 (Critical) | Connect dropped a filled drawing the fog covered only in part: a GM's box over a half-revealed room vanished for players, showing what it hid | A drawing with a fill is sent while any part of it is out of the fog (`FogCoverage.within().showsSome`, the dark's cover too); an unfilled line keeps the old rule | RED→GREEN: `drawingCover` "is sent while any part of it is out of the fog…" |
| F2 | A cutscene too large to send shed drawings in order, fills among them | Shedding drops unfilled drawings first and never a fill | RED→GREEN: `drawingCover` "a cutscene too large to send sheds drawings without a fill first…" |
| F3 | Tabletop laid all inks, then all texts, then all stamps; Atlas 0.16 draws drawings, texts and stamps in one order, so a box over a text hid nothing | `readAnnotations` keeps Atlas's `annotationList` order as `rank`; inks, texts and stamps take `renderOrder = 2 + rank·1e-4`; the player board ranks Connect's wire (texts under drawings, drawings by `stack` then time) | RED→GREEN: `annotations` "drawings, texts and stamps share one order…"; `mapModel`/`ink` expectations carry `rank` |
| F4 | Connect stacked drawings by timestamp alone; Atlas 0.16 stacks by `order` first (a route cut later kept under a box) | `stack` (Atlas's `order`) sent when nonzero; both 2D view and player board sort by (`stack`, `order`) | RED→GREEN: `drawingCover` "is stacked in the order Atlas stacks it…" |
| F5 | Fills used even-odd; Atlas fills by nonzero, holes cut only where the outline covers | Connect winds each hole against its outline; Tabletop's `fillTriangles` triangulates a simple fill exactly, else lays it on a nonzero grid (256 cells) | RED→GREEN: `drawingCover` nonzero case; `ink` "a fill is Atlas's: a self-crossing outline filled by the nonzero rule…" |
| F6 | A drawing on Atlas 0.16's map layer (`layer: 'map'`) was drawn above tokens | Connect sends `layer: 'map'`; its map layer draws those under the grid and tokens (`createMapDrawings`); Tabletop reads `layer` | RED→GREEN: `drawingCover` map-layer case; `sceneAdapter` fills case |
| F7 | A player on an older Connect gets the new fields it cannot read | Ruling, not fixed: see below | — |
| F8 | Tokens and props under an opaque box above the tokens stayed in 3D players' picture (Atlas's 2D shows the box over them) | `underBox` (solid, opacity ≥ 0.99, not hidden, not map layer, nonzero inside less holes) hides them from players; GM still sees them | RED→GREEN: `ink` "what an opaque box above the tokens covers…"; UI harness `boxes hide tokens` 1/2 with the check removed, 2/2 with it |

## Rulings

- F7: players must update Connect with the GM. An older player client reads a fill as a plain line: a box shows as its
  outline, nothing leaks that the GM hid (Connect never sends a hidden note, d624e6f). Cost if wrong: an old client's
  player sees under a box until they update.
- F3: the player board ranks texts under drawings (Connect's 2D view lays texts under drawings, and the wire carries no
  common order across them). Cost if wrong: on a player's 3D board a text drawn over a box after it sits under it.

## Minors (deferred)

- Connect draws a pin-symbol stamp without its opacity (`pinGlyph` takes none).
- A line of width 0 with no fill is skipped; Atlas's 0.16 reader never writes one, older records draw a hairline in Atlas.
- Holes are not counted in Connect's point budget (capped at 64 rings by validation).
- Simplifying a closed outline's points can move its closing point; Atlas still reads it closed by its type.
- Atlas's `convertShapes` drops a drawing's fill; not ours to fix.
- Eraser records on 0.15: Atlas 0.15 draws them as strokes, both plugins draw none (reviewer: harmless).
