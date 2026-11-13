# Atlas fusion Phase 3: spells and templates are Atlas measures

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `objects.measures` in Atlas's store is the only place an area, a template, a spell or an aura lives; Tabletop and Connect keep no list of their own and write through Atlas.

**Architecture:** One pure converter (owned by Connect, copied to Tabletop) turns a 3D spell or a player's template into an Atlas measure and back: the measure's two points are the truth for where it lies, how it is turned and how big it is; a `tabletop` extra field holds only what points cannot say, relative to those points. The GM's side writes every cast as one Atlas history transaction (the measure, and the walls and difficult terrain a spell's rules stand), so Atlas's own undo takes them together. Players send requests; the GM's Connect writes them with `by`. Players get measures as a scene record.

**Tech Stack:** TypeScript; Atlas 0.15.0 store actions (`addMeasure`, `updateMeasure`, `deleteMeasure`, `addWall`, `deleteWalls`, `addMapFeatures`, `deleteMapFeature`, `temporal.transaction`, `temporal.untracked`); vitest (Connect), node:test + Playwright harness (Tabletop).

**Spec:** `docs/superpowers/specs/2026-11-13-atlas-fusion-design.md`, section 8 Phase 3, sections 7, 10, 11.

## Global Constraints

- Atlas is the source of truth: no second store, no second list on the wire. Never push, never merge. Real vaults untouched; live checks only in `C:\Users\joaoo\fusion-gate-vault`.
- Both plugins need Atlas 0.15; `FUSION_PROTOCOL` becomes 3; versions Tabletop 1.6.0, Connect 0.12.0.
- Limits (spec): 10 kept spells per player and 40 per scene, checked at the GM before writing; Atlas's 256 per level; one template per player.
- Players are sent an allowlist only: never `hidden` measures, never `origin`, never `light`, never a token id that is not an alias.
- Commits end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Checks: Connect `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run build:page`, `npm run check:vendor`, `npm run check:shared`. Tabletop `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:connect -- --connect C:/Users/joaoo/2075/atlas-vtt-connect-cutscenes-wt`, harness as each task says.

## Review Focus

1. **A measure made or changed in Atlas.** Dragged, resized, turned, recoloured or deleted in Atlas's own UI, or one with no `tabletop` field, or with a `tabletop` field that is junk: the board draws what the points say, never throws, and a deleted spell leaves no wall or terrain behind. Test: Tasks 2 and 6.
2. **A cast on a map Atlas does not hold.** Refused with the bar's text for the GM and the not-held text for a player; nothing is kept anywhere else. Test: Tasks 3 and 5.
3. **Limits.** The 11th spell of a player, the 41st of a scene, the 257th measure of a level, a second template of a player (it replaces the first): refused or replaced as the spec says, with a message. Test: Task 3.
4. **Privacy.** A hidden measure, one whose origin players did not see, an aura of a token players are not told of, a light, a `tabletop` field with keys outside the allowlist or oversized words: none of it reaches players. Test: Task 3.
5. **Opening a board on a map that already has spells.** No cast effect, sound or rule (push, summon) replays for measures that were already there. Test: Task 5.

---

## Gates checked live before this plan (Task 1, done)

`harness/live/phase3-probe.cjs`, Atlas 0.15.0, results in `.superpowers/sdd/2026-11-13-atlas-fusion/phase3-probe.json`:

| Gate | Result |
|---|---|
| G9 a measure with a nested `tabletop` object of 4 KB, `by`, `hidden`, on the level shown | kept in the store, in the file after the save, and after switching map and back |
| G10 one undo step for a cast and what it brings | `store.temporal.getState().transaction(fn)`: measure + wall (`chainId`) + map feature are 1 step; undo removes all three, redo brings all three back |
| G11 writes that are no undo step | `temporal.getState().untracked(fn)`: 0 steps |
| G12 an area's `light`, and `darkness: true` | kept as given (Atlas's UI offers darkness on circles only: `canBeDarkness`) |

## Decisions

