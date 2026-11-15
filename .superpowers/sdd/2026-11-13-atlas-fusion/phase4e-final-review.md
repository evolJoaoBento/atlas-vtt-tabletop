# 4E review (fresh reviewer, read-only)

Scope: Tabletop 10a6278..HEAD, Connect af97127..HEAD, plan, spec 8/9/10, ledger rulings, Task 3 brief and report. Tabletop `npm test` rerun: 1118 pass, 2 skipped. Atlas behaviour checked against the 0.15 and 0.16 sources.

## Important

**I1. The roll log names Atlas set dice by their colour, not by the set's name.** `src/dice/boardDice.ts:320-325` sets `colorName` to the palette label whenever a die's hex is in `DIE_COLOURS`. `stockRoll` then sends it as `name` (`src/dice/atlasDice.ts:227,239`). In Atlas 0.15 and 0.16, `RolledDie.name` is the name the dice set gives the die (`tools/diceFormula.ts:42`, "Sun"), and the roll line prints it beside the value (`RolledDiceLine.tsx:31`, `diceLabels.ts:82,104`). `setGroups` and `edgeRule` (`atlasDice.ts:104-130`) drop the group's and the advantage die's `name`.
- **Scenario:** a "Sun" d12 in Gold, thrown on the board, shows in Atlas's log as "Gold 9". Atlas's own roll of the same set shows "Sun 9". An unnamed Crimson group shows "Crimson 9" where Atlas shows "9".
- **Why it is new in 4E:** before, Tabletop's palette (#d64545…) never matched Atlas's set colours, so set dice carried no name.
- **Fix:**
  - Read `group.name` and the advantage die's `name` into `DieGroup`/`EdgeRule`. Carry them on the die, and on its explosions, as `name`.
  - Name a die by its colour only when the picker chose it, or drop colour naming, since Atlas itself never names colours in the log.

**I2. With Atlas's dark look, every uncoloured die has black numerals on a near-black body.** `diceTable.ts:559` now gives every uncoloured die `#1f1e21` under the `dark` look. The default pack's numerals are black: I composited `d20_Numbers.png` over `#1f1e21` and the digits sit on a ~#404040 wash with low contrast. The same happens on the Black, Indigo and Purple set colours. Atlas paints light ink on dark bodies (`dieSkin.ts:54`, `readableInk`). 4E exports `readableInk` (`atlas-shared` index) but nothing calls it.
- **Scenario:** a GM who picks Atlas's dark dice gets hard-to-read dice on the board.
- **Fix:** when `readableInk(parseHex(tint))` is `LIGHT_INK`, invert or lighten the mask's dark pixels in `DiceTextures.sheet`. At minimum, record it in spec section 10.

## Minor

**M1. An older fusion-4 Connect client rejects all of a 4E GM's board extras.** The af97127 validator (`boardValidation.ts:119`) requires `isNullable(isNumber)(value.ambient)`, and an absent `ambient` fails it. `protocol.ts:272,280` then marks every `board-extras` and `cutscene-extras` invalid. `FUSION_PROTOCOL` is still 4 (`boardTypes.ts:12`), so the join gate admits such a client.
- **Scenario:** a player device still on a 4D build joins; their 3D board shows no walls, lights, props or cutscene scenes, and nothing explains why.
- **Severity:** only unreleased builds are affected, hence Minor.
- **Fix:** bump `FUSION_PROTOCOL`, or emit `ambient: null` until release.
- **Other directions are clean:**
  - An old vendored board falls through `look()?.ambient ?? …` to `map.lighting`.
  - A new validator ignores an old GM's `ambient`/`tint`.
  - An old Tabletop under a new Connect is ignored harmlessly.

**M2. The picker shows the pack's colour, not the look's.** `dicePreviews.ts:78` draws `textures(type, null)`. Under the dark or accent look, the picker shows white dice that land dark or purple. **Fix:** pass `lookBody` to the previews and redraw when it changes.

**M3. A theme without an accent gets the text colour, not Atlas's fallback.** `themeAccent` (`diceLook.ts:35-44`) sets `color: var(--interactive-accent)`. When the theme leaves that variable unset, the colour is inherited, so the body text colour comes back instead of null. The fallback `#8a5cf5` is never reached. The function also probes the main `document` only, and its regex accepts rgb() only. Atlas reads the variable and normalises it through a canvas (`diceLookRuntime.ts:17-25`). **Fix:** copy that approach.

