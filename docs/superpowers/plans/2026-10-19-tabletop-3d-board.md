# Tabletop 3D Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tabletop's overlay on Atlas's 2D map with Tabletop's own 3D tab. The tab reads an `.atlasmap` and shows the
map image as a board, with tokens and note pins above it. Tokens can be dragged, which saves their position. Tokens can
carry GLB minis, and GLB props can be placed on the board.

**Architecture:**
- A pure model layer reads the map file and the Atlas collection data. It also holds the geometry: token diameter,
  snapping and label layout. All of it is tested in Node.
- A `Board` class owns a canvas, a three.js scene, the orbit camera ported from TacticalEngine, and the pointer input.
  It talks to Obsidian only through an injected `BoardHost`, so the browser harness can drive it.
- `BoardView` is a thin Obsidian `ItemView` around a `Board`.
- Kept from old Tabletop:
  - the gallery and library, now with two tabs and two folders
  - `MiniFigure` (the mini motion)
  - the public API v1 for Connect
- Removed from old Tabletop: the overlay, the 3D table and the hook into Atlas's token menu.

**Tech Stack:** TypeScript 5.8, Obsidian API ≥1.8.7, three 0.185 (`three/examples/jsm`), esbuild bundling, `node:test`
for unit tests, and Playwright with swiftshader for the browser harness. Playwright is installed at
`C:/Users/joaoo/2075/atlas-vtt-connect/node_modules/playwright`.

**Spec:** `docs/superpowers/specs/2026-10-19-atlas-3d-board-design.md`, with its mockups in `docs/superpowers/specs/mockups/`.

## Global Constraints

- Plugin id stays `atlas-vtt-tabletop`. `manifest.json` name stays "Atlas VTT Extension - Tabletop".
- Target stock (vanilla) Atlas only. Read its files and use only the parts of the store old Tabletop already used
  (`view.atlasStore`, `getState()`), plus the store action `updateToken(id, {x, y})`.
- GLBs must be self-contained and uncompressed (no Draco or Meshopt), using the existing `explainLoadError` text.
- The only write to an `.atlasmap` is one token's `x`/`y`. Saved in Atlas's format: `JSON.stringify(value)` with no indentation.
- Minis folder `atlas-vtt/assets/minis` (the existing setting). Props folder default: `atlas-vtt/assets/props`.
- Plugin data stays backwards-compatible: the `settings.folder` and `assignments` keys are read as before.
- Public API v1 for Connect is unchanged: `{version:1, playerMinis, placementsFor, onChange, readMini}`, with the events
  `atlas-vtt-tabletop:api-ready` and `atlas-vtt-tabletop:api-unload`.
- `src/figure.ts` (`MiniFigure`) is used as is. The mini drag feel must not change.
- Pin glyphs come from game-icons.net (CC BY 3.0). Credit them in `README.md`. Do not copy Atlas's code (it is AGPL);
  copying the path data and the tone and colour values is fine.
- Vaults to deploy to (`ATLAS_VAULT=<vault> node scripts/deploy.mjs`), all under `C:\Users\joaoo`:
  - `2075`
  - `atlas-player-vault`
  - `atlas-stock-test-vault`
  - `Obsidian/Atlas`

## Facts from Atlas's source (paths under `.obsidian/plugins/atlas-vtt/src/app/`)

**Tokens**
- `x`, `y` are the token's centre, in background-image pixels. The world size is the image's natural size.
- Diameter: `stroke = max(1, round(grid.size*4/70))`, then `diameter = (grid.size − 2*stroke) * (2*size − 1)`.
  A missing `size` counts as 1.
- `rotation` is in degrees, clockwise on screen, and applies to the art only.
- Snapping:
  - Square: `floor((v−off)/size)*size + off + size/2`.
  - Hex: the nearest hex centre, with origin `(offsetX, offsetY)` at the top-left of hex (0,0)'s bounding box and
    circumradius `size/√3`. Pointy-top is `hex-vertical`; flat-top is `hex-horizontal`.
  - Snapping only happens when `grid.snapToGrid !== false`. The token's size is ignored.
  - Source: `grid/gridDistance.ts:48`, `grid/hexGeometry.ts:76-150`.
