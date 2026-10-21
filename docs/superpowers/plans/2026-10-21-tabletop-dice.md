# Tabletop Dice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physical dice on Tabletop's 3D board (GM and Connect player), landing at the camera's centre, with Interactive Dice's dice and packs, caught dice giving no number, thrown explosions, and a dice log and stat sheet on the GM's board.

**Architecture:** Interactive Dice's renderer-free pieces (die geometry, UVs, physics shapes, face reading, pack files) move into a `kit/` folder of plain modules that Interactive Dice uses and Tabletop vendors by copy (a sync script with a hash check, like Connect's `vendor/atlas`). Tabletop adds `src/dice/`: pure roll rules and a roll state machine, a `DiceTable` that owns a cannon-es world and a three.js group on the board, a picker, and a link to Atlas's stock event bus. Connect gains a `dice-result` message so a player's physical roll reaches the GM's Atlas log.

**Tech Stack:** TypeScript; Tabletop: three 0.185, cannon-es 0.20.0, esbuild, node:test (`npm test` = `node tests/run.mjs`). Interactive Dice: three 0.156, cannon-es 0.20.0, esbuild (no tests yet; Task 1 adds the same node:test runner). Connect: vitest, tsc, eslint (`--max-warnings 0`).

**Spec:** `docs/superpowers/specs/2026-10-21-tabletop-dice-design.md` (Tabletop repo)

**Repos and branches:**
- Interactive Dice: `C:\Users\joaoo\2075\.obsidian\plugins\atlas-physical-dice` (the deployed folder is the repo), new branch `feat/dice-kit` from `main`.
- Tabletop: `C:\Users\joaoo\2075\atlas-vtt-tabletop`, new branch `feat/tabletop-dice` from `feat/connect-3d`.
- Connect: worktree `C:\Users\joaoo\2075\atlas-vtt-connect-tabletop-wt`, new branch `feat/physical-dice` from `origin/main`.

## Global Constraints

- Tabletop must not require Interactive Dice, nor Interactive Dice Tabletop; Connect works with neither.
- Never invent a number: a caught or unreadable die never yields a value (no random fallback anywhere).
- No dice animation goes over the wire; only the thrower sees the tumble. GM throws never show on Tabletop's player window.
- Shared packs folder: `<app.vault.configDir>/atlas-dice-packs/`; pack format unchanged (`dice/README.md`).
- Tabletop uses its own three 0.185 only; no second three.js bundled.
- Physics and extra frames run only while dice move.
- No Atlas (AGPL) code or images copied into Tabletop or Interactive Dice (both MIT). Behaviour is written from Atlas's API types (`vendor/atlas/api-types/atlas-vtt-api.d.ts` in Connect), not its bundle.
- Vanilla Atlas only (no extension API required; `ext.dice.publish` used only if present).
- Stock rolls carry `min: 1` on every die so stock Atlas shows a result card and does not throw its own 3D dice.
- Connect wire protocol v1: new fields optional, older peers keep working.
- Dice limits: at most 20 dice per roll (as `dice-roll`), 2 rolls per second per player (existing `RateLimit`).
- No merge or push without asking the user. Deploy = copy builds into the 3 vaults (`2075`, `atlas-player-vault`, `atlas-stock-test-vault`).

## Review Focus

1. A die that settles leaning on another die is caught; rerolling it must leave every other die where it lies and its value kept (Task 6 test `reroll keeps settled dice`).
2. The scene or map changes, or the board closes, mid-roll: dice are cleared and no result is sent or logged (Task 8 test `scene change drops the roll`).
3. A player whose GM runs an older Connect: the GM has not offered `diceResults`, so the tray falls back to `dice-roll` and no roll is lost (Task 17 test `old GM gets dice-roll`).
4. A hostile `dice-result`: 0 dice, 21 dice, a value of 0 or above the die's faces, a d100 value of 0, NaN, an unknown die, a non-integer: refused, nothing logged (Task 15 validator tests).
5. A camera aimed far off the map or nearly level: the tray still centres on `camera.pose.target` at y=0 and its size is clamped, so dice land on screen (Task 7 test `tray at an off-map target`).

---

## Part A — Interactive Dice

### Task 1: Test runner and face reading in a kit

