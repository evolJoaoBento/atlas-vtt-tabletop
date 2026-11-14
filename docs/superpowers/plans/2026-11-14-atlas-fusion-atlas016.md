# Atlas fusion: Atlas VTT 0.16 support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, the user's choice). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tabletop and Connect work on Atlas 0.16.0 as on 0.15: nothing the GM hides from players reaches them, drawings and texts look as Atlas draws them, and the host behaves; 0.15 keeps working.

**Architecture:** Drawings and texts are read through Atlas's own reader (`annotationList`, vendored verbatim into `packages/atlas-shared` from the 0.16.0 tag), in both plugins: what Atlas hides from players is not sent or drawn for them, what Atlas does not draw (an old eraser stroke, an unknown type) is not drawn. Fills and holes travel to players and are drawn by both boards. The live scripts take the Atlas build to run against.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` (the rule: Atlas is the source of truth); program `2026-11-14-atlas-fusion-phase4-program.md` (this sub-plan sits between 4C and 4D). Atlas 0.16.0: tag `0.16.0` in `C:\Users\joaoo\2075\atlas-vtt-0.15-ref`, build in `C:\Users\joaoo\2075\sound-downloads\atlas-0.16.0`.

## Global Constraints

- Never push, never merge, never touch a real vault. Live only in `C:\Users\joaoo\fusion-gate-vault`; a copy of its 0.15 state is kept at `C:\Users\joaoo\fusion-gate-vault-015-copy` to go back to.
- Both plugins keep `Atlas VTT 0.15 or later` as their floor; every unit case that reads a record runs on a 0.15-shaped and a 0.16-shaped one; the full live chain passes on both builds before the close.
- `packages/atlas-shared` holds Atlas's files verbatim (hashed in `SOURCE.json`, `npm run check:shared`), owned by Connect, copied to Tabletop by `sync:connect`.
- The Connect fix for hidden notes is one self-contained commit (cherry-pickable onto the released line).
- Versions at close: Tabletop 1.9.0, Connect 0.15.0; `FUSION_PROTOCOL` stays 4.
- Commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## What discovery found

- Live chain on the 0.16.0 build: every phase passes but Phase 1's steps 1 (it pins 0.15.0), 3 and 4 (the Atlas tab the host opens is no longer hidden behind the board) and 10 (the rooms move ran before the step looked: no notice seen). Phase 1 re-installs 0.15.0 near its end, so the later phases ran partly on 0.15: the run is not a clean 0.16 run.
- Every store action, command id and view field the plugins call still exists in 0.16 (`getBackgroundSprite` was already gone in 0.15; Connect only falls back to it).
- Drawings and texts gain `hidden` (GM only), `layer: 'map'`, `order`, `locked`, `group`, `by`; drawings gain `fill: 'soft'|'solid'`, `holes`, `cells`, `dash`, `ends`, `anchors` (the curve's clicked points; `points` stays the truth), `rotation` (stamps), `width: 0` (a fill without a line); the `eraser` type is gone (an old one is passed over); a stamp's `icon` is any pin symbol or one of the twelve stamp ids of before. Texts gain `outline`, `breaks` and wrap at `width`.
- Fog: Cover all, Cells and Room write the three known operation types; a revealed area is a lasso or rectangle with `area` (ignorable). `objects.fog` stays the whole truth.
- Atlas's tool ids changed (`draw`, no `text`/`draw-*`): neither plugin uses them.
- Of the files in `packages/atlas-shared`, only `src/app/types/pinIcons.ts` changed (more symbols).

## Decisions

- **D1 Atlas's reader.** `annotationList` and what it imports (`annotationTypes`, `annotationFit`, `drawSizes`, `types.ts` and its type imports, `utils/guards`, `types/visionTypes`), verbatim from 0.16.0, join `packages/atlas-shared`; the package's source tag becomes 0.16.0 (its other files are unchanged there but `pinIcons`, which only gains symbols). Both plugins read drawings and texts through it. *Ruling to ledger; cost: a 0.15 Atlas file is read by 0.16's rules (a superset; an old eraser stroke is passed over).*
- **D2 Old eraser strokes.** Not drawn by Tabletop (they were drawn as ink, wrong on 0.15 too). Connect keeps erasing with them while Atlas is older than 0.16, and passes them over from 0.16 on (as each Atlas draws them). *Ruling; cost: one version test in Connect.*
- **D3 Hidden.** A hidden drawing or text is not sent to Connect's players (the scene, a cutscene's scene, every other projection that sends annotations) and not drawn in Tabletop's players' window, nor on a player's board; the GM's own board draws it as Atlas does for the GM (faded). *The released Connect has the leak; the fix is one commit.*
- **D4 Looks.** Drawn by both boards and sent to players: fills (solid, soft) with their holes, a line of width 0 as no line, stamps by any pin symbol and their turn, the order Atlas stacks annotations in. Not built now, listed: dashes, arrowheads, a text's halo look and wrapped lines (drawn on one line as before). *Ruling; cost: those look plainer than in Atlas.*
- **D5 The host on 0.16.** Steps 3 and 4 are investigated first in Task 6; the fix follows what is found.

