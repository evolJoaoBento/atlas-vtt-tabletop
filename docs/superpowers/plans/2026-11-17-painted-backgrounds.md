# Painted Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GM paints landscapes (terrain type, material, height) in a Backgrounds tab of the Tabletop Gallery, saves them, and picks one per map as the Ground panel's *Painted* background, drawn round the map on GM and player boards.

**Architecture:** Pure modules hold the model (`backgroundData.ts`), the heights (`terrainHeight.ts`), the painting (`layerPaint.ts`) and the liquid masks (`paintedLiquids.ts`). An Obsidian-free editor component (`backgroundEditor.ts`) is mounted by the gallery view and by the browser harness. The board loads a background through a new host call (`readBackground`) and draws it with the existing ground plane (new geometry source and a splat material) and `WaterSurface` sheets. Connect carries the PNGs as assets.

**Tech Stack:** TypeScript, three.js, Obsidian API, node:test (`npm test`), Playwright harness (`harness/features-test.cjs`), Connect: vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-painted-backgrounds-design.md` (read its "Calls made by Claude" section: they are binding).

## Global Constraints

- Branches: Tabletop `feat/painted-backgrounds` off `feat/lava-types` (a506d03); Connect worktree `C:\Users\joaoo\2075\atlas-vtt-connect-cutscenes-wt`, branch `feat/painted-backgrounds` off `feat/lava-types` (7998df6).
- Every layer is 2048 × 2048 (`BACKGROUND_SIZE`); index layers keep the index in all three colour channels, alpha 255, saved as lossless PNG.
- Files: `atlas-vtt/assets/backgrounds/<name>/` holding `background.json`, `terrain.png`, `material.png`, `height.png`, `thumb.png`.
- Picture extent: `2 × planeReach(80, span)` world units across, centred on the map's middle, whatever the fog (spec call 2).
- Under the usable board (map plus extra board) the ground is level and plain; painting there has no effect (spec call 3). Ease past it over `EASE_SQUARES` (12).
- Liquid bed 2.5 squares down; height range defaults low −2, high 6 squares; up to 4 custom patterns and 4 materials per background.
- FUSION_PROTOCOL stays 4. No Atlas writes for painted backgrounds.
- Tests: Tabletop `npm test` (affected) / `npm test -- --full`; UI `ATLAS_CSS=../.obsidian/plugins/atlas-vtt/styles.css PLAYWRIGHT_MODULE="C:/Users/joaoo/dnd store/node_modules/playwright" node harness/run-ui.mjs "<regex>"`; Connect `npx vitest run <file>`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01CgL2btnB9GB5fp9gcxJT4h`. Never push, never merge.

## Review Focus

1. A long thin map (e.g. 60 × 10 squares): the picture is square on the longer side, the level board stays the map's rectangle → test in Task 2.
2. A map whose ground names a background folder that was deleted or renamed: the board draws the plain horizon plane, no error → test in Task 8.
3. A background naming a material folder that no longer exists: plain ground where that material was painted → test in Task 8.
4. Fog off (plane past the picture): the picture's edge pixels continue, no seam, no NaN heights → test in Task 2.
5. A missing or wrong-sized PNG in a background folder: that layer reads empty (plains / plain ground / mid grey), one warning → test in Task 4.

---

### Task 1: Background model

**Files:**
- Create: `src/background/backgroundData.ts`
- Test: `tests/backgroundData.test.ts`

