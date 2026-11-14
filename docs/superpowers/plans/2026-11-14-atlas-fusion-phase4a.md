# Atlas fusion Phase 4A: 3D extras onto Atlas's records

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps are test-first.

**Goal:** What the GM sets on a wall, a door or a light in 3D lives on Atlas's own record, in its `tabletop` field, and nowhere else.

**Architecture:** Tabletop keeps seven records per map in data.json, keyed by Atlas ids (`wallMaterials`, `doorProps`, `wallHeights`, `wallWidths`, `windows`, `doorFlips`, `lightHeights`). They move to `objects.walls[id].tabletop`, `objects.lights[id].tabletop` and, for a light a token carries, `objects.tokens[id].tabletop`. Reads come from the map as read (`BoardWall.extra`, `BoardLight.height`), through one read model (`extrasOf(map, legacy)`), with data.json as a fallback only for a map not moved yet. Writes go through `TokenWriter` to Atlas's store (one step of its undo), so they need Atlas to hold the map, as every other edit. A move runs on its own, once per map, when Atlas comes to hold it, after a backup.

**Tech stack:** TypeScript, node:test, the UI harness, the live script over DevTools.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` sections 4.3 (last row), 6 (rules of every migration), 8 (Phase 4), 11 (G1w, G1l: PASS). Program: `2026-11-14-atlas-fusion-phase4-program.md`.

## Global constraints

- Never push, never merge, never touch a real vault. Live checks only in `C:\Users\joaoo\fusion-gate-vault`.
- No map file is written by Tabletop: every write is a store action on a map Atlas holds (`NotHeldError` otherwise).
- A backup (`src/backups.ts`) before a move; a move never deletes it; one notice says what moved.
- The contract with Connect does not change (`BoardExtras` keeps its shape): no fusion bump, versions stay 1.6.0 / 0.12.0.
- Commit trailer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Decisions

- **D1 The field.** Walls and doors: `tabletop: { v: 1, height?, width?, material?, window?: { bottom, top }, prop?, hinge?: true, side?: true }`. Lights and tokens that carry one: `tabletop: { v: 1, height }` (a token's is `lightHeight`, so a token's own extras can grow beside it). Read by allowlist with the bounds the setters had (height ≥ 0, width > 0, window `0 ≤ bottom < top`); anything else is ignored. Other keys of `tabletop` on a record are kept on write (a spell's `spell` on a derived wall).
- **D2 Reads.** `extrasOf(map, legacy)` gives `wallHeight(id)`, `wallWidth(id)`, `wallMaterial(id)`, `windowOf(id)`, `doorProp(id)`, `doorFlip(id)`, `lightHeight(id)`, `usedMaterials()`: the record's value, else the legacy data.json value of a map not moved yet.
- **D3 Writes.** `writer.setWallExtras(path, ids, change)`, `writer.setLightHeight(path, lightId, height)` (a placed light's record, or the carrying token's), each one transaction; null removes a key; an empty `tabletop` is removed. The board's own undo records them as Atlas steps.
- **D4 The move.** When Atlas holds a map whose data.json has any of the seven records: back up, write each value to its record (`untracked`: a move is no undo step), then delete the seven records from data.json and mark `extrasMoved`. A value whose record Atlas does not have is dropped (it is in the backup) and counted in the notice. It runs after migration 1 (old room ids are re-keyed first).
- **D5 What is lost.** Setting a wall's height, material or a light's height on a map Atlas does not hold is refused (it used to be kept in data.json). To spec section 10.

## Review Focus

1. A wall, door or light deleted, split or re-made in Atlas: its extras go with the record; nothing is left keyed by a dead id; a copy made in Atlas carries them.
2. A map Atlas does not hold, or not moved yet: it draws with its legacy values; an edit is refused with the bar's text; nothing is written.
3. The players' boards and the GM's player window draw the same extras as before (through `BoardExtras`), for the shown scene and for stacked scenes read from files.
4. A junk `tabletop` on a wall, a light or a token (wrong types, negative sizes, a spell's field): ignored field by field, never thrown on, and kept as it is when another key is written.
5. The move run twice, interrupted, or on a map with ids Atlas no longer has: nothing is doubled or lost; the backup holds the old data.

---

### Task 1: Live probe (no product code)

`harness/live/phase4a-probe.cjs` in the throwaway vault: `updateWall(id, { tabletop })`, `updateLight(id, { tabletop })` (name the action found), `updateToken(id, { tabletop })`; each kept in the store, in the file after the save, after `toggleDoor` / a token move, and after switching map and back. Results to `.superpowers/sdd/2026-11-13-atlas-fusion/phase4a-probe.json`. A kind that fails keeps its data.json record (ruling).

### Task 2: The field and its reading

- Create `src/board/recordExtras.ts`: `WallExtra`, `readWallExtra(raw)`, `readLightHeight(raw)`, `mergeExtra(current, change)`, `extrasOf(map, legacy)`.
- Modify `src/board/walls.ts`: `BoardWall.extra`, `BoardLight.ownHeight` read from the records (and the carrying token's).
- Test `tests/recordExtras.test.ts`: allowlist and bounds; junk ignored; merge keeps foreign keys and drops an emptied field; `extrasOf` prefers the record, falls back to legacy, lists used materials once.

### Task 3: Writes through Atlas's store

- Modify `src/board/tokenWriter.ts`, `src/atlas.ts` (`updateLight`), `src/board/undoRecorders.ts`.
- Test `tests/extraWrites.test.ts`: one transaction per call; several walls at once; a token-carried light writes the token; not held → `NotHeldError`, nothing written; a record Atlas does not have is passed over.

### Task 4: The board reads and writes records only

- Modify `src/board/BoardView.ts` (every `boardData.wall…`/`door…`/`light…` call), `src/boardLayers.ts`, `src/boardLook.ts`, `src/board/elevationLayer.ts`; `src/board/boardData.ts` loses the seven setters and keeps `legacyExtras(path)`.
- Test: guard `tests/noExtraStorage.test.ts` (no setter of the seven in `boardData.ts`; `BoardView` calls none); `boardLook` / `boardLayers` tests fed from records; harness `wall|door|light|window|material`.

### Task 5: The move

- Create `src/board/extrasMigration.ts`: `planExtrasMove(mapData, objects) → { walls, lights, tokens, dropped }` (pure); `BoardView` runs it after `moveRoomWalls`, with the backup and the notice; `boardData.clearLegacyExtras(path)`.
- Test `tests/extrasMigration.test.ts`: every record kind; a token-carried light; dead ids dropped and counted; nothing to move → no backup, no write; run twice → second finds nothing.

### Task 6: Docs, vendor

- README (the extras are Atlas's; what changed, D5), spec sections 9, 10 and 4.3; rebuild `dist-web`, vendor into Connect (version unchanged), sync back.

### Task 7: Live check

- `harness/live/phase4a.cjs` (runs `phase3.cjs` first): the rooms fixture's data.json overrides end on Atlas's walls after the two moves, with a backup and none left in data.json; a height, a material and a window opening set from the board are on the record and in the file, one undo step each, undone by Atlas's undo; a light's and a token-carried light's height; refused on a map not held. Report `phase4a-live-report.md`.

Then: one fresh reviewer over the sub-plan's range, one fix pass, ledger to `phase4a-ledger.md`, report.
