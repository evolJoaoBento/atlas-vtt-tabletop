# Tabletop TODO: catching up with the Atlas changelog (0.2.0 to 0.10.2)

Derived from the Atlas announcements changelog. NOT yet audited against Tabletop's code.
Step 0 of every item: confirm current state (done / partial / missing) before building.
Rules: build, copy main.js/styles.css/manifest.json to the vault folder, checksum-verify, tell the user to reload Obsidian. No commits.

Take Atlas schemas and method names from atlas-vtt/main.js (0.10.2), not atlas-vtt/src.

## Where it stands (2026-10-30, after the overnight run)

Everything that can be built and tested without a live Atlas is done. Tests: `npm test` (unit), `npm run test:ui` (the features checks, with screenshots) and `npm run test:ui:all` (those plus the full board checks), see the README. What is left, and why:
- [~] 3 Native statblocks: Tabletop's own sheet reads the 5E, Cairn, Draw Steel, Fate, B/X, percentile and generic templates as text; boxed and gauge numbers, counters and tracked numbers are display modes Atlas keeps in its templates (not in the notes), and Atlas's own card, which the drawer and hover already use, draws them.
- [!] 11 Public-roll toggle: Atlas's roll mode (public, GM, whisper) belongs to its chat, and its dice tool puts no flag on a `dice-rolled` roll. Needs a look at a live Atlas roll.
- [~] 13 `@` values: Atlas's own card resolves them and Tabletop logs the ability name it sends; Tabletop's text sheet has no `@` rolls.
- [x] 35 Localization: Atlas ships no translations, so Tabletop adds none (decided 2026-10-30); the layer stays for when it does.
- [ ] 32, 33, 34: a positioning decision for you, Connect's side, and Connect's repo (not Tabletop code).
- Never tried in a running Obsidian or Atlas (only in the headless browser harness): everything marked "not tried" in the items above, notably the Open in 3D button in Atlas's toolbar, the protocol link, the code block and snapshot saving.

## Atlas 0.11.0 (Mosaic Canvas), 2026-10-31

Checked against the 0.11.0 release build (the vault still runs 0.10.2; 0.11.0 was never run live).
- [x] Private members: `npm run check:atlas` finds all 17 in both the 0.10.2 and the 0.11.0 `main.js`; the store, tab and dice names Tabletop and Interactive Dice read are unchanged.
- [x] Huge maps: the board decoded the whole file (an `<img>`), which fails past about 150 megapixels. Maps of 8 MB and up now come as a picture from Atlas's tile service (`src/atlasMosaic.ts`, through `view.renderer.getMapImage().deps.service`), falling back to the file where Atlas has no such service.
- [x] 20 million squares: the grid is whole lines (or none for a hex grid too fine to draw) instead of tens of millions of edges, and `numberCells` no longer lists every cell (it also overflowed `Math.max(...)` at that size). Board check: a 65,535 px world with 14 px cells loads in seconds.
- [ ] Not tried live: the tile service route, which needs Atlas 0.11 running with a map over 8 MB.

## Phase 1: Protect what is shipped (compat)
- [x] 1. Audit pop-out windows. Atlas 0.10.2 moves itself back to the main window. Check the board, drawer and dice delivery to Atlas.
  - Audited: Atlas 0.10.2 detaches extra atlas-vtt leaves on layout-change and keeps one in the main window. Tabletop's rollView() uses getLeavesOfType('atlas-vtt') and picks by map path, so it still finds that one leaf. No code change. Not tested live in Obsidian.
- [x] 2. Add a smoke check for every private Atlas member Tabletop uses (atlasDice.ts, atlasPreview.ts). Atlas 0.10.0 crashed with third-party Atlas plugins, so we must never trigger that.
  - Done: `npm run check:atlas` (scripts/check-atlas-members.mjs) greps Atlas's main.js for the 15 private members Tabletop uses. All present in 0.10.2. Note `remoteView` no longer exists in 0.10.2, so isRollView's remoteView check is a harmless no-op.