**Interfaces:**
- Consumes: `LIQUID_DEFAULTS`, `readWaterMotion`, `LiquidKind`, `WaterMotion` (`src/board/water.ts`).
- Produces:
  - `BACKGROUND_SIZE = 2048`, `MAX_PATTERNS = 4`, `MAX_MATERIALS = 4`
  - `type TerrainId = 'plains' | 'gentle' | 'rolling' | 'rough' | 'dunes' | 'custom1' | 'custom2' | 'custom3' | 'custom4' | 'topography' | 'water' | 'lava' | 'acid'`
  - `TERRAINS: readonly { id: TerrainId; index: number; label: string; color: string }[]` (indices 0–12 in that order; labels "Plains", "Gentle hills", "Rolling hills", "Rough ground", "Dunes", "Custom 1"…"Custom 4", "Painted topography", "Water", "Lava", "Acid")
  - `terrainOf(index: number): TerrainId` (unknown index → `'plains'`)
  - `type PatternShape = 'smooth' | 'ridged' | 'terraced' | 'craters'`
  - `interface CustomPattern { name: string; scale: number; height: number; roughness: number; shape: PatternShape }` (scale 4–200 squares, height 0–40 squares, roughness 1–6 whole)
  - `interface BackgroundSettings { v: 1; name: string; patterns: CustomPattern[]; materials: string[]; height: { low: number; high: number }; liquids: Record<LiquidKind, WaterMotion> }`
  - `DEFAULT_BACKGROUND: BackgroundSettings` (patterns [], materials [], height { low: -2, high: 6 }, liquids = `LIQUID_DEFAULTS`)
  - `readBackgroundSettings(raw: unknown): BackgroundSettings` (tolerant: clamps, drops extra patterns/materials, unknown shape → smooth, low > high swapped)
  - `interface BackgroundLayers { size: number; terrain: Uint8Array; material: Uint8Array; height: Uint8Array }`
  - `emptyLayers(size?: number): BackgroundLayers` (terrain 0, material 0, height 128)

- [ ] **Step 1: Write the failing tests** — `tests/backgroundData.test.ts`: `readBackgroundSettings(undefined)` deep-equals `DEFAULT_BACKGROUND`; five patterns in → four out; `{ scale: 1000, height: -3, roughness: 9.4, shape: 'spiky' }` → `{ scale: 200, height: 0, roughness: 6, shape: 'smooth' }`; `{ low: 8, high: -1 }` → `{ low: -1, high: 8 }`; lava motion read with lava's fallback (style kept); `TERRAINS.map((t) => t.index)` is `[0..12]`; `terrainOf(99) === 'plains'`; `emptyLayers(4).height` all 128.
- [ ] **Step 2: Run** `npm test -- backgroundData` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `src/background/backgroundData.ts` with the interfaces above. Palette colours are the builder's (distinct, liquids in their default tints).
- [ ] **Step 4: Run** `npm test -- backgroundData` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(background): the painted background's model`.

### Task 2: Heights of a painted background

**Files:**
- Modify: `src/board/ground.ts` (export `fbm`, `pattern`, `EASE_SQUARES` already exported)
- Create: `src/background/terrainHeight.ts`
- Test: `tests/terrainHeight.test.ts`

**Interfaces:**
- Consumes: Task 1 model; `planeReach`, `pattern`, `fbm`, `EASE_SQUARES` from `ground.ts`.
- Produces:
  - `interface BackgroundFrame { cx: number; cy: number; extent: number; size: number }` — map's middle and the picture's width, in squares.
  - `backgroundFrame(mapWidth: number, mapHeight: number, cell: number, size?: number): BackgroundFrame` — `extent = 2 * planeReach(80, max(w, h)) / cell`.
  - `pixelAt(frame: BackgroundFrame, x: number, y: number): number` — index into a layer (clamped: the edge continues).
  - `LIQUID_BED = 2.5`
  - `typeHeight(id: TerrainId, x: number, y: number, settings: BackgroundSettings, height01: number): number` — squares; plains 0; gentle/rolling/rough/dunes = `pattern(...)` at strength 0.5's swing; custom n per its pattern (shape: smooth fbm; ridged `1 - |fbm|`; terraced fbm stepped to whole quarters of its height; craters from a cellular distance); topography `low + height01 * (high - low)`; water/lava/acid `-LIQUID_BED`.
  - `backgroundHeight(x: number, y: number, settings: BackgroundSettings, layers: BackgroundLayers, frame: BackgroundFrame, flat: { x0: number; y0: number; x1: number; y1: number }): number` — mean of `typeHeight` at the point and at four points `BLEND = 2` squares away (soft borders), 0 inside `flat`, eased over `EASE_SQUARES` past it (same ease as `groundHeight`).

