# Atlas fusion Phase 4C: stacks to Atlas levels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, the user's choice). Steps use checkbox (`- [ ]`) syntax.

**Goal:** A scene stack of older Tabletop (maps stacked on a base map, kept in Tabletop's data) becomes Atlas levels of its base scene, once, when the GM says so; cutscene shots can name a level; then the stack UI and protocol go.

**Architecture:** A pure planner (`src/board/stackMove.ts`) turns the base scene's state and each member's (as Atlas holds it) into one level scene; the writer hands it to Atlas's own `applyLevelScene` and lets Atlas's `alignLevel` move each member's records with its image, outside the undo history. A plugin-level `StackMigration` orders the commit (backup, journal, write, file confirmed, Tabletop's data, stack record cleared) and asks first. Shots gain `level`; the run's keys for Connect are per map and level.

**Tech stack:** TypeScript, node:test (Tabletop), vitest (Connect), Obsidian API, Atlas 0.15 store actions.

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md` (section 6 migration 3, section 7 cutscenes, section 8 Phase 4). Program: `2026-11-14-atlas-fusion-phase4-program.md`. Probes: `.superpowers/sdd/2026-11-13-atlas-fusion/phase4c-probe.json`, `phase4c-probe2.json`.

## Global Constraints

- Never push, never merge, never touch a real vault: live work only in `C:\Users\joaoo\fusion-gate-vault`; a live script that presses Move refuses any other vault.
- Atlas is the source of truth: every write of a scene goes through Atlas's store on a map Atlas holds; a migration never writes a map file.
- A backup is written first (`Tabletop backups/<date>/`): the base's and every member's `.atlasmap`, Tabletop's data for them, and their minis (`assignments`).
- The move asks first, and asks again at each start until the GM says Move.
- Extras ride in `tabletop: { v: 1, … }`; junk is ignored, never thrown on.
- Commit trailer `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Versions at close: Tabletop 1.8.0, Connect 0.14.0; `FUSION_PROTOCOL` stays 4 (the program bumps it once for Phase 4).

## What the probes settled (facts, not choices)

- `applyLevelScene({ levels, background, objects, exploredMask, exploredMasks, levelAlignments, grid })` replaces the scene's levels and objects in one write; `alignLevel(levelId, alignment, move)` then moves every record that is only on that level through `move` (tokens, pins, walls, lights, measures, liquids, map features: all seen moved; the base's records stay). Both run inside `temporal.untracked` and add no undo step.
- Atlas saves it as a version 5 file about 1.3 s later, and at once when the map is left; it reads back the same (levels, alignment, explored masks of other levels).
- "Below" is the order of `levels` (`levelsBelow`): a member under the base must come first in the array, and then it is the scene's first level: the scene's `background` is its image and the base's records must name their level (as Atlas's `withLevelsReordered` does). Probed: works, reads back.
- An alignment survives a reload only with `offset` ≥ 0 and no turn past 5 degrees: a quarter turn and a negative offset are kept in the store and the file but read back as none / 0.
- Atlas's state has no image size. Level tag fields (Atlas's `objectsAfterLevelEdit`): `level` on tokens, fog, pins, texts, drawings, mapFeatures, liquids, measures; `levels` on walls, lights, audios, lightZones. Ids that name other records: `measure.follows`, `measure.origin.tokenIds`, `wall.chainId`.
- Making the host hold a member (no board of it) rewrites the member's file (Atlas or a plugin's upkeep): see D3.

## Decisions

