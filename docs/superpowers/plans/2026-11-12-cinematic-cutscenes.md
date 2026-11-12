# Cinematic Cutscenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GM builds cutscenes per scene on a timeline (shots, keyframe shots, fade / cut / move), previews them alone, and runs them for players (or locks players to the GM's live camera), with every player faded in and out and returned to exactly the camera and view they had.

**Architecture:** Pure modules hold the data, the timeline maths, the playback state machine and the lock rules (`src/cutscene/`). The `Board` gets a cinematic mode: a driver that places the camera each frame from the clock, an input lock, and an overlay for bars and fades. The GM's side (`CutsceneStudio` in `BoardView`) authors, previews and runs. A run is published through Tabletop's API as a pull source (`api.cutscene`, shaped like `gmCamera`), so Connect learns when it starts, when it changes and when it is gone (the board closing or Tabletop unloading ends it for free). Connect sends players the shots and the current step, never a streamed camera (live mode excepted), together with a revealed projection of the current shot's map. Each player's board plays the shots locally, so playback is smooth. The revealed projection lives outside the scene assignments and is dropped at the end.

**Tech Stack:** TypeScript, three.js, node:test (`npm test`), Playwright harness (`node harness/run-ui.mjs "<feature>"`), esbuild. On the Connect side: vitest, eslint, vite.

**Spec:** `docs/superpowers/specs/2026-11-11-cinematic-cutscenes-design.md`

## Global Constraints

- A cutscene belongs to the `MapData` of the map it was created in (`data.json`, autosaved by `BoardData` at 500 ms). A shot on another map holds that map's vault path, and follows renames and deletions.
- Vault paths never leave the GM's machine. On the wire, a shot's map is a run-local key (`k1`, `k2`, …).
- Move transitions only between two shots on the same map. A cross-map transition is fade or cut.
- Cinematic settings: bars on/off; aspect 2.39:1 by default, with the choices 1.85:1, 2:1 and 2.39:1; default transition fade; default fade length 0.6 s each way (`fadeMs: 600`).
- Authoring camera: no normal camera limits (any pitch, looking up included; any distance), and no roll.
- Live cutscene: the GM's own camera keeps its normal limits; players' cameras follow it, smoothed.
- During a cutscene, a player's camera and tokens do not move from any input: mouse, wheel, keys, touch, pinch, token eyes, AR, or Connect calling the handle. The only things a player can use are hover and click info (sheet, menu, anything that changes nothing) and the Roll dice button.
- The reveal is bounded to the run. Nothing seen in a cutscene is kept as explored or remembered, or stays in the player's data after it ends.
- The cutscene scene is not part of `SceneAssignments`. It does not count toward the four-scene cap and never changes who is assigned where.
- `Previous` is a cut to the previous ordinary shot. There is no reverse playback.
- Players return to the map they were on when the cutscene ends, with their own camera, or AR placement, or 2D view.
- Another agent edits `src/board/board.ts` on this branch: anchor every change by method name, not line number.
- Connect repo: `C:\Users\joaoo\2075\atlas-vtt-connect`. Base the Connect tasks on `origin/main` (`c040c41`). The local `main` is stale and has no board code. `promo/fixes` (`cc5e56c`) and `fix/tooltip-portal` (`dcdb30b`) carry `BoardSession` members that Tabletop's `connectContract.ts` already declares (`presentTo`, `resourceShows`, `castSpell` rules). Merge them first, or rebase onto whichever has merged. `connectContract.ts` and Connect's `boardTypes.ts`/`playerBoardContract.ts`/`BoardSessionHub.ts` must stay in step.
- Run the browser checks with `PLAYWRIGHT_MODULE` set to an installed Playwright and `ATLAS_CSS=../.obsidian/plugins/atlas-vtt/styles.css`. Do not run `--all` until Task 9.

## Review Focus

1. **A player whose run crossed maps returns to their own camera exactly.** `PlayerBoard.reload` calls `frameNewMap()` on any scene change (`framesAnew`), which would frame the whole map instead. The kept pose must be restored after the own scene reloads, bypassing limits. Test: Task 6 (`restores the exact own camera after a cross-map run`).
2. **Input already in flight, and Connect's handle calls, while locked.** A drag or pinch begun before the lock must be dropped. `followGm`, `fitMap`, `lookAt`, `seeFrom`, `setAugmented`, `startRoomAr` and `selectTool` must change nothing during a run. Tests: Task 3 (`a drag in flight stops at the lock`) and Task 6 (`handle calls are ignored while locked`).
3. **The GM's session dropping, the GM's board closing, or the player's link dropping** ends the cutscene on the player's board. The player fades back to their own camera and is never left locked. Tests: Task 6 (`setConnected(false) ends the run`), Task 5 (`closing the board clears api.cutscene`), Task 8 (`disconnect ends the cutscene`).
4. **Next pressed again while a transition still plays, or Next on a keyframe chain.** The current legs finish at once, then the next leg starts. The run never stops on a keyframe shot, and never runs past the last shot. Test: Task 2 (`next during a transition`).
5. **A player joining or reconnecting mid-run, during a transition,** lands resting on the step's target shot. Before that they see the black fade, never their framed map with the bars. Test: Task 6 (`joins mid-run at the current shot`) and Task 7 (`admitted mid-run gets the cutscene, scene and extras`).

---

## File Structure

- `src/cutscene/cutsceneData.ts`: pure. `Cutscene`, `Shot`, `Transition`, `readCutscenes`, edits, `allowedTransitions`.
- `src/cutscene/cinematicSettings.ts`: `CinematicSettings`, defaults, `readCinematicSettings`.
- `src/cutscene/timeline.ts`: pure. Stops, legs, path sampling (spline through keyframe chains), `enterLeave`, `smoothFollow`.
- `src/cutscene/playback.ts`: pure. `CutscenePlayback` (next, previous, seek, follow, frame).
- `src/cutscene/lockRules.ts`: pure. `CinematicRole`, `LockInput`, `inputAllowed`.
- `src/cutscene/freeCamera.ts`: pure. The unlimited authoring camera.
- `src/cutscene/cinemaOverlay.ts`: DOM. Bars and the fade, above everything on a board or a players' window.
- `src/cutscene/timelineView.ts`: DOM. The timeline strip and its menus.
- `src/cutscene/studio.ts`: `CutsceneStudio`. The gallery, the editor, the preview and the run controls for one GM board, behind a `StudioHost`.
- `src/cutscene/broadcast.ts`: pure. `broadcastOf` (GM side: keys, no paths) and `readBoardCutscene` (player side: validation).
- `src/cutscene/cutsceneRun.ts`: the GM-side run (playback, map switching per shot, live mode, end).
- `src/cutscene/playerCutscene.ts`: pure. `PlayerCutsceneState`: what a player's board shows and when it restores.
- Modified:
  - `src/board/boardData.ts`, `main.ts`, `src/board/camera.ts`, `src/board/board.ts`, `src/board/toolbar.ts`, `src/board/BoardView.ts`, `src/playerBoard.ts`, `src/connectContract.ts`, `styles.css`, `harness/board.ts`, `harness/playerBoard.ts`, `harness/features-test.cjs`, `harness/run-ui.mjs`, `README.md`.
- Connect repo (Tasks 7–8):
  - `src/app/online/protocol.ts`, `src/app/online/scene/boardTypes.ts`, `src/app/online/scene/boardValidation.ts`, `src/app/online/scene/sceneSources.ts`, `src/app/online/scene/CutsceneSender.ts` (new), `src/app/online/scene/projectCutscene.ts` (new), `src/app/online/scene/AssetServer.ts`, `src/app/online/control/TokenMoveHandler.ts`, `src/app/online/tools/BoardSessionHub.ts`, `src/app/online/hostedSession.ts`, `src/connect/tabletopMinis.ts`
  - `src/app/online/PlayerSession.ts`, `src/app/online/obsidian/playerBoardContract.ts`, `src/app/online/obsidian/BoardSceneView.ts`, `src/app/online/obsidian/CanvasScene.ts`, `src/app/online/obsidian/joinFlow.ts`, `src/app/online/obsidian/onlineJoinTypes.ts`, `online-client/main.mts`, `online-client/sceneSwitch.mts`, `vendor/tabletop/*`

---

### Task 1: Cutscene data, storage and cinematic settings