- [ ] **Step 1: Write the failing tests** — `tests/terrainHeight.test.ts`:
  - `backgroundFrame(4200, 3000, 100)` has `extent === 2 * planeReach(80, 4200) / 100` and centre `(21, 15)`.
  - A 60 × 10-square map: `backgroundHeight` is 0 everywhere inside `{x0:0,y0:0,x1:60,y1:10}` on all-rolling layers, non-zero somewhere at y = 40.
  - All-water layers: height ≈ `-LIQUID_BED` 30 squares past the board.
  - Topography with `height` layer 255 and settings `{ low: -2, high: 6 }`: ≈ 6 far from the board; 0 → ≈ -2.
  - Left half rolling, right half dunes: neighbouring samples 0.25 squares apart across the border differ by less than 1.
  - Fog off: a point 3 × the picture's extent away gives a finite height equal to the edge pixel's type height (no NaN).
  - Terraced custom pattern: heights at 200 random far points take few distinct values (≤ 6 after rounding to 0.01).
- [ ] **Step 2: Run** `npm test -- terrainHeight` — Expected: FAIL.
- [ ] **Step 3: Implement** `terrainHeight.ts` (export `fbm` and `pattern` from `ground.ts`).
- [ ] **Step 4: Run** `npm test -- terrainHeight ground` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(background): heights of a painted background`.

### Task 3: Painting and its history

**Files:**
- Create: `src/background/layerPaint.ts`
- Test: `tests/layerPaint.test.ts`

**Interfaces:**
- Produces:
  - `paintStroke(layer: Uint8Array, size: number, from: {x,y}, to: {x,y}, radius: number, value: number, soft?: boolean): { x0: number; y0: number; x1: number; y1: number } | null` — pixels; soft blends height values toward `value` (index layers ignore soft); returns the changed box or null.
  - `floodFill(layer: Uint8Array, size: number, x: number, y: number, value: number): boolean` — 4-connected, same value.
  - `class LayerHistory { constructor(limit = 30); record(layer: Uint8Array, box): void /* before a change */; undo(layer): boolean; redo(layer): boolean; get canUndo(): boolean; get canRedo(): boolean }` — stores only the changed boxes.

- [ ] **Step 1: Write the failing tests** — stroke of radius 3 from (10,10) to (20,10) on a 64-pixel layer sets (15,10), not (15,15); fill of a closed ring fills inside only; soft stroke on height moves 0 toward 255 without reaching it at the rim; undo puts the exact bytes back, redo re-applies; 31 records keep 30.
- [ ] **Step 2: Run** `npm test -- layerPaint` — Expected: FAIL.
- [ ] **Step 3: Implement** `layerPaint.ts`.
- [ ] **Step 4: Run** `npm test -- layerPaint` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(background): painting a background's layers, with undo`.

### Task 4: Files: codec and store

**Files:**
- Create: `src/background/backgroundCodec.ts` (browser: canvas/`createImageBitmap`), `src/background/backgroundStore.ts`
- Test: `tests/backgroundStore.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3.
- Produces:
  - `encodeLayer(layer: Uint8Array, size: number, doc: Document): Promise<ArrayBuffer>`; `decodeLayer(bytes: ArrayBuffer, size: number): Promise<Uint8Array | null>` (red channel; `createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })`; wrong size → null); `renderThumbnail(layers, doc, px = 160): Promise<ArrayBuffer>` (terrain in palette colours).
  - `DEFAULT_BACKGROUNDS_FOLDER = 'atlas-vtt/assets/backgrounds'`
  - `interface BackgroundFiles { read(path): Promise<ArrayBuffer | null>; readText(path): Promise<string | null>; write(path, data: ArrayBuffer | string): Promise<void>; folders(root): Promise<string[]>; remove(folder): Promise<void>; rename(from, to): Promise<void> }`
  - `interface LayerCodec { encode(layer, size): Promise<ArrayBuffer>; decode(bytes, size): Promise<Uint8Array | null>; thumbnail(layers): Promise<ArrayBuffer> }`
  - `class BackgroundStore { constructor(files: BackgroundFiles, codec: LayerCodec, root?: string); list(): Promise<{ folder: string; name: string; thumb: string }[]>; load(folder): Promise<{ settings: BackgroundSettings; layers: BackgroundLayers } | null>; save(folder, settings, layers): Promise<void>; create(name): Promise<string>; duplicate(folder, name): Promise<string>; rename(folder, name): Promise<string>; remove(folder): Promise<void>; onChange(listener): () => void }` — names become folder names (unsafe characters replaced, unique with " 2", " 3").
- Obsidian adapter for `BackgroundFiles` lives in Task 6.

- [ ] **Step 1: Write the failing tests** (in-memory `BackgroundFiles`, a codec that copies bytes): create → list shows it; save then load gives the same settings and layers; a missing `material.png` loads as zeros and warns once (`console.warn` spy, one call); a decode returning null loads as empty; duplicate and rename give unique folders; remove drops it from the list; `create('a/b:c')` gives folder `.../a b c`.
- [ ] **Step 2: Run** `npm test -- backgroundStore` — Expected: FAIL.
- [ ] **Step 3: Implement** codec and store.
- [ ] **Step 4: Run** `npm test -- backgroundStore` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(background): a background's files, saved and read`.

