# Connect Players on the 3D Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect players with Tabletop installed see the session on Tabletop's 3D board (walls, doors, lights, minis, all player tools); the GM's board shows and drives the session.

**Architecture:** Connect (GM) projects a player-safe "board extras" record per scene next to today's `PlayerScene` and sends it, plus the GM's 3D camera, only to players who asked, in new message types. On the player, Connect's `CanvasScene` swaps its 2D `MapView` for a `BoardSceneView` that keeps Connect's DOM panels and hands drawing and pointer input to a player board that Tabletop builds (`api.playerBoard`). Tabletop's `Board` gains a player audience, fed by an adapter from `PlayerScene` + extras to `BoardMap`. On the GM, Connect attaches a session sink to Tabletop (`api.attachSession`) so the board draws players' pings, lasers, templates and the handout, places GM templates, and warns when Atlas does not hold the map.

**Tech Stack:** TypeScript, Obsidian API, three.js 0.185 (Tabletop only), esbuild (Tabletop), vite + vitest (Connect), node:test (Tabletop units), Playwright harness (Tabletop board).

**Spec:** `C:\Users\joaoo\2075\atlas-vtt-tabletop\docs\superpowers\specs\2026-10-21-connect-3d-player-view-design.md`

**Repos and branches:**
- Tabletop `C:\Users\joaoo\2075\atlas-vtt-tabletop`: new branch `feat/connect-3d` from `feat/3d-board`. Paths marked **T:** are relative to it.
- Connect `C:\Users\joaoo\2075\atlas-vtt-connect-tabletop-wt`: new branch `feat/board-3d` from `combined/sheets-minis`. Paths marked **C:** are relative to it.
- Tabletop tests: `npm test` (units), harness: bundle `harness/board.ts`, `node harness/board-test.cjs` (see repo README / earlier runs). Connect tests: `npx vitest run <file>`, full `npx vitest run`, `npx tsc --noEmit -p .`.

## Global Constraints

- Stock Atlas only; no Atlas fork features.
- Tabletop owns all 3D code; Connect never imports three.js.
- GLBs self-contained (no Draco/Meshopt).
- Protocol stays `v: 1`. No existing message or `PlayerScene` field changes shape. New data only in new message types, sent only to players who sent `board-request`.
- The web page never receives board messages, never fetches GLBs or material textures.
- Nothing reaches a 3D player that the 2D projection would hide: filter with `projectForPlayers`'s `visible` (fog + lighting frame).
- A light carried by a token is sent only if that token is in the player scene. A fixed, non-hidden light is sent even under fog.
- A closed secret door is sent as plain wall (type `solid`).
- Tabletop API stays `version: 1`; new members are additions, each checked before use by Connect.
- Player 3D view: no player-view button, no freeze button, no board settings, no GM editing (walls, lights, materials, HP bars, Alt-copy, GM token menu).
- Darkness (fog op id `atlas-lighting-darkness`) drawn as black ground, not solid fog.
- "GM view" camera: the GM's player-window camera (frozen or following) when open on the presented map; else the GM board camera when the board shows the presented map; else none (button disabled).
- A player shows 3D only when its Tabletop offers `playerBoard` and the GM sent `board-offer {available: true}`.

## Review Focus

1. A secret door that is open, then closed again, mid-session → players must see it go back to plain wall (no door id left in their extras). Test in Task C2.
2. A token light on a token hidden after being visible → the light must leave the extras on the next projection. Test in Task C2.
3. Tabletop disabled/enabled on the player mid-session → the tab switches 3D↔2D without leaving the session or losing the dice log. Test in Task C6.
4. GM without Tabletop (or old Connect) → player never sees 3D, never sends `board-request` more than once per admission. Test in Task C5.
5. A template removed by the GM on the board while a player's 3D view shows it → disappears from every player. Test in Task C7.

---

## Shared contract (both repos)

Both repos keep their own copy of these types: **T:** `src/connectContract.ts`, **C:** `src/connect/boardContract.ts`. Copy the block verbatim; it is the wire and API shape.