**Files:**
- Create: `src/cutscene/cutsceneData.ts`, `src/cutscene/cinematicSettings.ts`
- Modify:
  - `src/board/boardData.ts`: `MapData.cutscenes?: Cutscene[]`; read it in `readBoardData`; follow it in `rename` and `deleted`
  - `main.ts`: `TabletopSettings.cinematic`, its load, and a "Cinematic" group in `getSettingDefinitions` and `display()`
- Test: `tests/cutsceneData.test.ts`, `tests/cinematicSettings.test.ts`, `tests/boardData.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }`
  - `type Transition = 'fade' | 'cut' | 'move'`
  - `interface Shot { id: string; at: number /* ms from the start */; mapPath: string; eye: Vec3; target: Vec3; keyframe: boolean; transition: Transition /* into this shot; the first shot's is ignored */ }`
  - `interface Cutscene { id: string; name: string; shots: Shot[] /* sorted by at */ }`
  - `MIN_SHOT_GAP_MS = 100`
  - `allowedTransitions(from: Shot, to: Shot): Transition[]`: `['fade','cut','move']` on the same map, `['fade','cut']` across maps.
  - `readCutscenes(raw: unknown): Cutscene[]`:
    - drops a shot with a non-finite number, an empty `mapPath` or eye === target
    - sorts by `at`, then pushes shots apart to at least `MIN_SHOT_GAP_MS`
    - turns a cross-map `move` into `fade`
    - drops a cutscene with no id; an empty name becomes `"Cutscene"`
  - Edits, each returning a new `Cutscene`, unchanged when refused:
    - `addShot(c: Cutscene, shot: Pick<Shot,'id'|'at'|'mapPath'|'eye'|'target'>, preferred: Transition): Cutscene`: the shot gets `keyframe: false`, and the `preferred` transition when it is allowed from the shot before it (else `fade`). The shot after it is checked again.
    - `retime(c, shotId, at)`: clamped to stay `MIN_SHOT_GAP_MS` from both neighbours; order never changes.
    - `setTransition(c, shotId, t)`: refused when `t` is not allowed from the shot before.
    - `setKeyframe(c, shotId, keyframe: boolean)`
    - `updateShot(c, shotId, pose: { mapPath: string; eye: Vec3; target: Vec3 })`: rechecks both neighbouring transitions (a `move` that became cross-map turns into `fade`).
    - `removeShot(c, shotId)`
  - On `BoardData`:
    - `cutscenesOf(mapPath: string): readonly Cutscene[]`
    - `putCutscene(mapPath: string, cutscene: Cutscene): void` (replaces by id, or appends)
    - `removeCutscene(mapPath: string, id: string): void`
  - `interface CinematicSettings { bars: boolean; aspect: 1.85 | 2 | 2.39; transition: Transition; fadeMs: number }`
  - `DEFAULT_CINEMATIC_SETTINGS = { bars: true, aspect: 2.39, transition: 'fade', fadeMs: 600 }`
  - `readCinematicSettings(raw: unknown): CinematicSettings`: a missing or bad field takes its default; `fadeMs` is clamped to 100..3000.

- [ ] **Step 1: Write the failing tests**

`tests/cutsceneData.test.ts`:
- `allowedTransitions` of two shots on `a.atlasmap` deep-equals `['fade','cut','move']`; on `a`→`b` it deep-equals `['fade','cut']`.
- `readCutscenes([{ id: 'c', name: '', shots: [s(500,'a'), s(0,'a'), s(550,'a',{transition:'move'}), {…bad: eye NaN}] }])` gives one cutscene named `Cutscene`, with 3 shots at `[0, 500, 600]`.
- `readCutscenes` turns a `move` from map `a` into map `b` into `fade`.
- `addShot` with `preferred: 'move'` after a shot on another map gives `transition === 'fade'`; on the same map it gives `'move'`.
- `retime` of the middle of shots at 0/1000/2000 to 50 gives 100; to 1990 gives 1900.
- `setTransition(c, id, 'move')` across maps returns `c` unchanged (`===`).
- `updateShot` moving a shot to map `b` turns the `move` into it into `fade`.

`tests/boardData.test.ts`:
- `putCutscene` then `cutscenesOf` returns it. A second `putCutscene` with the same id replaces it.
- `rename('maps/b.atlasmap', 'maps/c.atlasmap')` rewrites a shot's `mapPath` inside the cutscenes of `maps/a.atlasmap`.
- `deleted('maps/b.atlasmap')` removes the shots on `b` from `a`'s cutscene and keeps the rest.
- Deleting `a` takes its cutscenes with it.
- `readBoardData` round-trips `cutscenes`.

`tests/cinematicSettings.test.ts`:
- `readCinematicSettings(undefined)` deep-equals the defaults.
- `{ aspect: 3, fadeMs: 99999, bars: false }` reads as aspect 2.39, fadeMs 3000, bars false.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the new tests fail (modules missing).

- [ ] **Step 3: Implement the modules, the `BoardData` methods and the settings group**

The settings rows:
- Cinematic bars (toggle)
- Aspect ratio (dropdown `1.85:1`, `2:1`, `2.39:1`)
- Default transition (Fade, Cut, Move)
- Fade length in seconds (slider 0.1–3, step 0.1)

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"` and `npx tsc --noEmit`
Expected: `# fail 0`; tsc exits 0.

- [ ] **Step 5: Commit**

`git add src/cutscene tests/cutsceneData.test.ts tests/cinematicSettings.test.ts tests/boardData.test.ts src/board/boardData.ts main.ts && git commit -m "feat(cutscene): cutscene data in the map's board data, cinematic settings"`

---

### Task 2: Timeline maths, playback and lock rules

**Files:**
- Create: `src/cutscene/timeline.ts`, `src/cutscene/playback.ts`, `src/cutscene/lockRules.ts`
- Test: `tests/cutsceneTimeline.test.ts`, `tests/cutscenePlayback.test.ts`, `tests/lockRules.test.ts`

**Interfaces:**
- Consumes: Task 1's `Cutscene`, `Shot`, `Transition` and `Vec3`, and `smoother` from `src/board/camera.ts`.
- Produces:
  - `stopsOf(c: Cutscene): number[]`: the indices of the shots the run rests on. These are the non-keyframe shots, plus always the first and the last.
  - `interface Leg { from: number; to: number; transition: Transition; ms: number }`: `ms` is `shots[to].at - shots[from].at`, and 0 for a cut.
  - `legsBetween(c: Cutscene, from: number, to: number): Leg[]`: one leg per consecutive pair from `from` to `to` (`from < to`).
  - `interface CameraAt { eye: Vec3; target: Vec3; mapPath: string; black: number /* 0 clear … 1 black */ }`
  - `sampleLegs(c: Cutscene, legs: Leg[], elapsedMs: number): { at: CameraAt; done: boolean }`:
    - A run of consecutive `move` legs is one path. It is a centripetal Catmull-Rom through the eyes and, separately, through the targets, with the end points doubled. Progress along the run is `smoother(elapsed / total)`, split among the legs by their `ms`.
    - A `fade` leg: `black = 1 - |1 - 2u|`; the camera jumps to the next shot at `u = 0.5`.
    - A `cut`: the next shot at once.
  - `enterLeave(elapsedMs: number, fadeMs: number): { black: number; swapped: boolean; done: boolean }`: black ramps 0→1 over `fadeMs`, `swapped` turns true at `fadeMs`, then black ramps 1→0 over the next `fadeMs`; `done` at `2*fadeMs`.
  - `smoothFollow(current: { eye: Vec3; target: Vec3 }, goal: { eye: Vec3; target: Vec3 }, dtMs: number, tauMs = 150): { eye: Vec3; target: Vec3 }`: exponential, `k = 1 - exp(-dt/tau)`.
  - `class CutscenePlayback`:
    - `constructor(c: Cutscene, startShot = 0)`: rests on `startShot`, keyframe or not (preview from here).
    - `readonly cutscene: Cutscene`
    - `get shot(): number`: the shot rested on or headed to.
    - `get seq(): number`: +1 on every `next`, `previous` or `seek`.
    - `get playing(): boolean`
    - `next(nowMs: number): 'playing' | 'ended'`: a transition still under way is finished at once first. Then it plays the legs to the next stop, or returns `'ended'` from the last shot.
    - `previous(nowMs: number): boolean`: a cut to the previous stop; false at the first.
    - `seek(shot: number, seq: number): void`: rests there, with no transition (join mid-run).
    - `follow(shot: number, seq: number, nowMs: number): void`: the player's side. An older or equal `seq` is ignored. The next stop after the current one plays like `next`; anything else seeks.
    - `frame(nowMs: number): CameraAt & { resting: boolean }`
  - `type CinematicRole = 'none' | 'authoring' | 'previewing' | 'running' | 'live' | 'locked'`. `running` and `live` are the GM's; `locked` is a player's during either.
  - `type LockInput = 'camera' | 'token-drag' | 'tool' | 'eyes' | 'ar' | 'token-info' | 'dice'`
  - `inputAllowed(role: CinematicRole, input: LockInput): boolean`. Table (anything not listed is allowed):
    - `locked`: only `token-info` and `dice`
    - `running` and `previewing`: no `camera`, `eyes` or `ar` (the GM still drags tokens in `running`)
    - `authoring`: no `eyes` or `ar` (the camera is the free camera)
    - `live` and `none`: everything