### Task 5: The editor component

**Files:**
- Create: `src/background/backgroundEditor.ts`; styles in `styles.css` (`.atlas-tabletop-bg-*`)
- Modify: `harness/board.ts` (mount `BackgroundEditor` on demand in a `div` over the page, store on in-memory files with the real codec; expose as `window.boardTest.backgroundEditor`), `harness/features-test.cjs` (feature `background editor`)

**Interfaces:**
- Consumes: Tasks 1–4; `LIQUID_TINTS`, `MOTION_LABELS`, `LAVA_STYLES` (`water.ts`).
- Produces: `class BackgroundEditor { constructor(container: HTMLElement, host: BackgroundEditorHost); open(folder: string | null): Promise<void>; save(): Promise<void>; dispose(): void }` with `interface BackgroundEditorHost { store: BackgroundStore; materials(): { path: string; name: string; thumb: string | null }[] }`.
- Layout (builder's details otherwise): a list of saved backgrounds (cards: thumbnail, name; New, Duplicate, Rename, Delete); the canvas (layer shown in its colours, the others faint; the map's footprint shaded in the middle as a square of `1 / (2 × (7.6 × 1.15 + 0.5))` of the picture; wheel zoom, right-drag pan); a tool row (Layer: Terrain / Material / Height; Brush / Eraser / Fill; brush size; Height value slider; Import heightmap; Undo; Redo; Save); a palette (terrain types with their colours; materials: Plain plus up to 4 slots each picked from `materials()`); a settings column (custom patterns: add up to 4, each name, scale, height, roughness, shape; height low/high; each liquid's motion, tint presets and lava type).
- Saving writes all layers, settings and the thumbnail; leaving a changed background asks to save (Save / Discard).

- [ ] **Step 1: Write the failing UI checks** (`background editor` feature): a new background shows in the list; painting Water with the brush in the canvas sets terrain pixels to water's index; Fill on Material fills a closed region; Undo restores it; adding a fifth custom pattern is refused (button disabled); Save then reopening shows the same pixels; the heightmap import of a 2-colour PNG gives height bytes 0 and 255; the map footprint is drawn in the middle; screenshot `background-editor`.
- [ ] **Step 2: Run** the harness with `"background editor"` — Expected: FAIL (feature errors: no editor).
- [ ] **Step 3: Implement** the editor and the harness mount.
- [ ] **Step 4: Run** it — Expected: all checks PASS; look at the screenshot.
- [ ] **Step 5: Commit** — `feat(background): the background editor`.

### Task 6: Tabletop Gallery and its Backgrounds tab

**Files:**
- Modify: `src/gallery.ts` (tab `backgrounds`; view's display text `Tabletop Gallery`), `main.ts` (ribbon and command `Open Tabletop Gallery`; command id unchanged), create `src/background/vaultBackgroundFiles.ts` (Obsidian `BackgroundFiles` over `app.vault`)
- Test: `tests/vaultBackgroundFiles.test.ts` (with `tests/obsidian-stub.ts`)

**Interfaces:**
- Consumes: Tasks 4, 5; the gallery's `MaterialLibrary` for `materials()`.
- Produces: `vaultBackgroundFiles(app: App): BackgroundFiles`; one `BackgroundStore` per plugin, `plugin.backgrounds`, used by Tasks 7 and 9.

- [ ] **Step 1: Write the failing test** — `vaultBackgroundFiles` over the stub vault: write then read text and binary, `folders(root)` lists only folders holding `background.json`, rename moves every file.
- [ ] **Step 2: Run** `npm test -- vaultBackgroundFiles` — Expected: FAIL.
- [ ] **Step 3: Implement** it; add the tab (mounts `BackgroundEditor`, disposed on tab change and view close), the rename of view, ribbon and command.
- [ ] **Step 4: Run** `npm test -- vaultBackgroundFiles` and `npm run build` — Expected: PASS, build clean.
- [ ] **Step 5: Commit** — `feat(gallery): Tabletop Gallery, with a Backgrounds tab`.

### Task 7: The Painted ground

**Files:**
- Modify: `src/board/ground.ts` (`GroundMode` adds `'painted'`; `GroundSettings.background?: string`; `readGround` keeps a non-empty string), `src/board/toolbar.ts` (sixth background button "Painted"; a `Painted background` select row shown in that mode, listing `actions.backgrounds()`; the material, pattern and strength rows hidden in that mode), `tests/ground.test.ts`, `harness/features-test.cjs`
- Interfaces: Produces `ToolbarActions.backgrounds?(): { folder: string; name: string }[]`.

- [ ] **Step 1: Failing tests** — unit: `readGround({ mode: 'painted', background: 'atlas-vtt/assets/backgrounds/Isle' })` keeps both; `background: 3` dropped. UI (`ground` feature): six background buttons all inside the panel at 280 px; Painted shows the background select (listing the harness's two backgrounds) and hides Pattern and Ground material.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- ground` and the harness `"^ground"` — PASS.
- [ ] **Step 5: Commit** — `feat(ground): Painted, a saved background round the map`.

### Task 8: The board draws a painted background

**Files:**
- Create: `src/background/paintedLiquids.ts` (pure), `src/background/paintedGround.ts` (three.js splat material)
- Modify: `src/board/groundPlane.ts` (`groundGeometry` takes an optional height source `(x, y) => number` in squares; `update` takes a painted look), `src/board/board.ts` (`BoardHost.readBackground?(ref: string): Promise<LoadedBackground | null>`; `applyGround` in painted mode loads, caches by ref, builds plane + splat + liquid sheets; anything missing → plain horizon plane), `harness/board.ts` (host `readBackground` from the harness store), `harness/features-test.cjs` (feature `painted ground`), `tests/paintedLiquids.test.ts`
- Interfaces:
  - `interface LoadedBackground { settings: BackgroundSettings; layers: BackgroundLayers; materials: (string | null)[] }` (in `backgroundData.ts`; `materials` are refs for `readMaterial`, null where gone).
  - `liquidMask(layers: BackgroundLayers, frame: BackgroundFrame, cell: number, liquid: LiquidKind, flat: {x0,y0,x1,y1}): WaterMask | null` — over the picture's world square (`extent × cell` units, `WaterMask.forMap`), wet where that liquid is painted and outside `flat`; null when none.
  - `paintedGroundMaterial(splat: THREE.DataTexture, materials: (THREE.MeshStandardMaterial | null)[], cell: { value: number }): THREE.MeshStandardMaterial` — RGBA splat (one channel per material slot, linear filtered, mipmapped) blending each slot's colour and normal map (`textureNoTile` as the plane does), plain colour where the weights sum under 1; `customProgramCacheKey` `tabletop-painted-ground`.

- [ ] **Step 1: Failing tests** — unit: `liquidMask` of a layer with a lava square gives wet texels there only, none inside `flat`, null for acid. UI (`painted ground`): with a harness background (left half rolling, a lava lake, a water strip, material slot 1 on a band, topography hill), mode Painted gives: plane present, heights non-zero past the board and zero on it; lava and water sheets present (`board.paintedLiquids` has `lava`, `water`; not `acid`); the plane's material key `tabletop-painted-ground`; no shader errors; Review Focus 2 (ground naming a missing folder → plain horizon plane, no page error); Review Focus 3 (a material slot whose folder is gone → plane still drawn, no error); screenshot `painted-ground`.
- [ ] **Step 2: Run** `npm test -- paintedLiquids` and the harness `"painted ground"` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both — PASS; look at the screenshot.
- [ ] **Step 5: Commit** — `feat(board): draws a painted background round the map`.

### Task 9: The GM's host and the look for Connect

**Files:**
- Modify: `src/board/BoardView.ts` (host `readBackground(folder)` via `plugin.backgrounds.load`, materials as folders; `backgrounds()` listing; reload the board's ground when a background is saved), `src/connectContract.ts` (`BoardGroundLook.mode` adds `'painted'`; `painted?: { terrain: string; material: string; height: string; settings: unknown; materials: string[] }` — vault paths and material folders), `src/boardLook.ts` (`groundLook` fills `painted` from the ground's folder; the background's materials join the look's `materials`), `tests/boardLook.test.ts`
- [ ] **Step 1: Failing test** — `boardLookFor` with a Painted ground gives `ground.painted` with the three PNG paths under the folder, its settings, and its materials listed in `look.materials`.
- [ ] **Step 2: Run** `npm test -- boardLook` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- boardLook` — PASS.
- [ ] **Step 5: Commit** — `feat(board): the GM's board reads painted backgrounds; players' look carries them`.

### Task 10: Connect and players' boards

**Files (Connect worktree):** `src/app/online/scene/boardTypes.ts` (`BoardGround.mode` adds `'painted'`; `painted?: { terrain: string; material: string; height: string; materials: string[]; settings: { patterns: …; height: { low; high }; liquids: { water; lava; acid } } }` asset ids), `sceneContracts.ts`, `boardValidation.ts` (`isGround` accepts it; ids `isSceneId`; patterns ≤ 4, materials ≤ 4), `projectBoard.ts` (`groundOf`: paths via `assets.idFor`, materials via `material()`, settings copied field by field and clamped; a missing PNG id → no `painted`, mode `horizon`), `tests/unit/online/projectBoard.test.ts`.
**Files (Tabletop):** `node scripts/sync-connect.mjs --connect ../atlas-vtt-connect-cutscenes-wt` (after the Connect commit); `src/board/sceneAdapter.ts` (`groundFromWire` keeps `painted` as `background: <terrain id>`), `src/playerBoard.ts` (host `readBackground(ref)`: waits for the three image assets, decodes with `decodeLayer`, materials by id), `tests/boardLayers.test.ts`, `harness/features-test.cjs` (player feature `player painted ground`).

- [ ] **Step 1: Failing tests** — Connect: a Painted ground projects with asset ids and its materials' ids; a broken pattern list is clamped; `isBoardExtras` refuses `painted` with a bad id. Tabletop: `groundFromWire` of a painted ground gives `mode: 'painted'`; UI player feature draws the plane with the lava sheet.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement** Connect, commit it, sync, implement Tabletop.
- [ ] **Step 4: Run** `npx vitest run tests/unit/online/projectBoard.test.ts`, `npm test -- boardLayers`, harness `"player painted"` — PASS.
- [ ] **Step 5: Commit** both repos — `feat(board): painted backgrounds reach players`.

### Task 11: Vendor, full runs, install

- [ ] **Step 1:** `node scripts/build-web.mjs`, copy `dist-web/tabletop-player-board.{js,css}` and `SOURCE.json` into Connect `vendor/tabletop/`, commit `chore(vendor): …`.
- [ ] **Step 2:** `npm test -- --full` (Expected: 0 fail), the harness with no regex (Expected: all pass but known flakes), Connect `npx vitest run` (known fog-limits timeout only), Connect `npm run build:page` then `PLAYWRIGHT_MODULE="C:/Users/joaoo/ToEnslaveGods/node_modules/playwright-core" node tests/page/run.mjs` (74+/74+).
- [ ] **Step 3:** Back up `C:\Users\joaoo\2075\.obsidian\plugins\{tabletop-for-atlas,connect-for-atlas}` to `C:\Users\joaoo\2075-plugin-backups\2026-11-17-pre-painted\`, build both, `node scripts/deploy.mjs`, copy Connect `dist/main.js`, `dist/styles.css`, `manifest.json`.
