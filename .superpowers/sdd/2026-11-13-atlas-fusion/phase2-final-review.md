# Atlas fusion Phase 2: final review

Reviewer: senior code review, read-only. Ranges: Tabletop `5df990b..46c4560`, Connect `34854bb..1fc3616` (vendor and the
verbatim Atlas files excluded, as asked; index, file list, sync/check scripts and generated stubs read).
Reference: stock Atlas 0.15.0 at `C:\Users\joaoo\2075\atlas-vtt-0.15-ref`.

Evidence I gathered myself:
- I compared the old `snapPoint` (from `5df990b`) with the new one (through Atlas's `snapTokenCenter`). Each version was
  bundled from its source into the scratchpad, with nothing written to either checkout. The run covered 144,000 points:
  square, hex-vertical and hex-horizontal grids, offsets (0,0) and (17,23), sizes 1, 1.5, 2, 2.5, 3 and 4. The largest
  difference was **0**.
- I read Atlas's own `DragRuler.ts`, `tokenMovement.ts`, `TokenRenderer.ts`, `InteractionController.ts`, `sides.ts`,
  `playerTokens.ts`, `plugin/playerTokens.ts`, `visibleResources.ts`, `diceCrit.ts`, `diceExplosion.ts`,
  `movementRules.ts`, `dragMovement.ts`, `dragDistance.ts`, `tokenHeight.ts` and `gridPlacement.ts`, and checked each
  call site against them.
- I did not open Atlas's `resourceValues.ts`, `sceneLevels.ts` or `laserPointerSettings.ts`. For those swaps the
  evidence is the executor's passing suites plus my reading of the test diffs: the only changed expectations are
  deleted file-engine cases and the three dice outcomes the Task 4 ruling names.
- I did not run `npm test` or vitest. Both write build folders into the checkouts. I rely on the executor's reported
  numbers.
- Checked HEADs: Tabletop `46c4560`, Connect `1fc3616` (clean). Code was read with `git show <head>:<path>`.

## Strengths

- **The no-file-write goal is met, and checked by a test.** `TokenWriter` is store-only. Every path goes through `store()`
  or `tokenStore()` and throws `NotHeldError` when the map is not held. The file engines (`*InText`, `tokenToFile`,
  `applyInitiative`, `recordedProcess`, the `'file'` result, `process` in the deps) are gone.
  `tests/noFileWrites.test.ts` pins this. The live check showed four refused edits and no `.atlasmap` file changed.
- **Held writes stay synchronous** (area a). Every method does
  `if (this.holder(path) === null) await this.ready(path);` before any store call. When the map is held, the store
  action runs before the first `await`, which is what `recordAtlasWrites` needs to count Atlas's history steps.
  `addTokensNow` is synchronous on the held path.
- **The shared package is built carefully.** It has a boundary stand-in for `i18n`, hashed and listed under
  `boundaries`. `STUB_TYPES` is limited to one-line aliases, and `check-shared` covers boundaries. Atlas's own
  `parseMovementRules`, `tokenHeight`, `riseInCells`, `dragMove`, `showsDragDistance`, `snapTokenCenter`,
  `resolveLevel`, `onLevel`, `visibleResources`, `getDiceCrit` and `explodingFaces` replace the plugins' copies with
  the same meaning. I diffed the old and new snapping (numerically) and resource visibility (against Atlas's source).
  Levels and laser are covered by the existing suites, which pass unchanged.
- **Review focus 1 holds.** `tokenHeight` clamps to ±100,000 and maps junk to 0. `riseInCells` gives 0 for a
  `unitDistance` that is 0, negative or not a number. `liftOf` and `heightLift` cannot produce `NaN`, and the drop line
  guards `Number.isFinite`.
- **Review focus 2 holds.** Every source of rules goes through `parseMovementRules`: the live drag ruler, collection
  settings, Connect's scene on the player board, and Connect's projection. Speeds go through
  `isMovementSpeed`/`ownSpeed`. `dragMove`/`movementStepFor` never throw on malformed input. Tests cover a multiple of
  0, a colour like `red`, and a speed of null.
- **Review focus 3 holds.** With no speed, `dragMove` returns null and both rulers show the plain distance with no
  colour. Tests cover this on both sides.
- **Review focus 4 holds** (my comparison above: identical).
- **Review focus 5 holds, by code reading plus the live check.** Every `TokenWriter` method reaches `store()` or
  `tokenStore()`, and `BoardView.unsaved` turns `NotHeldError` into a Notice with `hostBanner().text` and reloads. When
  the map is not held, `readMap` still draws the map and the initiative panel from the file. The test coverage gap is
  in Minor 3.
- **Area (b) holds.** `BoardView` no longer applies initiative optimistically and no longer waits without a host.
  `initiativeAct` and the join path now only call the writer. When Atlas does not hold the map the write is refused and
  the panel keeps showing the file's state, which is the intended "view only" behaviour. The no-host branch was only
  reachable without `services.host`, which production always passes (`main.ts`). I found nothing else broken.
- **The spell hit test does not see the drop line.** `spellTargets()` boxes `piece.fall`, which holds only the body.
  `setDrop` adds the line to `object3d`, beside `fall`, so a lifted token's box does not reach the floor. The T6 ruling
  holds.
- **Height and speed survive patches.** `measurement` is in `SCENE_FIELD_KEYS` (set whole) and `tokens` in
  `SCENE_RECORD_KEYS` (each token upserted whole), so a cleared `elevation` reaches players. On the Obsidian player's
  side, `RemoteSceneMemo` rebuilds each changed token through `atlasToken`, so it is not merged onto the old one.
- **Speed privacy is fail-closed** (area c). A speed is sent only when the rules name steps and Atlas's `sideOf` says
  `players`. This matches Atlas's own `DragRuler.isPlayersOwn()` and `getPlayerViewLayers()`: players read a speed only
  for their own tokens. The value is clamped and checked for finiteness.
- **Validation and the wire are sound** (areas d and e). The validator mirrors Atlas's limits exactly: 4 steps, names
  up to 24 characters and not empty, `#rrggbb` (the same regex as Atlas's `isHexColor`), multiples in (0, 100], speed
  in (0, 1e5], elevation within ±1e5. Tokens are upserted whole, so a token that lands loses `elevation` correctly.
  Movement and `dragDistance` ride inside `measurement`, which is a scene field set whole. That is the right call (the
  Task 5 ruling).
- **The dice judge matches Atlas** (area f). The chain counting reproduces Atlas's `limit = repeats ? 10 : 1`, the
  rule that a chain goes down only from its first die, and the `explodingFaces` clamp. `critOf` uses `getDiceCrit` with
  the set's groups.
- **The D6 host fix is narrow and safe.** Ending only after Atlas was seen loading avoids false early ends on a tab
  switch.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**I1. Players' drag rulers under "only in a fight" depend on whether players are sent the initiative list, not on
whether a fight runs.**

- Where:
  - Connect `src/app/online/view/tools/toolGrid.ts` (`dragLook`: `scene.initiative?.active === true`).
  - Tabletop `src/board/board.ts` drag ruler (`map.initiative.isActive`), fed on the player board by
    `src/board/sceneAdapter.ts:218` from `scene.initiative`.
- What's wrong: `projectInitiative` (`projectPanels.ts:123`) returns `null` when `!rules.showInitiative` or
  `!state.initiativeTrackerOpen`. With the GM's choice at `combat`, a GM who hides the tracker from players, or simply
  closes it, leaves every player with no ruler during a fight. Atlas's own drag ruler decides on
  `store.getState().initiative.isActive` (`TokenRenderer.ts:348`), whatever the tracker shows. The test in
  `dragRulerTool.test.ts` (`initiative: null` → no ruler) encodes the wrong coupling.
- Why it matters: the README promises "Whether a drag shows its distance at all follows Atlas's setting". Players lose
  the ruler exactly when it matters.
- Fix: resolve the choice at the GM. In `projectMeasurement`, send `dragDistance: 'never'` when the choice is
  `combat` and no fight runs. Send nothing (always) when it is `combat` and a fight runs. The projection already sees
  `state.initiative.isActive`, and the scene re-projects when it changes. Alternatively, send a separate
  `fightRuns: boolean`. Update the page and player-board tests to match.

**I2. Connect's judge of a player's physical throw still uses the old crit and explosion rules, so the GM's log and the
player's 3D board can disagree about the same roll.**

- Where: Connect `src/app/online/tools/physicalRolls.ts:40-71` (`explosion`, `critOf`), used by `physicalRollResult`,
  which owns "the total and the critical result".
- What's wrong: Tabletop's judge now uses Atlas's `getDiceCrit`, `explodingFaces` and `MAX_EXPLOSIONS` (Task 4 ruling).
  Connect's GM-side judge was not touched. Spec 4.2 lists "`physicalRolls.ts`'s judge" among what `atlas-shared`
  replaces, and the new spec section 9 row says the judge "decides critical results with Atlas's own code".
  Examples:
  - A plain `2d20` in a d20 system whose second die shows 20: the player's board (Atlas) says no crit; the GM's log
    says critical success.
  - A d6 with `highFaces: 6`: Connect still considers face 1 an explosion.
  - `PhysicalDie` has no `advantage` field, so the GM cannot leave out advantage's own die as Atlas does.

  There are no false refusals today, because Tabletop now throws a subset of what Connect accepts.
- Why it matters: this is a duplicate rule that contradicts Atlas, in a spot the spec names. Under the standing rule
  ("Atlas's code decides"), this is the redundancy Phase 2 was meant to remove.
- Fix: route Connect's `critOf` through `getDiceCrit`, and the earned-explosion check through `explodingFaces`, with a
  chain counter and `MAX_EXPLOSIONS`. Add an optional `advantage?: true` to `PhysicalDie`, which an older GM ignores,
  and validate it with `isFlag`. Alternatively, if this is deliberately deferred, say so in D2 and the spec section 9
  row, and report it to the user.

**I3. `sideOf` from `atlas-shared` never knows Atlas's player characters, so players' own tokens often get no speed.**

- Where: Connect `src/app/online/scene/projectForPlayers.ts` (`projectMovement`: `sideOf(token as never)`). The same
  root cause affects `projectPanels.ts` and Tabletop `src/board/initiative.ts` `sideOf`.
- What's wrong: Atlas's `sideOf` falls back to `isPlayersToken`. That reads a module-level `PlayerTokenSource`, which
  Atlas sets at plugin load (`src/app/plugin/playerTokens.ts`, `registerPlayerTokens`). Atlas's source is
  `KnownPlayerTokens`: the library's player characters, plus what the players of the campaign being played were given.
  The library part does not need a campaign, so this is separate from D3. In the copied package nobody calls
  `setPlayerTokenSource`, so `isPlayersToken` is always false. A player character with no explicit `side`
  and vision off (common with dynamic lighting off) is treated as `opponents`, and no speed is sent. In the GM's own
  Atlas the same token reads as `players`. The test fixtures all use `vision: { enabled: true }`, so this is not caught.
- Why it matters: this is not a privacy leak, but for a large share of tables the movement-step feature silently does
  nothing on players' rulers. Atlas's own player view would colour the same drag.
- Fix: at the GM, decide "players' own" with more than the token:
  - Connect already knows which tokens players control (party links, `tokenControl`). Treat a token as players' when
    Atlas's `sideOf` says so, or when Connect's party links assign it to a player. That mirrors Atlas's "what a player
    was given".
  - Alternatively, give the shared copy a `PlayerTokenSource` backed by Connect's party links.
  - Add a fixture with a party-linked PC that has no vision.

**I4. Speeds from statblocks are never asked for, so most statblock-linked tokens read as plain distances on the 3D
board and for players.**

- Where:
  - Tabletop `src/atlasBridge.ts` `movementFor`, and its use in `src/board/BoardView.ts` `movement()`.
  - Connect `src/connect/stockRules.ts` `stockMovement`.
- What's wrong: Atlas's `tokenMovement.speedOf` reads a statblock's speed only from `CreatureIndex`'s cache. As
  `tokenMovement.ts` says, it is "null ... while its statblock is unread", and `prepare(tokens)` has to request it
  ahead of the drag. In Atlas only its own canvas calls `prepare`: on hover and on press
  (`InteractionController.ts:226`, `:277`) and in `RangeMarks.ts:183`. Neither plugin calls it. So on the 3D board, a
  token whose speed comes from its statblock (most monsters, and player characters linked to a sheet) gets a speed only
  if the GM happened to hover it in Atlas's own canvas earlier in the session. Connect's projection has the same
  problem for players' tokens. The live check used a token with its own speed of 30, so it did not reach this case.
- Why it matters: "the speed is the token's own, its statblock's or the collection's, as Atlas reads it" (README).
  For statblock speeds that holds only by luck.
- Fix:
  - The live object behind `dragRuler.movement` is Atlas's full `TokenMovement`, which has `prepare`.
  - Tabletop: call it, guarded as `call(movement, 'prepare', [rawToken])`, when a drag or hover starts on the board.
  - Connect: call it for the players'-side tokens of the presented map, and re-project when `CreatureIndex` changes.
    The index has `subscribe`, which Atlas's `tokenMovement` does not wrap; reaching it may need the index itself or a
    short retry.
  - Add a live step with a statblock-linked token.

### Minor (Nice to Have)

1. **The shared index exports labels made by the `t` stand-in, against D1 and its own header comment.**
   `packages/atlas-shared/src/index.ts` exports:
   - `listedSides`, which calls `sideName` and therefore `t`;
   - `RESOURCE_COLORS`, whose labels come from `t`;
   - the whole `pinIcons` namespace, including `getPinIconDefinition(...).label`, `PIN_PLACE_GROUPS[].name` and
     `LOCATION_PIN_ICON.label`.

   None is shown today, but any of them would display a key such as `pin.icon.castle`. Narrow the exports. For example,
   export `pinIcons` members by name (`PIN_ICON_PATHS`, `DEFAULT_PIN_ICON`, `resolvePinIcon`, the tones) and drop
   `listedSides` and `RESOURCE_COLORS`. Alternatively, add a `check:shared` test that fails on such an export.
2. **Plan deviation in Task 3.** The captured-literal snapping table was not added; the ruling says the existing tests
   passed. Those tests do not cover sizes 3 and 4, a Large token on hex-horizontal, or a hex grid with an offset. My
   comparison shows the results are identical, so this is about guarding against future regressions. Add the table
   with the plan's offsets (17,23).
3. **Review focus 5 is only partly tested.** `tests/tokenWriter.test.ts` checks refusal for `move`, `resource` and
   `initiative` only. The live check adds doors and turns. Copy, kill, remove, `initiativeAction`, `addTokensNow`,
   walls, snap, lighting, loot and pins are refused only by reading the code. Nothing checks that the Notice shows the
   bar's text (`BoardView.unsaved`). A table-driven test over every writer method with `held: async () => null` is
   cheap.
4. **The spec section 9 row is inaccurate.** "Connect's older shared bundle ... what is left only draws" is not true.
   Connect still takes rules from `@atlas-vtt/shared/rules`: `parseFormula`, `diceFormula`, `isDieType`,
   `DEFAULT_INITIATIVE_RULES`, `PLAYER_VIEW_RULE_KEYS`, `SIDE_LABELS`, `sidesInOrder` and `LASER_COLOR_SWATCHES` (20
   imports). Reword the row, or list these as left for Phase 4.
5. **Some comments are stale or misplaced.**
   - Tabletop `src/board/initiative.ts:1-12` still describes applying changes "to the file" and `fileCannotRun`.
   - `src/board/tokenWriter.ts:92-99` duplicates the `NotHeldError` doc block.
   - `src/board/board.ts:151` leaves the accent docstring sitting above `errorColor`.
   - The `src/board/laser.ts` header reads "ported from `pixi/laser/`: its eight colours and its size", which is now
     wrong.
6. **`LASER_COLOR_NAMES` is matched to Atlas's colours by index** (`src/board/laser.ts`). If a later Atlas reorders or
   adds a colour, the names shift silently. Key the names by value (`'#ff0059' → 'Red'`).
7. **`TokenWriter.offers()` returns true when the map is not held.** The tracker then offers Clear and Sits out, which
   are then refused. That is acceptable under the bar, but hiding them, or saying "Edit here", would be clearer.
8. **`heightLift` calls `host.measurement()` for every token on every animated frame** (`board.ts`, in the tick loop).
   In `BoardView`, that function runs `readMeasurement`/`resolveMeasurementSettings` each time. Cache the value once
   per frame.
9. **The Task 4 ruling keeps Tabletop's sign for a subtracted die that explodes down,** where Atlas makes it add. It is
   rare, but it is a known divergence from Atlas inside a judge that claims Atlas's rules. Either follow Atlas
   (`negative = up === parent.negative`) or record it in the spec section 9 row.

## Rulings weighed

- T1 (stub shape, namespaces, the follow ending only after loading was seen): agree.
- T2 (thin wrappers kept, laser names from the old bundle, no new pinning cases, items left on the old bundle): agree,
  except that the resulting spec row is inaccurate (Minor 4).
- T3 (cell-number finder kept; tsconfig ES2023): agree. On the dropped snapping table: acceptable given the results are
  identical, but the table should still be added (Minor 2).
- T4 (Atlas's crit and explosion rules change three outcomes): agree for Tabletop. It leaves Connect's judge
  inconsistent (I2). The subtracted-die sign: see Minor 9.
- T5:
  - Speeds from the GM's running drag ruler: agree with the source, but see I4 (it must be prepared).
  - Speed only for the players' side: agree with the privacy goal. I disagree with the cost the ruling accepted ("a
    monster a player was given control of reads as a plain distance"). The copied `sideOf` also misses the library's
    player characters (I3), so the cost is much wider than stated. Party links should count as players' tokens.
  - Fields inside `measurement`, and no steps for the Obsidian player's Atlas: agree.
  - Sending the `combat` choice raw is the root of I1.
- T6 (burrowing drawn on the floor; rise for lines only; hit test from the world box): agree. This matches Atlas's
  `rulerRise`.
- T7 (live rules first, stored rules as fallback; past the last step in `--text-error`): agree, with I4 for statblock
  speeds.
- T8 (`floorState.follow`; wiring in `BoardView` not unit-tested): acceptable. The live check covered the old-Atlas
  floor.
- T9 (tracker engine moved to `harness/fakeTracker.ts`; methods resolve to void; `transfer` without `follow` refused):
  agree. Nothing in `src` imports from the harness.
- T11 (Phase 1 live script reads versions from the builds): agree.

## Declined to judge

- `countPerTurn` (what a token moved earlier in the turn) is not added on any ruler: deferred by D5 and reported to the
  user.
- Party links not fused with Atlas's `players.json`: deferred by D3 (no campaign vault to check against).
- The Obsidian player's own Atlas ruler shows no step colours: the remote measurement input has no field for them
  (Task 5 ruling); it needs an Atlas-side input.
- Neither the players' rulers (page, player board) nor the GM board ruler count Atlas's own map-feature difficult
  terrain, or Atlas's even-footprint `cellPath` shift. This was already so before Phase 2; spell terrain moves to
  map features in Phase 3 (G2).
- The web page's measure tool does not count token heights between tokens: not in Task 5's scope.
- The Tabletop initiative panel's `sideOf` has no player-token source: it behaved the same before Phase 2. The fix for
  I3 would cover it.
- Fog replays still duplicated: D2 and spec section 9, with reasons.
- An edit queued while Atlas is still loading is not recorded in the undo history: behaviour from Phase 1, unchanged
  here.
- `transfer` can leave a token on both maps when Atlas does not come back: behaviour from Phase 1, documented in the
  README.
- The d100 ones die, and how it is logged for crit purposes: not examined in depth; unchanged by this diff apart from
  `getDiceCrit` reading `max`.
- The two harness camera-timing flakes: reported by the executor; not re-run.
- Commit trailers: later commits end with `Claude Opus 5.5` instead of the plan's `Claude Fable 5.2`. This follows the
  session's attribution instruction, which changed mid-run; not a code issue.
- Running the suites myself: they write build folders into the checkouts, which this review must not touch. I relied on
  the executor's numbers and my own scratch comparison.

## Recommendations

1. Fix I1 by resolving `combat` at the GM. It is a one-line change in the projection plus test updates, and covers both
   player rulers.
2. Fix I2 by moving Connect's physical judge onto `getDiceCrit`, `explodingFaces` and `MAX_EXPLOSIONS`, with an
   optional `advantage` on the wire. Alternatively, record the deferral explicitly in D2 and the spec.
3. Fix I3 by adding Connect's party links to the "players' own" test for speeds, with a no-vision PC fixture.
4. Fix I4 by calling Atlas's `movement.prepare` from both plugins, and add a live step with a statblock-linked token.
5. Tighten the shared index exports (Minor 1) before Phase 3 adds more consumers.

## Assessment

**Ready to merge?** With fixes

**Reasoning:** The core of Phase 2 is correct and well guarded: the file engines are gone, the store writes are
synchronous, and the height, movement and snapping code is Atlas's own with no NaN or throw paths. Snapping is
identical to before. Four issues should be fixed before shipping:
- players lose the ruler in fights when the initiative list is hidden;
- the GM's dice judge still disagrees with Atlas;
- speeds rarely reach player characters, because the copied `sideOf` cannot see Atlas's player-token source;
- statblock speeds are never prepared, so the movement steps work reliably only for tokens with a speed of their own.