- [~] 3. Native statblocks (0.8.0): make atlasCard, atlasPreview and the Ctrl+hover card read them, not only Fantasy Statblocks.
  - Text sheet done (src/sheets/nativeSheet.ts, tests/nativeSheet.test.ts): reads `atlas-template` notes (Cairn, Draw Steel, Fate, B/X, percentile, d20, generic, custom). Drawer card and hover already use Atlas's own renderer. Unit-tested only, not checked live. Not yet read: Draw Steel ability sub-fields (cost, distance, target, tiers), spells, counters, boxed/gauge display, `@` references, the 32 KB rule, shared statblocks.
  - [ ] templates (5E 2014/2024, Cairn, Draw Steel, Fate)
  - [ ] boxed and gauge numbers
  - [ ] counters and tracked numbers
  - [ ] `@` references (`1d8 + @str.mod`, also by label)
  - [ ] the 32 KB skip rule
  - [ ] several tokens sharing one statblock
- [x] 4. Token resources: up to 6 per collection, HP and secondary bars living in the Resources tab, and fixed values such as AC showing when 0. Use these in the sheet drawer and hover card.
  - Audited, already done: src/board/resources.ts is a port of Atlas's resources (6 sockets, 2 bars plus 4 wheels, static values such as AC shown at 0, per-resource player visibility). Open gap: the sheet drawer shows the statblock's own HP/AC, not the token's live resources; the Ctrl+hover preview is Atlas's own window and mirrors hp and stress only.
