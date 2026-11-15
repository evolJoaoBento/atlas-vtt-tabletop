# Atlas fusion 4E: dice look, one sheet model, players' lighting from the projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three overlaps with Atlas go: the dice's colours are Atlas's (its dice look and its dice set colours), Connect and Tabletop share one sheet model and one reader of a token's linked creature, and players' boards read the scene's lighting from the scene Connect projects instead of from `BoardExtras`.

**Architecture:** Atlas's pure `dice3d/diceLook.ts` joins `packages/atlas-shared` (verbatim, 0.16.0 tag), with `DICE_SET_COLOURS` / `isDieColour` exported; Tabletop's die body colour is the set group's colour, else the look's (`light` keeps the pack's own, `dark` / `accent` as Atlas resolves them), and its own colour list goes. Connect's sheet model (`src/app/online/tools/sheets.ts`), its template reader and its linked-creature reader (`src/connect/statblockSource.ts`) move into `packages/atlas-host/src/sheets/`, Tabletop's additions merged in; Tabletop deletes `sheet.ts`, `nativeSheet.ts`, `statblock.ts` for them. `PlayerMap` gains `lighting`; `BoardExtras.lighting`, `ambient`, `tint` and `BoardLook.ambient` / `tint` go.

**Tech Stack:** TypeScript; Vitest (Connect), node:test (Tabletop); UI harness; live DevTools harness.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` section 8 (Dice, Sheets, Connect `BoardExtras`), section 9. Inventory: `.superpowers/sdd/2026-11-15-atlas-fusion-phase4e/inventory.md`.

## Global Constraints

- Never push, never merge, never touch a real vault; live checks only in `C:\Users\joaoo\fusion-gate-vault` (0.15 copy put back before a chain), on Atlas 0.16.0 and 0.15.0.
- Floor stays Atlas 0.15; atlas-shared files are verbatim from the 0.16.0 tag (`npm run check:shared`).
- `FUSION_PROTOCOL` stays 4: the fusion release is not out, so the wire changes within 4.
- Connect owns `packages/`; Tabletop copies by `sync:connect`. Vendor cycle after Tabletop changes.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions

- **E1 Pack stays, colours are Atlas's.** The spec keeps Tabletop's 3D pack, whose faces carry the numerals; so the numerals stay the pack's and only the colour follows Atlas: a die of a dice set group with a colour takes it; else `diceColour` `dark` / `accent` give the body Atlas resolves (`DARK_BODY`, the theme accent), and `light` leaves the pack's own colour. `diceFont` has no effect on the pack's faces (said in section 10). The picker's colours are `DICE_SET_COLOURS`; Tabletop's `colors` setting goes.
- **E2 Connect's page** draws its dice with the GM's look when its bundle lets it be set; otherwise ledgered as deferred (the bundle is a build of the fork).
- **E3 One sheet model** is Connect's (it has the limits and validators), with Tabletop's `*_description` intro and `ac_class` folded in; the template reader is Connect's `templateSheets.ts` (reads Atlas's template file) over Tabletop's hard-coded 0.10.2 fields.
- **E4 Players' lighting** is `PlayerMap.lighting { enabled, ambient, ambientColor }`, read from `state.lighting` with Atlas's clamps once (Connect), drawn by Tabletop's player board; the GM board keeps reading Atlas directly.

## Review Focus

1. A die rolled from Atlas's dice tray for a set with group colours: each die's colour, also for the advantage die.
2. `accent` dice when the theme changes (`css-change`).
3. A sheet of a token with no linked creature, a broken statblock, a template Atlas does not ship.
4. A player's board joining a scene saved unlit, lit, and one switched while they watch.
5. An older Tabletop player board (vendored into Connect) reading the new wire: no throw.

---

### Task 1: Players' lighting from the projection (Connect, then Tabletop)
- Connect: failing test in `projectForPlayers` "the scene's lighting reaches players as Atlas reads it (clamped ambient, its colour), unlit by default"; add `PlayerMap.lighting` (sceneTypes, validation, limits), produced from `state.lighting`; delete `BoardExtras.lighting/ambient/tint`, `BoardLook.ambient/tint` and their tests' expectations. vitest, tsc, lint.
- Tabletop: sync; failing test `sceneAdapter` "a player's board takes the scene's lighting from the projection"; `playerBoard.ts` reads `map.lighting` only; `boardLook.ts` sends no ambient/tint fields. npm test, tsc, build.

### Task 2: Dice colours are Atlas's (shared, Tabletop)
- atlas-shared: `dice3d/diceLook.ts` added to `files.mjs` (0.16.0), `DICE_SET_COLOURS`, `isDieColour`, `DEFAULT_DICE_LOOK`, `isDiceColour`, `isDiceFont` exported; check:shared.
- Tabletop: failing tests `diceLook.test.ts`: "a set group's colour wins; else dark and accent give Atlas's bodies; light keeps the pack's colour"; `atlasDice.ts` uses `isDieColour`; `atlasBridge` reads `getDiceLook` and follows `onChange` and `css-change`; picker colours = `DICE_SET_COLOURS`; `colors` setting removed (saved value dropped). npm test, tsc, build, UI harness dice features.

### Task 3: One sheet model (Connect, then Tabletop)
- Connect: move `sheets.ts`, `templateSheets.ts`, `statblockSource.ts` into `packages/atlas-host/src/sheets/` with Tabletop's `*_description` and `ac_class` (failing test first in Connect's sheets tests); Connect imports them. vitest, tsc, lint.
- Tabletop: sync; replace `src/sheets/{sheet,nativeSheet,statblock}.ts` with the shared ones; its tests point at the shared model. npm test, tsc, build, UI harness sheet features.

### Task 4: Connect page dice look (E2), vendor, live, review
- Check whether `vendor/atlas/shared/dice3d.js` exports a way to set the look; wire the GM's look to the page or ledger deferral.
- Vendor cycle; live step 54 (a lit scene's lighting on a player board projection, read back from Connect's projection in Obsidian; a die rolled on the board takes the set colour / dark look); chains on 0.16 and 0.15; spec sections 9/10; one fresh reviewer; one fix pass; records; memory.
