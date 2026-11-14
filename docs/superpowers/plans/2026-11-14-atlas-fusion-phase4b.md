# Atlas fusion Phase 4B: painted water is Atlas's liquids

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps are test-first.

**Goal:** The water the GM paints on the 3D board is kept as Atlas's own liquids (`objects.liquids`), and the board draws every liquid Atlas has.

**Architecture:** Tabletop keeps a brush mask per map in data.json (`water: { mask, motion }`), which Atlas never sees; Atlas keeps liquids as polygons with holes, which the board never draws. The board keeps its mask as what it draws and paints into, but the mask is no longer stored: it is rasterised from the level's liquids when the map is read, and a finished stroke is traced back into outlines and written with Atlas's `addLiquids` / `deleteLiquid` in one step of its undo. The brush owns the liquids it made (`tabletop: { v: 1, brush: true, motion }`); liquids made in Atlas are drawn and left as they are. Players get outlines, not a mask (the players' board rasterises them at its own size).

**Tech stack:** TypeScript, node:test, the UI harness, the live script; Connect: vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` sections 4.3, 8 (Phase 4, Water), 10 (Water detail), 11 (G1q, G8 liquids), 13 (resolution left to the builder). Program: `2026-11-14-atlas-fusion-phase4-program.md`.

## Global constraints

- Never push, never merge, never touch a real vault. Live checks only in `C:\Users\joaoo\fusion-gate-vault`.
- No map file is written by Tabletop; every write is a store action on a map Atlas holds.
- A backup before the move; one notice; the move is whole or not at all, outside Atlas's undo, and lets go of Atlas's older steps (as 4A).
- The contract with Connect changes (`BoardWater` carries outlines): `FUSION_PROTOCOL = 4`, Tabletop 1.7.0, Connect 0.13.0.
- Commit trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Decisions

- **D1 What is kept.** A brush-made liquid: `{ liquid: 'water', polygon, holes?, colors, flow?, level?, tabletop: { v: 1, brush: true, motion } }`. `colors` come from the motion's tint (surface the tint, deep darker, glint lighter), `flow` from its direction when it flows, so Atlas's 2D view shows the same water. The motion (kind, amount, direction, tint, clarity) is one for all the brush's water of a level; it is read from the first brush-made liquid.
- **D2 Outlines.** A mask is traced along its texel edges into rings (an outer ring and its holes per patch), then thinned: points on a straight run go, then Douglas–Peucker within half a texel (a sixteenth of a square), more only when a ring would pass Atlas's 2048 corners. Patches beyond Atlas's 256 per level, smallest first, are left out. Rasterising is the reverse: a texel is wet when its centre lies in a ring and in none of its holes.
- **D3 What the board draws.** Every liquid of the level shown, any kind, in one mask; the motion is the brush's, else still water in the first liquid's surface colour. Lava and acid are drawn as water of their colour (their own look is not built here).
- **D4 What the brush changes.** A finished stroke (or bucket) writes the mask minus what liquids made in Atlas cover: the brush-made liquids of the level are replaced by its outlines, in one step of Atlas's undo. Erasing over a liquid made in Atlas changes nothing (it is Atlas's to change). A motion change re-writes the brush's liquids (Atlas has no update for liquids), once the sliders rest.
- **D5 The move runs on its own** (revising the program's ruling that water asks first): the outlines lie within a sixteenth of a square of the brush's edge, the loss the design already names (section 10). When Atlas holds a map whose data.json has water: back up, write its outlines as brush-made liquids on the first level, drop `water` from data.json, one notice. A map Atlas does not hold draws its old mask until then.
- **D6 Players.** `BoardWater = { areas: Array<{ polygon: number[]; holes?: number[][] }>; motion }` for the scene and for each stacked scene or level, built from the map as Atlas has it (the store when held, else the file), and from the old mask of a map not moved yet.

## Review Focus

1. Liquids made in Atlas (a generated dungeon's water, lava, acid; with holes, a course, art): drawn on the board, never rewritten or deleted by the brush, the move or a motion change.
2. A mask that traces to nothing, to more than 256 patches, to a ring of more than 2048 corners, touching the map's edge, with holes in holes, or patches meeting at a corner: no throw, no crossed ring, nothing outside the limits written.
3. The players' boards and the GM's player window: the same water as the GM's board, for the scene, its other levels and stacked scenes; a hidden or fogged area shows no more than before.
4. A map Atlas does not hold: draws its water (liquids from the file, or the old mask); painting is refused with the bar's text; nothing is written.
5. The move run twice, interrupted, on a map with levels, or beside liquids Atlas already has: nothing doubled, nothing of Atlas's touched; an older board undo does not bring the mask back.

---

### Task 1: Outlines and rasters (pure)

- Create `src/board/liquids.ts`: `readLiquids(raw)`, `maskOutlines(mask, limits?)`, `rasterAreas(mask, areas)`, `brushLiquids(outlines, motion, level)`, `motionOf(liquids)`, `withoutAreas(mask, areas)`.
- Test `tests/liquids.test.ts`: a rectangle, an L, a ring (a hole), two patches meeting at a corner, a patch at the map's edge trace to closed rings that rasterise back to the same mask; a round brush stroke comes back within one texel of its edge; the corner and patch limits; junk liquids are left out; colours and flow from a motion; the motion read back.

### Task 2: The map's liquids and their writes

- Modify `src/board/mapModel.ts` (`BoardMap.liquids`, by level), `src/atlas.ts` (`addLiquids`, `deleteLiquid`, `objects.liquids`), `src/board/tokenWriter.ts` (`replaceLiquids(path, remove, add)`, `applyWaterMove(path, add)`), `src/board/undoRecorders.ts`.
- Test `tests/liquidWrites.test.ts`: one transaction; not held → `NotHeldError`; ids Atlas no longer has passed over; the move untracked, whole or not at all.

### Task 3: The board draws areas

- Modify `src/board/board.ts` (`host.water()` gives `{ key, areas, motion }`; `loadWater` rasterises; a stroke still ends in `host.saveWater(mask)`), `harness/board.ts`, `src/board/sceneAdapter.ts`, `src/playerBoard.ts`, `src/board/elevationLayer.ts`.
- Test: harness `water`, board suite.

### Task 4: The GM's board reads and writes liquids

- Modify `src/board/BoardView.ts` (water from `map.liquids`, the old mask as a fallback; `saveWater` → `withoutAreas` → `replaceLiquids`; motion written once it rests; layers' water from their maps), `src/board/boardData.ts` (no water setters; `legacyWater(path)`, `clearLegacyWater(path)`, `waterMoved`; `restore` keeps the move), the move after the extras' move.
- Test `tests/noWaterStorage.test.ts` (guard), `tests/boardData.test.ts`, `tests/undoHistory.test.ts`.

### Task 5: Players get outlines (both repos)

- Tabletop: `src/connectContract.ts`, `src/boardLook.ts`, `src/boardLayers.ts`. Connect: `boardTypes.ts`, `boardValidation.ts`, `projectBoard.ts`, `sceneContracts.ts`, `FUSION_PROTOCOL = 4`, tests.

### Task 6: Versions, docs, vendor

- Tabletop 1.7.0, Connect 0.13.0, READMEs, spec sections 6, 9, 10; program doc's ruling revised (D5); `dist-web` vendored; sync.

### Task 7: Live check

- `harness/live/phase4b.cjs` (runs `phase4a.cjs` first): a mask in data.json becomes liquids with a backup; a stroke is liquids in the store and the file, one undo step; Atlas's undo dries it; a liquid added in Atlas shows on the board and survives a stroke and a motion change; refused on a map not held. Report `phase4b-live-report.md`.

Then: one fresh reviewer, one fix pass, ledger to `phase4b-ledger.md`, report.