- [ ] **Step 1: Write the failing tests**

`tests/cutsceneTimeline.test.ts`, on a fixture of shots A(0, map a), B(1000, a, keyframe), C(2000, a, move), D(3000, b, fade), E(3600, b, cut):
- `stopsOf` deep-equals `[0, 2, 3, 4]`, and with E marked keyframe still ends with `4`.
- `legsBetween(c, 0, 2)` gives 2 legs, with ms `[1000, 1000]`. E's leg has `ms: 0`.
- `sampleLegs` over A→B→C (both `move`) at 0 is A's eye, at the end is C's eye with `done: true`, and at the halfway point passes within 1e-6 of B's eye (the spline goes through keyframes).
- Fade C→D: at u=0.25 black is 0.5 and the map is `a`; at u=0.75 black is 0.5 and the map is `b`; at the end black is 0.
- `enterLeave(300, 600)` gives black 0.5, not swapped. `(600, 600)` gives black 1, swapped. `(1200, 600)` is done with black 0.
- `smoothFollow` with dt = tau moves 63.2% (±0.1%) of the way.

`tests/cutscenePlayback.test.ts`:
- From a new playback on the fixture: `shot === 0`. `next(0)`, then `frame(2000)` is resting at shot 2. `next` → 3, `next` → 4, `next` → `'ended'`.
- **`next during a transition`:** `next(0)` then `next(500)` gives `shot === 3`, and `frame(500)` is on shot 2's pose or later, never between A and B.
- `previous` from shot 3 is resting on shot 2 at once (`frame(now).resting`), and `previous` at shot 0 is false.
- `new CutscenePlayback(c, 1).shot === 1` (preview from a keyframe shot).
- `follow(3, 5, t)` on a fresh playback seeks (resting at 3). After it, `follow(3, 4, t)` changes nothing.

`tests/lockRules.test.ts`: the table above, row by row: every `LockInput` for `locked`, `running`, `authoring` and `none`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the new tests fail.

- [ ] **Step 3: Implement the three modules**

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

`git add src/cutscene tests/cutsceneTimeline.test.ts tests/cutscenePlayback.test.ts tests/lockRules.test.ts && git commit -m "feat(cutscene): timeline maths, playback and lock rules"`

---

### Task 3: The board's cinematic mode: driver, free camera, lock, bars and fade

**Files:**
- Create: `src/cutscene/freeCamera.ts`, `src/cutscene/cinemaOverlay.ts`
- Modify:
  - `src/board/camera.ts`: `keep`/`restore`
  - `src/board/board.ts`:
    - `applyView` and `frame`: the driver's pose wins over the orbit camera's, as the AR and eyes branches do
    - camera input: the pointer handlers, wheel, pinch/touches, `steer`, the key handlers, `seeFrom`, `followGm`, `frameMap`, `lookAtPoint`, `setAugmented`, `startRoomAr`
    - token drags: the press becoming `moved`
    - `drawPlayers`: the players' window takes the driver too
  - `styles.css`: `.tabletop-cinema`, `.tabletop-cinema__bar`, `.tabletop-cinema__fade`
  - `harness/features-test.cjs`
- Test: `tests/camera.test.ts`, `tests/freeCamera.test.ts`, and the harness feature `cinematic mode`

**Interfaces:**
- Consumes: Task 2's `CinematicRole`, `inputAllowed` and `CameraAt`.
- Produces:
  - `interface CameraKeep { pose: CameraPose; goal: CameraPose; wanted: number }`. On `OrbitCamera`:
    - `keep(): CameraKeep`
    - `restore(keep: CameraKeep): void`: copies exactly, even outside the limits, and cancels a glide.
  - `class FreeCamera`:
    - `constructor(eye: Vec3, target: Vec3)`
    - `look(dx: number, dy: number): void`: radians; pitch clamped to ±(π/2 − 0.01)
    - `fly(right: number, up: number, forward: number): void`: world units, along the view's own axes; `up` is world y
    - `dolly(factor: number): void`: moves along the view by `reach * (factor − 1)`
    - `pose(): { eye: Vec3; target: Vec3 }`: target = eye + forward × `reach`, where `reach` is the eye–target distance it was made with
  - `interface CinematicDriver { pose(nowMs: number): { eye: Vec3; target: Vec3; black: number }; free?: FreeCamera }`
  - On `Board`:
    - `setCinematic(driver: CinematicDriver | null): void`
    - `get cinematic(): CinematicDriver | null`
    - `setCinematicRole(role: CinematicRole): void`: a press in progress is dropped when the role stops allowing it, and held keys are cleared.
    - `get cinematicRole(): CinematicRole`
    - `readonly cinema: CinemaOverlay`
    - `keepCamera(): CameraKeep` / `restoreCamera(keep: CameraKeep): void`
    - `setPlayersCinematic(on: boolean): void`: the players' window draws the driver's pose and carries its own `CinemaOverlay`.
    - `holdPlayers(hold: boolean): void`: on the next players' draw, the frame is captured (`toDataURL` right after `render`) into an `<img>` laid over the players' stage. It stays until `holdPlayers(false)`, across scene switches too.
    - `setReveal(on: boolean): void`: `showFor('player')`, and so the players' window and a player's own board, then shows what the GM's view shows, as players draw it. That means:
      - the line-of-sight veil (`veilSight`, `sightMasks`) and `pointBeyond`/`beyondSight` are suspended
      - no solid fog is drawn
      - every token not `hidden` by the GM is shown
      - hidden tokens stay hidden
      - nothing is cached: turning it off redraws from the live sight
  - A player in a token's eyes when the role turns `locked` leaves the eyes (pointer lock released). `get eyesBeforeLock(): string | null` remembers the token for the player board to re-enter.
  - An AR view (`setAugmented`) still received while locked is kept as the latest, but not drawn: the driver wins. When the lock ends, it is drawn again, so marker AR resumes with no restart.
  - With `driver.free` set, the board feeds the free camera instead of the orbit camera:
    - a left or right drag → `look`
    - WASD → `fly` forward/right, and Q/E → down/up, speed `span * 0.4` per second
    - the wheel → `dolly(1.1 ** sign)`
  - `class CinemaOverlay`:
    - `constructor(container: HTMLElement)`
    - `setBars(aspect: number | null): void`
    - `setBlack(level: number): void`
    - `get barHeight(): number`: px; `max(0, (h − w/aspect) / 2)`
    - `dispose(): void`
    - It sits above every other board overlay (z-index above the toolbar). It takes no pointer events, except where a child of it asks for them.

- [ ] **Step 1: Write the failing tests**

- `camera.test.ts` `restore bypasses limits`: a camera with `limitsFor(1000,1000)`. Keep its pose, then set `pose.pitch = 1.56`, `distance = 1e5`, and `wanted` (via `keep`) on a copy. Restore it: `pose` and `goal` deep-equal the kept ones, and `update(0.1)` returns false.
- `freeCamera.test.ts`:
  - `look(0, 10)` leaves pitch at π/2 − 0.01, and the target is above the eye.
  - `fly(0, 0, 10)` moves the eye 10 along the view, and the target with it.
  - `pose()` keeps `reach`.