- Ring: `showRing !== false`. Colour is `ringColor`, default `#ffffff`. Outer diameter is `diameter + 2*stroke`.
- Hidden tokens: `alpha 0.5` on the art and ring, with an eye-off marker at the centre (diameter `min(40, D*0.5)`).
  The labels stay at full opacity.
- Only `kind === 'character'` tokens get labels.
  - **Nameplate:** shown if `tokenSettings.showNameplates || token.showNameplate === true`. Text is `name`, else
    `statblockName` (when `statblockPath` is set), else "Unknown Creature" (when `statblockPath` is set).
  - **HP bar:** shown if `tokenSettings.showHPBars !== false && hp != null`. A plain-number `hp` means
    `{current: hp, max: 100}`. Fill colour is `#22c55e` at ≥70%, `#eab308` at ≥30%, otherwise `#ef4444`.
  - **Stress bar:** shown if `tokenSettings.showStressBars === true && stress != null`. Colour `#a855f7`; `maxStress`
    defaults to 10.
- Instance badge: shows `instanceNumber` when two or more tokens share an `imagePath` and
  `tokenSettings.showInstanceBadges !== false`.

**Conditions**
- Catalogue: `atlas-vtt/.atlas-data/assets-metadata.json` → `collections[<id>].settings.conditions[]`, each
  `{id, name, color, icon?, valued?}`.
- `<id>` is the folder after `atlas-vtt/collections/` in the map path.
- Ids missing from the catalogue are skipped. A valued condition's label is `"<name> <conditionValues[id] ?? 1>"`.

**Pins**
- Pin icon ids and tones: `types/pinIcons.ts` (`TONES` l.13-26, `PIN_PLACE_GROUPS` l.45-136, `PIN_PALETTE` l.144-160,
  `LEGACY_PIN_ICONS` l.165-177). Missing or unknown ids fall back to `pin`.
- Glyph paths: `types/pinIconPaths.ts`, on a 512×512 viewBox.
- Drawing: a disc of radius 20 in `#2a2a2a` at 0.95 alpha, with a 22×22 glyph tinted with the tone's dark-theme colour.
  For `icon` `number` or `letter`, the badge shows `label` in bold white instead of a glyph.
- On a hex grid, a pin with `hex === true` is drawn at the centre of its hex.

**Saving**
- Atlas does not watch its map file. Its next save writes its in-memory state, which wipes external edits. So when an
  Atlas view has the same map open (`view.atlasStore.getState().mapPath === path`), a move goes through
  `atlasStore.getState().updateToken(id, {x, y})`, and Atlas saves it.

**Camera (TacticalEngine `src/engine/render/camera.ts` and `src/main.ts`)**
- `OrbitCamera`: goal/pose with exponential damping 10, settling exactly. `pitchFloor` is log-scaled between
  `minPitch` 0.35, `farPitch` 1.3 and `maxPitch` 1.45, from `minDistance` to `maxDistance`.
- Bindings:
  - Left- or middle-drag: `orbit(-dx*0.006, -dy*0.004)`.
  - Right-drag: `pan(-dx*s, dy*s)` with `s = goal.distance*0.0016`.
  - Wheel: `zoom(exp(deltaY*0.0012))`.
  - WASD / arrow keys pan. Q / E turn at 1.6 rad/s. Home calls `frame`.
  - A drag starts at 6 px.

## Review Focus

1. **Atlas has the same map open while a token is dragged in 3D.** The move must appear in Atlas and survive its next
   save, and it must not be lost. Task 3 tests `TokenWriter` routing to the store.
2. **The map file changes on disk** (Atlas saved it, or a sync tool did) while the 3D tab is open. The board reloads
   without losing the camera, and a drag in progress is not interrupted. Task 8's harness checks that a second `load()` keeps the camera.