- **D1: What the extra field holds.** `tabletop: { v: 1, kind: 'spell' | 'template', shape, from, rel: { ax, ay, yaw, size, length }, h, pitch, roll, angle?, effect?, caster?, owner?, name?, about?, rules?, temp? }`. `rel` is the spell's anchor, turn and sizes **relative to the measure's two points** (offsets and sizes in units of the points' distance, yaw relative to their heading), so a measure moved, turned or resized in Atlas carries its 3D shape with it and nothing goes stale. `h`, `pitch`, `roll` have no Atlas meaning and are kept as they are.
- **D2: Shapes** (spec, with one ruling): sphere → `circle` (centre, radius); cube → `square` (Atlas's square starts at the middle of its near side: the cube's centre is half a side along); cone → `cone` (tip, length on the floor; Atlas and 2D draw the collection's cone angle, 3D keeps the spell's `angle`); wall → `line` with `width` its thickness; **cylinder (Tabletop's beam)** → `line` with `width` twice its radius when it runs along the floor further than its radius, else `circle` (a column).
- **D3: A measure with no `tabletop` field** (made in Atlas) is drawn flat on the board in its colour, as templates are; with an `effect` its looping sound plays (fire→fire, frost→cold, lightning→lightning, radiance→radiant, shadow→necrotic, mist→plain). It is no 3D volume. What it holds is asked of Atlas's own `shapedArea` (shared), by the collection's cone angle and cone end.
- **D4: 3D spells keep their volume hit test** (height matters: Atlas has none). Atlas's `areaCellRule` applies to flat areas only (D3). Recorded in spec section 9.
- **D5: One transaction per cast.** The GM's board and the GM's Connect both write a cast inside `temporal.transaction`: the measure, its light, its walls (`chainId: 'spell:<measure id>'`, `tabletop: { spell }`) and its difficult terrain (`tabletop: { spell }`). A reconciler on the GM's Tabletop (untracked) removes walls and terrain whose measure is gone and rebuilds them when a measure with rules has none or was moved (a signature of its points on the wall's `tabletop`).
- **D6: Instantaneous spells are not kept.** A spell whose words say Duration: Instantaneous is flashed (a `spell-flash` message to the scene's players and the GM's board) and written nowhere: no save, no undo step. Its rules that move tokens (push, teleport, summon) still go through the store. A spell with a duration, or set by hand, is kept until removed.
- **D7: Lifetime of the kept.** Saved in the map, as Atlas's. "Clear spells" removes the map's spell measures (one transaction); a session end clears nothing but players' templates (`temp: true`), which also go when their player leaves, when they place another (one per player), and in a sweep when a session starts (a crash leaves them in the file).
- **D8: Wire.** Player → GM requests stay as `map-template` and `map-spell` (they are requests, not storage; asks and declines need them). GM → player lists `map-templates` and `map-spells` are deleted: measures arrive in the scene as a record key (`measures`, upsert and remove), the GM's asks in `spell-asks`. The GM stamps `owner` and `by`; nothing of them is taken from a message.
- **D9: What players lose, to add to spec section 10 and tell the user.** A cast or a template needs Atlas to hold that map: on a split party's other scene, or with Atlas on another map, it is refused (the not-held text). A GM who is not hosting still casts (it is Atlas's map either way). A player has one template at a time (was several). Opening a board no longer shows spells cast in an earlier session as fresh casts.
- **D10: Not in this phase.** Auras (`follows`) are drawn as Atlas has them, never made by the board. The Obsidian player's own Atlas view gets measures only if its remote input carries them (checked in Task 4; otherwise recorded).

---

### Task 2 (Connect): The converter and the shared geometry

**Files:**
- Create: `packages/atlas-host/src/spellMeasure.ts`, export from `packages/atlas-host/src/index.ts`.
- Modify: `packages/atlas-shared/files.mjs` (+ `measure/measureGeometry.ts`, `measure/measureEffects.ts`, `measure/measureTypes.ts`, their type closures), `packages/atlas-shared/src/index.ts`, `src/app/online/scene/boardTypes.ts` (`FUSION_PROTOCOL = 3`).
- Test: `tests/unit/connect/spellMeasure.test.ts`, the fusion number in the join tests.

