# Task 3 report: one sheet model (fusion 4E)

Status: DONE_WITH_CONCERNS (see Concerns).

## Commits (local, `feat/atlas-fusion`, not pushed)
- Connect `28d1804` refactor(shared): one sheet model and linked stat block reader in atlas-host
- Tabletop `8762c36` refactor(sheets): the stat sheet is Connect's shared sheet model; sync from Connect 28d1804
- Tabletop `87f530b` test(sheets): a d20 built-in note is laid out by Atlas's d20 template

## Files
Connect:
- `git mv` (whole; recorded as renames R100/R094/R096): `src/app/online/tools/sheets.ts` → `packages/atlas-host/src/sheets/sheets.ts`; `sheetCards.ts` → `packages/atlas-host/src/sheets/sheetCards.ts`; `templateSheets.ts` → `packages/atlas-host/src/sheets/templateSheets.ts`. All three stay pure (no `obsidian`, no `@atlas-vtt/api-types`), so the join page bundles them by path.
- New `packages/atlas-host/src/sheets/linkedCreature.ts`: `TemplateFiles` (moved out of `statblockSource.ts`, with a console label and `whenRead()`), `linkedCreatures(app, { label, onTemplatesRead })` → `{ read, readNote, templated, noteFields, watchTemplates, templates }`, a structural `StatblockLink` token type (`statblockPath`, `statblockName`), `notePath`, `TEMPLATE_EXTENSION`.
- `src/connect/statblockSource.ts` now only wraps it: card capture (`statblockCards.ts`), the change events (metadata, Fantasy Statblocks, template files through `watchTemplates`).
- `packages/atlas-host/src/index.ts` exports the model, card types, template reader and reader.
- Imports pointed at the package in 26 `src`/`tests` files and 6 `online-client/*.mts` files (by file path, never the index, under `src/app/online` and the page).
- New tests: `tests/unit/online/sheetModel.test.ts`, `tests/unit/connect/linkedCreature.test.ts`.