3. **Token art, background or GLB missing or unreadable** (renamed, deleted, or a Draco GLB). The board still opens;
   the token falls back to a coloured disc and the mini falls back to a disc, with one Notice per file.
   Task 8's harness checks that a token still renders when its art is missing; the Notice comes from the view in Task 9.
4. **Odd map data**: a token without `size`, `hp` as a plain number, unknown condition ids, a pin with an unknown icon,
   no grid or `grid.enabled === false`, a hex grid. Task 1 and Task 2 tests cover each.
5. **The map is renamed or deleted while open**, along with its saved props and disc/standee choices. The tab follows a
   rename and closes on delete. The data follows `rename` and `deleted` like assignments. Task 4 tests this.

---

### Task 0: Shelve the overlay and set up tests

**Files:**
- Modify: `main.ts`
- Modify: `package.json` (the `test` script)
- Modify: `styles.css`
- Modify: `src/atlas.ts`
- Delete: `src/overlay.ts`, `src/table.ts`, `src/contextMenu.ts`, `harness/harness.ts`
- Create: `tests/run.mjs`

**Interfaces:**
- Produces: `npm test`. It bundles every `tests/*.test.ts` with esbuild (`--bundle --platform=node --format=esm
  --outdir=.test-build`, external `three`) and runs `node --test .test-build/*.test.js`.
- Produces: `src/atlas.ts`, which keeps only `mapViews(app)`, `AtlasView` (`viewId`, `atlasStore`) and the `AtlasStoreState`
  fields `mapPath`, `objects.tokens`, `tokenSettings`, `updateToken`.

- [ ] **Step 1:** `git tag shelved/overlay` on the current HEAD (≥ `c3cb7a9`).
- [ ] **Step 2:** Remove the following from `main.ts`:
  - the overlay tracking (`tracked`, `syncViews`, `track`, `untrack`, `activeTracked`, `toggleTable`, `syncButton`,
    `addMapButton`, `menuEntries`, `targets`)
  - the two table commands and the view poll
  - the `.atlas-tabletop-overlay` and `.atlas-tabletop-table-button` CSS
  Keep the gallery, import, settings, vault rename/delete hooks, and the API (`players`, `api`, events).
- [ ] **Step 3:** Move `tests/assignments.test.mjs` and `tests/glbCheck.test.mjs` to `.test.ts`, importing from `../src/...`.
  Write `tests/run.mjs` and point `npm test` at it.
- [ ] **Step 4:** Run `npm run build && npm test`. Expected: tsc is clean and all existing tests pass.
- [ ] **Step 5:** Commit: `refactor: shelve the overlay and the 3D table (tag shelved/overlay)`.

### Task 1: Read a map file

**Files:**
- Create: `src/board/mapModel.ts`
- Test: `tests/mapModel.test.ts`

**Interfaces:**
- Produces:
  - `interface BoardGrid { enabled: boolean; visible: boolean; snap: boolean; type: 'square'|'hex-vertical'|'hex-horizontal'; size: number; offsetX: number; offsetY: number; opacity: number; lineWidth: number; color: string|null }`
  - `interface BoardToken { id; x; y; size; rotation; imagePath: string|null; kind: 'character'|'token'; name: string|null; hidden: boolean; showRing: boolean; ringColor: string; showNameplate: boolean; hp: {current:number;max:number}|null; stress: {current:number;max:number}|null; conditions: string[]; conditionValues: Record<string,number>; resources: Array<{key:string;current:number;max:number}>; instanceNumber: number|null }`
  - `interface BoardPin { id; x; y; notePath: string|null; icon: string; label: string|null; hex: boolean }`
  - `interface TokenSettings { showNameplates: boolean; showHPBars: boolean; showStressBars: boolean; showInstanceBadges: boolean }`
  - `interface BoardMap { path; background: string|null; grid: BoardGrid; tokenSettings: TokenSettings; tokens: BoardToken[]; pins: BoardPin[] }`
  - `readMap(path: string, text: string): BoardMap`. Throws `Error('not an Atlas map')` when `state.objects` is missing.

