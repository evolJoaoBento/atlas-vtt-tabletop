# 4D review: sight follows Atlas

Reviewer: one fresh reviewer (Opus 5.5), review only.

**What I read:** the plan, spec sections 8 to 10, the ledger, the inventory, both diffs, and the code at HEAD in both repos. I read the 0.16 probe in full and diffed it against the 0.15 probe. I also read the Atlas 0.16 ref source for when sight is recomputed: any change to the level's token record rebuilds the model (`sceneModel.ts:133`), and `LightingRenderer` updates synchronously from its store subscription.

**What I ran:**
- Tabletop `atlasSight` and `sightWatch` tests: 6/6 pass.
- Connect `vitest stockLighting`: 16/16 pass.
- `packages/atlas-host/src/lighting` is byte-identical in the two repos.
- I timed `Uint8Array(384*384).join('')` in node: about 3.2 ms.

All findings below come from reading the code. None was reproduced live.

## Findings

**1. Critical: a quality change unveils the GM's player window.** `BoardView.ts:552-569` and `board.ts:679`.
- **Why:** when the antialias setting differs (Low against Medium or High), `applyQuality` builds a new `Board`, and a new board starts with `atlasSight = UNLIT`. The code then runs `load` and `attachPlayer`, but never `followSight()`. `SightWatch` answers only when the watch signature changes, and an idle scene never changes it.
- **Scenario:** a lit dungeon is on the TV. The GM switches Quality from Medium to Low. The whole map is shown, and every token that is not hidden or fogged, until something changes in Atlas.
- **Fix:** call `this.followSight()` after `fresh.load`. Better still: `SightWatch` keeps its last answer and hands it to every board `makeBoard` creates. Do not make `PENDING` the Board's default: Connect players' own boards rely on `UNLIT`. Add a harness case for it.

**2. Important: a host with no viewed level answers for any level.** `sightWatch.ts:29`; the test at `tests/sightWatch.test.ts:14` locks this in.
- **Why:** to Atlas, an unset `viewedLevel` means the first level. The board can show another level while the host's `viewedLevel` is still null: `shownLevel` falls back to the presented scene's `levelId`, and `switchLevel` keeps `chosenLevel` when `setViewedLevel` throws or is missing.
- **Scenario:** the upper floor is presented while the host tab never set `viewedLevel`. The player window shows the upper floor under the ground floor's raster, so upper props, walls and floor are revealed where the ground is lit. Tokens stay hidden.
- **Fix:** test `resolveLevel(map.levels, viewed) === map.level`. That means passing `levels` in `SightMap`.

