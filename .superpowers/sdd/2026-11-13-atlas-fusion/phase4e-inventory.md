# 4E inventory (2026-11-15, before the plan; Explore agent, read-only)

## A. Dice look
- Atlas: `SettingsService.getDiceLook(): DiceLook` (0.15 `services/SettingsService.ts:503`, 0.16 :515) → `{ colour, font }`, default `DEFAULT_DICE_LOOK = { colour:'light', font:'medieval' }` (`dice3d/diceLook.ts:15`); `DiceColour = 'light'|'dark'|'accent'`, `DiceFont = 'medieval'|'scifi'`; stored as top-level `diceColour`/`diceFont` in Atlas data.json; `settingsService.onChange(listener)`. Applied by `plugin/diceLookSync.ts` → `applyDiceLook` (`dice3d/diceLookRuntime.ts:30`) at start, settings change, `css-change` (accent takes `--interactive-accent`).
- Set group colours: `DiceSetDie.colour?: '#rrggbb'` (`types/diceSetTypes.ts:17`, unset keeps the look), advantage die colour (:38); palette `DICE_SET_COLOURS` (12 named, `gameSystems/diceSets.ts:19-32`), `isDieColour` (:35).
- Purity: `diceLook.ts` pure but for i18n `t` (labels in *_OPTIONS); `dieSkin.ts` `resolveLook` (:53) pure, rest canvas; `dieNumerals.ts`, `diceLookRuntime.ts`, `dieColours.ts` DOM/three.
- atlas-shared has `gameSystems/diceSets.ts`, `types/diceSetTypes.ts`, `diceRules`, `diceCrit`, `diceExplosion`, `utils/hexColor`; `DICE_SET_COLOURS`/`isDieColour` not exported (`src/index.ts:149-155`); no dice3d files.
- Tabletop: `src/dice/diceSettings.ts` (physics: dieSquares, tolerance, motionThreshold, shadows, highlight, highlightColor; `pack`; `colors` default :21-28 — differs from DICE_SET_COLOURS; autoRoll; sheetPinned), main.ts:252, settings tab main.ts:1297-1335. Look = Interactive Dice texture pack (faces over a colour, `diceTextures.ts:20-25`), default colour pack `dieColor` (`kit/dieShapes.ts:171`, fallback #ff4444), mesh `diceTable.ts:551-556`. Per-die colours: picker `colors` (`dicePicker.ts`, `boardDice.ts:86,316-321`) and Atlas set groups read raw in `atlasDice.ts:90-126` (own #rrggbb check). `src/atlasBridge.ts:30-38` wraps `settingsService` without getDiceLook.
- Connect: `vendor/atlas/shared/dice3d.js`, `diceDisplay.js` (bundle with diceLook/dieSkin/dieNumerals); join page `online-client/dice3d/diceThrows.mts:12-17` without diceLookRuntime → always light/medieval; GM look read into `AtlasSettingsView.diceLook` (`stockAtlas.ts:294-298`) never sent; only an extension look id (`sessionDeps.ts:39-55`, `SceneSlot.ts:150-156`, `RemoteSceneClient.ts:185`); CSS `var(--atlas-dice-font, …)` (`atlas-dice-tray.css:42-43`).

## B. Sheets
- Atlas `resolveLinkedCreature(app, notePath, bestiary?)` (`creatures/linkedCreature.ts:145`) not pure (Obsidian, FantasyStatblocksService, statblockSource, noteYaml). Pure: `creatures/statblockValues.ts`, `creatures/frontmatterTraits.ts`, `statblocks/model/resolvedTypes.ts`, `templateTypes.ts`.
- Tabletop `src/sheets/`: `sheet.ts` (PlayerSheet, buildSheet; "ported from Connect"), `nativeSheet.ts` (Atlas 0.10.2 template fields hard-coded), `statblock.ts` (own Fantasy Statblocks/frontmatter reader), cards (`atlasCard.ts`, `atlasCardHost.ts`, `hoverCard.ts`, `atlasPreview.ts`); used in `BoardView.ts:69-75,610-613`.
- Connect: `src/app/online/tools/sheets.ts` (same model + resources, TokenSheet, validators, SHEET_LIMITS), `templateSheets.ts`, `sheetCards.ts`, `src/connect/statblockCards.ts`, `src/connect/statblockSource.ts` (re-implements resolveLinkedCreature), `SheetHost.ts`. The two buildSheets drifted (Tabletop: `*_description`, `ac_class`; Connect: limits).

## C. BoardExtras.lighting / ambient / tint
- Defined Connect `scene/boardTypes.ts:109` (BoardLighting), :158-162; Tabletop copy `src/connectWire.ts:110,159-162`; BoardLook ambient/tint `src/connectContract.ts:95-96`, Connect `sceneContracts.ts:112-114`.
- Produced `projectBoard.ts:37-39` (lighting = state.lighting clamped, default 0.1); called `SceneSlot.ts:342-346`, `projectCutscene.ts:77`. Validated `boardValidation.ts:116-124`.
- Tabletop sends `ambient: null`, no tint (`src/boardLook.ts:73-74`): already dead.
- Read: `sceneAdapter.ts:258-259,274` (layers default :99), `playerBoard.ts:998-1000`; GM board reads Atlas (`BoardView.ts:1601-1604`); `walls.ts:196-199` readSceneLighting repeats the clamp.
- PlayerScene/PlayerMap (`sceneTypes.ts:18-35,398-419`) carry no lighting: `lighting` extras are players' only source of enabled/ambient/ambientColor → add to the projection first, then delete.
- Tests: Connect projectBoard.test.ts:30,38,113-120,206, boardProtocol.test.ts:15, boardSender.test.ts:226,237,257,275, arTable.test.ts:134-143, connect/tabletopBoard.test.ts:30, page/boardPage.mts:74,85; Tabletop sceneAdapter.test.ts:41-42,88-89, boardLook.test.ts:40-42, fusionCarryOver.test.ts.

## Docs
- Program row `2026-11-14-atlas-fusion-phase4-program.md:22`; spec :122, :271-273, :276, :277, :286.