- [ ] **Step 1: Write the tests.**
  - `reads tokens and pins from a real map`: use a trimmed copy of `Level 1 - DM Map.atlasmap` as a fixture under
    `tests/fixtures/`.
  - `defaults`: a token with no `size` reads size 1. `hp: 30` reads `{current:30, max:100}`. A missing `showRing`
    reads true. A missing `ringColor` reads `'#ffffff'`. The name falls back to `statblockName`, or to
    `'Unknown Creature'` when `statblockPath` is set.
  - `resources`: `statblockResources {ac:{current:18,max:18}}` reads `[{key:'ac', current:18, max:18}]`. Entries
    with `max <= 0` are dropped.
  - `grid`: `enabled:false` reads `enabled:false`. `type 'hex'`-style values map onto the three types.
    `#00FFFF` reads `color:null`.
  - `rejects non-maps`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, because `readMap` is not defined.
- [ ] **Step 3:** Implement `readMap`. It must be total: every field is defaulted, and nothing malformed throws except
  a missing `objects`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(board): read tokens, pins and grid from an Atlas map`.

### Task 2: Board geometry

**Files:**
- Create: `src/board/geometry.ts`
- Test: `tests/geometry.test.ts`

**Interfaces:**
- Consumes: `BoardGrid` (Task 1).
- Produces:
  - `tokenDiameter(grid: BoardGrid, size: number): number`
  - `ringDiameter(grid, size): number`
  - `snapPoint(grid, x, y): {x, y}`. Returns the input unchanged when `!grid.enabled || !grid.snap`.
  - `hexCenter(grid, x, y): {x, y}`
  - `sideBadgeSlots(count: number): Array<{side: -1|1; row: number}>`. Alternates left, right, left, right; the row
    goes up every 2.
  - `conditionRingRadii(baseRadius: number, count: number, width: number, gap: number): number[]`. The first ring is
    at `baseRadius + gap + width/2`; each next ring is `width + gap` wider.

- [ ] **Step 1: Write the tests.**
  - For `grid.size 70`: `tokenDiameter` is 62 at size 1, 186 at size 2 and 310 at size 3.
  - Square snap with offsets (15.82, 13.79), size 26.033: (100, 100) → the cell centre computed by the formula above.
  - Hex snap for both orientations: a point inside a known hex returns that hex's centre.
  - Snap is off when `snap:false`.
  - `sideBadgeSlots(5)` is `[{-1,0},{1,0},{-1,1},{1,1},{-1,2}]`.
  - `conditionRingRadii(10, 3, 2, 1)` is `[12, 15, 18]`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the functions, using the formulas under "Facts".
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(board): token sizes, grid snapping and label slots`.

### Task 3: Saving a token move

**Files:**
- Create: `src/board/tokenWriter.ts`
- Test: `tests/tokenWriter.test.ts`

**Interfaces:**
- Consumes: `AtlasView` and `mapViews` from `src/atlas.ts` (Task 0).
- Produces:
  - `moveTokenInText(text: string, id: string, x: number, y: number): string`. Changes only that token's `x`/`y`,
    keeps key order, and writes with `JSON.stringify(value)` (no indent). Throws if the token is missing.
  - `class TokenWriter { constructor(deps: { views: () => AtlasView[]; process: (path: string, edit: (text: string) => string) => Promise<void> }); move(path: string, id: string, x: number, y: number): Promise<'atlas'|'file'> }`.
    If a view's `atlasStore.getState().mapPath === path` and it has `updateToken`, `move` calls `updateToken(id, {x, y})`
    and returns `'atlas'`. Otherwise it calls `process(path, (t) => moveTokenInText(t, id, x, y))` and returns `'file'`.
    In the plugin, `process` is `app.vault.process`.