**Files:**
- Create: `tests/run.mjs` (copy of Tabletop's `tests/run.mjs`), `kit/faces.ts`, `tests/faces.test.ts`
- Modify: `package.json` (script `"test": "node tests/run.mjs"`), `tsconfig.json` (include `kit`, `tests`), `d20-dice.ts:2699-2770`

**Interfaces:**
- Produces: `kit/faces.ts`:
  - `export type DieType = 'd4' | 'd6' | 'd8' | 'd10' | 'd100' | 'd12' | 'd20'`
  - `export const DIE_TYPES: readonly DieType[]`
  - `export const DIE_FACES: Record<DieType, number>` (d100 → 100; the percentile die itself reads tens)
  - `export interface FaceReading { caught: boolean; face: number | null; confidence: number }`
  - `export function readFace(type: DieType, normals: readonly Vec3[], numbers: readonly number[], q: Quat, tolerance: number): FaceReading` — `Vec3 = {x,y,z}`, `Quat = {x,y,z,w}` plain objects (no three import, so the kit works with any three). Up is +y; the d4 reads the face pointing down. Caught when best dot < `1 − tolerance`; then `face: null`.

- [ ] **Step 1: Write the failing tests** — `tests/faces.test.ts`:
  - `identity quaternion reads the face whose normal is +y`: normals `[{0,1,0},{0,-1,0}]`, numbers `[6,1]`, d6 → `{caught:false, face:6}`.
  - `d4 reads the face pointing down`: same normals, numbers `[4,1]`, d4 → face `1`.
  - `tilted 45° about x is caught with no face`: q = 45° about x, tolerance 0.1 → `{caught:true, face:null}`.
  - `tolerance edge`: tilt with dot exactly `1 − tolerance` is not caught.
- [ ] **Step 2:** `npm test` → FAIL (module not found).
- [ ] **Step 3:** Implement `kit/faces.ts`; make `D20Dice.checkDiceResult` call `readFace` (convert its THREE normals/quaternion to plain objects).
- [ ] **Step 4:** `npm test` → PASS; `npm run build` → OK.
- [ ] **Step 5:** Commit `feat(kit): read a die's face in a plain module, with tests`.

### Task 2: Die shapes in the kit

**Files:**
- Create: `kit/dieShapes.ts`, `tests/dieShapes.test.ts`
- Modify: `d20-dice.ts` (geometry :785-2128, physics shape :2373-2437, face normals :2776-2995, :3045-3087, :3100-3275 move out; `D20Dice` calls the kit)

**Interfaces:**
- Consumes: Task 1 `DieType`, `readFace`.
- Produces: `kit/dieShapes.ts` (imports `three` and `cannon-es`; each repo resolves its own three):
  - `export interface PackLayout` = the `PackDie`/`DicePack` types now in `d20-dice.ts` (moved, re-exported from `d20-dice.ts` for existing imports).
  - `export function dieGeometry(type: DieType, size: number, pack: DicePack): THREE.BufferGeometry` (UVs applied, rim softened as the pack says)
  - `export function dieFaceNormals(type: DieType, geometry: THREE.BufferGeometry): { normals: Vec3[]; numbers: number[] }`
  - `export function diePhysicsShape(type: DieType, geometry: THREE.BufferGeometry): CANNON.ConvexPolyhedron`
  - `export function dieMaterial(type: DieType, pack: DicePack, textures: { map?: THREE.Texture; normalMap?: THREE.Texture }, color: string | null): THREE.MeshPhongMaterial`

- [ ] **Step 1: Failing tests** — `tests/dieShapes.test.ts` (node, no WebGL needed):
  - `every die type has as many face normals as faces`: d4 4, d6 6, d8 8, d10 10, d100 10, d12 12, d20 20; numbers are a permutation of the die's faces (d100: 00,10..90 → `[0,10,…,90]`).
  - `normals are unit length and outward`: |n|≈1, dot with face centroid > 0.
  - `physics shape has the geometry's vertex count after merging`: ConvexPolyhedron vertices ≤ geometry vertices, faces ≥ face count.
  - `each face read upright reads its own number`: for every face i, the quaternion turning `normals[i]` to +y (−y for d4) gives `readFace(...).face === numbers[i]`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Move the code; `D20Dice` keeps its behaviour by calling the kit.
- [ ] **Step 4:** `npm test` PASS; `npm run build` OK; the build's dice look the same in Obsidian (manual check noted in ledger; the 2075 vault is where it is deployed).
- [ ] **Step 5:** Commit `refactor(kit): die geometry, normals and physics shapes as kit functions`.

### Task 3: Caught dice give no number

**Files:**
- Create: `kit/caught.ts`, `tests/caught.test.ts`
- Modify: `d20-dice.ts` — `getTopFaceNumberForDice` (:2758) and the no-mesh branch of `checkDiceResult` (:2703) stop returning `getRandomResultForDiceType`; delete `getRandomResultForDiceType` (:2541) if unused; single-die path `completeSingleDiceRoll` (:2570) waits like the multi path; `main.ts` status line shows the caught message.

**Interfaces:**
- Produces: `kit/caught.ts`:
  - `export function caughtMessage(caught: readonly { type: DieType }[]): string | null` — null for none; one: `"d20 caught: roll it again"`; several of one type: `"2 d6 caught: roll them again"`; mixed: `"d20 and 2 d6 caught: roll them again"`.

- [ ] **Step 1: Failing tests** — `tests/caught.test.ts`: the three message forms above, and `[]` → null.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; wire: when any die is caught after settling, no `onRollComplete`, the status shows `caughtMessage`, the caught die is highlighted, a click or drag on it rerolls it (existing `rerollCaughtDice`), others stay. A die with no mesh counts as caught.
- [ ] **Step 4:** PASS; build OK; grep `getRandomResultForDiceType` → no matches.
- [ ] **Step 5:** Commit `fix: a caught die gives no number and asks to be rolled again`.

### Task 4: Shared packs folder

**Files:**
- Create: `kit/packs.ts`, `tests/packs.test.ts`
- Modify: `main.ts:50-57` (default pack written to the shared folder), `main.ts:600-668` (`resolvePackFiles`, `loadPackConfig` read the shared folder), `dice-packs-tab.ts` and the "open folder" command (shared folder), `README.md` (where packs live)

**Interfaces:**
- Produces: `kit/packs.ts` (no Obsidian import; takes an adapter-like object):
  - `export interface PackFs { exists(p: string): Promise<boolean>; list(p: string): Promise<{ files: string[]; folders: string[] }>; read(p: string): Promise<string>; readBinary(p: string): Promise<ArrayBuffer>; writeBinary(p: string, d: ArrayBuffer): Promise<void>; mkdir(p: string): Promise<void>; getResourcePath(p: string): string }`
  - `export const PACKS_FOLDER_NAME = 'atlas-dice-packs'`
  - `export function packsFolder(configDir: string): string` → `${configDir}/atlas-dice-packs`
  - `export async function listPacks(fs: PackFs, folder: string): Promise<string[]>` (sorted folder names)
  - `export async function loadPack(fs: PackFs, folder: string, pack: string): Promise<DicePack | null>`
  - `export function packFileUrls(fs: PackFs, folder: string, pack: string, config: DicePack | null, key: 'texture' | 'normal'): Partial<Record<DieType, string>>`
  - `export async function ensureDefaultPack(fs: PackFs, folder: string, files: Record<string, ArrayBuffer>): Promise<void>` — writes only missing files.
  - `export async function migratePacks(fs: PackFs, from: string, to: string): Promise<number>` — copies pack folders not already in `to`; never deletes; returns how many it copied.

- [ ] **Step 1: Failing tests** with an in-memory `PackFs`: `packsFolder('.obsidian')` → `.obsidian/atlas-dice-packs`; `migratePacks` copies `A/` and `B/` but skips existing `B/` and leaves `from` intact; `ensureDefaultPack` writes nothing when files exist; `packFileUrls` falls back to `<type>_Numbers.png` without config; `listPacks` sorted.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; plugin `onload` runs `migratePacks(<plugin dir>/dice → shared)` once (setting flag `packsMigrated: true`), then `ensureDefaultPack`.
- [ ] **Step 4:** PASS; build; deploy to the 2075 vault folder is the repo itself, so `npm run build` updates `main.js` there; check `.obsidian/atlas-dice-packs/Texture-Pack-Default/` appears after reload (ledger note: user reloads, never restart Obsidian for them).
- [ ] **Step 5:** Commit `feat: dice packs in a shared folder both dice plugins read`.

## Part B — Tabletop

### Task 5: Vendor the kit; cannon-es

**Files:**
- Create: `scripts/sync-dice-kit.mjs`, `src/dice/kit/` (copied files + `SOURCE.json` `{ "repo": "atlas-physical-dice", "commit": "<sha>", "files": { "<name>": "<sha256>" } }`), `tests/diceKit.test.ts`
- Modify: `package.json` (dependency `"cannon-es": "^0.20.0"`; script `"sync:dice": "node scripts/sync-dice-kit.mjs"`)

**Interfaces:**
- Consumes: Interactive Dice `kit/*.ts` (Tasks 1-4).
- Produces: `src/dice/kit/{faces,dieShapes,caught,packs}.ts`, same exports.

- [ ] **Step 1: Failing test** `tests/diceKit.test.ts`: every file listed in `src/dice/kit/SOURCE.json` exists and its sha256 matches; and a smoke check `dieFaceNormals('d20', dieGeometry('d20', 1, {})).normals.length === 20`.
- [ ] **Step 2:** FAIL. **Step 3:** Sync script copies `<dice repo>/kit/*.ts` (path from `DICE_REPO` env or default `../.obsidian/plugins/atlas-physical-dice`) and writes `SOURCE.json`. `npm i cannon-es@^0.20.0`.
- [ ] **Step 4:** `npm test` PASS; `npm run build` OK (tsc clean on the kit under three 0.185).
- [ ] **Step 5:** Commit `chore(dice): vendor Interactive Dice's kit; cannon-es`.

### Task 6: Roll rules and the roll's state

**Files:**
- Create: `src/dice/rollRules.ts`, `src/dice/rollSession.ts`, `tests/rollRules.test.ts`, `tests/rollSession.test.ts`

**Interfaces:**
- Produces: `src/dice/rollRules.ts` (written from Atlas's API docs for `DiceRules`, `ExplodeRule`, `CritRule`):
  - `export interface DiceRules { defaultRoll: string; crit: 'natural'|'roll-under'|'doubles'|'high-total'|'none'; explode?: { dice: 'default'|'all'; repeats: boolean; highFaces: number; lowFaces: number } }`
  - `export const DEFAULT_RULES: DiceRules = { defaultRoll: '1d20', crit: 'natural' }`
  - `export interface RollRequest { dice: Partial<Record<DieType, number>>; modifier: number; advantage?: 'advantage'|'disadvantage'; label?: string; colors?: Partial<Record<DieType, string>> }`
  - `export function parseFormula(formula: string, rules: DiceRules): RollRequest | null` — `NdS` groups plus a flat modifier; a bare `+3` uses `defaultRoll`; any die not in DIE_TYPES → null; more than 20 dice → null.
  - `export function defaultDie(rules: DiceRules): DieType | null` (the die of `defaultRoll`)
  - `export function explosion(rules: DiceRules, die: DieType, value: number, isDefault: boolean, fromExplosion: boolean): 'up' | 'down' | null`
  - `export interface RolledDie { die: DieType; value: number; max: number; exploded?: true; negative?: true; color?: string; colorName?: string; dropped?: true }`
  - `export function critOf(rules: DiceRules, rolls: readonly RolledDie[]): 'success' | 'failure' | undefined` — looks at default dice only (not dropped, not exploded).
  - `export function total(rolls: readonly RolledDie[], modifier: number): number` (negative subtract, dropped skipped)
- Produces: `src/dice/rollSession.ts`:
  - `export type DieState = { id: number; die: DieType; color?: string; status: 'rolling' | 'settled' | 'caught'; value?: number; exploded?: true; negative?: true; isDefault: boolean }`
  - `export class RollSession { constructor(request: RollRequest, rules: DiceRules); readonly dice: readonly DieState[]; settle(id: number, reading: FaceReading): void; reroll(id: number): void; pendingThrows(): { die: DieType; reason: 'caught' | 'explode-up' | 'explode-down'; color?: string }[]; prompt(): string | null; result(): { rolls: RolledDie[]; modifier: number; total: number; crit?: 'success'|'failure'; label?: string } | null; }`
  - Advantage: the request has one default die; the session adds a second, and `result()` marks the lower (advantage) or higher (disadvantage) `dropped`.
  - d100: one d100 die carries tens (0-90) + a companion d10 die (1-10, 10 reads 0); value 00+0 = 100; either caught → only that one rerolls.
  - `prompt()` uses `caughtMessage` for caught dice, else `"d6 exploded: throw another d6"` (one per pending explosion), else null.

- [ ] **Step 1: Failing tests** — `tests/rollRules.test.ts`:
  - `parseFormula('2d6+3')` → `{dice:{d6:2}, modifier:3}`; `parseFormula('+3', DEFAULT_RULES)` → `{dice:{d20:1}, modifier:3}`; `parseFormula('1d7')` → null; `parseFormula('21d6')` → null.
  - `explosion`: rules `{explode:{dice:'default',repeats:false,highFaces:1,lowFaces:1}}`, d10 default: 10 → 'up', 1 → 'down', 5 → null, non-default d6 6 → null, fromExplosion with repeats false → null.
  - `critOf`: natural d20 20 → 'success', 1 → 'failure'; roll-under d100 1 → 'success'; doubles 2d12 [7,7] → 'success'; high-total 2d10 [10,9] → 'success', [9,9] → undefined; none → undefined.
  - `total` with a negative die and a dropped die.
  `tests/rollSession.test.ts`:
  - `reroll keeps settled dice`: 3 dice, settle two, one caught → `result()` null, `prompt()` `"d20 caught: roll it again"`; `reroll(id)` then settle → result has the two original values unchanged.
  - `explosion asks for another die and adds it`: d6 all-dice explode, settle 6 → pending `[{die:'d6',reason:'explode-up'}]`, result null; a new die settles 3 → total 9, second die `exploded: true`.
  - `explode down subtracts`: lowFaces 1, settle 1 → extra die `negative: true`.
  - `advantage drops the lower d20`; `disadvantage drops the higher`.
  - `d100 pair`: tens 30 + ones 7 → 37; tens 0 + ones 0 → 100; tens caught → only tens pending.
- [ ] **Step 2:** `npm test` FAIL. **Step 3:** Implement both. **Step 4:** PASS. **Step 5:** Commit `feat(dice): roll rules and a roll's state, thrown explosions included`.

### Task 7: The dice table on the board

**Files:**
- Create: `src/dice/diceTable.ts`, `src/dice/tray.ts`, `tests/tray.test.ts`
- Modify: `src/board/board.ts` (a dice hook: group in the scene, hidden in `drawPlayers` :1846 the way player labels are hidden at :565; frames kept while `diceTable.busy`; `cameraBasis()`; `diceAt(clientX, clientY)` raycast)

**Interfaces:**
- Consumes: kit (`dieGeometry`, `dieFaceNormals`, `diePhysicsShape`, `dieMaterial`, `readFace`), Task 6 `RollSession`.
- Produces: `src/dice/tray.ts` (pure):
  - `export interface Tray { center: { x: number; z: number }; halfWidth: number; halfDepth: number; yaw: number }`
  - `export function trayAt(target: { x: number; z: number }, visibleHalfExtent: { x: number; z: number }, gridSize: number, yaw: number): Tray` — half sizes = visible extent × 0.8, clamped to `[3, 20] × gridSize`.
  - `export function dieEdgePx(gridSize: number, squares: number): number` (`squares` default 0.6)
- Produces: `src/dice/diceTable.ts`:
  - `export interface DiceTableHost { scene: THREE.Scene; gridSize(): number; target(): { x: number; z: number }; visibleHalfExtent(): { x: number; z: number }; cameraYaw(): number; wake(): void; textures(type: DieType): { map?: THREE.Texture; normalMap?: THREE.Texture }; pack(): DicePack }`
  - `export class DiceTable { constructor(host: DiceTableHost, settings: DiceSettings); get busy(): boolean; throwRoll(session: RollSession, flick: Flick): void; throwDie(dieId: number, flick: Flick): void; step(dtMs: number): void; pick(ray: THREE.Ray): number | null; clear(): void; dispose(): void; onSettled: (id: number, reading: FaceReading) => void }`
  - `export interface DiceSettings { dieSquares: number; tolerance: number; motionThreshold: number; shadows: boolean; highlight: boolean; highlightColor: string }`
  - Physics in die units (die edge = 1, gravity −60 as Interactive Dice); the group is scaled by `dieEdgePx` and placed at the tray centre; floor at y=0; four invisible walls from `Tray`.
- Board additions (`board.ts`, public): `attachDice(table: DiceTable): void`, `cameraYaw(): number`, `visibleHalfExtent(): {x,z}` (from the view frustum at the target's distance), `rayAt(clientX, clientY): THREE.Ray`.

- [ ] **Step 1: Failing tests** `tests/tray.test.ts`:
  - `tray centred on the target`: `trayAt({x:100,z:50},{x:400,z:300},50,0).center` → `{x:100,z:50}`; half sizes 320/240.
  - `tray at an off-map target`: target `{x:-9000,z:9000}`, extent `{x:5000,z:5000}`, grid 50 → center unchanged, halfWidth 1000 (clamped to 20 squares).
  - `small view clamps to 3 squares`; `dieEdgePx(70, 0.6)` → 42.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `tray.ts`, then `DiceTable` and the board hooks. Settling uses the kit's motion threshold as Interactive Dice does; a settled die calls `onSettled` with `readFace`.
- [ ] **Step 4:** `npm test` PASS; `npm run build` OK; harness check (Playwright/swiftshader, `tests/harness` as used for the board): a scripted `throwRoll` of 2d6 settles and both dice are inside the tray; the player window pass draws no dice (pixel compare of the player canvas before/after throw is unchanged).
- [ ] **Step 5:** Commit `feat(dice): a dice table on the board at the camera's centre`.

### Task 8: Throwing with the pointer, and the roll's lifetime

**Files:**
- Create: `src/dice/throwInput.ts`, `src/dice/diceController.ts`, `tests/throwInput.test.ts`, `tests/diceController.test.ts`

**Interfaces:**
- Produces: `src/dice/throwInput.ts`:
  - `export interface Flick { dx: number; dy: number; ms: number }` (screen pixels, upward negative dy)
  - `export function throwVector(flick: Flick, yaw: number): { x: number; z: number; speed: number }` — screen-up maps to the camera's ground-forward (`−sin yaw, −cos yaw` convention of `OrbitCamera`; match `camera.ts`), screen-right to ground-right; speed from px/ms clamped to [0.2, 3] (a click without movement = a gentle 0.2 toss).
- Produces: `src/dice/diceController.ts` (no three; drives table + session):
  - `export class DiceController { constructor(deps: { table: Pick<DiceTable,'throwRoll'|'throwDie'|'clear'|'busy'> & { onSettled: DiceTable['onSettled'] }; rules: () => DiceRules; publish: (result: NonNullable<ReturnType<RollSession['result']>>) => void; prompt: (text: string | null) => void }); start(request: RollRequest, flick: Flick): void; throwPending(flick: Flick): void; clickDie(id: number, flick: Flick): void; sceneChanged(): void; dispose(): void }`
  - On every settle: if `session.result()` → `publish` once, `prompt(null)`; else `prompt(session.prompt())`. `throwPending` throws every pending die (caught rerolls and explosions). `sceneChanged`/`dispose` clear the table and drop the session without publishing.

- [ ] **Step 1: Failing tests**:
  - `throwInput`: yaw 0, flick up `{dx:0,dy:-200,ms:100}` → `{x≈0, z<0}` (away from viewer per `camera.ts` convention — the test asserts against `OrbitCamera`'s forward for yaw 0); yaw π/2 rotates it; zero flick → speed 0.2.
  - `diceController`, with a fake table: `publishes once when every die settles`; `caught die prompts and publishes after reroll`; `scene change drops the roll` (settle after `sceneChanged` → no publish); `explosion prompt then publish with the extra die`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(dice): throwing from a flick and a roll's lifetime`.

### Task 9: Atlas link: rules for the map, and publishing rolls

**Files:**
- Create: `src/dice/atlasDice.ts`, `tests/atlasDice.test.ts`

**Interfaces:**
- Produces:
  - `export interface MapViewLike { getViewType(): string; file?: { path: string } | null; serviceManager?: unknown; atlasStore?: unknown }`
  - `export function rollViewFor(views: readonly MapViewLike[], recent: MapViewLike | null, mapPath: string): MapViewLike | null` — the view whose `file.path === mapPath` (not a `remoteView`); else `recent` if a map view; else the first map view; else null.
  - `export function diceRulesOf(view: MapViewLike | null): DiceRules` — reads the collection's dice rules where stock Atlas 0.9 keeps them for the view's map (the collection settings `dice` and `diceSetId` → the dice set's `crit`/`explode`; find the exact path in the live Atlas object in the 2075 vault — record it in the ledger as a Ruling); checked field by field; `DEFAULT_RULES` otherwise.
  - `export function stockRoll(result, rolledBy?: string): object` — Atlas's stock roll: `{id: 'tabletop_<time>_<rand>', timestamp, formula, rolls: [{die, value, max, min: 1, exploded?, negative?, colour?, name?}], modifiers, total, crit?, player: 'Tabletop for Atlas VTT', source: {type:'toolbar'} | {type:'statblock', abilityName, tokenId}, rolledBy?}`
  - `export function publishRoll(view: MapViewLike | null, roll: object): boolean` — `ext.dice.publish(roll,{throw:false})` when Atlas's extension API exists, else the view bus `emit('dice-rolled', roll)`; false with no route.
  - `export function onRolled(view: MapViewLike, listener: (roll: unknown) => void): () => void` — subscribes to the view bus `dice-rolled`.
- [ ] **Step 1: Failing tests**: `rollViewFor` picks the matching path over `recent`; skips a remote view; falls back to recent, then first, then null. `stockRoll` puts `min:1` on every die and maps `color`→`colour`, `colorName`→`name`. `diceRulesOf` on a fake view with `{dice:{defaultRoll:'1d10',crit:'natural',explode:{dice:'default',repeats:false,highFaces:1,lowFaces:1}}}` returns it; garbage → `DEFAULT_RULES`. `publishRoll` emits once on the fake bus.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(dice): rules from Atlas's collection and rolls into Atlas's log`.

### Task 10: The GM's picker, toolbar button and settings

**Files:**
- Create: `src/dice/dicePicker.ts`, `src/dice/diceSettings.ts`, `tests/dicePicker.test.ts`
- Modify: `src/board/toolbar.ts` (a Dice button in the end slot, icon `dices`, aria-label "Dice"), `src/board/BoardView.ts` (creates `DiceTable`, `DiceController`, `DicePicker`; `sceneChanged` on scene switch/close), `main.ts` (settings defaults, packs folder, default pack via `ensureDefaultPack`), the settings tab (a "Dice" section)

**Interfaces:**
- Produces: `src/dice/diceSettings.ts`: `export interface TabletopDiceSettings extends DiceSettings { pack: string; colors: { name: string; color: string }[] }`, `export const DEFAULT_DICE_SETTINGS` (`dieSquares 0.6, tolerance 0.1, motionThreshold 1, shadows true, highlight true, highlightColor '#ffd54a', pack 'Texture-Pack-Default'`).
- Produces: `src/dice/dicePicker.ts`: `export class DicePicker { constructor(parent: HTMLElement, opts: { onRoll(request: RollRequest, flick: Flick): void; onClear(): void; colors: () => {name: string; color: string}[] }); open(): void; close(): void; get isOpen(): boolean; request(): RollRequest; dispose(): void }` — a count per die type (+/−), a modifier (+/−), right-click a die for its colour, Roll (gentle toss) and drag-out-to-throw (flick from pointer), Clear. Styled with Atlas's menu classes inside `atlas-vtt-plugin`.
- [ ] **Step 1: Failing tests** (jsdom-free: test `request()` through a minimal DOM shim already used by Tabletop tests, else extract `pickerState` reducer and test it): `counts add and cap at 20 in total`; `modifier steps by 1 within −99..99`; `Roll with nothing picked rolls the default die` (`defaultDie(rules)`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement and wire: Roll → `controller.start(picker.request(), flick)` with the GM's map's rules; publish → `publishRoll(rollViewFor(..., mapPath), stockRoll(result))`; the prompt shows as a toast-style line over the board; clicking a caught/pending die throws it.
- [ ] **Step 4:** `npm test` PASS; build; harness: click Dice, set 2d6, Roll → two dice settle, the fake Atlas bus gets one `dice-rolled` with two dice and `min:1`.
- [ ] **Step 5:** Commit `feat(dice): the GM's dice picker on the board`.

### Task 11: The GM's dice log and toast

**Files:**
- Create: `src/board/diceLog.ts`, `tests/diceLog.test.ts`
- Modify: `src/board/BoardView.ts` (log button in the end slot, panel, toast), styles

**Interfaces:**
- Produces: `export interface LogEntry { id: string; who: string; label?: string; formula: string; dice: { die: string; value: number; dropped?: boolean; colour?: string }[]; total: number; crit?: 'success'|'failure'; time: number }`; `export function logEntryOf(roll: unknown): LogEntry | null` (reads a stock `dice-rolled` roll, checked); `export class DiceLogPanel { constructor(parent: HTMLElement); add(entry: LogEntry): void; toggle(): void; dispose(): void }` — newest first, at most 50, a toast for 4 s on each new roll. Its own markup matching Connect's player log look; no code copied from Atlas.
- [ ] **Step 1: Failing tests**: `logEntryOf` reads who (`rolledBy` or "GM"), the ability label, dice, total, crit; returns null for garbage; panel keeps 50 newest.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; subscribe with `onRolled(rollViewFor(..., mapPath))`, resubscribe on map change. **Step 4:** PASS; harness: a published roll appears in the panel and as a toast. **Step 5:** Commit `feat(board): the GM's dice log and toast`.

### Task 12: The GM's stat sheet drawer, with physical sheet rolls

**Files:**
- Create: `src/sheets/statblock.ts`, `src/sheets/sheet.ts`, `src/sheets/sheetDrawer.ts`, `tests/sheet.test.ts`
- Modify: `src/board/BoardView.ts` (sheet button, drawer follows `board.selected` :1893)

**Interfaces:**
- Ruling recorded up front: the user owns Connect and Tabletop; Connect's own sheet code (`src/app/online/tools/sheets.ts` `buildSheet`, `sheetRollFormula`, `sheetRollLabel`; `src/connect/statblockSource.ts`; `online-client/sheetView.mts`) is ported into Tabletop under MIT. Nothing derived from Atlas's bundle is ported; check each ported file's header for "as Atlas …" wording and keep only the reading of documented data shapes.
- Produces: `src/sheets/sheet.ts`: `buildSheet(creature: unknown, fallbackName?: string | null): PlayerSheet | null`, `sheetRollFormula(sheet, ref): string | null`, `sheetRollLabel(sheet, ref): string` (same contracts as Connect's). `src/sheets/statblock.ts`: `statblockOf(app: App, token: { statblockPath?: string; statblockName?: string }): Promise<unknown | null>`. `src/sheets/sheetDrawer.ts`: `class SheetDrawer { constructor(parent, opts: { onRoll(formula: string, label: string, advantage?: 'advantage'|'disadvantage'): void }); show(sheet: PlayerSheet | null): void; toggle(): void; dispose(): void }`.
- [ ] **Step 1: Failing tests** (port Connect's sheet tests for these functions — `tests/unit/online/sheets*.test.ts` — to node:test): a 5e-style creature builds abilities and actions; `sheetRollFormula` for an attack → `1d20+5`; an unknown ref → null.
- [ ] **Step 2:** FAIL. **Step 3:** Port; drawer roll → `parseFormula` → `controller.start({...request, label, advantage}, gentle flick)`; published with `source: {type:'statblock', abilityName: label, tokenId}`.
- [ ] **Step 4:** PASS; harness: select a token with a statblock, open the drawer, click an ability → dice thrown, the log names the ability. **Step 5:** Commit `feat(board): the selected token's sheet, rolled with physical dice`.

### Task 13: Dice on the player board (Tabletop side of Connect's contract)

**Files:**
- Modify: `src/connectContract.ts`, `src/playerBoard.ts`, `tests/playerBoard*.test.ts` (or a new `tests/playerDice.test.ts`)

**Interfaces:**
- Produces (optional members, contract stays `version: 1`):
  - `PlayerBoardHost.sendDiceResult?(result: { rolls: RolledDie[]; modifier: number; label?: string; sheet?: { tokenId: string; roll: unknown } }): boolean`
  - `PlayerBoardHost.diceRules?(): DiceRules | null` (from the GM's offer)
  - `PlayerBoardHandle.throwDice?(request: RollRequest & { sheet?: { tokenId: string; roll: unknown } }): boolean` — false when dice are unavailable (no `sendDiceResult`).
  - `PlayerBoardHandle.diceAvailable?: true`
  - The player board gets its own `DiceTable` + `DiceController` (player's own packs from the shared folder and Tabletop's dice settings); `publish` → `host.sendDiceResult`.
- [ ] **Step 1: Failing test** `playerDice.test.ts` with a fake host: `throwDice` without `sendDiceResult` → false; with it, a scripted settle (fake table) sends one result with the rules from `diceRules()` applied (an exploding d10 asks for another die before sending).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; build; deploy Tabletop (`npm run deploy`) to the 3 vaults. **Step 5:** Commit `feat(player-board): physical dice for a Connect player`.

## Part C — Connect

### Task 14: The `dice-result` message and the offer

**Files:**
- Modify: `src/app/online/protocol.ts` (message, validator, `PLAYER_MESSAGE_TYPES`), `src/app/online/tools/toolMessages.ts` (`PhysicalRoll` type), `src/app/online/obsidian/playerBoardContract.ts` (the optional members of Task 13, kept identical to Tabletop's copy)
- Test: `tests/unit/online/protocol.test.ts`

**Interfaces:**
- Produces:
  - `| { v: 1; type: 'dice-result'; rolls: PhysicalDie[]; modifier: number; label?: string; sheet?: { tokenId: string; roll: SheetRollRef } }`
  - `PhysicalDie = { die: 'd4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d100'; value: number; exploded?: true; negative?: true; dropped?: true; color?: string; colorName?: string }`
  - `board-offer` gains `diceResults?: true` and `diceRules?: DiceRules` (the rules of the player's scene's map).
- [ ] **Step 1: Failing tests**: valid 2d6 accepted; refused: 0 dice, 21 dice, value 0, d6 value 7, d100 value 101, NaN, 2.5, unknown die `d3`, modifier outside −999..999, label > 120 chars, `color` not `#rrggbb`; `board-offer` with and without the new fields.
- [ ] **Step 2:** `npx vitest run tests/unit/online/protocol.test.ts` FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(online): dice-result message, and the GM offers dice results with its rules`.

### Task 15: The GM takes a player's physical roll

**Files:**
- Modify: `src/app/online/tools/DiceHost.ts` (handle `dice-result`), `src/connect/stockRules.ts` + `src/connect/stockAtlas.ts:230` (read the collection's dice rules instead of the frozen defaults — same path as Tabletop's Task 9 ruling), the board-offer sender (add `diceResults: true` and `diceRules`)
- Create: `src/app/online/tools/physicalRolls.ts`, `tests/unit/online/physicalRolls.test.ts`

**Interfaces:**
- Produces: `physicalRolls.ts`: `critOf(rules, rolls)` and `totalOf(rolls, modifier)` with the same contracts as Tabletop's Task 6 (Connect's own copy); `export function physicalRollResult(message, rules, rolledBy: string, ability?: string): DiceRollResult` — `max` from the die, `min: 1` via the stock publish, crit recomputed by the GM (the player's is ignored), formula built from the dice.
- DiceHost: `dice-result` → rate limit → `physicalRollResult` → `feed.publish(result)` → the existing `rolled()` path logs it for everyone with `mine` for the roller; a `sheet` names the ability from the GM's own copy of the sheet (`sheetRollLabel`), never the player's label.
- [ ] **Step 1: Failing tests**: a 2d6 result publishes once with `rolledBy` the player and total right; the GM recomputes crit (player sends none, d20 20 natural → success); 3 results in one second → 2 published; a sheet result takes the GM's ability label; stock rules read the collection's `explode` from a fake view.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS + full `npx vitest run`. **Step 5:** Commit `feat(online): a player's physical roll joins Atlas's log`.

### Task 16: The player throws on the 3D board

**Files:**
- Modify: `src/app/online/obsidian/BoardSceneView.ts` (host `sendDiceResult`, `diceRules`; `throwDice` passthrough), `src/app/online/obsidian/CanvasScene.ts` (tray Roll and sheet roll → `view.throwDice` when the view is 3D, the GM offered `diceResults`, and the board has dice; else today's path), `src/app/online/obsidian/OnlineJoinService.ts` + `PlayerSession.ts` (`sendDiceResult`, keep the offer's `diceResults`/`diceRules`), `obsidian/onlineDice.ts` (the player's own physical roll is not animated again by Atlas's dice on the player side)
- Test: `tests/unit/online/boardSceneView.test.ts`, `tests/unit/online/canvasSceneView.test.ts`

**Interfaces:**
- Consumes: Task 13 handle/host members, Task 14 message.
- [ ] **Step 1: Failing tests**:
  - `3D tray roll throws on the board`: fake board with `throwDice` → Roll calls it with `{dice:{d20:1}, modifier:2}`, no `dice-roll` sent; its `sendDiceResult` sends one `dice-result`.
  - `old GM gets dice-roll`: offer without `diceResults` → Roll sends `dice-roll`, `throwDice` not called.
  - `2D view keeps dice-roll`.
  - `sheet roll in 3D throws the sheet's dice` with `sheet` ref attached.
  - `own physical roll is logged but not re-thrown` (the dice-log entry with `mine` shows as a card, no 3D replay).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `npx tsc --noEmit`, `npm run lint`, `npx vitest run` all green; `npm run build`; copy `dist/main.js`, `dist/styles.css`, `manifest.json` to the 3 vaults' `connect-for-atlas`. **Step 5:** Commit `feat(online): players throw physical dice on the 3D board`.

### Task 17: End to end

**Files:**
- Test: `tests/unit/online/obsidian/obsidianPlayerEndToEnd.test.ts` (Connect) — new case.

- [ ] **Step 1: Failing test** `a player's physical roll reaches the GM's log`: GM with a fake Atlas (feed + rules with exploding d10), player with a fake Tabletop board that settles scripted values; the player's 1d10 lands 10 → board asks for another die → 4 → GM logs total 14 with the second die `exploded`, the player's log shows it `mine`. Also `old GM gets dice-roll` end to end.
- [ ] **Step 2:** FAIL until wiring is complete; **Step 3:** fix gaps; **Step 4:** full suites green in all three repos; **Step 5:** Commit `test(online): physical dice end to end`.