## Review Focus

1. Every path a drawing or text reaches players by: Connect's scene, its cutscene scene, a split party's views, the GM's local player window, a player's 3D board, other levels drawn as layers, Tabletop's board snapshot/AR pictures.
2. A 0.15 scene opened under 0.16 and a 0.16 scene (hidden, fills) opened under 0.15: drawn as that Atlas draws it, never a throw.
3. A fill that covers part of the map (the GM's "black box"): players see the fill, never what is under it.
4. The live chain on each build, the vault going back to 0.15 after a 0.16 run.
5. A live script that installs a build refuses any vault but the throwaway one.

---

### Task 1: Live scripts take the Atlas build

**Files:** `harness/live/phase1.cjs` (`ATLAS_BUILD` env, default `0.15.0`: the version step expects it, the floor step re-installs it), `harness/live/install.cjs` (unchanged: `--atlas`), a `harness/live/README.md` note on running against 0.16 and restoring the 0.15 copy.

- [ ] Change; `node --check`; run Phase 1 alone on 0.16 (`ATLAS_BUILD=0.16.0`): steps 3, 4, 10 still fail, 1 and 16 pass. Commit `test(live): the live checks run on the Atlas build asked for`.

### Task 2: Atlas's annotation reader in the shared package (Connect)

**Files (Connect):** `packages/atlas-shared/files.mjs` (the list), `SOURCE.json` (tag 0.16.0, hashes), the new files; `scripts/check-shared` as needed. Then Tabletop `npm run sync:connect`.

- [ ] Add the files, re-hash from the 0.16.0 tag, `npm run check:shared` passes; Connect tsc, vitest; commit; Tabletop sync, tsc, tests; commit.

### Task 3: Connect never sends what the GM hid (the self-contained fix)

**Files (Connect):** `src/app/online/scene/projectRecords.ts` (`projectTexts`, `projectDrawings` skip `hidden: true`), and every other caller that sends annotations (find with grep for `drawings`/`texts` in `src/app/online` and `src/connect`). Tests: `tests/unit/online/projectRecords*.test.ts` or the existing projection tests: a hidden drawing and a hidden text are not in the scene, nor in a cutscene scene; a 0.15-shaped record without `hidden` is.

- [ ] RED → fix with no dependency on Task 2 (a plain `hidden === true` check, so it cherry-picks alone) → GREEN; vitest, tsc, lint. Commit `fix(online): drawings and texts the GM hid in Atlas 0.16 are not sent to players`.

### Task 4: Tabletop reads annotations as Atlas does

**Files:** `src/board/mapModel.ts` (`readInk`, `readText`, `readIcon` through `annotationList`: `hidden`, `order`, fill, holes, width 0, stamp rotation, eraser and unknown types passed over), `src/board/board.ts` `showFor` (hidden pieces out of the players' window), `src/board/sceneAdapter.ts` (a player's board), the pieces. Tests: `tests/annotations.test.ts` (0.15 and 0.16 shapes), harness feature `hidden notes` (the GM sees a hidden drawing, the players' window does not).

- [ ] RED → implement → GREEN; tsc; harness; commit.

### Task 5: Fills, holes and stamps drawn and sent

**Files:** Tabletop `src/board/ink.ts` (fill triangles with holes: `THREE.ShapeUtils.triangulateShape`), `src/board/pieces.ts`, `src/board/mapIcons.ts` (pin symbols from `PIN_ICON_PATHS`); Connect `sceneTypes.ts` (`PlayerDrawing.fill?`, `holes?`, `rotation?`), `projectRecords.ts`, validation, `view/layers/drawingsLayer.ts` (the 2D player view draws them). Tests both repos; harness `ink fills`.

- [ ] RED → implement → GREEN; both repos' checks; commit each.

### Task 6: The host on 0.16

- [ ] Investigate Phase 1 steps 3 and 4 on 0.16 (how the host's Atlas leaf is kept behind the board; what 0.16 changed in its view or workspace handling), and step 10's missing notices. Rule or fix with a test; Phase 1 passes on 0.16.

### Task 7: Docs, versions, vendor, live on both builds

- [ ] READMEs ("Atlas VTT 0.15 or 0.16"), spec note; versions; build-web, vendor, Connect checks, sync, build; full live chain on 0.16.0 (with the 4C leftover: a member left of the corner, read back after a reload), restore the 0.15 copy, full live chain on 0.15.0; report.