- [ ] **Step 1: Write the tests.**
  - `moves one token and nothing else`: only that token's x/y differ after parsing; the rest is deep-equal.
  - `missing token throws`.
  - `routes to an open Atlas view`: a fake view with a matching `mapPath` receives `updateToken('t', {x, y})`, and
    `process` is never called.
  - `writes the file when no view has it`: a non-matching `mapPath` calls `process`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `moveTokenInText` and `TokenWriter`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(board): save token moves, through Atlas when it has the map open`.

### Task 4: Board data (styles and props)

**Files:**
- Create: `src/board/boardData.ts`
- Test: `tests/boardData.test.ts`

**Interfaces:**
- Produces:
  - `type TokenStyle = 'disc'|'standee'`
  - `interface PropPlacement { id: string; glb: string; x: number; y: number; rotation: number; scale: number }`
  - `type BoardDataJSON = Record<string /*map path*/, { styles?: Record<string, TokenStyle>; props?: PropPlacement[] }>`
  - `readBoardData(raw: unknown): BoardDataJSON` (drops anything malformed)
  - `class BoardData`, which mirrors `Assignments`' API style:
    - `style(map, tokenId): TokenStyle` (defaults to `'disc'`)
    - `setStyle(map, tokenId, style)`. Setting `'disc'` deletes the entry.
    - `props(map): readonly PropPlacement[]`
    - `addProp(map, p: Omit<PropPlacement,'id'>): PropPlacement`. The id is `prop_<Date.now()>_<random>`.
    - `moveProp(map, id, x, y)`, `removeProp(map, id)`
    - `rename(oldPath, newPath)`, which follows maps, GLBs and folders (prefix-safe, like `Assignments.rename`)
    - `deleted(path)`
    - `onChange(listener: (map: string|null) => void): () => void`
    - `toJSON()`
- Saved under the plugin data key `board`, next to `settings` and `assignments`.

- [ ] **Step 1: Write the tests.**
  - `default disc; standee round-trips; disc deletes`.
  - `props add/move/remove`.
  - `rename follows map and GLB folders`.
  - `delete drops map data and props using a deleted GLB`.
  - `readBoardData drops junk`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `BoardData`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(board): remember token styles and props per map`.

### Task 5: Orbit camera

**Files:**
- Create: `src/board/camera.ts`
- Test: `tests/camera.test.ts`

**Interfaces:**
- Produces: `CameraLimits`, `CameraPose`, `pitchFloor`, `OrbitCamera`, `positionOf`, ported from TacticalEngine's
  `src/engine/render/camera.ts`. Port `orbit`, `pan`, `zoom`, `frame`, `lookAt`, `snap` and `update`; drop `hold`,
  `release`, `follow` and `slide`.
- Produces: `limitsFor(width: number, height: number): CameraLimits`. Takes the pitch values verbatim, with
  `minDistance = max(width, height)*0.08` and `maxDistance = max(width, height)*2.5`. TacticalEngine's 6/80 range was
  for a room of about 30 units; these keep the same 1:13 ratio.
- Produces: `frame(target, radius)`, which uses `radius*1.8` as in TacticalEngine.

- [ ] **Step 1: Write the tests.**
  - `pitch floor rises when zoomed out`: at `maxDistance`, the pitch is ≥ `farPitch`.
  - `a wanted low angle comes back when zooming in`.
  - `pan is screen-relative`: at yaw π/2, `pan(1,0)` moves the target along −z.
  - `update settles exactly and then reports no movement`.
  - `limitsFor scales with the map`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Port the class. Keep the doc comments' reasoning, but in this repo's comment style.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(board): TacticalEngine's orbit camera`.

### Task 6: Pieces: board, tokens, pins

**Files:**
- Create:
  - `src/board/pinIcons.ts` (the tone table, the icon→tone table, the legacy map and the paths, copied as data)
  - `src/board/textures.ts`
  - `src/board/pieces.ts`