```ts
export interface BoardPoint { x: number; y: number }
export interface BoardWallRecord {
  id: string; type: 'solid' | 'door'; p1: BoardPoint; p2: BoardPoint;
  /** Units: world (map) px, as BoardMap walls. */
  height: number | null;           // null → fog height
  material: string | null;         // material id in `materials`
  door?: { open: boolean; swing: 'left' | 'right'; prop: string | null /* asset id of a GLB */; chainId?: string };
}
export interface BoardLightRecord {
  id: string; x: number; y: number; height: number | null;
  color: string; bright: number; dim: number; intensity: number;
  animation: string | null; angle: number | null; rotation: number;
}
export interface BoardMaterialRecord { id: string; scale: number; maps: Record<string, string /* asset id */> }
export interface BoardPropRecord { id: string; asset: string; x: number; y: number; scale: number; turn: number }
export interface BoardExtras {
  sceneId: string;
  walls: BoardWallRecord[]; lights: BoardLightRecord[]; props: BoardPropRecord[];
  materials: BoardMaterialRecord[];
  ambient: number | null;          // Tabletop ambient slider, null → scene lighting
  lighting: { enabled: boolean; ambient: number; ambientColor: string | null };
  fogHeight: number | null;
}
export interface BoardCamera { sceneId: string; eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }

/** GM side, Tabletop → Connect (on `api`). Raw = vault paths; Connect turns paths into asset ids. */
export interface BoardLook {
  wallHeight(id: string): number | null; wallMaterial(id: string): string | null; doorProp(id: string): string | null; // GLB vault path
  lightHeight(id: string): number | null; fogHeight: number | null; ambient: number | null;
  props: Array<{ id: string; path: string; x: number; y: number; scale: number; turn: number }>;
  materials: Array<{ id: string; scale: number; maps: Record<string, string /* vault path */> }>;
}
export interface GmCameraSource { camera(mapPath: string): Omit<BoardCamera, 'sceneId'> | null; onChange(listener: () => void): () => void }

/** GM side, Connect → Tabletop (`api.attachSession(session)`). */
export interface BoardSession {
  hosting(): boolean;
  presentedMap(): string | null;
  overlay(mapPath: string): SessionOverlay;
  onChange(listener: () => void): () => void;     // overlay, hosting or presented changed
  addTemplate(mapPath: string, add: { shape: string; start: BoardPoint; end: BoardPoint }): boolean;
  eraseTemplate(mapPath: string, id: string): void;
  clearTemplates(mapPath: string): void;
}
export interface SessionOverlay {
  templates: Array<{ id: string; owner: string; shape: string; start: BoardPoint; end: BoardPoint; color: string }>;
  handout: { path: string; title: string } | null;
}
export interface SessionMarks { ping(mapPath: string, at: BoardPoint & { color: string }): void; laser(mapPath: string, from: string, points: BoardPoint[], lifted: boolean, color: string): void }

/** Player side (`api.playerBoard`). */
export interface PlayerBoardHost {
  image(id: string): string | null;              // object URL
  model(id: string): ArrayBuffer | null;
  sendMove(tokenId: string, x: number, y: number): boolean;
  sendLaser(points: BoardPoint[], lifted: boolean, dt: number[], color?: string): boolean;
  sendPing(x: number, y: number): boolean;
  sendTemplate(change: { add: { shape: string; start: BoardPoint; end: BoardPoint } } | { remove: string } | { clear: true }): boolean;
  openPin(pinId: string): void;
  hover(tokenId: string | null, screen: BoardPoint | null, modifier: boolean): void;
  select(tokenId: string | null): void;
  toolsChanged(): void;
}
export interface PlayerToolState { tool: 'move' | 'measure' | 'template' | 'laser' | 'ping'; shape: 'line' | 'circle' | 'cone'; templateShape: string; ownTemplates: boolean; laserColor: string; gmView: boolean }
export interface PlayerBoardHandle {
  setScene(scene: unknown /* Connect PlayerScene */): void; setExtras(extras: BoardExtras | null): void;
  setGmCamera(camera: BoardCamera | null): void; setControlled(ids: readonly string[]): void;
  setConnected(on: boolean): void; setPaused(on: boolean): void; moveRefused(id: string): void;
  setPlayers(order: readonly string[], self: string | null): void;
  selectTool(tool: PlayerToolState['tool']): void; selectShape(shape: PlayerToolState['shape']): void;
  selectTemplateShape(shape: string): void; selectLaserColor(color: string): void; clearOwnTemplates(): void;
  toolState(): PlayerToolState; followGm(): void; fitMap(): void;
  receiveTemplates(sceneId: string, list: readonly unknown[]): void; receivePing(ping: unknown): void; receiveLaser(laser: unknown): void;
  refresh(): void; measure(): void; dispose(): void;
}
export interface PlayerBoardFactory { version: 1; create(parent: HTMLElement, host: PlayerBoardHost): PlayerBoardHandle }
```