Tabletop:
- Synced packages from Connect 28d1804 (`connect-sync.json`, `src/connectWire.ts` header, `packages/atlas-host`).
- Deleted `src/sheets/sheet.ts`, `src/sheets/nativeSheet.ts`, `src/sheets/statblock.ts`.
- `src/board/BoardView.ts`: `sheetOf` = `buildPlayerSheet(await linked.readNote(token), token.name, id => builtInTemplate(id)?.template)` (atlasPort's Atlas built-in templates); the initiative modifier reads `linked.noteFields(path)` (what `statblockFields` did); `watchTemplates()` registered on open.
- `src/sheets/sheetDrawer.ts` (imports; `textParts(item.desc, item.rollable)`), `atlasCard.ts`, `atlasPreview.ts`, `hoverCard.ts`, `src/dice/boardDice.ts`, `harness/board.ts`: imports from `packages/atlas-host/src/sheets/sheets`.
- `tests/nativeSheet.test.ts` replaced by `tests/builtInSheets.test.ts` (git mv'd, but rewritten so fully that git records delete + add), its five cases rewritten against the shared reader with Atlas's built-in templates, plus a d20-creature case (87f530b); `tests/sheet.test.ts` imports the shared model, plus one new drawer case.

## Tests watched failing, then passing
Connect, `tests/unit/online/sheetModel.test.ts`:
1. Before the move: the file failed to load (module `packages/atlas-host/src/sheets/sheets` missing).
2. After the `git mv`, before the fold-in, all 5 failed on assertions:
   - "opens a list with Fantasy Statblocks' intro to it (`legendary_description`), as an item named as the list" (deep equal)
   - "keeps a full list a sheet a page accepts: the intro takes the place of the last item" (deep equal)
   - "shows the armour's kind beside the armour class (`ac_class`)" (`'18'` vs `'18 (plate)'`)
   - "gives the side a click asks for ... and which formulas a side changes" (`advantageSide is not a function`)
   - "reads a note made with one of Atlas's built-in templates by that template, where the caller has it" (match object)
3. After the fold-in: 5/5 passed.
`tests/unit/connect/linkedCreature.test.ts` (3 cases: fence + frontmatter read, waiting for templates, bestiary order and a throwing Fantasy Statblocks) was written after the extraction and passed first time. The existing `statblockSource.test.ts` (3 cases) passed unchanged, which pins the extraction leaving Connect's reader as it was.

Tabletop, `tests/sheet.test.ts` "a template's rollable value rolls its plain numbers, named as Atlas names a rolled cell": failed with the drawer's old `textParts(item.desc)` (temporarily restored), passed with `textParts(item.desc, item.rollable)`.

Final runs:
- Connect: `npx vitest run` 350 files / 3179 tests passed; `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` and `npm run build:page` built; `npm run check:shared` matches Atlas 0.16.0.
- Tabletop: `npm test` 1118 pass, 0 fail, 2 skipped (the existing TaleSpire/HeroForge file-gated skips); `npx tsc --noEmit` clean; `npm run build` clean; `sync-connect --check --connect` matches Connect 28d1804. UI harness `run-ui.mjs "sheet|card|stat"`: 19/19 (features "snapshot and board card", "sheet pin", "atlas css restated"). The stat sheet drawer checks live in `harness/board-test.cjs` (run only with `--all`): run on the built harness it stopped at step 25 (dice colour swatches "Add a Red d6" no longer exist since the dice colours commit 86e7b18), before the sheet. Rerun from a throwaway copy that skipped those three swatch clicks (deleted after): 260/262, every stat sheet check passed (toolbar button, select hero shows its sheet as text, subtracted die refused, Longsword 1d20+5 logged once, drawer/picker exclusivity, token without stat block, close). The 2 failures are not sheets: "a later stroke lies over an earlier one" (drawing order) and "right-click on a die shows its colours" (the same 86e7b18 swatch change); the same two fail identically (209/211, same abort) on Tabletop 86e7b18, the commit before this task, run in a throwaway worktree (removed after), so they predate this task.

## Behaviour differences resolved
1. `*_description` intro (Tabletop only): kept in the shared model. The intro is unshifted and the list then cut to `SHEET_LIMITS.items` (40), so a full list plus intro stays a valid `token-sheets` sheet (pinned). **This changes what Connect sends**: players now get the intro item and "AC 18 (plate)". That is the decided fold-in.
2. `ac_class` (Tabletop only): kept; changes Connect's `ac` text as above.
3. `advantageSide`, `mayHaveAdvantage`, `signed` (Tabletop only, used by its drawer and card routing): exported from the shared `sheets.ts`. Connect had none of them, so nothing was duplicated.
4. Roll detection in a text: Connect's `textParts` (its port of Atlas's link detector, with Foundry/Roll20 notation, `@` references and `rollable` numbers) replaces Tabletop's simpler regex. Every Tabletop dice case in `sheet.test.ts` still passes unchanged. The drawer now also rolls a template's `rollable` value, and the log names the cell ("Severe").
5. `SheetRollRef` gains Connect's `card` kind and `side`, and `SheetItem.rollable`. Tabletop's drawer needed no other change (`sheetRollFormula`/`sheetRollLabel` handle `card`).
6. Template reader (decided): Connect's `templateSheets.ts` replaces `nativeSheet.ts`. Tabletop's 0.10.2 hard-coded built-in field lists go. To keep what `nativeSheet.test.ts` pinned (Cairn/percentile stats not read as STR–CHA, Draw Steel/Fate/percentile values shown), `buildPlayerSheet` takes an optional built-in template lookup. Tabletop passes Atlas's own built-in templates from its atlasPort (`builtInTemplates.ts`, Atlas 0.12.0), so a non-5e `builtin:` note is laid out by Atlas's template. 5e built-ins (`builtin:5e-*`) always read as 5e stat blocks, so their abilities, saves and skills stay rollable. Connect passes no lookup, so its behaviour is unchanged (built-ins read as 5e). What changed in the pinned cases:
   - The values are now template items ("Armor: 1", "Attributes: STR 12, DEX 9, WIL 7", "Critical Damage: Hex"), not `lines`.
   - **5e 2024 built-ins lose the extra "Initiative" and "Gear" lines** nativeSheet added. Atlas's template shows them, but taking it would cost the 5e ability rolls. The test now pins that it equals `buildSheet`.
   - **`builtin:d20-creature` loses nativeSheet's rollable 5e ability row and save bonuses**: Atlas's d20 template shows the six scores as one line ("Abilities: STR 16, ...") and the saves as text; its Initiative ("+2") and Attacks still roll from their text. No earlier test pinned the d20 row; 87f530b pins the new outcome. The other built-ins checked (B/X, generic creature/NPC/hazard, narrative NPC) had no ability row before either; narrative NPC shows only the name with the sample fields. Widening the "reads as 5e" rule to d20 would lose its Attacks and template layout instead.
   - A custom template with no file now goes to `buildUntemplatedSheet` (every non-reserved field, Atlas's stand-in). With a file, it is laid out by that file, which Tabletop never read before.
7. Linked-creature reader:
   - Connect's sync `read` is identical: template, then bestiary by path, then frontmatter with marker, then bestiary by name.
   - Tabletop's `readNote` uses template, then bestiary by path, then the note's fence with frontmatter laid over it (when it has a fence, or a marker in the frontmatter), then bestiary by name. That is Tabletop's old order with Connect's template step first, and it waits for the vault templates only when the note names one.
   - Difference for Tabletop: a templated note now reads by its template before Fantasy Statblocks' copy of it, as Atlas and Connect do.
   - `noteFields` keeps the old `statblockFields` (fence + frontmatter) for the initiative modifier.
8. Fields a template hides from players (Atlas 0.9 `players`): the shared template reader leaves them out, and any block that reads one, as Connect must for players. Tabletop's drawer is the GM's, so its **text** sheet now omits those fields where nativeSheet showed every field. Atlas's card, which the drawer shows in place of the text sheet once drawn, still shows everything. Not pinned by any test; left as Connect's rule. Also, a template file that claims an id but cannot be read gives a name-only text sheet (Connect's rule, never "show every field").
9. A Fantasy Statblocks API call that throws now reads as "no creature" in both plugins. This was Tabletop's `fromBestiary`; Connect caught only `isResolved`. It only changes Connect when the plugin throws (before, the read threw).

## Concerns
- `harness/board-test.cjs` already fails on 86e7b18 (verified): the dice colour swatch step times out and aborts the run before the stat sheet checks, and the drawing-order check fails. Not fixed here (outside this task); the sheet checks were verified with the swatch clicks skipped.
- `builtin:d20-creature` notes lose the rollable ability row and save bonuses on the text sheet (difference 6).
- The GM's text sheet in Tabletop now hides template fields marked hidden from players (difference 8); Atlas's card still shows them.
- 5e 2024 built-in notes no longer show Initiative/Gear on the text sheet (difference 6).
- Connect's players now receive the `*_description` intro item and the `ac_class` in `token-sheets` (decided, but a visible change).

## Left / notes
- `docs/TODO-atlas-0.10.2.md` (Tabletop) still mentions `src/sheets/nativeSheet.ts` in a historical line; not edited.
- Untracked `harness/live/phase4e.cjs` in Tabletop is not mine; left alone.
- Not checked live in Obsidian (no vault opened, as instructed).