- Test: `tests/pinIcons.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `tokenDiameter`, `ringDiameter`, `hexCenter`, `MiniFigure` (`src/figure.ts`), `LoadedMini`.
- Produces:
  - `pinTone(icon: string): string` (the dark-theme colour) and `pinGlyph(icon: string): string|null` (an SVG path,
    or null for number/letter). Unknown icons map to `'pin'`. Legacy ids are remapped.
  - `loadImageTexture(url: string): Promise<THREE.Texture>`
  - `pinTexture(pin: BoardPin): THREE.CanvasTexture`, drawn at 128 px: the disc, then the glyph or the label.
  - `class BoardSurface`, the map plane at the image's natural size, laid on y=0 with world (x, y) → three (x, 0, y).
    - `constructor(width, height, grid: BoardGrid)`
    - `setImage(tex)`
    - `object3d`
    - Grid lines: when `grid.visible && grid.enabled`, square or hex per the facts. Colour is `grid.color`, else black or
      white chosen by the image's mean luminance (> 128 → black). Alpha is `grid.opacity`.
  - `class TokenPiece`:
    - `constructor(token: BoardToken, grid: BoardGrid)`
    - `update(token)`
    - `setStyle(style: TokenStyle)`
    - `setArt(tex|null)`. Null means a flat disc in `ringColor`.
    - `setMini(model: LoadedMini|null, placement: MiniPlacement|null)`
    - `pose(x, y, dt, now, zoom)`. Moves the anchor and calls `figure.pose` with the existing `FigurePose` fields.
    - `figureHeight(): number`
    - `object3d`, `hitTarget: THREE.Object3D`, `get animating`, `dispose()`
  - `TokenPiece` details:
    - **Disc:** a cylinder of diameter `tokenDiameter`, thickness `diameter*0.12`, lifted by `diameter*0.15`. The top
      face carries the art, rotated by `rotation`. The ring is a torus at `ringDiameter`.
    - **Standee:** an upright plane, height `diameter*1.4`, with the art on both faces, on a base disc of `diameter*0.9`.
    - **With a mini:** the `MiniFigure` stands on the disc's top face, and the disc's own art still shows.
    - **Hidden:** opacity 0.5 on all meshes, plus an eye-off sprite.
  - `class PinPiece`: `constructor(pin, grid)`, `object3d`, `hitTarget`, a billboard sprite of world radius
    `grid.size*0.35`, lifted by `grid.size*0.6`. Uses `hexCenter` when `pin.hex`. A title label floats above the pin
    (the user chose "map pin with label"; Atlas itself draws none). The title is the basename of `notePath` without
    its extension, or `label` when there is no note.

- [ ] **Step 1: Write the tests.**
  - `pinTone`: `'treasure'` gives or-dark `#e3b341`, an unknown icon gives `'pin'`'s gules-dark `#e5534b`, and a legacy
    `'coins'` gives the treasure tone.
  - `pinGlyph('number')` is null.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `pinIcons.ts` (data and two functions), `textures.ts` and `pieces.ts`.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: PASS and clean.
- [ ] **Step 5:** Commit: `feat(board): board surface, token discs/standees with minis, Atlas pins`.

### Task 7: Labels

**Files:**
- Create: `src/board/conditions.ts`, `src/board/labels.ts`
- Test: `tests/conditions.test.ts`

**Interfaces:**
- Consumes: `BoardToken`, `TokenSettings`, `sideBadgeSlots`, `conditionRingRadii`, `TokenPiece.figureHeight()`.
- Produces:
  - `collectionOf(mapPath: string): string|null`
  - `readConditionCatalog(metadataJson: unknown, collection: string): Map<string, {name: string; color: string; valued: boolean}>`
  - `conditionLabel(def, value: number|undefined): string`
  - `class TokenLabels`:
    - `constructor(token, settings, catalog)`
    - `update(token, settings, catalog)`
    - `place(figureHeight: number, baseRadius: number)`
    - `object3d`
    - `hitRings(): Array<{object: THREE.Object3D; label: string}>`
- The layout, from the user:
  - **Name pill on top, HP bar directly under it,** both above `figureHeight`. They are camera-facing sprites with a
    constant on-screen size (`sizeAttenuation: false`), so they stay readable when zoomed out.
  - The **stress bar** goes under the HP bar when shown.
  - **Conditions are flat coloured rings on the base,** one ring per condition at `conditionRingRadii(baseRadius, n, …)`.
    Hovering a ring shows its `conditionLabel` in a tooltip.
  - **Resources and the instance badge are Atlas-style stepped circles:** a dark disc, the number in the middle, and an
    outer ring split into `max` steps with `current` lit (cap the drawn steps at 20; above that, draw a plain arc of
    `current/max`). They carry no label; the tooltip shows the key, humanised (`spell-slots` → `Spell slots`). They sit
    at `sideBadgeSlots(n)` beside the figure.
  - Name, HP, stress and conditions only appear for `kind === 'character'`, under the visibility rules in "Facts".
    The instance badge appears for every kind.
  - Labels stay at full opacity on hidden tokens.