- Harness feature `cinematic mode` (GM board):
  - `board.setCinematic({ pose: () => ({ eye: {x:500,y:900,z:1400}, target: {x:500,y:0,z:500}, black: 0 }) })`. After two frames, `board.view.position` is within 0.01 of the eye.
  - With role `running`, a wheel and a drag on the canvas leave `camera.goal` unchanged (JSON-equal).
  - **`a drag in flight stops at the lock`:** start a token drag with `page.mouse.down` and a move, then `setCinematicRole('locked')`, then move and release. The token's map position is unchanged and `window.boardTest.record.moves` is empty.
  - `board.cinema.setBars(2.39)`: `barHeight` is within 1 px of `(h − w/2.39)/2`, from the container's measured `clientWidth`/`clientHeight`, and two bars of that height are in the DOM.
  - `setReveal(true)`: a token inside the fixture's fogged room is visible when `showFor('player')` runs. A `hidden` token is not. `setReveal(false)` hides the fogged one again.
  - `setBlack(1)`: the fade element's computed opacity is 1.
  - A free driver: pressing W for 300 ms moves `driver.free.pose().eye` forward, and the orbit camera's goal is unchanged.
  - Screenshot `cinematic-bars.png`.

- [ ] **Step 2: Run, see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"` and `node harness/run-ui.mjs "cinematic mode"`

- [ ] **Step 3: Implement.**

Each gated entry point asks `inputAllowed(this.role, …)` once, at its top:
- camera gestures, `steer`, `followGm`, `frameMap` and `lookAtPoint` ask for `camera`
- the token press ask for `token-drag`
- `seeFrom` asks for `eyes`
- `setAugmented` and `startRoomAr` ask for `ar`
- player tool presses (ping, laser, template, measure, spell) ask for `tool`

A refused handle call returns `false`, or does nothing.

- [ ] **Step 4: Run them and make sure they pass**

Run: `npm test`, `node harness/run-ui.mjs "cinematic mode"`, and also `node harness/run-ui.mjs "sound settings"` (the listener still follows a driven camera), then `npx tsc --noEmit`.
Expected: `# fail 0`; every check `ok`.

- [ ] **Step 5: Commit**

`git add src/cutscene src/board/camera.ts src/board/board.ts styles.css harness/features-test.cjs tests/camera.test.ts tests/freeCamera.test.ts && git commit -m "feat(cutscene): board cinematic mode: driven camera, free camera, input lock, bars and fade"`

---

### Task 4: Authoring: the gallery, the timeline, the editor and the preview

**Files:**
- Create: `src/cutscene/studio.ts`, `src/cutscene/timelineView.ts`
- Modify:
  - `src/board/toolbar.ts`: `setCinema`
  - `src/board/BoardView.ts`:
    - makes the `CutsceneStudio` and implements `StudioHost`
    - the scene switch keeps the editor open
    - the players' window is held while authoring or previewing
  - `styles.css`
  - `harness/board.ts`: a fake `StudioHost` on `window.boardTest.studio`
  - `harness/features-test.cjs`
- Test: `tests/timelineView.test.ts` (pure helpers), and the harness features `cutscene authoring` and `cutscene preview`

**Interfaces:**
- Consumes: Tasks 1–3 (data edits, `CutscenePlayback`, `Board.setCinematic`, `FreeCamera`, `CinemaOverlay`, `holdPlayers`).
- Produces:
  - `interface StudioHost`:
    - `readonly board: Board`
    - `mapPath(): string | null`
    - `cutscenes(mapPath: string): readonly Cutscene[]`
    - `save(mapPath: string, cutscene: Cutscene): void`
    - `remove(mapPath: string, id: string): void`
    - `mapTabs(): string[]`: the map paths of the GM's Atlas view tabs
    - `switchMap(mapPath: string): Promise<boolean>`: false when it is not a tab
    - `settings(): CinematicSettings`
    - `setSettings(changes: Partial<CinematicSettings>): void`
    - `askName(initial: string): Promise<string | null>`
    - `notice(text: string): void`
    - `holdPlayers(hold: boolean): void`
  - `class CutsceneStudio`:
    - `constructor(root: HTMLElement, host: StudioHost)`
    - `get state(): 'idle' | 'gallery' | 'editing' | 'previewing' | 'running'`
    - `openGallery(): void`, `closeGallery(): void`
    - `create(): Promise<void>`
    - `edit(id: string): void`
    - `preview(fromShot?: number): void`
    - `stopEditing(): void`
    - `mapChanged(): void`: called by `BoardView` after a scene switch; the board reloaded and needs its driver again
    - `dispose(): void`
    - `get editing(): { home: string; cutscene: Cutscene } | null`: `home` is the map whose gallery holds it
  - `timeAt(x: number, pxPerSecond: number, scrollPx: number): number` and `xAt(ms: number, pxPerSecond: number, scrollPx: number): number`: pure, exported from `timelineView.ts`. The default is `pxPerSecond = 80`.
  - `toolbar.setCinema(handlers: { open(): void; live(): boolean; toggleLive(): void } | null): HTMLElement | null`: a film button (label "Cutscenes") and a toggle "Players follow my camera". The toggle shows only while a session hosts; the live part is wired in Task 5.

Behaviour:
- **Gallery:** a panel of the current map's cutscenes, with `+`, and per row: Edit, Preview, Play for players (Task 5), Rename, Delete (with confirm). Its header has a Cinematic settings button: bars, aspect, default transition and fade length, saved through `setSettings`.
- **`+`:** `askName("Cutscene")` → the cutscene is saved at once (no shots) → `edit`.
- **Editing:**
  - The board gets role `authoring`, and a `FreeCamera` driver started from the board's current pose.
  - The bars show when the settings say so. `holdPlayers(true)`.
  - A timeline strip spans the bottom, above the toolbar.
- **Timeline:**
  - A left click on empty time adds a shot there, with the free camera's pose and the current map (`addShot`, `preferred = settings.transition`).
  - Shots are dragged to retime them (`retime`).
  - A right click on a shot opens a menu: Make keyframe shot / Make ordinary shot, Preview from here, Update to current camera, Delete.
  - A right click between two shots opens a menu: Fade, Cut, Move (Move disabled across maps), with the current one ticked.
  - A shot on another map draws in another colour, with the map's name as its tooltip.
- **Autosave:** every edit calls `host.save(home, cutscene)` at once (BoardData debounces).
- **Scene switch while editing:** the editor stays. New shots take the new map. `mapChanged` puts the free driver back with the camera where it was.
- **Leaving editing** (Done button, Escape): role `none`, the driver is removed, the camera is put back from `keepCamera()` (taken on entry), and `holdPlayers(false)`. If the board is on another map than `home`, it switches back to `home` first.
- **Preview:** role `previewing`, and a `CutscenePlayback` driver from `fromShot`.
  - A control bar with Previous, Next and Back to editing, and the label "Shot n of m".
  - A shot on another map switches the board's map at the black midpoint of the fade, or at once for a cut. The playback clock pauses until the map has loaded.
  - The players' window stays held.

- [ ] **Step 1: Write the failing tests**

`tests/timelineView.test.ts`: `timeAt(xAt(1234, 80, 40), 80, 40) === 1234`, and `timeAt(-5, 80, 0) === 0`.