**3. Important: tokens are judged by id, not by where the board draws them.** `board.ts:1207` (players' line), with the board's own drag (`:3785`, `:3795`) and glides.
- **Why:** Atlas's perception is for the token's place in its last answer. The players' picture uses `entry.at`, which moves during a GM drag on the 3D board (group members included) and during the glide after a store move. Before 4D, tokens were judged by position. Props still are.
- **Scenarios:** a seen goblin dragged through a dark corridor stays on the TV until the drop. A token that ends seen glides visibly out of the dark, which shows where it came from.
- **Fix:** while a token is held or gliding, also require `sightMask.seenAt(entry.at)`. This fails closed, and it may briefly hide a token seen in the dark. A seen-place tolerance would hide every seen token during every ordinary glide.

**4. Minor: the veil drops during a rename.** `sightWatch.ts:34` (`withoutHost(null)` returns `UNLIT`) and `BoardView.ts:1958`.
- **Why:** the rename handler sets `path` before `reload()` finishes. A `watchAtlas` in that gap passes `map = null`, so the old map loses its veil until the reload completes.
- **Fix:** `PENDING` for null, and update that assertion in `sightWatch.test.ts`.

**5. Minor: the veil does not cover board area outside the raster.** `sightVeil.ts:51-73`.
- **Why:** blocks exist only for raster cells. If the board is bigger than Atlas's worldRect (for example `FALLBACK_SIZE` when the texture fails, or a stretch mismatch), that strip shows floor and walls. Pieces in it are hidden, since `cellShown` treats off-raster as dark.
- **Fix:** add blocks beyond `cols*cellSize` and `rows*cellSize`.

**6. Minor (performance).**
- **Veil key:** `sightVeil.ts:45` joins the whole raster (about 3 ms at 384², twice with a POV) every time the sight key changes. The key includes quantised piece positions, so this happens on every glide on any lit scene, even with no player window open. Key the veil on the `shown` buffer's identity (fresh for each answer) plus size and height, and rebuild it only for `sightRevision`, size or height.
- **Poll:** the 250 ms poll is cheap (about 16 identity reads).
- **Duplicate raster:** Tabletop's reader computes the 384² raster separately from Connect's, and once more for a POV.
- **Raster cache:** a hit does not refresh an entry's place among the 8 kept (`playerVisibility.ts:229-236`), so many POV switches can evict the players' raster. The cost is a rebuild only.

**7. Minor: two readers can unhook each other.** `playerVisibility.ts:193`.
- **Why:** Tabletop's reader and Connect's both wrap `controller.onSightChange`. If the outer one stops first, `delete` also drops the inner wrapper, and the inner reader never re-hooks. It falls back to the store subscription and the poll, so async changes arrive up to 250 ms late. That is lag, not a leak.
- **Fix:** if `onSightChange` was an own property before wrapping, restore `original` instead of deleting.

**8. Minor: Preview POV of a hidden token, or on a scene with no vision tokens, is black.** `currentSight()` is the players' sight. Document it, or add a note on the POV chip.

**9. Minor: no compile-time check of the copied types.** `stockAtlas.ts:914` casts with `as unknown as`. The shapes match today; I compared them by hand. Add an assignment check against `@atlas-vtt/api-types` `LightingApi` in Connect.

**10. Minor: leftovers.**
- `README.md:74` still mentions "line of sight".
- `BoardView.ts:1951` has an orphaned doc comment.
- A rebuilt board keeps a stale `povId`, so a POV raster is worked out for nothing.

## Judged in particular

1. **Fail-closed:** the host on another map, loading, or switching lighting gives `pending`; the `isEnabled()` against `savedLit` check holds. A store-driven reload hands its answer before the next frame. The gaps are findings 1, 2 and 4.
2. **Tokens:** hidden tokens, fog and boxes are still applied (`playerSees`, `underBox`). Stacked layers are not shown in the player window. A token Atlas does not list is unseen. The gap is position (finding 3).
3. **POV:** correct.
   - The `tokenId` filter is right.
   - The per-token sight is memoised by a WeakMap on the view's sight, so the raster key (`viewId:cells:token`) gets cache hits.
   - Explored memory is null for a POV.
4. **Deletions:** nothing still needs a removed symbol. `canSee`, `visibilityPolygon` and `effectOn` remain for spells and windows. Old settings are dropped at load (`main.ts:250`), and `readQuality` reads only the preset name. Only the README leftover remains (finding 10).
5. **Connect:** behaviour is unchanged by the move, apart from finding 7 now that two readers exist. The types match structurally, with no compile-time check (finding 9).
6. **Performance:** see finding 6.

Plan Review Focus 3 and 4: props, pins, door sounds and spell anchors use `seenAt` or `pointBeyond`. Templates, pings and lasers draw over the veil, as before 4D. A cutscene reveal bypasses sight and keeps hidden tokens hidden.

## Declined to judge
- Whether Atlas's own player window shows a token mid-drag. This decides whether finding 3 goes beyond Atlas.
- The cutscene camera flake (Task 3 ruling). I cannot run it.
- Whether `writer.holder` and `tabViewOf` can differ.
- Raster alignment for stretched or per-level worldRects, beyond finding 5.
- Probe `tokens[]`: the seer is listed `hidden: true, vision: null` yet has regions and reads seen. This looks like a pre-setup snapshot, but I did not confirm it.

## Verdicts on rulings I disagree with
- **Task 2, the player-window ruling ("cost if wrong: none"):** disagree. Sight lives on the `Board` instance, and a board rebuilt in place never gets it back (finding 1). The cost is a fully unveiled players' picture.
- **Task 2, D5 as built ("viewedLevel unset or the board's level"):** disagree. Unset means the first level (finding 2).
- **Task 3, the flake ruling:** declined.
- All other rulings: agree.