Protocol messages (Connect `protocol.ts`, all `v: 1`):
- GM → player `{ type: 'board-offer'; available: boolean }`
- player → GM `{ type: 'board-request'; on: boolean }` (added to `PLAYER_MESSAGE_TYPES`)
- GM → player `{ type: 'board-extras'; extras: BoardExtras | null }`
- GM → player `{ type: 'board-camera'; camera: BoardCamera | null }`

---

### Task C1: Protocol messages

**Files:** Modify **C:** `src/app/online/protocol.ts`; Create **C:** `src/connect/boardContract.ts` (contract block); Create **C:** `src/app/online/scene/boardValidation.ts`; Test **C:** `tests/unit/online/boardProtocol.test.ts`

**Interfaces:** Produces `isBoardExtras(value: unknown): value is BoardExtras`, `isBoardCamera(value: unknown): value is BoardCamera` (boardValidation.ts); the four message variants in `ControlMessage`; `'board-request'` in `PLAYER_MESSAGE_TYPES`.

- [ ] **Step 1: Write failing tests** `decodes board-offer/request/extras/camera round-trip via encode/decode`, `rejects board-extras with a non-finite wall point or > 20_000 walls`, `board-request is a player message type`, `an older decoder path: unknown type 'board-foo' is ignored, not invalid`.
- [ ] **Step 2:** `npx vitest run tests/unit/online/boardProtocol.test.ts` → FAIL (types missing).
- [ ] **Step 3:** Implement. Limits (boardValidation): walls ≤ 20_000, lights ≤ 2_000, props ≤ 2_000, materials ≤ 200, maps per material ≤ 8, strings ≤ 200 chars, numbers finite.
- [ ] **Step 4:** Run → PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Commit `feat(online): board messages for 3D players`.

### Task T1: Contract and GM-side look API in Tabletop

**Files:** Create **T:** `src/connectContract.ts`; Create **T:** `src/boardLook.ts`; Modify **T:** `main.ts` (TabletopApi additions); Modify **T:** `src/board/BoardView.ts` (report camera); Test **T:** `tests/boardLook.test.ts`

**Interfaces:**
- Consumes `BoardData` getters (wallMaterials, wallHeights, doorProps, lightHeights, props, fog height, ambient) and `MaterialLibrary.settings/list` (map paths per role).
- Produces on `api`: `boardLook(mapPath: string): BoardLook | null`, `onBoardChange(listener: (mapPath: string | null) => void): () => void`, `readAsset(path: string): Promise<ArrayBuffer>` (vault binary for `.glb`, `.png`, `.jpg`, `.jpeg`, `.webp` under the minis/materials folders only; rejects anything else), `gmCamera: GmCameraSource`.
- `boardLookFor(data: BoardDataView, materials: MaterialView, mapPath: string): BoardLook` pure in `src/boardLook.ts`.