Harness feature `cutscene authoring` (the harness's fake host keeps cutscenes in memory, and `switchMap` loads a second fixture map):
- Clicking Cutscenes, then `+` with name "Docks", gives `studio.state === 'editing'` and `board.cinematicRole === 'authoring'`. The saved list holds `Docks`.
- Pressing W, then clicking the timeline at x of 0 s and of 2 s, saves 2 shots whose eyes differ.
- A right click between them, then Move, makes the second shot's transition `move`.
- `switchMap(second)`, then a click at 4 s, saves a third shot on the second map. The right-click menu between shots 2 and 3 has Move disabled.
- A right click on shot 2, then Make keyframe shot, saves `keyframe: true`.
- Dragging shot 2 to 3 s saves `at` within 50 ms of 3000.
- With the camera at pitch 1.5 rad looking down and then `look(0, -3)` (looking up), the pose is kept. No limit clamps it.
- Done: the role is `none`, `camera.pose` deep-equals the pose before `+`, the board is on the first map, and `holdPlayers` saw `true` then `false`.
- Screenshot `cutscene-timeline.png`.

Harness feature `cutscene preview`:
- Preview from the start rests on shot 0. Next runs through the keyframe shot and rests on shot 3 (the next ordinary one), on the second map, after the fade.
- Previous cuts back to shot 0. Back to editing gives `state === 'editing'`.
- Preview from here on shot 2 starts resting on shot 2.

- [ ] **Step 2: Run, see them fail**

Run: `npm test` and `node harness/run-ui.mjs "cutscene (authoring|preview)"`

- [ ] **Step 3: Implement**, as listed under Files.

- [ ] **Step 4: Run them and make sure they pass**

`npm test`, `node harness/run-ui.mjs "cutscene (authoring|preview)"`, `node harness/run-ui.mjs "cinematic mode"`, and `npm run build`.

- [ ] **Step 5: Commit**

`git add src/cutscene src/board/toolbar.ts src/board/BoardView.ts styles.css harness tests/timelineView.test.ts && git commit -m "feat(cutscene): gallery, timeline, free-camera authoring and preview"`

---

### Task 5: Running for players on the GM side, the contract and `api.cutscene`

**Files:**
- Create: `src/cutscene/broadcast.ts`, `src/cutscene/cutsceneRun.ts`
- Modify:
  - `src/connectContract.ts`: wire shapes and the GM's source
  - `main.ts`: `TabletopApi.cutscene`; one run at a time; ends on unload and on session release
  - `src/board/BoardView.ts`:
    - Play for players and the live toggle
    - the run ends in `onClose`
    - the players' window plays the run
  - `src/cutscene/studio.ts`: state `running` and its controls
  - `harness/board.ts`, `harness/features-test.cjs`
- Test: `tests/cutsceneBroadcast.test.ts`, and the harness feature `cutscene run`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces, in `connectContract.ts`. Connect copies these into `boardTypes.ts` and `sceneSources.ts`, and they must stay the same. `Vec3` is written out there as `{ x: number; y: number; z: number }`, because Connect's `boardTypes.ts` imports nothing:
  - `interface BoardCutsceneShot { key: string; eye: Vec3; target: Vec3; at: number; keyframe: boolean; transition: 'fade' | 'cut' | 'move' }`
  - `interface BoardCutscene`:
    - `runId: string`
    - `mode: 'prepared' | 'live'`
    - `look: { bars: number | null /* aspect, or none */; fadeMs: number }`
    - `shots: BoardCutsceneShot[] /* none in live */`
    - `step: { shot: number; seq: number } /* prepared: the ordinary shot rested on or headed to */`
    - `key: string /* the map shown now: the step's shot's, or the GM's in live */`
  - `interface GmCutscene { cutscene: BoardCutscene; maps: Record<string, string> /* key → vault path, GM side only, never sent */ }`
  - `interface CutsceneSource`:
    - `current(): GmCutscene | null`
    - `onChange(listener: () => void): () => void`
    - `camera(): { eye: Vec3; target: Vec3 } | null`: live only; the GM board's own camera, never the players' window's
    - `onCamera(listener: () => void): () => void`
  - `BoardSession.cutscenes?: true`: a Connect that carries cutscenes says so.
  - `TabletopApi.cutscene: CutsceneSource` (`main.ts`).
- `broadcastOf(input: { runId: string; mode: 'prepared' | 'live'; cutscene: Cutscene | null; step: { shot: number; seq: number }; mapPath: string; settings: CinematicSettings }): GmCutscene`:
  - keys are `k1…` by the first appearance of each map, `mapPath` included
  - `look.bars` is `settings.bars ? settings.aspect : null`
  - no vault path appears anywhere in `cutscene`
- Adds to `StudioHost`: `session(): BoardSession | null`, which `BoardView` reads from `services.session?.()`.
- `class CutsceneRun`:
  - `constructor(host: StudioHost, publish: (run: GmCutscene | null) => void)`
  - `startPrepared(cutscene: Cutscene, home: string): Promise<boolean>`
  - `startLive(): void`
  - `next(): void`, `previous(): void`, `end(): void`
  - `get running(): boolean`
  - `liveCamera(): { eye: Vec3; target: Vec3 } | null`

Behaviour:
- **Play for players and Preview** are refused for a cutscene with no shots: "Tabletop: add a shot first."
- **Play for players** is refused with a notice when:
  - no session hosts: "Tabletop: start a session in Connect first."
  - the session lacks `cutscenes`: "Tabletop: this Connect cannot show cutscenes; update it."
  - a shot's map is not one of `mapTabs()`: "Tabletop: open these maps as tabs in Atlas first: …"
- **On start:**
  - The run keeps the GM board's map and `keepCamera()`.
  - Role `running`, with the playback driver, the bars, `setPlayersCinematic(true)` and `setReveal(true)`, so the local players' window shows everything, as remote players see it.
  - `BoardView` lends the open players' window (`PlayerView`) to the run. After each cross-map switch it is attached to the run's board again, without `waiting(true)`: the fade is black. At End it is given back to its own map.
  - It publishes `step { shot: 0, seq: 1 }` with an enter fade on the GM board (`enterLeave`).
- **Next, Previous and End** each publish a new `step`. A shot on another map switches the GM board (`switchMap`), so that Atlas's active tab follows and Connect gets that map's live snapshot. Next on the last shot is End.
- **End:**
  - publishes null
  - leave-fades the GM board
  - switches back to the start map and restores the kept camera
  - sets role `none` and turns the players' window back to normal
- **Live (the toolbar toggle):**
  - publishes `mode: 'live'`, `key` = the GM board's map
  - the GM keeps the orbit camera with its limits (role `live`)
  - `onCamera` fires on `cameraMoved`
  - a scene switch republishes with the new key
  - toggling off is End
- **The run also ends** when its board closes (`BoardView.onClose`), when the session is released (the `attachSession` release), when `hosting()` turns false, and on plugin unload. Each path publishes null.

- [ ] **Step 1: Write the failing tests**

`tests/cutsceneBroadcast.test.ts`:
- Shots on `maps/a.atlasmap`, `maps/b.atlasmap`, `maps/a.atlasmap` give keys `['k1','k2','k1']` and `maps` deep-equal `{ k1: 'maps/a.atlasmap', k2: 'maps/b.atlasmap' }`.
- `JSON.stringify(result.cutscene)` contains no `.atlasmap` and no `/`.
- bars off → `look.bars === null`; on with 1.85 → 1.85.
- Live mode with no cutscene → `shots: []` and `key: 'k1'`.

Harness feature `cutscene run` (the fake session has `cutscenes: true` and `hosting() === true`; `window.boardTest.api.cutscene` is the source):
- Play for players on `Docks` gives `current().cutscene.step` deep-equal to `{ shot: 0, seq: 1 }`, and `onChange` fired once.
- Next → `step.shot === 3` and `key === 'k2'`, and the fake host's `switchMap` was called with the second map.
- End → `current() === null`, the board is back on the first map, and its `camera.pose` deep-equals the pose before Play.
- The fake session without `cutscenes` → a notice containing "cannot show cutscenes", and `current() === null`.
- **`closing the board clears api.cutscene`:** start a run, dispose the board view → `current() === null` and `onChange` fired.
- The live toggle → `mode === 'live'`; a camera zoom fires `onCamera`; `camera()` is the GM's pose.
- With the players' window open during the run:
  - its camera matches the driver's pose
  - a fogged token is drawn in it (the reveal)
  - after End it follows the GM's again, and the fogged token is hidden there again
- Play and Preview on a cutscene with no shots give the notice "add a shot first", and `current() === null`.
- The players' window following the run across a map switch is checked live, in Task 9: the harness mounts `Board`, not `BoardView`/`PlayerView`.

- [ ] **Step 2: Run, see them fail**

Run: `npm test` and `node harness/run-ui.mjs "cutscene run"`

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and make sure they pass**

`npm test`, `node harness/run-ui.mjs "cutscene"`, and `npm run build`.

- [ ] **Step 5: Commit**

`git add src/cutscene src/connectContract.ts main.ts src/board/BoardView.ts harness tests/cutsceneBroadcast.test.ts && git commit -m "feat(cutscene): run cutscenes for players; api.cutscene for Connect; live follow"`

---

### Task 6: The player's board: playback, lock, reveal store, Roll dice, restore

**Files:**
- Create: `src/cutscene/playerCutscene.ts`
- Modify:
  - `src/playerBoard.ts`: the handle methods; the own scene kept aside; the lock on handle calls; the restore; the Roll dice button
  - `src/connectContract.ts`: re-export the player-handle additions next to `PlayerBoardHandle`
  - `src/cutscene/broadcast.ts`: `readBoardCutscene`
  - `harness/run-ui.mjs`: also bundle `harness/playerBoard.ts` as `.ui-build/playerBoard.js`, and write `.ui-build/playerBoard.html` (`board.js` swapped for `playerBoard.js`), so a feature can use the url `/playerBoard.html`
  - `harness/features-test.cjs`: the runner's boot wait becomes `window.boardTest?.ready || window.playerTest?.ready || window.boardError`
  - `harness/playerBoard.ts`: its fake host records `cutsceneOver` calls in `record.cutsceneOver`
- Test: `tests/playerCutscene.test.ts`, `tests/cutsceneBroadcast.test.ts`, and the harness features `player cutscene` and `player cutscene lock`

**Interfaces:**
- Consumes:
  - Task 2's `CutscenePlayback`, `enterLeave`, `smoothFollow` and `inputAllowed`
  - Task 3's `setCinematic`, `setCinematicRole`, `cinema`, `keepCamera` and `restoreCamera`
  - Task 5's `BoardCutscene`
- Produces:
  - `readBoardCutscene(raw: unknown): BoardCutscene | null`. These limits are shared with Connect's validator (Task 7):
    - ≤ 200 shots
    - keys match `^k[0-9]{1,4}$`, and runId matches `^[A-Za-z0-9_-]{1,64}$`
    - `at` in 0..3 600 000
    - `|coordinates|` ≤ 1e7
    - prepared: ≥ 1 shot, and `step.shot` is a stop of the shots
    - live: `shots` is empty and `step` is `{ shot: 0, seq: n }`
    - `fadeMs` in 100..3000
    - `bars` is null or one of 1.85, 2, 2.39
  - `class PlayerCutsceneState` (pure):
    - `cutscene(c: BoardCutscene | null, nowMs: number): void`
    - `sceneArrived(key: string): void`
    - `disconnected(nowMs: number): void`
    - `view(nowMs: number): { show: 'own' | string; locked: boolean; black: number; camera: CameraAt | null; restore: boolean }`. `restore` is true once, at the leave fade's black midpoint, when the own scene and camera must come back.
  - New members on `PlayerBoardHandle` (Connect copies them into `playerBoardContract.ts`):
    - `readonly cutscenes?: true`
    - `setCutscene?(cutscene: unknown | null, options?: { startBlack?: boolean; handBack?: boolean }): void`: a `BoardCutscene`; null ends it.
      - `startBlack`: Connect has just made this board for the run, over a view it faded to black itself; no enter fade.
      - `handBack`: at the leave fade's black, the board does not reload its own scene. It calls `host.cutsceneOver?.()` and stays black, so that Connect can put back the view it had (2D) under its own black and fade that in.
  - New on `PlayerBoardHost`: `cutsceneOver?(): void`.
    - `setCutsceneScene?(runId: string, key: string, scene: unknown, extras: BoardExtras | null): void`: the revealed scene of `key`, sent again whenever it changes
    - `setCutsceneCamera?(runId: string, camera: { eye: Vec3; target: Vec3 }): void`: live only

Behaviour on `PlayerBoard`:
- **Entering:**
  - `keepCamera()` is taken, and the role becomes `locked`.
  - The enter fade runs: black over `fadeMs`.
  - Then the board shows the cutscene scene of `key`. It loads `boardFromScene(scene, extras)` with the sceneId `cutscene:<runId>:<key>`, does not call `frameNewMap`, and does not call `dice.sceneChanged`.
  - `reload()` is the one gate. `refresh`, `moveRefused`, `setExtras`, `setScene` and `setCutsceneScene` all call it, and it loads the cutscene scene while a run shows one, else the own scene. During the run, `setScene` and `setExtras` only update the kept own scene.
  - A scene has arrived (`sceneArrived`) once `board.load` has finished with its background image present (`backgroundMissing` false). Until then the board stays black, then it fades in on the playback's (or the live camera's) pose.
  - The board calls `setReveal(true)` for the run, so its own sight veil hides nothing.
  - A player in a token's eyes leaves them (Task 3). After the run they are back in the same token's eyes (`seeFrom(eyesBeforeLock, gyro as before)`), and `host.eyeChanged` is called both times.
  - Marker AR keeps running underneath and resumes by itself (Task 3). Room AR (WebXR) is Connect's to stop (Task 8).