- [ ] **Step 1: Write the tests.**
  - `collectionOf('atlas-vtt/collections/DotMM Level 1 Full Test/scenes/x.atlasmap')` is `'DotMM Level 1 Full Test'`.
  - `readConditionCatalog`: run it on a trimmed copy of the vault's `assets-metadata.json` under `tests/fixtures/`,
    and check that `dnd5e-frightened` reads `{name: 'Frightened', color: '#7c3aed'}`.
  - `conditionLabel` of a valued condition gives `'Exhaustion 2'`.
  - Unknown ids are skipped.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the catalogue functions, then `TokenLabels`, with the textures drawn on canvases.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: PASS and clean.
- [ ] **Step 5:** Commit: `feat(board): name, HP, condition rings and stat badges on tokens`.

### Task 8: The Board

**Files:**
- Create: `src/board/board.ts`, `harness/board.ts`, `harness/board.html`
- Modify: `harness/player.ts` (only if the import paths change)

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
  ```ts
  interface BoardHost {
    readImage(path: string): Promise<string | null>;          // resource URL for vault image, null if missing
    readMini(path: string): Promise<LoadedMini>;               // MiniLibrary.load
    placement(tokenId: string): MiniPlacement | null;
    style(tokenId: string): TokenStyle;
    props(): readonly PropPlacement[];
    conditions(): Map<string, { name: string; color: string; valued: boolean }>;
    moveToken(id: string, x: number, y: number): void;         // TokenWriter.move, fire-and-forget with Notice on failure
    moveProp(id: string, x: number, y: number): void;
    openNote(path: string): void;                               // new tab
    tokenMenu(id: string, event: MouseEvent): void;             // Obsidian Menu, built by the view
    warn(message: string): void;                                // Notice, once per message
  }
  class Board {
    constructor(container: HTMLElement, host: BoardHost);
    load(map: BoardMap): Promise<void>;   // first load frames the map; later loads keep the camera
    refresh(): void;                      // re-read placements/styles/props/conditions from host
    placeProp(glb: string): void;         // next left-click on the board drops it there
    readonly camera: OrbitCamera;
    dispose(): void;
  }
  ```
- Behaviour:
  - **Rendering:** a `WebGLRenderer` with antialias, `PCFShadowMap` and a 2048 shadow map. Hemisphere and directional
    lights, as in old `overlay.ts`. The frame and floor around the board are dark wood; no black void. Render on demand:
    a frame runs only while the camera `update()` moves, a piece is `animating`, or something is dirty.
    `ResizeObserver` drives `setSize`.
  - **Input**, on the canvas (thresholds and rates exactly as in "Facts"):
    - Pointerdown on a token's `hitTarget` with button 0 starts a token drag. The token follows the ray onto the plane
      at y=0. On release it snaps with `snapPoint`, the piece glides to the snapped point, and `host.moveToken` runs once.
    - Ctrl plus button 0 on a prop picks the prop up; it follows the ray, and `host.moveProp` runs on release.
    - A click (under 6 px) on a pin calls `host.openNote`.
    - Button 2 released under 6 px on a token calls `host.tokenMenu`.
    - Any other drag is the camera.
    - Hovering a condition ring shows its label in a DOM tooltip.
    - `contextmenu` is prevented.
    - Keys are read only while the board has focus (the canvas has `tabindex=0`).
  - **While a token is dragged,** `load()` keeps the dragged token's local position until release.