**Interfaces — Produces:**
```ts
export type SpellShape = 'sphere' | 'cube' | 'cylinder' | 'cone' | 'wall';
export interface SpellLike { shape: SpellShape; from: 'self' | 'point'; at: { x: number; y: number; h: number }; to?: { x: number; y: number }; yaw: number; pitch: number; roll: number; size: number; length: number; angle: number; caster?: string; effect?: string }
export interface SpellMeta { owner?: string; by?: string; color?: string; name?: string; about?: unknown; rules?: unknown; hidden?: boolean }
export interface MeasureRecord { shape: 'circle' | 'cone' | 'square' | 'line' | 'ruler'; points: Array<{ x: number; y: number }>; width?: number; color?: string; hidden?: true; by?: string; light?: unknown; effect?: string; tabletop?: unknown; id?: string }
export function spellToMeasure(spell: SpellLike, meta?: SpellMeta): MeasureRecord;      // D1, D2
export function measureToSpell(measure: MeasureRecord): { spell: SpellLike; meta: SpellMeta } | null; // null: no spell extra, or junk
export function templateToMeasure(template: { shape: 'line' | 'circle' | 'square' | 'cone'; start: Point; end: Point }, meta: { owner: string; by: string; color: string }): MeasureRecord; // temp: true
export function measureKind(measure: MeasureRecord): 'spell' | 'template' | 'area'; // 'area': made in Atlas
export function atlasEffectOf(damage: string | undefined): string | undefined;      // the six Atlas looks, else none
export function damageOfEffect(effect: string | undefined): string | undefined;     // D3's map
export const SPELL_CHAIN = (measureId: string): string => `spell:${measureId}`;
export const MEASURE_LIMITS = { perPlayer: 10, perScene: 40, perLevel: 256, about: 4000 } as const;
```

- [ ] **Step 1: Failing tests.** Round trip for each shape × `from` × a pitch of 0, 0.4 and 1.5: `measureToSpell(spellToMeasure(s))` gives `s` within 1e-6. A measure translated by (100, 50), turned a quarter turn about its first point, or scaled ×2, gives the spell moved, turned and scaled the same way. A square's cube centre lies half a side along. `measureToSpell` of a measure without `tabletop`, with `tabletop: 5`, with `rel.size: NaN`, with zero-length points: null. A cylinder lying along the floor is a `line` of width 2·radius; one standing is a `circle`. `templateToMeasure` marks `temp: true`, `kind: 'template'`. `damageOfEffect('frost') === 'cold'`.
- [ ] **Step 2:** Run; expected FAIL (module missing).
- [ ] **Step 3:** Implement; sync shared files; export `shapedArea`, `readMeasureEffect`, the measure types.
- [ ] **Step 4:** All Connect checks.
- [ ] **Step 5: Commit** `feat(host): spells and templates as Atlas measures (the converter); fusion 3`.

### Task 3 (Connect): The GM writes measures; players get them in the scene

**Files:**
- Create: `src/app/online/tools/MeasureHost.ts` (replaces `TemplateHost.ts`: requests, limits, asks, flashes), `src/connect/stockMeasures.ts` (the writes on a stock Atlas's store: `add`, `remove`, `clear`, `sweepTemporary`, each in a transaction; null when the map is not held), `src/app/online/scene/projectMeasures.ts`.
- Modify: `protocol.ts` (delete `map-templates`, `map-spells`; add `spell-asks`, `spell-flash`; a refusal reason for requests), `scene/sceneTypes.ts` (`PlayerMeasure`, `PlayerScene.measures`, `SCENE_RECORD_KEYS`), `sceneValidation.ts`, `projectForPlayers.ts`, `hostedSession.ts`, `toolParts.ts`, `BoardSessionHub.ts`, `tools/spells.ts` and `tools/templates.ts` (what only the lists used goes).
- Delete: `src/app/online/tools/TemplateHost.ts`.
- Test: `tests/unit/online/measureHost.test.ts`, `projectMeasures.test.ts`, `sceneProtocol.test.ts`, `tests/unit/connect/stockMeasures.test.ts`; `tests/unit/online/noSpellStorage.test.ts` (no `byScene`/`spellsByScene`, no `map-spells`/`map-templates` in `src`).

**Interfaces — Produces:** `PlayerMeasure = { shape; points; width?; color?; walls?: false; effect?; owner?: string; tabletop?: PlayerMeasureExtra }` where `PlayerMeasureExtra` is D1's allowlist (`rules` cleaned as today, `about` cut to `MEASURE_LIMITS.about`); `PlayerScene.measures?: Record<string, PlayerMeasure>` (aliases, never Atlas's ids); `MeasureHost.requestSpell/requestOf/cancelSpellRequest` as `TemplateHost` had them; `stockMeasures(view).add(record, derived): string | null`.

