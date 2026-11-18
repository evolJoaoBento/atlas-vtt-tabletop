# Painted Props Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Props tab in the background editor paints prop brushes (forests, distant props) that the GM and player boards draw with instanced models near and impostors far.

**Architecture:** The model gains prop brushes and a props layer (`backgroundData.ts`, store). A pure scatter (`propScatter.ts`) turns the layer into placements. `propForest.ts` draws them (InstancedMesh per model mesh; crossed-quad impostors from a once-rendered picture). `PaintedScene` builds the forest once the models load. Connect carries the layer and the models' ids.

**Tech Stack:** TypeScript, three.js, node:test, Playwright harness, Connect vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-painted-props-design.md` (and the painted backgrounds spec it builds on).

## Global Constraints

- Branches: Tabletop `feat/painted-props` off `feat/painted-backgrounds` (6d4c4ab); Connect worktree `C:\Users\joaoo\2075\atlas-vtt-connect-cutscenes-wt` `feat/painted-props` off `feat/painted-backgrounds` (3f94fa6).
- Up to 6 brushes (`MAX_BRUSHES`), up to 4 props each (`MAX_BRUSH_PROPS`); density 0.1–200 props per 10×10 squares; scale 0.1–20; ±15 % size jitter.
- Props layer `props.png`, 2048², index 0 none / 1..6 brush, lossless; missing → empty.
- Inner half (distance from the map's middle < picture extent / 4) = models; outer = impostors. Caps 6 000 models, 60 000 impostors.
- No props on the map itself or on liquids; props on the extra board allowed.
- FUSION_PROTOCOL stays 4. Commit trailers and test commands as in `.superpowers/sdd/2026-11-18-painted-props/common.md`. Never push or merge.

## Review Focus

1. A brush naming a .glb that is gone: its other props still place; none of it → no props, no error → test in Task 4.
2. A huge forest (density 200 over half the picture): the caps hold, the board stays responsive (build time logged) → test in Task 2 (caps) and Task 4 (timing).
3. A tiny painted dot (one cell): exactly one prop at its middle → test in Task 2.
4. Props painted over water: none stand on the water → test in Task 2.
5. Re-saving a background with props: the old instances and impostor textures are disposed (no GPU growth) → test in Task 4.

---

### Task 1: Prop brushes in the model and the store
**Files:** `src/background/backgroundData.ts`, `src/background/backgroundStore.ts`, `tests/backgroundData.test.ts`, `tests/backgroundStore.test.ts`
**Produces:** `MAX_BRUSHES = 6`, `MAX_BRUSH_PROPS = 4`; `interface PropBrush { name: string; props: string[]; density: number; scale: number }`; `BackgroundSettings.props: PropBrush[]` (default []); `readBackgroundSettings` reads them tolerantly (clamps density 0.1–200, scale 0.1–20, props non-empty strings ending `.glb`, ≤4; ≤6 brushes; name ≤60, default "Props N"); `BackgroundLayers.props: Uint8Array` (emptyLayers → zeros); the store saves/loads `props.png` like the other index layers (missing → empty, counted in the one warning).
- [ ] Failing tests (clamps, caps, defaults, store round-trip incl. props layer, missing props.png → empty) → implement → green → commit `feat(background): prop brushes and a props layer`.

### Task 2: Scatter
**Files:** create `src/background/propScatter.ts`, `tests/propScatter.test.ts`
**Consumes:** Task 1; `backgroundFrame`/`pixelAt` (`terrainHeight.ts`), `TERRAINS` (liquids).
**Produces:** `interface ScatteredProp { brush: number; prop: number; x: number; y: number; turn: number; scale: number; far: boolean }` (x, y squares in the map's frame; turn radians); `scatterProps(layers, settings, frame, map: Rect, footprint: (brush: number) => number /* squares, the brush's largest prop at scale 1 */): ScatteredProp[]`; constants `MAX_MODELS = 6000`, `MAX_IMPOSTORS = 60000`.
- Spots: 4-connected components of each brush's cells. Spot area (squares²) < (footprint × scale)² → one prop at the spot's centroid. Else jittered grid, spacing `10 / sqrt(density)` squares, deterministic hash jitter; keep a point only when its cell is this brush, it is off the map rect and not a liquid cell. Random (hashed) prop index among the brush's props that exist (props whose footprint is known), turn 0–2π, scale × (0.85–1.15). `far` = distance from the map's middle > `frame.extent / 4`. Over a cap: keep placements whose hash passes `cap / count` (models and impostors capped separately).
- [ ] Failing tests: one-cell dot → exactly one prop at its middle; a 20×20-square forest at density 20 → about 80 props (±25 %); none on the map rect; none on water cells; same input → same output; far flag by distance; a density-200 forest over half a 2048 picture → ≤ 6 000 near and ≤ 60 000 far, evenly spread (both halves of the area keep props); a brush with no known props → nothing → implement → green → commit `feat(background): scatter painted props`.

### Task 3: The editor's Props tab
**Files:** `src/background/backgroundEditor.ts` (+ a new `src/background/propBrushPanel.ts` for the brush list, to keep the editor from growing), `src/gallery.ts` (host `props()` from the props library), `harness/board.ts`, `harness/features-test.cjs`
**Produces:** `BackgroundEditorHost.props(): { path: string; name: string; thumb: string | null }[]`.
- Layer button "Props"; palette = the brushes (colour, name) + "Add brush" (≤6); a selected brush shows name, up to 4 prop pickers (selects from `props()`), **Density** `<input type="number" min="0.1" max="200" step="0.1">`, **Scale** `<input type="number" min="0.1" max="20" step="0.1">`; painting writes the brush number; eraser 0; fill; the layer drawn in brush colours, others faint. Removing a brush only when it is the last (as patterns), so painted numbers keep their meaning.
- [ ] Failing UI checks (`background editor props` feature): Props tab exists; add a brush, pick a prop, type density 25 and scale 1.5 (number inputs, no sliders); paint → props layer pixels = 1; save/reopen keeps them and the brush settings → implement → green (look at the screenshot) → commit `feat(background): paint prop brushes in the editor`.

### Task 4: The board draws the props
**Files:** create `src/background/propForest.ts`, modify `src/background/paintedScene.ts` (models via the board's existing model loader `readMini`, footprints from `LoadedMini.footprint` in squares; build after heights; dispose on clear), `src/board/board.ts` (pass the loader), `harness/features-test.cjs`, `harness/board.ts` (a background with a forest brush using the harness's prop GLBs)
**Produces:** `class PropForest { constructor(models: Map<string, LoadedMini>, placements: ScatteredProp[], brushes: PropBrush[], heightAt: (x, y) => number, cell: number); readonly object3d: THREE.Group; readonly counts: { models: number; impostors: number }; dispose(): void }`.
- Near: per model, per mesh in its scene, one `InstancedMesh` (shared geometry/material, matrices = placement × the mesh's world matrix in the model); `receiveShadow` true, `castShadow` false; frustum culling off on the instanced meshes (instances span the plane) or bounds set to the whole area.
- Far: per model, render once (offscreen, orthographic side view, 256², transparent) to a texture; two crossed quads per instance (InstancedMesh of a merged cross geometry), `alphaTest` 0.5, fog on.
- [ ] Failing UI checks (`painted props` feature): the forest builds (counts.models > 0, counts.impostors > 0 for a forest spanning both halves); a one-cell dot gives one prop; build time logged and under 1.5 s for 3 000 + 20 000; re-saving disposes the old instances (renderer.info.memory.geometries/textures do not grow over three re-saves); a brush whose .glb is gone → the others still drawn, no error (Review Focus 1); screenshot `painted-props` (look at it: trees standing on the ground, impostors in the distance read as the same trees) → implement → green → commit `feat(board): draws painted props, instanced near and flat far`.

### Task 5: GM host, look, Connect and players
**Files (Tabletop):** `src/connectContract.ts` (`BoardGroundLook.painted.props: string` path of props.png; settings carry `props` brushes with .glb paths), `src/boardLook.ts`, `main.ts` settings cache unchanged, `src/board/sceneAdapter.ts`, `src/playerBoard.ts` (readBackground also reads props.png; brushes' props become model asset ids; the player's `readMini(id)` loads them), `tests/boardLook.test.ts`, `tests/boardLayers.test.ts`, harness player feature.
**Files (Connect):** `boardTypes.ts`, `boardValidation.ts`, `projectBoard.ts` (props.png → asset id; brush props .glb → asset ids via `assets.idFor`, missing → dropped; brushes clamped as in Task 1), `assetIds.ts` (`boardAssetIds` includes props.png and the brushes' model ids), tests.
- [ ] Failing tests both repos → implement Connect, commit, `node scripts/sync-connect.mjs --connect ../atlas-vtt-connect-cutscenes-wt`, implement Tabletop → green (Connect `npx tsc --noEmit -p .` clean) → commit both `feat(board): painted props reach players`.

### Task 6: Vendor, full runs, install
- [ ] `node scripts/build-web.mjs`, copy into Connect `vendor/tabletop/`, commit; full runs (`npm test -- --full`, harness, Connect vitest, join page with the ToEnslaveGods playwright-core); back up the vault plugins to `C:\Users\joaoo\2075-plugin-backups\2026-11-18-pre-props\`; build both; `node scripts/deploy.mjs`; copy Connect `dist/main.js`, `dist/styles.css`, `manifest.json`.