- **Shots:** prepared shots play through `CutscenePlayback.follow(step.shot, step.seq, now)`. A cross-map step holds black until the new key's scene has loaded, then plays on.
- **Live:** each `setCutsceneCamera` is a goal, eased every frame with `smoothFollow`. Never stepped.
- **Ending** (null, or `setConnected` going from true to false; repeated or out-of-order calls with false change nothing more):
  - The leave fade runs.
  - At black, the own scene reloads (`reload`), and `restoreCamera(kept)` follows once that load is done. This replaces `framesAnew`'s framing for this one load.
  - The cutscene scene, its extras and its playback are dropped (no reference kept), and the role goes back to `none`.
  - The fade in follows.
- **Handle calls during a run** do nothing and return false where they return a value: `followGm`, `fitMap`, `lookAt`, `seeFrom`, `setAugmented`, `startRoomAr`, `placeRoomAr`, `selectTool` and `throwDice` (a Connect sheet roll).
- **Roll dice button:** when `diceAvailable` and the run is on, a "Roll dice" button sits above the bottom bar, the overlay's one pointer target. It opens Tabletop's `DicePicker`, anchored on it. Its Roll throws through `this.dice.throw(request)`, so the result goes to `sendDiceResult` as any player roll. A shot change on the same map keeps a roll in play. A cross-map change drops it unsent, with the prompt notice "The scene changed; roll again."
- **Joining mid-run:** a `setCutscene` arriving with `startBlack`, or before the board has shown its own scene, starts already black: no enter fade from the framed map, and `seek` to the step's shot.

- [ ] **Step 1: Write the failing tests**

`tests/cutsceneBroadcast.test.ts` additions:
- `readBoardCutscene` returns null for 201 shots, for the key `k/1`, for a `step.shot` that is a keyframe shot, and for a prepared run with no shots.
- It accepts a live run with `shots: []`.
- It accepts the Task 5 broadcast output unchanged (deep-equal).

`tests/playerCutscene.test.ts`:
- After `cutscene(c, 0)`: `view(300).black` is 0.5 with `show: 'own'`; `view(700)` shows `k1` with black 1 until `sceneArrived('k1')`; then `view(1400).black` is 0.
- `locked` is true from `cutscene(c)` until the leave fade is done.
- `cutscene(null, t)`: `restore` is true exactly once (two calls at the midpoint give it once). After the fade, `show: 'own'` and `locked: false`.
- **`setConnected(false) ends the run`:** `disconnected(t)` behaves as `cutscene(null, t)`.
- **`joins mid-run at the current shot`:** a fresh state given a step `{shot: 3, seq: 7}` starts at black 1 with `show: 'k2'`. Once it arrives, its camera is shot 3's resting pose.

Harness features, on `/playerBoard.html`:

`player cutscene`:
- `handle.cutscenes === true`.
- Orbit the player camera somewhere odd and keep `board.camera.keep()`. `setCutscene(two-map run)`, then `setCutsceneScene(…, 'k1', revealedScene, extras)`:
  - after 1.4 s, `board.view.position` is within 0.5 of shot 0's eye
  - a fogged token of the own scene is drawn (the reveal)
  - the bars are in the DOM
  - screenshot `player-cutscene.png`
- Step to shot 3 on `k2`, then deliver `k2`'s scene: the view rests on shot 3.
- **`restores the exact own camera after a cross-map run`:** `setCutscene(null)`, then after 1.5 s:
  - `board.camera.pose` deep-equals the kept pose (each number within 1e-9)
  - the own scene's fog is back
  - no sceneId starting with `cutscene:` is shown