- [ ] **Step 1: Failing tests.** Review Focus 2, 3 and 4 as cases; a player's `map-spell add` writes one measure with `by` the player's name, `owner` their id, inside one transaction with its rule walls; `remove` of another player's measure is refused; an instantaneous cast writes nothing and sends `spell-flash`; a leaving player's template is deleted; `sweepTemporary` removes `temp` measures at session start; the patch for a removed measure carries `remove.measures`.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement. Visibility by Atlas's rule (hidden, and an origin the players did not see) with the fields Connect has; an aura's `follows` is sent as the token's alias or the measure is dropped.
- [ ] **Step 4:** All Connect checks.
- [ ] **Step 5: Commit** `feat(online): spells and templates are written to Atlas's measures; players get measures in the scene`.

### Task 4 (Connect): The page and the Obsidian player draw measures

**Files:**
- Modify: `src/app/online/view/tools/PlayerTools.ts` (lasting templates read from `scene.measures`; the draft preview shaped by Atlas's `shapedArea`), `toolsLayer.ts`, `TemplateTool` (its request), `PlayerSession.ts` (no list messages; `spell-asks`, `spell-flash`), the Obsidian remote scene (`obsidian/remote/toRemoteScene.ts`: measures into the player's Atlas where its input has a field), the board bridge that hands Tabletop's player board its marks (`measures` in place of `templates` and `spells`).
- Test: `tests/unit/online/playerTools*.test.ts`, `toolsLayer` drawing tests, `playerSession` tests.

- [ ] **Steps:** failing tests (a scene's measure of each shape is drawn with Atlas's outline; the player's own is erasable, another's is not; a template preview equals the measure it becomes; an ask arrives by `spell-asks`), implement, all Connect checks incl. `build:page`, commit `feat(page): players draw Atlas's measures; templates preview as Atlas shapes them`.

### Task 5 (Tabletop): The board reads and writes measures

**Files:**
- Modify: sync Connect; `src/board/mapModel.ts` (`BoardMap.measures: BoardMeasure[]`, read from the store or the file, by level), `src/board/BoardView.ts` (spells and templates from `map.measures`; `localSpells`, `overlay().templates`, `overlay().spells` go; casts through the writer), `src/board/tokenWriter.ts` (`addSpell(path, record, derived)`, `removeMeasure`, `clearSpells`, each one transaction; in `WRITES`), `src/board/board.ts` (`receiveMeasures`; a measure already on the map when the board opens is known, not a fresh cast), `src/board/spells.ts` (`CastSpell` built from a measure), `src/board/marks.ts` (flat areas by Atlas's outline), `src/playerBoard.ts` and `src/board/sceneAdapter.ts` (the player's board reads `scene.measures`; flashes).
- Test: `tests/boardMeasures.test.ts` (new), `tests/tokenWriter.test.ts`, `tests/noSpellStorage.test.ts` (no `localSpells`, no `overlay().spells`), harness features `spells`, `templates`, a new `atlas areas`.