- [ ] **Step 1: Failing tests** in `tests/boardLook.test.ts`: `boardLookFor returns wall height/material/door prop by wall id for the map`, `materials list only the ones used by walls or doors of this map, with scale and role→path maps`, `props of other maps are not listed`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `boardLookFor`; wire `api` members; `gmCamera.camera(mapPath)`: the open player window's camera for that map (frozen eye/target or the GM pose it follows) else the GM board's camera pose for that map else null; `onChange` fires at most every 100 ms while the camera moves (reuse the board frame loop; BoardView exposes `cameraPose(): {eye,target} | null` and `playerPose()`).
- [ ] **Step 4:** `npm test` → PASS; `npm run build` clean.
- [ ] **Step 5:** Commit `feat(api): board look, assets and camera for Connect`.

### Task C2: Project board extras (pure)

**Files:** Create **C:** `src/app/online/scene/projectBoard.ts`; Modify **C:** `src/app/online/scene/projectForPlayers.ts` (export `visibleShows(state, context): Shows | null` — the `visible` it computes, null when closed); Test **C:** `tests/unit/online/projectBoard.test.ts`

**Interfaces:**
- Consumes `ProjectionInput`, `ProjectionContext`, `BoardLook` (C1 contract), `AssetIds.idFor(path)`, the projected `PlayerScene.tokens` (ids sent).
- Produces `projectBoard(state: ProjectionInput, context: ProjectionContext, scene: PlayerScene, look: BoardLook | null): BoardExtras`.

Rules: wall kept iff `visible.shows(bounds of its segment)`; `secret-door` closed → `{type:'solid'}` without `door`; `secret-door` open and `door` → `type:'door'`; door `open = closed === false`; lights: `objects.lights` not `hidden`, plus token lights only for tokens in `scene.tokens`; props kept iff `visible.shows({x,y,0,0})`; asset ids via `context.assets.idFor`, an item whose asset id is null yet is sent without the prop/material (re-projected when hashed); materials limited to those referenced by kept walls; closed frame → empty arrays.

- [ ] **Step 1: Failing tests** (fixtures as plain objects): `a wall under fog is not sent`, `a closed secret door is plain wall; opened it is a door; closed again plain wall` (Review Focus 1), `a token light goes when its token is hidden` (Review Focus 2), `a hidden fixed light is not sent; a fogged one is`, `in darkness (lighting frame shows false) walls are not sent`, `closed frame sends nothing`, `materials only for kept walls, with asset ids`.
- [ ] **Step 2:** `npx vitest run tests/unit/online/projectBoard.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; full `npx vitest run tests/unit/online` green.
- [ ] **Step 5:** Commit `feat(online): player-safe board extras`.

### Task C3: Tabletop board source on the GM

**Files:** Modify **C:** `src/connect/tabletopMinis.ts` → add `tabletopBoard(app): TabletopBoard`; Modify **C:** `src/connect/startConnect.ts` (pass `board` to the session service); Test **C:** `tests/unit/connect/tabletopBoard.test.ts`

**Interfaces:** Produces
```ts
export interface TabletopBoard {
  available(): boolean;
  lookFor(mapPath: string): BoardLook | null;
  camera(mapPath: string): Omit<BoardCamera, 'sceneId'> | null;
  readAsset(path: string): Promise<ArrayBuffer | null>;
  subscribe(listener: () => void): () => void;   // api arrived/left, look changed, camera changed
  dispose(): void;
}
```
Checks every member before use (`boardLook`, `onBoardChange`, `readAsset`, `gmCamera`), never throws (same style as `tabletopMinis`).

- [ ] **Step 1: Failing tests:** `without Tabletop: unavailable, null look`, `an API without boardLook: unavailable`, `look and camera read through; listener fires on api-ready, onBoardChange and camera change`, `a throwing boardLook gives null and warns`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(connect): read Tabletop's board look`.

### Task C4: Board sender (GM)