- **`joins mid-run at the current shot`:** a new handle given the running cutscene at step 3, then the `k2` scene, rests on shot 3 without showing the bars over the framed map first (sample `cinema` black ≥ 0.99 before the scene arrives).
- **Assets arriving mid-run:** deliver `k1`'s scene with its map image held back. The board stays black (≥ 0.99). Then `files` delivers the image and `refresh()` runs: the board fades in on `k1`, not on the own scene.
- **`handBack`:** `setCutscene(run, { startBlack: true, handBack: true })` starts at black 1 with no fade from the framed map. `setCutscene(null)` ends with `record.cutsceneOver.length === 1`, the board still black, and the own scene not reloaded.
- **`setConnected(false) ends the run`:** `handle.setConnected(true)` during the run, then `handle.setConnected(false)`: the leave fade runs and the camera is restored. A second `setConnected(false)` changes nothing.
- A player in a token's eyes when the run starts is out of them during the run (`seeingFrom() === null`), and back in the same token's eyes after it.
- Live: 5 `setCutsceneCamera` goals 100 ms apart along a line. Sampled every frame, the camera moves monotonically, and no frame-to-frame step is more than 3× the median step.

`player cutscene lock`:
- During a run:
  - a drag and a wheel on the canvas, WASD, and a pinch (two touch pointers) leave `board.camera.goal` unchanged
  - dragging a controlled token sends no move (`record.moves` is empty)
- **`handle calls are ignored while locked`:**
  - each of `followGm()`, `fitMap()`, `lookAt(10,10)`, `seeFrom('t1', false)`, `setAugmented(view)` and `selectTool('ping')` leaves the pose unchanged
  - `toolState().tool` is still the tool it was before the run
  - `seeFrom` returns false, `startRoomAr(fakeSession, null)` resolves false, and `throwDice({dice:{d20:1},modifier:0})` returns false
  - after the run, `setAugmented(view)` draws from the AR pose again
- Hovering a token still calls `record.hovers`.
- The Roll dice button is visible. Picking 1d20 and Roll ends with one `record.diceResults` entry.
- After `setCutscene(null)`, a drag moves the camera again.

- [ ] **Step 2: Run, see them fail**

Run: `npm test` and `node harness/run-ui.mjs "player cutscene"`

- [ ] **Step 3: Implement.**

Also run `node scripts/build-web.mjs`: the web player board (`src/web/playerBoardWeb.ts`) wraps the same `PlayerBoard`, so it builds with the new members and needs no code of its own.

- [ ] **Step 4: Run them and make sure they pass**

Run:
- `npm test`
- `node harness/run-ui.mjs "player cutscene"`
- `node harness/run-ui.mjs "cutscene"`
- `npm run build`
- `node scripts/build-web.mjs`

- [ ] **Step 5: Commit**

`git add src/cutscene src/playerBoard.ts src/connectContract.ts harness tests/playerCutscene.test.ts tests/cutsceneBroadcast.test.ts && git commit -m "feat(cutscene): player boards play cutscenes locally, locked, revealed, and come back to their own camera"`

---

### Task 7 (Connect repo): GM side: messages, revealed projection, sender, guards

Work in `C:\Users\joaoo\2075\atlas-vtt-connect`, on a branch `feat/cutscenes` from the base named in Global Constraints.

**Files:**
- Modify:
  - `src/app/online/scene/boardTypes.ts`: copies of `BoardCutsceneShot` and `BoardCutscene`, plus `CUTSCENE_LIMITS`
  - `src/app/online/scene/boardValidation.ts`: `isBoardCutscene`
  - `src/app/online/protocol.ts`: the five messages, their validators, and `PLAYER_MESSAGE_TYPES` + `'cutscene-ready'`
  - `src/app/online/scene/sceneSources.ts`: `BoardSource.cutscene?(): GmCutscene | null`, `subscribeCutscene?(listener): () => void`, `cutsceneCamera?(): {eye,target} | null` and `subscribeCutsceneCamera?(listener): () => void`
  - `src/connect/tabletopMinis.ts` (`tabletopBoard`): reads Tabletop's `api.cutscene` when it is a valid `CutsceneSource`, else none
  - `src/app/online/tools/BoardSessionHub.ts`: a new option, `cutscenes: boolean`. It sets `cutscenes = true` only when it is true, and `hostedSession` passes `tabs !== null`. On an older Atlas, with no scene tabs, there is no live snapshot of a shot's map, so Tabletop is told no and refuses Play for players.
  - `src/app/online/control/TokenMoveHandler.ts`: refuses `token-move` while a cutscene runs
  - the template/spell host (`TemplateHost`): refuses player `add`s while a cutscene runs
  - `src/app/online/scene/AssetServer.ts`: also serves the asset ids of the cutscene scene sent to that player, until the run ends
  - `src/app/online/hostedSession.ts`: makes and starts `CutsceneSender` after `BoardSender`
- Create: `src/app/online/scene/projectCutscene.ts`, `src/app/online/scene/CutsceneSender.ts`
- Test: `tests/unit/online/cutsceneProtocol.test.ts`, `tests/unit/online/projectCutscene.test.ts`, `tests/unit/online/cutsceneSender.test.ts`, `tests/unit/online/tokenMoveHandler.test.ts` (or the existing move test)

**Interfaces:**
- Consumes: Tabletop's `CutsceneSource`, `GmCutscene` and `BoardCutscene` (Task 5), as copied here.
- Messages (`protocol.ts`, `v: 1`):
  - GM → every admitted player: `{ type: 'cutscene'; cutscene: BoardCutscene | null }`
  - Player → GM: `{ type: 'cutscene-ready'; on: boolean }`. A client that can draw cutscenes asks for the revealed scene; it is added to `PLAYER_MESSAGE_TYPES`.
  - GM → ready players: `{ type: 'cutscene-scene'; runId: string; key: string; scene: PlayerScene }`
  - GM → ready players: `{ type: 'cutscene-extras'; runId: string; key: string; seq: number; part: number; parts: number; extras: BoardExtras }`, cut by `boardParts`
  - GM → ready players: `{ type: 'cutscene-camera'; runId: string; eye: Vec3; target: Vec3 }`, live only, at most every `CAMERA_INTERVAL_MS` (100 ms), with the last move always sent
- `projectCutscene(snapshot: SceneSnapshot, options: SceneProjectionOptions, look: BoardLook | null, sceneId: string, memo: ProjectionMemo): { scene: PlayerScene; extras: BoardExtras }`:
  - `projectForPlayers` with `coverage: FogCoverage.EMPTY`, `lighting: OPEN_FRAME`, `rules: { ...rules, curtain: false }` and `...sceneContext(snapshot, options)`; then `fog: {}`
  - `projectBoard` with a `Shows` that shows everything
  - GM-hidden tokens stay out, and closed secret doors stay plain wall (as `projectForPlayers`/`projectBoard` do)
  - when the scene's JSON would pass `MAX_CONTROL_MESSAGE_BYTES − 8 KiB`, drawings are dropped, then texts
- `class CutsceneSender implements SessionHandler`, with options `{ session, tabs: TabScenes | null, board: BoardSource | null, sceneOptions, assets }`:
  - On a source change: sends `cutscene` to every admitted player (null when it ends).
  - For the ready players: finds the GM tab whose `mapPath` is `maps[key]` and is live (`tabs.liveSnapshot`), and watches it while the run lasts. It sends `cutscene-scene` and `cutscene-extras` when the projection's JSON changes, at most every 200 ms. A key whose tab is not live yet waits for `subscribeLive`.
  - `onAdmitted`: sends the running `cutscene`. On `cutscene-ready` (on) or `scene-resync`: sends the current scene, extras and camera.
  - `onGone`: forgets the player.
  - `running(): boolean`, for the move and template guards.
  - On the end: `cutscene: null` to all, and its watchers stop.

- [ ] **Step 1: Write the failing tests** (vitest, in the style of `boardSender.test.ts` and `boardProtocol.test.ts`):