- [ ] **Step 1: Failing tests.** `readMapState` gives each measure with its kind; a spell measure reads as the spell that made it; a cast on a held map calls `addMeasure` inside `transaction`; on a map not held it rejects with `NotHeldError`; `clearSpells` deletes spell measures only (an Atlas area stays); Review Focus 5 as a harness check (load a map with a spell measure: no cast sound in `sounds.plays`).
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tabletop checks; harness `"spell|template|atlas areas|measure"`, board suite.
- [ ] **Step 5: Commit** `feat(board): spells, templates and Atlas's areas are read from and written to Atlas's measures`.

### Task 6 (Tabletop): A spell's rules become Atlas records

**Files:**
- Modify: `src/board/spellRules.ts` (`derivedRecords(spell, rules, grid, measurement): { walls: WallInput[]; features: FeatureInput[]; light?: LightEmission }`; the board's own rule walls, lights and difficult terrain go; push, teleport, portal, summon stay), `src/board/board.ts` (no `spellWalls`, `difficultShare` reads Atlas's map features), `src/board/spellReconciler.ts` (new: orphans and stale derived records, untracked), `src/board/BoardView.ts` (runs it on the held store's changes).
- Test: `tests/spellRules.test.ts`, `tests/spellReconciler.test.ts` (new), harness `spell rules`.

- [ ] **Step 1: Failing tests.** A wall spell derives Atlas walls along its run with `chainId` and `tabletop.spell`; an obscuring sphere derives a ring of sight-blocking walls; a difficult spell derives one map feature with `terrain.difficult` in eighth pixels; a light or darkness sets the measure's `light` (darkness on a circle only). Reconciler: walls and features whose measure is gone are deleted; a measure with rules and no derived records gets them; one moved (signature differs) gets them replaced; nothing is written when all is in order; every write is inside `untracked`. Review Focus 1.
- [ ] **Step 2:** Run; expected FAIL.
- [ ] **Step 3:** Implement; delete the board's doubles in the same change.
- [ ] **Step 4:** Tabletop checks; harness `"spell"`, board suite.
- [ ] **Step 5: Commit** `feat(board): a spell's walls, light and difficult terrain are Atlas's own records, kept in step with its measure`.

### Task 7: Versions, docs, vendor

- Tabletop 1.6.0, Connect 0.12.0; READMEs (spells are Atlas areas; what changed for players, D9); spec sections 9 (D4), 10 (D9), 11 (G9 to G12); build `dist-web` from a clean tree; vendor into Connect; the vendor test's version.
- Commits `docs: Tabletop 1.6.0 (fusion 3)` and `build(vendor): player board from Tabletop 1.6.0; Connect 0.12.0 (fusion 3)`.

### Task 8: Live check on Atlas 0.15.0

`harness/live/phase3.cjs` (fresh Obsidian, fresh fixtures; runs `phase2.cjs`'s steps first): a cast on the board is one measure in Atlas's store and file with its extras, and one Atlas undo step with its rule walls; Atlas's undo removes the spell from the board; a measure made in Atlas's store shows on the board; one dragged in the store moves the 3D spell; deleting a wall spell's measure in Atlas leaves no wall; a cast on a map not held is refused and no file changes; reopening the board plays no cast sound. Report `.superpowers/sdd/2026-11-13-atlas-fusion/phase3-live-report.md`. Commit `test(live): Atlas fusion Phase 3 live check`.

---

## Self-review

- **Spec coverage (section 8, Phase 3):** only store (Tasks 3, 5); shapes and extras (2); rules as records (6); lifetime (3, 5; D6, D7); limits (3); projection (3, 4); deletions (3, 4, 5); effects and sounds key off the measure, an Atlas area shows in 3D (5; D3); hit tests (D3, D4).
- **Type consistency:** `spellToMeasure`, `measureToSpell`, `measureKind`, `SPELL_CHAIN`, `MEASURE_LIMITS` are Task 2's and used by 3, 5, 6; `PlayerScene.measures` is Task 3's and read by 4 and 5; `derivedRecords` is Task 6's and used by the writer of Task 5 (Task 5 passes none until Task 6 lands).
- **Review Focus:** each line names the task that carries it.