**Files:** Modify **C:** `src/app/online/scene/SceneSlot.ts` (after `project`, compute `this.board = projectBoard(...)` when `host.options.board?.available()`; expose `get board(): BoardExtras | null`); Create **C:** `src/app/online/scene/BoardSender.ts`; Modify **C:** `src/app/online/OnlineSessionService.ts` (register after `CameraSender`); Modify **C:** `src/app/online/scene/AssetRegistry.ts` only if `idFor` refuses material/prop paths (it accepts by mime; no change expected); Test **C:** `tests/unit/online/boardSender.test.ts`

**Interfaces:**
- Consumes `SlotProjection` (`slotOf`, `audience`, `shownSlot`, `onSlotChange`), `SceneSlot.board`, `TabletopBoard`.
- Produces `class BoardSender implements SessionHandler` with `onAdmitted` (sends `board-offer {available}`), `onMessage` (`board-request {on}` → subscribe/unsubscribe player; on → send current extras + camera), re-offer to all players when `available()` changes, sends `board-extras` to subscribed audience of a slot when its `board` changed (deep-equal against last sent per player), `board-camera` for the shown slot's map at most every 100 ms, `null` extras on scene clear/move.
- Assets: material maps and props/door GLBs registered through the slot's `AssetIds`; the GM's `AssetServer` serves any registered id (it does today for minis).

- [ ] **Step 1: Failing tests:** `admission sends board-offer false without Tabletop and true with it`, `only players who requested get board-extras`, `a door toggle sends new extras once; an unrelated token move sends none`, `request off stops extras`, `a player moved to another scene gets that scene's extras`, `camera throttled to 100 ms, last change kept`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + `npx vitest run` full green.
- [ ] **Step 5:** Commit `feat(online): send board extras and camera to 3D players`.

### Task C5: Player session plumbing

**Files:** Modify **C:** `src/app/online/PlayerSession.ts` (`sendBoardRequest(on: boolean): boolean`; dispatch the three GM messages); Modify **C:** `src/app/online/obsidian/OnlineJoinService.ts` + `onlineJoinTypes.ts` (sink methods `boardOffer(available)`, `boardExtras(extras)`, `boardCamera(camera)`; `boardPainter()` like `miniPainter()`); Modify **C:** `src/app/online/assets/AssetLoader.ts` (`setExtraIds(ids: readonly string[])`, merged with scene ids; GLBs among them only while `models()` is true); Modify **C:** `src/connect/tabletopMinis.ts` (`tabletopPainter` also exposes `board(): PlayerBoardFactory | null`); Test **C:** `tests/unit/online/playerBoardSession.test.ts`

**Interfaces:** Produces `boardAssetIds(extras: BoardExtras | null): string[]` (materials maps, props, door props) in `assetIds.ts`.

- [ ] **Step 1: Failing tests:** `board-offer reaches the sink`, `extras ids are requested and cancelled when extras go`, `no board-request is sent when the GM offered false` (Review Focus 4), `one request per admission even if the view re-mounts twice`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(online): player side of board extras`.

### Task C6: 3D view in the player tab

**Files:** Create **C:** `online-client/scenePanels.mts` (extract from `mapView.mts`: hover card, handout, note + its wait, initiative, statblock preview, turn notice — `class ScenePanels` with `setScene`, `setSheets`, `hover(tokenId, screen, modifier)`, `receiveNote`, `requestNote(pinId)`, `dispose`); Modify **C:** `online-client/mapView.mts` to use `ScenePanels` (no behaviour change); Create **C:** `src/app/online/obsidian/sceneViewport.ts` (`interface SceneViewport` = MapView's public methods listed in `CanvasScene`); Create **C:** `src/app/online/obsidian/BoardSceneView.ts` (`implements SceneViewport`, mounts `PlayerBoardFactory.create(container, host)`, host → `service.send*`, `ScenePanels`); Modify **C:** `src/app/online/obsidian/CanvasScene.ts` (`this.map: SceneViewport | null`; choose `BoardSceneView` when `service.boardPainter()` and offer true, else `MapView`; switch on painter/offer change keeping session, dice log and sheets; `canvasSceneDom.ts` adds a "2D/3D" toggle button in `viewButtons`, shown only when 3D is possible; sends `board-request` on mount/unmount of the 3D view); Tests **C:** `tests/unit/online/boardSceneView.test.ts`, existing MapView tests must stay green.

- [ ] **Step 1: Failing tests** (fake factory recording calls): `with painter and offer the tab mounts the board and sends board-request on`, `Tabletop leaving swaps to MapView, sends board-request off, dice log entries kept` (Review Focus 3), `toggle to 2D and back`, `toolbar tool clicks reach the board handle`, `hover from the board shows the hover card`, `openPin requests the note and the note drawer shows the answer`.
- [ ] **Step 2:** FAIL. **Step 3:** implement (extract `ScenePanels` first, run existing MapView tests green, then the rest). **Step 4:** full `npx vitest run` + tsc green. **Step 5:** Commit `feat(online): Tabletop's 3D board in the player tab`.