**M4. Tests don't cover what production runs.**
- `dieBody` (`diceLook.ts:30-32`) is called only by `diceLook.test.ts`. Production precedence is the inline `color ?? lookBody` at `diceTable.ts:559`, which no test covers. **Fix:** test `DiceTable`/`BoardDice` with a host `lookBody`, or have the table call `dieBody`.
- The "5E built-in" case in `builtInSheets.test.ts` passes a lookup that the 5e prefix bypasses. It pins only `== buildSheet`.

**M5. A non-string `ac_class` gives "18 ()".** At `sheets.ts:240`, a truthy non-string `ac_class` such as a number or an array produces "18 ()". **Fix:** test the `text(...)` result, not the raw value.

**M6. The GM's built-in sheets use a stale copy of Atlas's templates.** Tabletop's sheet now depends on `atlasPort` built-in templates at **0.12.0** (`BoardView.ts:617`). Atlas 0.15 and 0.16 ship newer revisions: d20 creature r5 against the port's r4, generic r3 against r2, and `meaning: 'speed'`. This is a second copy of Atlas data that spec section 9 does not list. It does no harm today, because `templateSheets` ignores `meaning: 'speed'`. **Fix:** add a section 9 row, or vendor the presets into atlas-shared.

**M7. An open drawer does not follow a template change.** `BoardView.ts:311` says it does. But `linkedCreatures(this.app, { label })` (`:623`) passes no `onTemplatesRead`, so an open text sheet only changes on its next read.

**M8. Leftover doc comments.**
- `src/dice/diceSettings.ts`: line 3 (header mentions colours), line 12 (the `colors` doc now sits on `autoRoll`), line 42, line 60.
- `src/atlasBridge.ts:182-183`: `diceVolume`'s doc now sits above `diceLook()`, which has two.
- The plan's Architecture and E4 still describe `PlayerMap.lighting` and `onChange`/`css-change`. The rulings and spec amend this, but the plan does not.

## Review Focus

1. **A set with group colours from Atlas's tray.**
   - Each die takes its group's hex (`setGroups`), and explosions and rerolls inherit it.
   - A `die` advantage takes its own colour (`rollSession.ts:98`); a `keep` advantage takes the first die's.
   - On the table, the hex matches the log's `colour`. The log's `name` is wrong (I1).
   - Uncoloured dice: the GM's board uses the look, Connect's page draws light (E2), and a player's own board uses the pack's colour (ruled).
2. **Accent dice.** Read at each new die; dice already on the table keep their colour (ruled). M3 is the accent reading itself.
3. **Sheets.**
   - **No link:** null. **Broken fence:** no fields, then a by-name lookup.
   - **Throwing Fantasy Statblocks:** reads as none, then falls back to frontmatter. That is an improvement for Connect, which used to throw.
   - **Template Atlas doesn't ship:** with a file, laid out by it. Without one, `buildUntemplatedSheet`. Unreadable, name only.
   - **Privacy:** none of Atlas's built-ins has `players` settings, so the 5e path can't reveal anything a template hides. The new `*_description` and `ac_class` text is the same stat block text Atlas's card shows. Older pages accept the new sheet within `SHEET_LIMITS`.
4. **Lighting.** Unchanged path (`BoardExtras.lighting` kept). Unlit means ambient 1; lit means clamped ambient and colour; a mid-session switch arrives through the same extras resend as before.
5. **Older vendored board.** No throw (M1 covers older Connect *clients*).

## Declined to judge

- How readable I2 is under the board's 3D lighting. I judged from the texture alone; it needs a visual check, which needs Obsidian or the harness.
- Whether any 4D build is in a real player's hands (M1 severity).
- Live behaviour on 0.15/0.16 and the harness runs. I re-ran unit tests only.

## Rulings

I agree with:
- E4 (lighting kept).
- Copying the dark body and fallback accent.
- Reading the look per throw.
- E2 deferred.
- Players' boards keeping the pack's colour. Cheap to revisit: `playerBoard.ts:522` could take a look from Connect later.
- The `*_description`/`ac_class` fold-in.

I disagree in part with:
- **d20 and 5e-2024 lose rolls on the text sheet:** acceptable, but say in section 10 that the 5e-2024 Initiative and Gear lines also go. Section 10 names only d20.
- **The GM's text sheet hides player-hidden fields:** I would not have taken this. It is the GM's own drawer, and the rule exists for players. A one-line fix: give `buildTemplateSheet` a `forGm` flag, used only by Tabletop. The cost is real wherever Atlas's card cannot be drawn: a GM can't see a field there.