- [x] 5. Token numbering: match Atlas (players see the GM's numbers, hidden tokens still count) in labels, minis and the hover card.
  - Audited, already done: src/board/levels.ts instanceBadgeNumbers follows Atlas 0.10 (hidden tokens count, shown to every screen). Not checked live.

## Phase 2: Dice
- [x] 6. Notation parser: kh/kl/dh/dl, rerolls, explosions, success counts, d%, Fate dice, labels. Reject invalid or oversized formulas with a clear message.
  - Done (rollRules.ts, rollSession.ts, tests): `kh/kl/dh/dl`, `d%`, success counts (`>=`, `>`, `<=`, `<`, `=`, optional `cs`), clear refusal messages (explainFormula, shown by the sheet drawer and card rolls). Rerolls done 2026-10-29: `r`, `ro` (once) and `rr` (up to 10) with `<`, `<=`, `>`, `>=`, `=` (a bare `r` rerolls ones), as Atlas 0.10.2 reads them; a rule every face meets is refused, and a rerolled die waits to be thrown again like an explosion. The player board handle says `rerolls: true` (2026-10-29), which Connect waits for before it sends a reroll rule, and a thrown-away die is listed right before its replacement, as Atlas lists them.
  - Done 2026-10-30: Fate dice (`4dF`, `dF+2`): thrown as d6s on the table, each face reading minus, blank or plus (two faces each), summing to the total, sent to Atlas as `dF` dice with `min -1`, shown as + / − / 0 in the log and card; refused with a clear message when mixed with keep, drop, reroll or success rules (Atlas's own `dF` takes none), subtracted, or over 20 dice; a Fate die never explodes and is no critical. Labels (`2d6[fire]+1d6[cold snap]`): a label of 1 to 24 letters, numbers, spaces, apostrophes or hyphens after a dice group names those dice (kept in order, a group without one keeps its place), rides through explosions, rerolls and advantage, is sent to Atlas on each die as `label`, and shows once before its run of dice in the log; refused on a plain number or when badly formed. Explosion notation in formulas is still the collection's rule only. Tested: unit tests (rollRules, rollSession) and in a browser (`features-test.cjs`, screenshots `fate-log.png`, `fate-table.png`).
- [x] 7. Show dropped and rerolled dice struck through on the 3D dice and in the log.
  - Dropped dice show struck through in the log and card (diceLog.ts `is-dropped`), and keep/drop marks dice dropped. Rerolled dice (2026-10-29): the roll keeps the die thrown away, marked `rerolled` (counts for nothing in the total, successes or critical), sent to Atlas as `rerolled: true`, struck through in the log and card. Done 2026-10-30: on the 3D table the dice a finished roll sets aside (dropped by a keep rule or advantage, or thrown again by a reroll) are drawn dimmed (35%) until the roll changes (`RollSession.setAside`, `DiceTable.setAside`); a die still waiting to be thrown is never dimmed. Tested in a browser: `4d6kh3` on 5, 1, 6, 3 dims only the 1, not before the roll is complete, and the log and card strike the same die (`set-aside-dice.png`).
- [x] 8. Per-collection dice rules in rollRules.ts: default roll, critical rule, exploding dice. Also Dice Lab sets (colours and names).
  - Audited, already done: atlasDice.ts diceRulesOf/readRules read default roll, crit rule, explode rule and dice sets (groups, colours, names, advantage and disadvantage) from the collection or the view's dice tool.
- [x] 9. Advantage and disadvantage: right-click a die.
  - Shift (advantage) and Alt (disadvantage) already work on sheet and card rolls. Done 2026-10-30: right-clicking a die in the tray shows its colours and an Advantage / Disadvantage choice under them (`edgeFor` in dicePicker.ts): it adds the die when none is picked and sets the side, a second click takes the side back, and it is disabled where the side changes no roll (a die that is not the set's own, or keeping the best with two d20). Atlas's own tray has no such gesture (nothing in its bundle or changelog), so this follows Atlas Online as the item described it; the existing Normal / Advantage / Disadvantage choice stays. Checked in the harness only.
- [x] 10. Initiative rolls: add the statblock modifier and the per-combatant modifier.
  - Audited, already done: src/board/initiative.ts reads the statblock modifier and the combatant's own modifier (edit popup).
- [!] 11. Respect the public-roll toggle, and keep rolls, sounds and history in the view that made them.
  - Blocked: Atlas 0.10.2's dice tool puts no public/GM flag on the `dice-rolled` roll that I could find (its roll modes belong to chat). Needs a look at a live Atlas roll before this can be built.
- [x] 12. When 3D dice cannot draw, fall back to a roll card.
  - Not applicable: Tabletop's own board is 3D, and rolls already show as a card over the board (diceLog.ts).
- [~] 13. Name the `@` values a roll used (for example "Agility").
  - Atlas's own card resolves `@` references and sends the formula and ability name; Tabletop logs that name. Not checked live.

## Phase 3: Tokens and minis
- [x] 14. Sizes Medium to Gargantuan and per-asset default size. Scale the mini footprint and snap Large and Gargantuan to whole cells.
  - Token size and mini scale were already read from the token (`size`, covers 2*size-1 cells). Added: even-sized tokens (Large 1.5, Gargantuan 2.5) now snap to the meeting of their cells, square and hex, as Atlas's snapTokenCenter does (geometry.ts snapPoint(size), board.ts call sites, tests/geometry.test.ts). Per-asset default size is Atlas's spawn step, not Tabletop's. Unit-tested only, not dragged live.
- [x] 15. Tokens glide into place instead of jumping.
  - Audited, already done: board.ts header says tokens snap and glide to their place.
- [x] 16. Shift multi-select with group drag, group rotate and group HP change. Dragging does not select.
  - Done: Shift-click adds or removes a token from a selection (rings drawn under them), dragging any selected token moves them all (groupMove.ts, groupMarks.ts, tokenWriter.moveMany). Done 2026-10-30: with two or more selected a bar shows over the board (`groupActions.ts`): the count, rotate left or right 45 degrees (each click one saved change for the whole group, `tokenWriter.rotate`, one undo through Atlas's `updateTokens`), an HP amount with Damage and Heal (each token that tracks HP changes by it, clamped to 0 and its maximum), and Clear. Tested in a browser with real clicks (`harness/features-test.cjs`, screenshots `group-bar*.png`) and in unit tests (`tests/groupActions.test.ts`).
- [x] 17. Ring colour applies to all selected tokens in one undo step.
  - Not applicable: Tabletop's token menu has no ring colour (that is Atlas's own right-click menu).
- [x] 18. Player-visible resource wheels over minis, with the per-resource switch.
  - Audited, already done: labels.ts shows resources through visibleResources(..., viewer), with the per-resource player switch.

## Phase 4: Board rendering (core)
- [x] 19. Grid transforms: scale, offset, stretch and angle from the Spectral Engine. Also:
  - Done: Atlas's `grid.mapStretch` (map image turned up to 5 degrees and stretched 1 to 1.5x) now lays the image on the 3D board and sizes the board to the stretched world (src/board/mapStretch.ts, surface.ts, board.ts, tests/mapStretch.test.ts; math ported from Atlas 0.10.2 xH/oxe, agreement with Atlas's mapping unit-tested). Not checked visually. Done 2026-10-30: per-level `levelAlignments` (`readLevelAlignment`, `alignedGrid`: the level's own stretch times its scale, turn and offset replace the scene's stretch, as Atlas's `Uf`), unit-tested and checked in a browser (a level stretched 1.4 by 1.2 makes a board 1.4 by 1.2 times as large). Already present before: cell numbers, hex grids, diagonal rules, unit distance read from the scene's raw grid (`readMeasurement`). Not checked: ruler snap, cone measurement.
  - [x] per-scene distance per cell, decimals included (measure.ts `readMeasurement`, `formatDistance`; tests/measure.test.ts)
  - [x] A1 cell numbering (cellNumbers.ts; letter-number, column-row and sequential, square and both hex layouts; tests/cellNumbers.test.ts)
  - [x] hex grids (geometry.ts snapping for pointy and flat hexes, hex step distance; tests/geometry.test.ts, measure.test.ts)
  - [x] ruler snap (a drag shows the ruler from the token's snapped cell and drops waypoints with Space; browser checks 1g in harness/board-test.cjs)
  - [ ] game-system cone measurements: not done. Tabletop's ruler measures paths; cone, line and sphere shapes are Connect's Template tool (the toolbar button shows while Connect hosts).
- [x] 20. Large maps: the 8192 px downscale rule, up to 144 MP, the GPU texture limit and the Saver/Balanced/High quality setting.
  - Done: a map larger than 8192 px on its longest side is drawn from a scaled-down copy of that size while the board keeps the image's true size (textures.ts loadMapTexture, fitTexture, mapImageSize; board.ts; tests/mapTexture.test.ts), so tokens and the grid stay in the image's pixels. Done 2026-10-30: the copy is also never larger than the graphics card's own texture limit (`renderer.capabilities.maxTextureSize`, which can be 4096 on a small card), checked in a browser with a 3000 x 2000 map on a card limited to 1024 (the board keeps 3000 x 2000, the texture 1024 x 683, same proportions; screenshot `large-map.png`). The Saver/Balanced/High setting is Atlas's lighting setting; Tabletop's own Low/Medium/High (settings page) does that job: resolution, antialiasing and shadow detail, and it lowers itself while the frame rate drops. Not tried with a real 144 MP map.
- [x] 21. Dispose three.js geometries and textures on reload and scene load. Add a WebGL-unavailable fallback.
  - dispose() exists across board.ts, pieces.ts and surface.ts. Checked 2026-10-30 in a browser (`features-test.cjs`, 'memory on reload'): loading the map again six times, and going to a video map and back, leaves the renderer's geometry and texture counts where they were (`renderer.info.memory`). This is a headless check of the board alone, not of Atlas's own leak fixes or a long live session. WebGL-unavailable fallback done 2026-10-29 (src/webgl.ts): without WebGL the GM's board tab shows why (and how to turn hardware acceleration on) instead of staying blank, and tries again on the next load; a second context refused for the player window is skipped, not thrown; `api.playerBoard` is absent without WebGL, so Connect keeps its 2D map. Unit-tested probe only, not tried with WebGL off.
- [x] 22. Map layers with a layer switch.
  - Levels (Atlas 0.10 layers) are modelled (src/board/levels.ts, levelBackground, onLevel) with a level switch in atlasMenu/BoardView. Checked 2026-10-30 in a browser (`features-test.cjs`, 'map levels'): the ground floor shows its tokens, those on every floor and those with no level; the upper floor shows its own and the every-floor ones with its own background; an unknown level reads as the first. Also screenshots `level-*.png`.
- [x] 23. Animated maps: WebM and MP4 as video textures. Support "Replace map image" (keeps grid, walls, lights and tokens).
  - Done 2026-10-30: a map whose background is a `.webm`, `.mp4`, `.m4v`, `.ogv` or `.mov` plays as the board's floor (`loadVideoTexture` in textures.ts): muted, looped, at the video's own size (the board and its grid take that size), redrawn about thirty times a second while it plays (not when the board is hidden), and the video stops and lets go of its file when the map changes or the board closes. Replacing the map image (a new background on the same map) keeps the tokens (checked with a real WebM in a browser; walls and lights are redrawn from the same map file). Tested in a browser (`features-test.cjs`, `make-test-video.cjs` makes the clip; screenshot `animated-map.png`) and a unit test of the format check. Not tried with a real MP4 (Obsidian's Electron plays H.264) or a large video.

- [x] 24. Walls, doors and one-way walls in 3D.
  - Audited, already done: walls.ts, wallPieces.ts and board.ts draw walls and doors (open, locked) and light respects one-way walls (tests/walls.test.ts).
- [x] 25. Design spike: fog, explored areas, dynamic lighting and player sight in 3D. Hidden tokens give no sight, and tokens under fog are hidden from players. Decide scope before building.
  - Decided, no build needed: Tabletop's board is the GM's, who sees everything, so the player-sight and explored-area model of Atlas's dynamic lighting is not needed here. Tabletop's lights are its own point lights from Atlas's light data (lightRig.ts) and fog comes from Atlas's fog strokes (fog.ts).
- [x] 26. Implement the lighting and fog design from item 25.
  - Not applicable after item 25.

## Phase 5: Initiative and play flow
- [x] 27. Active-combatant ring, turn banner (flash only) and defeated and delayed states on the board.
  - Done: a green ring under the combatant(s) whose turn it is (BoardView.showInitiative, Board.setActiveTokens). Done 2026-10-30: a banner flashes at the top of the board when the turn passes ("Round 2 · Goblin"; not when the board opens mid-fight; `turnAnnouncement` in initiative.ts), and a clock marker shows over a token whose combatant holds its turn back (`delayed`; `Board.setDelayedTokens`). Defeated tokens were already drawn greyed, with a skull, lying down. Tested in a browser (`features-test.cjs`, screenshots `turn-banner.png`, `delayed-marker.png`) and unit tests.
- [x] 28. Player clicks a combatant in the initiative list to find its token.
  - Audited: the GM side already has the tracker click that moves the camera to the token (Board.showToken). The player-side list is Connect's.
- [x] 29. Respect "players move only on their turn".
  - Audited: players' moves go through Connect's canMove (playerBoard.ts), which is Connect's rule to enforce.
- [x] 30. Board context menu: Add to Initiative, spawn from an encounter, and the Atlas token placement preview.
  - Add to Initiative / Remove from Initiative is in the token menu (tokenMenu.ts, tested). Spawning from an encounter and the placement preview are Atlas's own encounter builder steps: like item 31, they put tokens into the map file, and the 3D board shows the map's tokens as they appear, so there is nothing for Tabletop to add. Settled 2026-10-30.
- [x] 31. Random encounter pins and Encounter Builder spawns (random counts such as `2d4 Wolves`) on the 3D board.
  - Not applicable: Atlas's encounter builder and random-encounter pins put tokens into the map, and the 3D board shows the map's tokens as they appear. Nothing for Tabletop to add.

## Phase 6: Connect and crossover
- [x] 32. Decide Tabletop and Connect positioning now that Atlas Online (0.8.0 beta) exists.
  - Decided 2026-10-30: Connect stays a free alternative while there is no self-host; once a self-host exists it will use it, acting as a relay (not relevant yet). Tabletop is neutral and works with both: the README names Connect and Atlas Online side by side and depends on neither.
- [ ] 33. Read campaign player characters, the Players tab and shared HP instead of keeping a separate copy.
  - Not started, and mostly Connect's side. Tabletop already shows each token's own resources, which Atlas keeps shared for the same player character.
- [ ] 34. Refresh src/connect/stockRules.ts (in Connect) and update BACKLOG-atlas-compat.md.
  - Not started: it is in the Connect repo, which I have not opened. The member check (npm run check:atlas) covers Tabletop only.

## Phase 7: Polish
- [x] 35. Localization: Atlas follows Obsidian's language, so add an i18n layer for Tabletop's UI strings.
  - Settled 2026-10-30: Atlas ships no translations (no language files or language setting in its source), so by the rule "translate what Atlas translates" Tabletop adds none and stays English, as Atlas is. The layer (`src/i18n.ts`: `t(key, values)`, `languageOf`, `setLanguage`, English base, tested with a stand-in language) stays, and the controls added in this work already read their words through it, so a language is one table once Atlas offers it.
- [x] 36. Narrow-pane toolbar: follow Atlas's "More tools" behaviour.
  - Done 2026-10-30: found with a browser test that the bar ran off the edge of a 330 px pane. `BoardToolbar.fit()` now moves the tools farthest from the Move group (the end slot with Dice, log and sheet, then the settings button, the lighting button, the template tool) into a "More tools" menu above the bar, one at a time until the bar fits, and brings them back as the pane widens; Escape or a click outside closes the menu. Tested in a browser (`features-test.cjs`, screenshots `narrow-toolbar*.png`): inside the pane, the menu inside the pane, back at full width.
- [x] 37. Scene links and embeds, and snapshots: open or link a board from notes.
  - Done 2026-10-30 (`src/boardLinks.ts`, `src/boardCard.ts`, main.ts): the command "Copy a link that opens this map in 3D" copies a Markdown link of the form `obsidian://tabletop-board?vault=...&map=...`, which opens the map in 3D when followed (anything that is not an `.atlasmap` in the vault, or reaches out of it, is refused with a notice); "Save a snapshot of the 3D board" saves the picture the board shows as a PNG in `Tabletop snapshots/` and copies its `![[embed]]`; a ```` ```tabletop ```` code block holding `[[Maps/Cave.atlasmap]]` (or a path, with an optional `|caption`) shows a card in the note with the map's latest snapshot and an Open in 3D button. Tested: unit tests for the links, the block and the file names; in a browser the board gives a real PNG of its own size that is not blank, and the card shows the title, the snapshot and a working button (screenshot `board-card.png`). Not tried inside Obsidian (the protocol handler, the code block and the file saving are written against its API but only the pure parts and the card run in tests).
- [x] 38. Check light-theme readability (ruler labels, player window).
  - Done 2026-10-30: the board's panels, menus, group bar and turn banner were checked in a browser with Obsidian's light theme colours (text contrast at least 4.5 on each; screenshots `light-*.png`). It found one problem, fixed: Tabletop's Atlas-look menus took the text colour of whatever the board sits in (white on white in a light theme); the root now sets `color: var(--text-normal)` as Atlas's own root does. The ruler's labels and the token plates are drawn with their own dark plates and white text, so they read in any theme; the player window is a fixed dark screen by design. Not looked at in real Obsidian's light theme.

## Ordering rationale
Phase 1 first (cheap, protects shipped behaviour). Phase 2 and 3 are visible wins with low risk. Phase 4 is the largest; items 25/26 need a design decision first. Phase 6 depends on strategy, not code.

## Look (2026-10-29, from a talk on a small game's renderer)
- Done: `src/board/look.ts`. The renderer uses a neutral tone mapper (ordinary colours unchanged, only the brightest roll off toward white, no hue skew), the sun is a warm key and the sky a cool fill with more contrast between them (top surfaces keep the same brightness, so the map's art is not shifted), shadow edges are softer (`shadow.radius`), and the background is a dithered vignette. Checked in the headless harness (swiftshader), not in Obsidian.
- Done (2026-10-29): the miniature look (`src/board/postFx.ts`), a settings toggle "Miniature look" (off by default): the scene is drawn to a half-float target and blurred across then down by distance from the middle band, then tone mapped. Covers the GM board and Connect's player board; the local player window has it too. Checked only in the headless harness. The user found the earlier lighting change "not better, just different": `look.ts` and the lighting constants can be reverted if it still reads that way.
- Done (2026-10-29): contact shadows (`postFx.ts`, settings toggle "Contact shadows", off by default): a 16-tap normal-oriented screen-space occlusion at half size from the scene's depth texture, multiplied into the picture. Subtle; checked only in the headless harness.
- Done (2026-10-29): "Painted lighting" is a settings toggle now (off = the original white light and flat room; `LIGHTING` in `look.ts`), and its backdrop is a dusk sky painted in code (`vignette()` in `look.ts`: gradient, soft cloud strokes, vignette, grain). It shows only where the camera looks toward the horizon: from above the table the floor covers it. No openly licensed hand-painted skybox was found (TAD's is photos, Screaming Brain's are rendered).
- Done (2026-10-29): the sky is an equirectangular painting (`paintSky()` in `look.ts`, 3072x1536) so it turns with the camera; three palettes (dusk, day, night with stars) in a "Sky" setting; in the painted look the floor runs out to the horizon and fades into the sky's colour (fog, `applyHorizon()` in `board.ts`), and the camera may tilt down to 0.04 rad (it was 0.22) so the horizon comes down from the top of the screen. Checked only in the headless harness.
- Done (2026-10-29): the light follows the sky (`SKY_LIGHTING` in `look.ts`): dusk warm, day bright and neutral, night a dim cool moon. Not done: clouds are soft smudges.


## Toolbar lighting and the Atlas button (2026-10-30)
- Done: the lighting (classic, or painted under a dusk, day or night sky) is chosen from a button in the 3D board's toolbar (`toolbar.ts`), and is kept for every board; the "Painted lighting" and "Sky" settings are gone. All the lighting controls are in that menu now: the choices, the ambient light slider (moved out of the board settings panel), "Miniature look" and "Contact shadows" (moved out of the plugin settings).
- Done: an "Open in 3D" button in stock Atlas's own map toolbar (`src/atlasButton.ts`, in the `.atlas-toolbar-end` slot like Connect's group; put back when Atlas redraws it; dimmed while no map is open). Checked only by reading Connect's own injection; not seen in a running Atlas.