### Task T2: PlayerScene → BoardMap adapter

**Files:** Create **T:** `src/board/sceneAdapter.ts`; Modify **T:** `src/board/mapModel.ts` (add `darkness: FogOperation[]` to `BoardMap`, `[]` from `readMap`); Test **T:** `tests/sceneAdapter.test.ts`

**Interfaces:** Produces `boardMapFromScene(scene: PlayerSceneLike, extras: BoardExtras | null): BoardMap` and `type PlayerSceneLike` (the fields of Connect's `PlayerScene` used, typed loosely: `sceneId, map{asset,width,height,cellSize}, grid, tokens, fog, texts, drawings, initiative, pins?`). Token `imagePath` = asset id (host resolves), `statblockPath` null, mini from `token.mini.asset`. Fog ops with id `atlas-lighting-darkness` → `darkness`, others → `fog`. Walls/lights/lighting from extras (`readWalls`/`readLights` shapes). Pins → `pins` with `notePath` = pin id. Texts → `texts`; drawings → `inks` (pen strokes; shapes as closed strokes); initiative → `initiative` (read-only on the player).

- [ ] **Step 1: Failing tests:** `tokens, grid and background map across with asset ids`, `darkness op goes to darkness, not fog`, `extras walls become BoardMap walls; door open → closed false`, `no extras → no walls or lights`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `feat(board): read a Connect player scene`.

### Task T3: Board player audience

**Files:** Modify **T:** `src/board/board.ts` (constructor option `audience: 'gm' | 'player'`, default `'gm'`; player: main render with `showFor('player')` + blind check, darkness ground mesh, token drag only if `host.canMove(id)`, no GM menus/editors/Alt-copy/height drag/paint/material drop); Modify **T:** `src/board/toolbar.ts` (player variant: Move/Measure/Template/Laser/Ping tools + "GM view"; no player-view, freeze, board settings); Create **T:** `src/board/darkness.ts` (`darknessMesh(ops): THREE.Mesh` flat black at y≈0.5); Modify **T:** `harness/board.ts`, `harness/board-test.cjs`.

**Interfaces:** `BoardHost` gains optional `canMove?(tokenId: string): boolean`, `playerTool?` hooks used by T4. `Board.setGmCamera(camera: BoardCamera | null)`, `Board.followGm()` glides to it (reuse camera glide).

- [ ] **Step 1: Failing harness checks:** `player audience: no player-view/freeze/settings buttons`, `hidden fogged token absent; wall under fog absent`, `darkness drawn black, camera above it not blind`, `a non-controlled token cannot be dragged; a controlled one calls host.moveToken`, `GM view glides to the given camera`.
- [ ] **Step 2:** run harness → FAIL. **Step 3:** implement. **Step 4:** harness + `npm test` green. **Step 5:** Commit `feat(board): player audience`.

### Task T4: Player tools in 3D

**Files:** Create **T:** `src/board/playerTools.ts` (tool state machine: measure line/circle/cone with grid snap and label, template place/tap-to-remove-own/clear, laser stroke with dt, ping on click); Create **T:** `src/board/templates3d.ts` (`TemplateLayer` draws circle/cone/line/square/… flat, coloured by owner); Create **T:** `src/board/marks.ts` (remote pings ring + fade 1.5 s; remote laser trail per sender, reuse `laserBeam.ts`); Modify **T:** `src/board/board.ts` (route pointer by tool in player audience; pin click → `host.openPin`; hover → `host.hover`); Test **T:** `tests/playerTools.test.ts` + harness checks.

- [ ] **Step 1: Failing tests:** units `a short template drag on own template removes it`, `measure cone label in scene units`, `laser stroke dt per point`; harness `ping click calls sendPing at the ground point`, `remote template drawn`, `remote laser drawn and fades`.
- [ ] **Step 2:** FAIL. **Step 3:** implement (template shapes = Connect's `TEMPLATE_SHAPES`, copied into the contract file). **Step 4:** green. **Step 5:** Commit `feat(board): player tools`.

### Task T5: `api.playerBoard`

**Files:** Create **T:** `src/playerBoard.ts` (`playerBoardFactory(plugin): PlayerBoardFactory`; `create` builds `Board` with `audience:'player'`, a host backed by `PlayerBoardHost` — `readImage(id)` → `host.image(id)`, `readMini(id)` → `parseMini(host.model(id))`, material textures by asset id — and implements `PlayerBoardHandle` via the adapter (T2), tools (T4), camera (T3)); Modify **T:** `main.ts` (`api.playerBoard`); Test: harness page that mounts `playerBoardFactory` with a fake host and a fixture PlayerScene + extras.

- [ ] **Step 1: Failing harness checks:** `mount + setScene draws map, tokens, minis, walls`, `setExtras(null) removes walls`, `assets arriving later (refresh) appear`, `dispose frees the WebGL context`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** green; `npm run build`. **Step 5:** Commit `feat(api): player board for Connect`.

### Task C7 + T6: Session on the GM's board

**Files:** **C:** Create `src/connect/boardSession.ts` (`attachBoardSession(app, deps): Disposer` builds `BoardSession` + `SessionMarks` from `onlineSessionStore`, `TemplateHost`, `PingRelay`, `LaserRelay`, `Handouts`, presentation; calls `api.attachSession(session)` when Tabletop offers it, re-attaches on api-ready); Modify `src/app/online/tools/TemplateHost.ts` (`addGm(sceneId, add): boolean`, owner `'gm'`, GM colour; `erase` already exists); Modify `PingRelay`/`LaserRelay` options to accept a second `show` sink (fan-out). **T:** Modify `main.ts` (`api.attachSession(session: BoardSession): () => void`, `api.marks` returned to Connect as `SessionMarks`); Modify `src/board/BoardView.ts` + `board.ts` (draw overlay templates (erase on tap for GM), handout panel, pings and lasers via `marks.ts`; GM toolbar adds a Template tool while hosting; banner "Players don't see changes made here: open this map in Atlas." + "Open in Atlas" when `hosting()` and `writer.holder(path)` is null). Tests: **C:** `tests/unit/connect/boardSession.test.ts` (`templates added by the GM board reach players`, `erase from the board removes for every player` (Review Focus 5), `hosting flag follows the store`); **T:** harness `banner shows when hosting and Atlas does not hold the map`, `overlay template drawn, tap erases`.

- [ ] **Step 1:** failing tests in both repos. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** both suites green. **Step 5:** Commit in each repo `feat: the session on the GM's board`.

### Task X: Build, deploy, report

- [ ] Connect: `npx vitest run`, `npx tsc --noEmit -p .`, `npm run build`; copy `dist/main.js`, `dist/styles.css` to the three Connect vaults (backup the current build to the scratchpad first).
- [ ] Tabletop: `npm test`, harness, `npm run build`, `ATLAS_VAULT=… node scripts/deploy.mjs` for the four vaults.
- [ ] Final whole-branch review in both repos; report to the user with a manual checklist (host in 2075, join from atlas-player-vault with Tabletop on/off, doors, lights, darkness, templates, pings, lasers, GM view, banner).