- [ ] **Step 1:** Write `harness/board.ts`. It builds a `Board` with a fake `BoardHost` and the Task 1 fixture map,
  with a generated GLB (reuse `makeGlb` from the old harness or `harness/richGlb.ts`) on one token, a standee on
  another, and a pin. It exposes `window.boardTest = { board, moves: [], notes: [], project(x, y): {clientX, clientY} }`.
- [ ] **Step 2:** Implement `Board`.
- [ ] **Step 3:** Build the harness with esbuild (`--bundle --alias:obsidian=./harness/obsidian-stub.ts`) into the
  scratchpad. Run it with Playwright and swiftshader, and assert:
  - the dragged token's `moves[0]` equals `snapPoint` of the drop point;
  - a click on the pin records its `notePath`;
  - a right-drag changes `camera.goal.target` and records no move;
  - a wheel changes `camera.goal.distance`;
  - Ctrl+drag moves the prop;
  - a second `load()` keeps `camera.goal`;
  - with the art URL returning null, the token still renders.
  Save a screenshot of the tilted board for the hand-off.
- [ ] **Step 4:** Commit: `feat(board): the 3D board with token drag, props, pins and camera`.

### Task 9: The view, gallery tabs and wiring

**Files:**
- Create: `src/board/BoardView.ts`
- Modify: `src/gallery.ts`, `src/library.ts`, `main.ts`, `styles.css`, `README.md`

**Interfaces:**
- Consumes: `Board`, `BoardHost`, `TokenWriter`, `BoardData`, `Assignments`, `readMap`, `readConditionCatalog`,
  `MiniLibrary`, `MiniPicker`.
- Produces:
  - **`BOARD_VIEW_TYPE = 'atlas-tabletop-board'`.** `BoardView extends ItemView`, with state `{file: string}`. It:
    - reads the map on open;
    - reloads on vault `modify` of that path, debounced 300 ms (with the dragged-token exception from Task 8);
    - follows `rename`, and detaches on `delete`;
    - takes its title from the map's basename.
  - **Opening the board:**
    - The command `open-board`, "Open map in 3D", opens the active `.atlasmap`, or the map of the most recent Atlas view.
    - The `file-menu` gets an "Open in 3D" item for `.atlasmap` files.
    - Both open in a new tab.
  - **The token menu** (Obsidian `Menu`):
    - "Assign mini…" / "Change mini…" opens `MiniPicker` and calls `assignments.set`.
    - "Remove mini".
    - "Show as standee" / "Show as disc" calls `boardData.setStyle`.
  - **The gallery:** `GalleryView` gets two tabs, **Minis** and **Props**, each with its own `MiniLibrary`. The props
    library uses `settings.propsFolder`, default `atlas-vtt/assets/props`. Each prop card gets a "Place on board"
    button, which calls `placeProp` on the most recently focused `BoardView` (or shows a Notice when none is open).
  - **Settings:** a second text setting, "Props folder".
  - **Saved data:** `{ settings: {folder, propsFolder}, assignments, board }`.
  - **Changes flow:** a change to assignments or board data calls `refresh()` on every open `BoardView`.

- [ ] **Step 1:** Implement `BoardView`, the gallery tabs, the settings and the `main.ts` wiring. Add the game-icons.net
  credit to `README.md`.
- [ ] **Step 2:** Run `npm run build && npm test`. Expected: clean, all pass.
- [ ] **Step 3:** Deploy to the 4 vaults and reload the plugin in the `2075` window over CDP (port 9333). Open
  `atlas-vtt/collections/DotMM Level 1 Full Test/scenes/Yawning Portal.atlasmap` with "Open in 3D" and check:
  - tokens, pins, labels and the existing minis show;
  - a pin click opens its note in a new tab;
  - the Props tab lists its folder.
  Do **not** drag the user's real tokens without asking. Test the save path on a copy of the map
  (`… Yawning Portal (3D test).atlasmap`), then delete the copy.
- [ ] **Step 4:** Commit: `feat: open Atlas maps in Tabletop's 3D board`. Update the memory file
  `atlas-tabletop-minis.md` (the 3D board replaces the overlay; tag `shelved/overlay`).