`cutsceneProtocol.test.ts`:
- each message round-trips `decodeControl(encodeControl(m))`
- a `cutscene` with 201 shots, with the key `k/1` (keys match `^k[0-9]{1,4}$`), or with `at: -1` decodes as `invalid`
- a live `cutscene` with `shots: []` is accepted, and a prepared one with no shots is not (the same rules as Tabletop's `readBoardCutscene`)
- `new BoardSessionHub({ …, cutscenes: false }).cutscenes === undefined`
- `cutscene-ready` from a player is accepted (`PLAYER_MESSAGE_TYPES`)
- a `cutscene` from a player is dropped

`projectCutscene.test.ts`, on the fixtures of `projectForPlayers.test.ts`:
- a token under the GM's fog is in `scene.tokens`, and `scene.fog` deep-equals `{}`
- on a lit scene with a closed lighting frame, tokens are still sent
- a GM-hidden token is not sent
- a wall in a fogged room is in `extras.walls`
- a scene with 5000 drawings fits under the cap, with `drawings` empty

`cutsceneSender.test.ts`, with a fake source, tabs and session:
- a source change sends `cutscene` to both admitted players
- only the player who sent `cutscene-ready` gets `cutscene-scene` and `cutscene-extras`
- **`admitted mid-run gets the cutscene, scene and extras`:** a player admitted during the run gets `cutscene` on admission, and scene + extras after `cutscene-ready`
- live: 10 camera changes within 100 ms send 1, and the last one after the cooldown
- the source going null sends `cutscene: null` to everyone and stops watching the tab
- no sent message contains `.atlasmap`

The move guard test: `token-move` during a run gets `token-move-refused`, and after the end it is accepted.

- [ ] **Step 2: Run, see them fail**

Run: `npx vitest run tests/unit/online/cutscene tests/unit/online/projectCutscene.test.ts`

- [ ] **Step 3: Implement**, as listed under Files.

- [ ] **Step 4: Run them and make sure they pass**

Run: `npx vitest run tests/unit/online`, `npx tsc --noEmit`, and `npm run lint`.
Expected: all pass; lint has no warnings.

- [ ] **Step 5: Commit** (Connect repo)

`git add src tests && git commit -m "feat(online): carry Tabletop cutscenes to players with a revealed projection bounded to the run"`

---

### Task 8 (Connect repo): Player side: session, tab views, web page, AR, vendored board

**Files:**
- Modify:
  - `src/app/online/PlayerSession.ts`:
    - the options `onCutscene`, `onCutsceneScene`, `onCutsceneExtras` (whole once every part of one seq arrives) and `onCutsceneCamera`
    - `sendCutsceneReady(on: boolean): boolean`
    - `onCutscene(null)` on a disconnect, a `bye`, or leaving
  - `src/app/online/obsidian/playerBoardContract.ts`: the Task 6 handle members (`cutscenes?`, `setCutscene?` with its options, `setCutsceneScene?`, `setCutsceneCamera?`) and `PlayerBoardHost.cutsceneOver?`
  - `src/app/online/obsidian/BoardSceneView.ts`: passes them through; `get playsCutscenes(): boolean`
  - `src/app/online/obsidian/CanvasScene.ts`, `joinFlow.ts`, `onlineJoinTypes.ts`:
    - A player already on the board: the board is handed `setCutscene(c)` and does everything.
    - A player on the 2D map, at the start:
      - a black overlay of the scene root fades in over `fadeMs`
      - the 2D `MapView` is hidden, not disposed, so its pan and zoom stay as they were
      - a board is made beside it and given `setCutscene(c, { startBlack: true, handBack: true })` before its first `setScene`
    - A 2D player, at the end: the board fades to black and calls `host.cutsceneOver()`. Connect then disposes the board, shows the kept `MapView` under the black overlay, and fades the overlay out.
    - `chooseView` changes nothing during a run (the 2D/3D button is hidden).
    - the toolbar, the sheets drawer and the dice tray are hidden during the run (the board's Roll dice stays)
    - `cutscene-ready` is sent while the shown view `playsCutscenes`
  - `online-client/sceneSwitch.mts` and `online-client/main.mts`, the web page:
    - the same 2D hand-back flow, loading the board chunk if needed
    - marker AR keeps running under the locked board, and resumes by itself after the run (Task 3)
    - room AR (WebXR): its session is stopped (`stopRoomAr`) when the run starts, because it cannot draw a driven camera. WebXR cannot restart without a user gesture, so after the run a "Back to AR" button restarts it with the kept placement (`placeRoomAr`).
  - `vendor/tabletop/*`: rebuilt from Tabletop's `node scripts/build-web.mjs` at the Task 6 commit; `SOURCE.json` names that commit
- Test: `tests/unit/online/playerSessionCutscene.test.ts`, `tests/unit/online/canvasSceneView.test.ts` (cutscene cases), `tests/unit/online/obsidian/playerBoard.test.ts`, and `npm run check:vendor`

**Interfaces:**
- Consumes: Task 7's messages and Task 6's handle members.
- A client that cannot draw cutscenes (no factory, no WebGL, the board failed to start, or a Tabletop without `cutscenes`):
  - shows a black curtain over its view, reading "The GM is showing a scene."
  - its tools are locked
  - it never sends `cutscene-ready`, so it is never sent the reveal

- [ ] **Step 1: Write the failing tests**

`playerSessionCutscene.test.ts`:
- `cutscene` reaches `onCutscene`
- extras in 3 parts reach `onCutsceneExtras` once, whole
- **`disconnect ends the cutscene`:** the link closing calls `onCutscene(null)`, and so does a `bye`

`canvasSceneView.test.ts`:
- a 2D player with a factory gets a board on `cutscene`, made with `{ startBlack: true, handBack: true }`, and `sendCutsceneReady(true)` is sent
- the 2D `MapView` is the same instance after the run, and its pan and zoom deep-equal the player's own from before the run (not the GM's camera)
- the board is disposed only after `cutsceneOver`; until then the black overlay stays
- without a factory, the curtain shows and no `cutscene-ready` is sent
- the toolbar is hidden during the run and shown after

`playerBoard.test.ts` (the contract checker): a handle with `cutscenes: true` and the three methods passes, and one with `cutscenes: true` but no `setCutscene` is treated as not playing cutscenes.

- [ ] **Step 2: Run, see them fail**

Run: `npx vitest run tests/unit/online/playerSessionCutscene.test.ts tests/unit/online/canvasSceneView.test.ts`

- [ ] **Step 3: Implement.** Then rebuild the vendored board: in Tabletop `node scripts/build-web.mjs`, copy its output into `vendor/tabletop/` as `vendor/tabletop/README.md` says, and update `SOURCE.json`.

- [ ] **Step 4: Run them and make sure they pass**

Run:
- `npx vitest run`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run check:vendor`
- `npm run build`
- `npm run build:page`

- [ ] **Step 5: Commit** (Connect repo)

`git add src online-client vendor tests && git commit -m "feat(online): players switch onto the 3D board for cutscenes and come back to their own view"`

---

### Task 9: Live check in the promo setup, and the README

**Files:**
- Modify: `README.md`, a "Cutscenes" section covering:
  - building: the gallery, the timeline clicks, keyframes, transitions and the free-camera keys
  - preview, Play for players and the live toggle
  - the cinematic settings
  - what players see: everything the shots show, for the run only
  - that it needs Connect with cutscenes

- [ ] **Step 1:** Build both plugins and deploy them:
  - `npm run build` here and `npm run build` in Connect
  - copy `main.js`, `styles.css` and `manifest.json` of each into `C:\Users\joaoo\tabletop-promo-vault\.obsidian\plugins\…` and the two player vaults
  - restart the three Obsidians: `node C:\Users\joaoo\tabletop-promo-session\real\launch.cjs gm 9301`, `player 9302 …` and `kestrel 9303 …`, then `node session.cjs`
- [ ] **Step 2:** Over CDP, on the GM:
  - author a cutscene across two maps with a fade, a cut, a move and a chain of two keyframe shots
  - preview it
  - play it for players

  Check on each player, by reading the board over CDP:
  - the fade in
  - the bars
  - locked input (a drag and a wheel change nothing)
  - the cross-map shot
  - the reveal of a fogged token
  - Roll dice reaching the GM's log
  - End restoring each player's own pose (compare `board.camera.pose` before and after)

  Put one player on Connect's 2D view first: they are switched to 3D and back to 2D, with their own 2D pan and zoom. With the GM's local players' window open: it plays the run, shows the reveal, follows the cross-map shot with no "waiting" screen, and is back on its own map afterwards. While the GM authors and previews, it holds its last picture.
- [ ] **Step 3:**
  - Run a live cutscene: players follow smoothly (record a CDP screencast of a player and look for steps).
  - Kill and restart one player's Obsidian mid-run: it rejoins at the current shot.
  - Close the GM's board mid-run: every player is back on their own camera.
- [ ] **Step 4:** Fix what is wrong, then rerun `npm test`, `npm run test:ui:all`, and in Connect `npx vitest run`.
- [ ] **Step 5: Commit** `docs: cutscenes in the README; checked live`