- **D1 The ask.** At start, while any stack is in Tabletop's data: one notice, "Tabletop: N scene stacks from before can become Atlas levels. Until then they are not drawn stacked." with **Review and move** and **Later**. Review opens a modal that lists, per stack, its levels to be (name, height), what will not be kept, and what is skipped; **Move** and **Later**. Also a command, "Move scene stacks to Atlas levels".
- **D2 Sources.** Each member is read as Atlas holds it (`host.follow(member)`, then a deep copy of its state): Atlas's loader is what makes a file of any age into records of today. Then the base is held and written.
- **D3 Member files.** They stay as scenes of their own and the move itself writes nothing to them; holding one in Atlas may re-save it in Atlas's current format (as opening it does). The backup is written before any member is held. *Ruling to ledger; cost: a member's file changes on disk though the spec says untouched.*
- **D4 What is not moved onto members' records first.** A member's 3D settings still in Tabletop's data and its old water mask are folded into the copies in memory (`planExtrasMove`, `legacyWaterLiquids` with the image's size from an injected `imageSize`); where the size cannot be had the mask stays in the member's data and is listed.
- **D5 The write.** Planned at the write on `getState()`, with no `await` between reading and writing; one `applyLevelScene`, an `alignLevel` per fitted member, `setViewedLevel(base's level)`, all in one `untracked`; on a throw the fields are put back as they were; Atlas's history for the map is cleared once (as 4A, 4B).
- **D6 The frame.** A member's pixels go to the base's by `p' = k·p + o`: `k = base cell / member cell`, `o = base grid offset − k · member grid offset + its placement's shift`. Its turn is not kept (Atlas turns no level): the level lies unturned about its image's middle where the size is known (else about its corner), listed. A negative `o` is raised by whole squares until it is not (the grids stay lined up), listed. `move` is derived from the alignment actually written. A member needs no alignment (a frame level) only when `k = 1`, `o = 0` and its `mapStretch` equals the base's.
- **D7 Levels.** Sorted by height (ties by path), the base at 0; `bottom = elevation × base unitDistance`; `top = min(next bottom, bottom + 10)`, the last `bottom + 10`. Names are the files' base names. Ids as Atlas's (`level_<time36>_<rand>`), injected.
- **D8 Ids.** A member's record keeps its id where the base (and members before it) has none of that kind, else gets `<id>_s<n>`; `follows`, `origin.tokenIds` and `chainId` follow the same table (a chain id is remapped per member when taken). Derived `spell:` walls, features and lights are not copied (the reconciler derives them for the copied measure).
- **D9 Not kept, listed:** a member's turn; a shift left of or above the base's origin; what players had explored on it; its initiative; its fog height, wall thickness and Atlas lighting where they differ from the base's; text sizes and brush widths in pixels where `k ≠ 1`; old water whose image size cannot be had.
- **D10 Skipped, listed (the stack record stays, so a later Move can take it):** the base already has Atlas levels; a member has levels; the base's file is gone; Atlas does not come to hold the base. A member whose file is gone, or that Atlas does not come to hold, skips its whole stack (whole stack or none).
- **D11 Commit order and reruns.** Backup → members snapshotted → base held → plan → journal in Tabletop's data, saved to disk → state unchanged since the plan? (else plan again) → write → the base's file shows the levels (polled, 10 s) → Tabletop's data adopted (styles, minis, props, hidden, shots) → stack record cleared, journal cleared. At start, a journal whose levels are all in the base's file is finished (Tabletop's side only); one whose levels are not is dropped (the write never landed). A level is never added twice.
- **D12 Refused** while Connect hosts a session or a cutscene runs (Atlas's tab goes through the members). Atlas is brought back to the map it showed.
- **D13 Shots.** `Shot.level?: string`. New and updated shots take the level shown; going to a shot shows its level; `GmCutscene.levels` (key → level id) and keys per map and level; Connect projects a key's scene at its level and asks Tabletop's look for that level. A move transition stays within one map and one level for now (*ruling: the board re-reads on a level switch and a level's floor is the board's zero height, so a glide between floors is its own piece of work; cost: floors of one scene are joined by fade or cut only*). Shots on a member are re-pointed to the base and the level, `eye` and `target` through `move` (heights by `k`), in every map's cutscenes.
- **D14 What goes.** The stack UI and protocol: `LayerModal`, the file menu item, placing and turning a layer by hand, the stack branches of the board view, `writer.transfer`, `tokensMoved` (both repos), Connect's `movedTokens`. `BoardLayerRecord` stays: it is how players are sent a scene's other *levels* (`boardLayers.ts`); only what was the stack's goes. *Ruling to ledger against the spec's "BoardLayerRecord is deleted".*

## Review Focus

1. The GM's local player window and Connect's players: a level made from a member shows them nothing the member hid (hidden tokens, GM-only measures, fog), as any Atlas level.
2. The players' level against the GM's: after the move the GM is on the base's level; a hosted session cannot be running (D12).
3. A board on a map Atlas does not hold: the move never writes it; skipped and listed.
4. Records made in Atlas's UI or with junk `tabletop` fields on a member: copied as they are, never a throw; a member with zero records; a base with zero records.
5. The live script refuses any vault but the throwaway one.
6. A rerun after a crash at each point of D11: no level twice, no stack lost.
7. Two members made by duplicating the base (every id collides, measures follow tokens, walls share chains).
8. A member below the base, and one whose grid is another size.
9. Cutscenes: a shot on a member after the move plays on its level, for the GM and for players; a cutscene stored under the member's own path is still there.

---

### Task 1: The planner (`src/board/stackMove.ts`, pure)

**Files:** Create `src/board/stackMove.ts`, `tests/stackMove.test.ts`.

**Interfaces — Produces:**
```ts
export interface SceneFields { levels?: unknown; background: string | null; objects: Record<string, Record<string, unknown> | undefined>; exploredMask?: string | null; exploredMasks?: Record<string, string>; levelAlignments?: Record<string, LevelAlignmentLike>; grid: GridLike | null; lighting?: unknown }
export interface MemberSource { path: string; name: string; elevation: number; placement: Placement; scene: SceneFields; size: { width: number; height: number } | null; legacyExtras: unknown; legacyWater: { mask: unknown; motion?: unknown } | null; fogHeight: number; wallThickness: number; hasInitiative: boolean }
export interface BaseSource { path: string; name: string; scene: SceneFields; fogHeight: number; wallThickness: number }
export interface MemberMove { path: string; level: string; ids: Record<string, Record<string, string>>; frame: { k: number; x: number; y: number } }
export interface StackPlan { scene: SceneFields; aligns: Array<{ level: string; alignment: LevelAlignmentLike; frame: { k: number; x: number; y: number } }>; baseLevel: string; members: MemberMove[]; lost: string[] }
export function frameOf(base: GridLike, member: GridLike, placement: Placement, size: { width: number; height: number } | null): { alignment: LevelAlignmentLike | null; frame: { k: number; x: number; y: number }; lost: string[] }
export function moveOf(frame: { k: number; x: number; y: number }): (point: { x: number; y: number }) => { x: number; y: number }
export function stackSkip(base: SceneFields | null, members: ReadonlyArray<{ name: string; scene: SceneFields | null }>): string | null
export function planStackMove(base: BaseSource, members: readonly MemberSource[], newLevelId: () => string): StackPlan
```

- [ ] Write failing tests: frame (same grid: no alignment; other cell size: scale and offset; shift; negative shift raised by whole squares and listed; a turn dropped about the middle, about the corner without a size, listed; another `mapStretch` needs an alignment at scale 1); levels (order, bottoms from unitDistance, tops, names; a member below is first, the scene's background is its image, the base's records name the base's level per kind, the base's explored mask goes to `exploredMasks`); records (tags per kind from the table above; ids kept when free and remapped on collision with `follows`, `origin.tokenIds`, `chainId` following; `spell:` derived records left out; legacy extras folded into `tabletop`; old water as brush liquids on the level, or listed without a size); `lost` lines for D9; `stackSkip` for D10; a member and a base with no records.
- [ ] Run: FAIL (no module). Implement. Run: PASS; `npx tsc --noEmit`.
- [ ] Commit `feat(stacks): plan a stack as the levels of its base scene`.

### Task 2: The write (`tokenWriter.applyStackMove`)

**Files:** Modify `src/atlas.ts` (`applyLevelScene`, `alignLevel`, `setViewedLevel`, state fields `levels`, `background`, `exploredMask`, `exploredMasks`, `levelAlignments`, `lighting`), `src/board/tokenWriter.ts`, `src/board/undoRecorders.ts` (not recorded: outside history). Test `tests/stackWrites.test.ts`.

**Interfaces — Consumes:** `StackPlan`, `moveOf`. **Produces:**
```ts
async applyStackMove(path: string, plan: (state: AtlasSceneState) => StackPlan | null): Promise<StackPlan | null>
```
The plan is asked at the write with the store's state; null writes nothing. `NotHeldError` when not held (it does not wait for a follow); `missing` when Atlas lacks `applyLevelScene`, `alignLevel` or `untracked`.

- [ ] Failing tests on a stand-in store: one `applyLevelScene`, then an `alignLevel` per entry of `aligns` with a `move` that is `moveOf(frame)`, then `setViewedLevel(baseLevel)`, all untracked, no undo step, history cleared; planned on the state at the write; a throw inside puts the scene's fields back and rethrows; not held: refused, nothing written; a plan of null: nothing written.
- [ ] RED → implement → GREEN; tsc. Commit `feat(stacks): write a planned stack to Atlas's levels in one untracked step`.

### Task 3: Tabletop's side of the move (data)

**Files:** Modify `src/board/boardData.ts` (`stackJournal?: StackJournal` on the base's `MapData`; `stackJournal(path)`, `setStackJournal(path, journal | null)`, `adoptStack(base, journal)`, `stacks()`), `src/assignments.ts` (copy a member's placements under new ids), `src/cutscene/cutsceneData.ts` (`Shot.level`, read and kept; `sameScene(a, b)`), `src/board/undoRecorders.ts` (migration bookkeeping is no undo step). Test `tests/stackAdopt.test.ts`, additions in `tests/cutsceneData.test.ts`.

**Interfaces — Produces:**
```ts
export interface StackJournal { members: MemberMove[]; baseLevel: string }
stacks(): Array<{ base: string; members: StackMember[] }>
adoptStack(base: string, journal: StackJournal): void   // idempotent
```
`adoptStack`: each member's token styles and (through `assignments`) minis under the new ids on the base; its props on the base with new ids, moved through the frame, `level` set; its hidden flag on `${base}#atlas-level:${level}`; every map's cutscene shots on the member re-pointed (`mapPath: base`, `level`, `eye`/`target` moved, heights by `k`); the member's `layer` record gone; the journal gone. The member's own data stays (it is still a scene).

- [ ] Failing tests (each bullet above; run twice gives the same data; a cutscene kept under the member's path stays there; `allowedTransitions` gives `move` only for the same map and level; `readCutscenes` keeps a `level`, drops a junk one).
- [ ] RED → implement → GREEN; tsc. Commit `feat(stacks): adopt a moved stack's minis, styles, props and shots onto its base`.

### Task 4: Shots on a level (Tabletop)

**Files:** Modify `src/cutscene/studio.ts`, `cutsceneRun.ts`, `broadcast.ts`, `src/connectContract.ts` (`GmCutscene.levels?`, `TabletopApi.boardLook(mapPath, level?)`), `src/board/BoardView.ts` (the studio host's `level()`, `switchLevel()`), `main.ts` (`boardLook` for a level). Tests: `tests/cutsceneBroadcast.test.ts`, `tests/cutsceneRun.test.ts`, `tests/cutsceneStudio.test.ts` additions.

**Interfaces — Produces:** `StudioHost.level(): string | null`, `StudioHost.switchLevel(level: string | null): Promise<boolean>`; `BroadcastInput.level?: string | null`; `GmCutscene.levels?: Readonly<Record<string, string>>`.

- [ ] Failing tests: a shot added or updated takes the level shown; going to a shot of another level of the same map switches the level, not the map; a run follows a shot's level; the broadcast gives two keys to two levels of one map, `maps` both the same path, `levels` the two ids, and one key to a map without a level (as before); a live run's key carries the GM's level.
- [ ] RED → implement → GREEN; tsc; harness `cutscene` features. Commit `feat(cutscene): a shot names the level it looks at`.

### Task 5: Connect: a cutscene scene at its level; the stack's protocol read no more

**Files (Connect):** `src/app/online/scene/sceneContracts.ts` (`GmCutscene.levels`), `sceneSources.ts` (`lookFor(mapPath, level?)`), `CutsceneSender.ts` (a key's snapshot at its level: verify at execution how `projectForPlayers` picks the level, and give it the key's), validation of `levels` (keys as `maps`', values scene ids); tests beside the existing CutsceneSender tests.

- [ ] Failing tests: two keys of one tab's map with two levels are projected each at its level and sent as two scenes; `levels` with a key `maps` lacks, or a non-string, is refused like a bad `maps`; without `levels` as before.
- [ ] RED → implement → GREEN; `npx vitest run`, tsc, lint. Commit `feat(cutscene): project a run's scene at the level its key names`.

### Task 6: The move itself, and the ask

**Files:** Create `src/stackMigration.ts` (class `StackMigration`, deps injected), `src/stackMoveModal.ts`; modify `main.ts` (start notice, command, journals finished at start), `src/backups.ts` if a helper is needed. Test `tests/stackMigration.test.ts` (stand-in deps).

**Interfaces — Consumes:** Tasks 1–3. **Produces:**
```ts
export interface StackMigrationDeps { boardData; assignments; writer; follow(path: string): Promise<boolean>; heldState(path: string): AtlasSceneState | null; shownMap(): string | null; read(path: string): Promise<string | null>; backup(files: Array<{ name: string; text: string }>): Promise<string>; imageSize(path: string): Promise<{ width: number; height: number } | null>; save(): Promise<void>; busy(): string | null; newLevelId(): string; wait(ms: number): Promise<void> }
export interface StackOutcome { base: string; moved: boolean; levels: string[]; lost: string[]; skipped: string | null }
class StackMigration { pending(): Array<{ base: string; members: StackMember[] }>; preview(): Promise<StackOutcome[]>; move(): Promise<{ outcomes: StackOutcome[]; backup: string | null }>; finishJournals(): Promise<void> }
```

- [ ] Failing tests: the order of D11 (a log of calls); refused while `busy()`; a member not held skips the whole stack and writes nothing; the state changing between the plan and the write plans again; the file never showing the levels leaves the journal and adopts nothing; `finishJournals` adopts when the file has the levels and drops the journal when not; two stacks, one skipped: the other moves; Atlas is brought back to `shownMap()`; the backup holds the base, the members, their data and their minis, and a `Stacks moved.md` summary.
- [ ] RED → implement → GREEN; tsc; build. Commit `feat(stacks): move scene stacks to Atlas levels when the GM says so`.

### Task 7: Live check, before anything is deleted

**Files:** `harness/live/fixtures.cjs` (a stack: the cove as base; `Stack Upper` = the cellar without levels, 3 squares up, shifted; `Stack Lower` = the cove again, 2 squares down, so every id collides; minis, a style, a prop, a hidden flag, wall settings and a water mask in Tabletop's data for the upper; a cutscene with a shot on each), `harness/live/phase4c.cjs` (runs `phase4b.cjs` first; refuses any vault but the throwaway one).

- [ ] Steps: the ask is shown and Later leaves everything; Move writes the backup, gives the base three levels in order with the right heights and alignment, every kind on its level and moved, ids remapped with `follows` kept, extras and water folded; the file reads back the same; Tabletop's data adopted and the stack record gone; the members' files still open as scenes; the 3D board shows three floors; a second Move finds nothing; a journal left as after a crash is finished, and one whose write never landed is dropped; a shot on the upper plays on its level; refused while a session is hosted; no console error.
- [ ] Run full chain in the background; fix; rerun. Commit script and report (`phase4c-live-report.md`).

### Task 8: What goes

**Files:** delete `src/layerModal.ts`; modify `main.ts` (file menu item, `lookChanged` stack test, settings texts), `src/board/BoardView.ts` (stack branch of `readStack`, `switchMember`, the stack's ruler menu, placing/turning/resetting a layer, `moveTokensToLayer`, `arrived`, `stackPaths`), `src/board/board.ts` and `layerRuler.ts` (what only a hand-placed layer used: list by grep at execution), `src/board/tokenWriter.ts` (`transfer`, `deps.follow` if nothing else uses it), `src/board/boardData.ts` (`setLayer`, `setPlacement`, `setLayerHidden` for stacks stays as the levels use it; `layerOf`/`layersOf`/`stackOf`/`placementOf` stay read-only for the move), `src/boardLayers.ts` (stack branch), `src/connectContract.ts` (`tokensMoved`); Connect: `BoardSessionHub.tokensMoved`, `control/movedTokens.ts`, their tests. A guard test that the stack's entry points are gone.

- [ ] Failing guard test (`tests/noStacks.test.ts`: no `LayerModal`, no `tokensMoved`, no `transfer(`, no `setLayer(` outside the move); delete; fix what the compiler and the suites say; harness `layers|levels` features rewritten onto levels where they stood on stacks.
- [ ] Both repos' checks green. Commit `refactor(stacks): the scene stack's UI and protocol are gone; floors are Atlas levels`.

### Task 9: Docs, versions, vendor, live again

- [ ] README (both), spec sections 4, 6, 7, 10; versions 1.8.0 / 0.14.0; `node scripts/build-web.mjs`, vendor into Connect, Connect checks, `npm run sync:connect`, build; full live chain; report.
