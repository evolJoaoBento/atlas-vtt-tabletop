// What scripts/sync-atlas-port.mjs copies from Atlas's source into src/atlasPort/app (Atlas's own folder layout under
// src/app, so the copies import each other unchanged). Each entry is copied with every Atlas file it imports, except
// the boundaries: an import of a boundary is pointed at Tabletop's stand-in under src/atlasPort/shims instead.

/** Atlas files (relative to Atlas's src/app) the board's copies of Atlas's panels use directly. */
export const PORT_ENTRIES = [
  // Random tables and loot (Task 4).
  'randomTables/tableRoller.ts',
  'randomTables/noteTables.ts',
  'randomTables/markdownTables.ts',
  'randomTables/generatorRoller.ts',
  'randomTables/generatorResults.ts',
  'randomTables/generatorReroll.ts',
  'randomTables/tableSettings.ts',
  'randomTables/tablePaths.ts',
  'randomTables/tableResults.ts',
  'loot/lootRoller.ts',
  'loot/lootHistory.ts',
  'loot/deviceLootHistory.ts',
  'loot/lootHistoryPaths.ts',
  'loot/lootRarity.ts',
  'stores/lootRollerSlice.ts',
  // Loot history (Task 5): Atlas's own store, writing this device's Tabletop file (see shims/deviceId.ts).
  'loot/LootHistoryStore.ts',
  // Atlas's DOM host (installed once by src/atlasPort/installHost.ts, as Atlas's plugin does).
  'plugin/host/dom.ts',
  // The random tables window (Task 6).
  'react/components/randomTables/RandomTablesPanel.tsx',
  'packages/components/asset-manager/AssetManager.tsx',
  // Atlas's shortcut help (its `help` key), with the board's keys added by a patch below.
  'keyboard/HotkeyHelp.tsx',
];

/** Atlas file → Tabletop stand-in (relative to src/atlasPort/shims), for imports the copies must not follow. */
export const BOUNDARIES = {
  'i18n/index.ts': 'i18n.ts',
  'i18n/types.ts': 'i18n.ts',
  // Where Atlas's floating UI joins the page: Atlas's own copy would remove the running Atlas's host (and all in it).
  'host/portalHost.ts': 'portalHost.ts',
  'services/AssetService.ts': 'assetService.ts',
  'services/collectionBundle/installRecord.ts': 'installRecord.ts',
  'plugin/deviceId.ts': 'deviceId.ts',
  'react/components/CollectionSettingsModal.tsx': 'handOffs.tsx',
  'statblocks/editor/openTemplateEditor.ts': 'handOffs.tsx',
  'services/PlayerLootDisplay.ts': 'playerWindow.ts',
  'services/SettingsService.ts': 'settingsService.ts',
  'react/hooks/useSystemPresets.ts': 'systemPresets.ts',
  'react/root/AtlasUIContext.tsx': 'atlasUI.tsx',
  'react/ViewStoreContext.tsx': 'viewStore.ts',
  'onboarding/lootTutorials.ts': 'tutorials.ts',
  'randomTables/import/importFile.ts': 'importFile.ts',
  'packages/components/dungeon-generator/openDungeonGenerator.ts': 'handOffs.tsx',
  'statblocks/editor/create/entryPoints.ts': 'handOffs.tsx',
  // Atlas 0.15's pressable Counters pips in a statblock preview write the note (Atlas's note writer): read only here.
  'statblocks/render/shared/noteCounters.tsx': 'handOffs.tsx',
  'services/TokenStatblockLinkService.ts': 'assetHandOffs.tsx',
  'packages/components/asset-manager/TokenCreator.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/encounter-builder/EncounterBuilder.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/CreateSceneModal.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/StatblockLinkModal.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/collection-transfer/CollectionTransferLayer.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/hooks/useUvttImport.ts': 'assetHandOffs.tsx',
  'packages/components/asset-manager/CreateCollectionModal.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/utils/collectionTransferActions.ts': 'assetHandOffs.tsx',
  'services/createScene.ts': 'assetHandOffs.tsx',
  'packages/components/asset-manager/hooks/useCollectionTransfer.ts': 'assetHandOffs.tsx',
  // Atlas 0.15's starter tokens offer downloads a token pack into the vault: that is Atlas's to do, not the board's.
  'packages/components/asset-manager/components/BestiaryTokensOffer.tsx': 'assetHandOffs.tsx',
  'packages/components/asset-manager/hooks/useStarterOfferDismissal.ts': 'assetHandOffs.tsx',
  // Where the asset manager meets the board.
  'packages/components/asset-manager/hooks/useOpenAsset.ts': 'boardOpen.ts',
  'plugin/atlasLeaves.ts': 'boardLeaves.ts',
  'initiative/offMapCombatants.ts': 'offMap.ts',
  'packages/components/asset-manager/utils/tokenDeleteImpact.ts': 'assetHandOffs.tsx',
  'react/components/context-menu/playerCharacterMenu.ts': 'assetHandOffs.tsx',
  'pixi/mosaicCanvas/mapProcessing.ts': 'mapProcessing.ts',
  'services/AssetThumbnailService.ts': 'thumbnails.ts',
  // The command palette (Task 10): Atlas's player window and settings pages are Atlas's.
  'services/PlayerWindowService.ts': 'palettePlayer.ts',
  'services/PlayerWindowPresenter.ts': 'palettePlayer.ts',
  'stores/playerWindowStore.ts': 'palettePlayer.ts',
  'react/components/command-palette/SceneSnapshotsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/SceneLevelsPanel.tsx': 'palettePages.tsx',
  // Atlas 0.14's lighting page writes the scene lighting of Atlas's map view.
  'react/components/command-palette/LightingSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/levels/replaceMapImage.ts': 'palettePages.tsx',
  'react/components/levels/MapImagePickerModal.ts': 'palettePages.tsx',
  'packages/components/shared/useMapProcessing.ts': 'mapProcessing.ts',
  // Atlas 0.19's settings pages (command-palette/*Panel.tsx) act on the running Atlas's map view; what they take from files that
  // build Atlas's own map (its store, its dice renderer) is stood in for.
  // Atlas 0.19's palette entries that act on Atlas's own map (its table mode, floors and map image): the board opens Atlas for them.
  'tableMode/viewTableMode.ts': 'palettePages.tsx',
  'react/components/levels/mapImagePicker.tsx': 'palettePages.tsx',
  'react/components/levels/levelEditing.ts': 'palettePages.tsx',
  'storeFactory.ts': 'paletteSettings.ts',
  'dice3d/diceLookRuntime.ts': 'paletteSettings.ts',
};

/** Packages the copies may import (Tabletop bundles or Obsidian provides them). */
export const ALLOWED_PACKAGES = [
  'obsidian', 'yaml', 'react', 'react-dom', 'framer-motion', 'lucide-react', 'clsx', 'tailwind-merge',
  '@radix-ui/react-tooltip', '@radix-ui/react-slot', '@radix-ui/react-dropdown-menu', '@radix-ui/react-slider', '@tanstack/react-virtual', 'zustand',
  // Atlas 0.15's lighting/polygonClip.ts (reached by the asset manager's scene menus); Tabletop bundles it already.
  'clipper2-ts',
];

/**
 * The few places Tabletop adds to a copy, as exact text replacements applied after each copy is made. `@shims/` in a
 * replacement becomes the relative path to src/atlasPort/shims. The sync fails if a `find` text is no longer in Atlas's
 * file, so a newer Atlas that moved it is noticed at once.
 */
export const PATCHES = [
  // Atlas 0.19's `inSideOrder` (the order the GM dragged the sides into, `InitiativeState.sideOrder`). The floor's initiativeSideRules
  // is 0.15's: 0.18 and 0.19 changed more of it (the side roll's timing) than the board needs, so only this function is added. Once
  // the floor is 0.19 the sync fails on this patch's `find` (Atlas has it): drop it then.
  {
    file: 'gameSystems/initiativeSideRules.ts',
    find: "  return rules.sides ?? defaultSides(rules.firstSide);\n}\n",
    replace: "  return rules.sides ?? defaultSides(rules.firstSide);\n}\n\n/** `sides` with those `order` names first, in its order, and the rest after them in their own (Atlas 0.19). */\nexport function inSideOrder(sides: readonly SideRef[], order: readonly SideId[] | undefined): SideRef[] {\n  if (!order) return [...sides];\n  const place = (side: SideRef): number => {\n    const index = order.indexOf(side.id);\n    return index < 0 ? order.length : index;\n  };\n  return [...sides].sort((a, b) => place(a) - place(b));\n}\n",
  },
  // Atlas 0.17 took the sound keys out of the experimental features and 0.18 added the Sound page key and the brush size keys (the floor, 0.15, has none).
  {
    file: 'keyboard/mapHotkeys.ts',
    find: "  { id: 'nextMood', label: t('hotkey.nextMood'), group: t('hotkey.group.map'), defaultKey: 'n', dmOnly: true, experimental: 'sound' },\n  { id: 'silence', label: t('hotkey.silence'), group: t('hotkey.group.map'), defaultKey: 'Shift+s', dmOnly: true, experimental: 'sound' },\n",
    replace: "  { id: 'nextMood', label: t('hotkey.nextMood'), group: t('hotkey.group.map'), defaultKey: 'n', dmOnly: true },\n  { id: 'silence', label: t('hotkey.silence'), group: t('hotkey.group.map'), defaultKey: 'Shift+s', dmOnly: true },\n  // Opens the DM screen on its Sound page, and closes it from there (`UIRoot`, `DMScreen`).\n  { id: 'soundPage', label: t('hotkey.soundPage'), group: t('hotkey.group.map'), defaultKey: 's', dmOnly: true },\n",
  },
  {
    file: 'keyboard/mapHotkeys.ts',
    find: "  { id: 'measure', label: t('hotkey.measure'), group: t('hotkey.group.tools'), defaultKey: 'm' },\n",
    replace: "  // Run only while the Draw tool or the fog tool is in use (`useToolbarHotkeys`): the size of whichever it is.\n  { id: 'drawSmaller', label: t('hotkey.drawSmaller'), group: t('hotkey.group.tools'), defaultKey: ',', dmOnly: true, repeats: true },\n  { id: 'drawLarger', label: t('hotkey.drawLarger'), group: t('hotkey.group.tools'), defaultKey: '.', dmOnly: true, repeats: true },\n  { id: 'measure', label: t('hotkey.measure'), group: t('hotkey.group.tools'), defaultKey: 'm' },\n",
  },
  // Atlas 0.18's Tiny (0.75) and Small (0.875) token sizes, in the size menu and the statblock size map (0.15: both 1).
  {
    file: 'pixi/token-renderer/tokenSizing.ts',
    find: "  { label: t('token.size.medium'), size: 1 },",
    replace: "  { label: t('token.size.tiny'), size: 0.75 },\n  { label: t('token.size.small'), size: 0.875 },\n  { label: t('token.size.medium'), size: 1 },",
  },
  {
    file: 'pixi/token-renderer/tokenSizing.ts',
    find: "{ tiny: 1, small: 1, medium: 1,",
    replace: "{ tiny: 0.75, small: 0.875, medium: 1,",
  },
  // Atlas 0.18's quarter-cell snap for Tiny tokens (the floor, 0.15, snaps them to the cell centre). Once the floor is 0.18
  // the sync fails on this patch's `find` (Atlas has it): drop it then, with the Tiny/Small patches below.
  {
    file: 'grid/gridPlacement.ts',
    find: "  const shift = tokenCenterShift(gridType, cellSize, tokenSize);\n  const cell = snapToCell(",
    replace: "  // Atlas 0.18's Tiny rule: on a square grid a token half a cell across or less takes the quarter of the cell nearest the pointer.\n  if (!isHexGridType(gridType) && tokenDiameterInCells(tokenSize) <= 0.5) {\n    const tinyCell = snapToCell(point);\n    return {\n      x: tinyCell.x + (point.x <= tinyCell.x ? -1 : 1) * cellSize / 4,\n      y: tinyCell.y + (point.y <= tinyCell.y ? -1 : 1) * cellSize / 4,\n    };\n  }\n  const shift = tokenCenterShift(gridType, cellSize, tokenSize);\n  const cell = snapToCell(",
  },
  {
    // Tabletop's own lighting and board settings in the palette's Settings tab, before Atlas's toolbar editor entry.
    file: 'react/components/CommandPalette.tsx',
    find: "    ...(onCustomizeToolbar ? [customizeToolbarCommand(",
    replace: "    ...tabletopCommands(onClose),\n    ...(onCustomizeToolbar ? [customizeToolbarCommand(",
  },
  {
    file: 'react/components/CommandPalette.tsx',
    find: "import { customizeToolbarCommand } from './command-palette/customizeToolbarCommand';",
    replace: "import { customizeToolbarCommand } from './command-palette/customizeToolbarCommand';\nimport { tabletopCommands, tabletopSettingsCommands } from '@shims/tabletopCommands';",
  },
  {
    // Tabletop Settings heads the palette's Settings, above Atlas's own settings pages.
    file: 'react/components/CommandPalette.tsx',
    find: "    // Settings\n    {\n      id: \"grid-settings\",",
    replace: "    // Settings\n    ...tabletopSettingsCommands(onClose),\n    {\n      id: \"grid-settings\",",
  },
  // Tabletop's own settings page in the palette's Settings section (src/atlasPort/shims/tabletopSettingsPanel.tsx), as a page like Atlas's.
  {
    file: 'react/components/command-palette/types.ts',
    find: "  'lighting-settings',\n] as const;",
    replace: "  'lighting-settings',\n  // Tabletop's own pages, in the palette like Atlas's.\n  'tabletop-settings',\n  'tabletop-sound-settings',\n] as const;",
  },
  {
    file: 'react/components/CommandPalette.tsx',
    find: "import { showNotice } from '../../ui/notice';",
    replace: "import { showNotice } from '../../ui/notice';\nimport { TabletopSettingsPanel, tabletopSettingsMeta } from '@shims/tabletopSettingsPanel';\nimport { TabletopSoundPanel, tabletopSoundMeta } from '@shims/tabletopSoundPanel';",
  },
  {
    file: 'react/components/CommandPalette.tsx',
    find: "  'lighting-settings': { title: t('sceneLight.settings'), icon: <SunMoon /> },\n};",
    replace: "  'lighting-settings': { title: t('sceneLight.settings'), icon: <SunMoon /> },\n  'tabletop-settings': tabletopSettingsMeta(),\n  'tabletop-sound-settings': tabletopSoundMeta(),\n};",
  },
  {
    file: 'react/components/CommandPalette.tsx',
    find: "      case 'lighting-settings':\n        return <LightingSettingsPanel />;\n",
    replace: "      case 'lighting-settings':\n        return <LightingSettingsPanel />;\n      case 'tabletop-settings':\n        return <TabletopSettingsPanel onClose={onClose} />;\n      case 'tabletop-sound-settings':\n        return <TabletopSoundPanel />;\n",
  },
  // Atlas's shortcut help on the board (`board`, src/atlasPort/shims/boardHotkeyHelp.ts): only the shortcuts the board
  // has, with the keys the board takes (a camera letter with Shift), and the board's own keys as a section of their own.
  {
    file: 'keyboard/HotkeyHelp.tsx',
    find: "import { useDialogFocus } from '../onboarding/useDialogFocus';",
    replace: "import { useDialogFocus } from '../onboarding/useDialogFocus';\nimport type { BoardHotkeyHelp } from '@shims/boardHotkeyHelp';",
  },
  {
    file: 'keyboard/HotkeyHelp.tsx',
    find: "export function HotkeyHelp({ settings: explicit, onClose, isPlayerView = false }: { settings?: SettingsService | undefined; onClose: () => void; isPlayerView?: boolean }): React.JSX.Element {",
    replace: "export function HotkeyHelp({ settings: explicit, onClose, isPlayerView = false, board }: { settings?: SettingsService | undefined; onClose: () => void; isPlayerView?: boolean; board?: BoardHotkeyHelp }): React.JSX.Element {",
  },
  {
    file: 'keyboard/HotkeyHelp.tsx',
    find: "  const actions = availableHotkeys(isPlayerView, (feature) => settings?.isExperimentalOn(feature) ?? false);",
    replace: "  const actions = availableHotkeys(isPlayerView, (feature) => settings?.isExperimentalOn(feature) ?? false).filter(action => board?.shows(action.id) ?? true);",
  },
  {
    file: 'keyboard/HotkeyHelp.tsx',
    find: "<kbd>{formatHotkey(bindings[action.id])}</kbd>",
    replace: "<kbd>{formatHotkey(board ? board.binding(action.id, bindings[action.id]) : bindings[action.id])}</kbd>",
  },
  {
    file: 'keyboard/HotkeyHelp.tsx',
    find: "</section>)}",
    replace: "</section>)}\n        {board?.sections}",
  },
];
// (Until Atlas 0.12 three more patches swapped the palette's OverlayScroll for a plain div; Atlas 0.15's own palette
// renders the options as that plain scrolling div, so they are gone.)

/**
 * Atlas files the floor (0.15) lacks, copied from the newer Atlas (`--newer=`, default ../atlas-vtt-0.19-ref) in the same
 * layout, with what they import that the floor lacks too (what the floor has stays the floor's). Each copy's header names
 * the newer version. The fog tool's pure logic (snapping, cells, rooms, polygons, strokes) is here.
 */
export const NEWER_ENTRIES = [
  'fog/fogSnap.ts',
  'fog/fogConstrain.ts',
  'fog/fogCells.ts',
  'fog/fogPolygon.ts',
  'fog/fogRooms.ts',
  'fog/fogKeyhole.ts',
  'fog/fogAreas.ts',
  'fog/fogBody.ts',
  'fog/fogCoverage.ts',
  'fog/fogOperationShape.ts',
  'types/fogTypes.ts',
  'tools/shapeStroke.ts',
  'types/toolSwitches.ts',
  'lighting/exploredEdits.ts',
  'lighting/polygonClip.ts',
  // Copy, cut and paste (Atlas's map clipboard): what is copied, where a paste lands, and the clipboard itself.
  'clipboard/mapClipboard.ts',
  'clipboard/mapObjectContent.ts',
  'clipboard/mapObjectPlacement.ts',
  // The turn banner (0.18 adds the fight's start and end, the players' hidden turn holders and the combatant's colour).
  'initiative/banner/turnBanner.ts',
  'initiative/banner/fightWatch.ts',
  'initiative/banner/turnBannerElement.ts',
  // Saved rolls (0.18): the collection's `dicePresets` and `diceRow` as the dice tray reads, changes and writes them, and a roll's look.
  'react/components/dice/diceShelf.ts',
  'react/components/dice/presetLook.ts',
  // The dice row (0.18): how a saved roll shows on its place (the body of its first die, with marks).
  'react/components/dice/presetFace.ts',
  // Atlas 0.19: dice sets that offer advantage only where they have a rule for it (a Plain d20 for a collection without a system).
  'gameSystems/builtInDiceSets.ts',
  'gameSystems/diceSetResolution.ts',
  'gameSystems/presets/daggerheart.ts',
  'gameSystems/presets/oldSchoolEssentials.ts',
  // Atlas 0.19: a side written after a value (`+7 adv`) is kept, summed and read by a reference as written.
  'statblocks/values/valueRolls.ts',
  'statblocks/values/valueCoercion.ts',
  'statblocks/values/numberText.ts',
  'statblocks/values/fillReferences.ts',
  // Atlas 0.19: what a kept area leaves where walls stop it (the sweep from its origin), and the shapes it is measured as.
  'measure/measureWalls.ts',
  'measure/measureGeometry.ts',
  // Atlas 0.19's command palette and the settings pages in it (Grid, Token, Widget, Player view, Dice, Experimental, Graphics).
  'react/components/CommandPalette.tsx',
  'react/components/command-palette/GridSettingsPanel.tsx',
  'react/components/command-palette/TokenSettingsPanel.tsx',
  'react/components/command-palette/WidgetSettingsPanel.tsx',
  'react/components/command-palette/PlayerViewSettingsPanel.tsx',
  'react/components/command-palette/DiceSettingsPanel.tsx',
  'react/components/command-palette/ExperimentalFeaturesPanel.tsx',
  'react/components/command-palette/GraphicsPanel.tsx',
];

/** Floor files the newer Atlas's version replaces (a superset: it only adds what the fog's room logic needs). */
export const NEWER_OVERRIDES = [
  // Atlas 0.19's command palette and the files of its folder the palette is made of.
  'react/components/CommandPalette.tsx',
  'react/components/command-palette/types.ts',
  'react/components/command-palette/palettePlacement.ts',
  'react/components/command-palette/CommandItem.tsx',
  'react/components/command-palette/SettingsPanelHeader.tsx',
  'react/components/command-palette/customizeToolbarCommand.tsx',
  'lighting/polygonClip.ts',
  'gameSystems/builtInDiceSets.ts',
  'gameSystems/diceSetResolution.ts',
  'gameSystems/presets/daggerheart.ts',
  'gameSystems/presets/oldSchoolEssentials.ts',
  'statblocks/values/valueRolls.ts',
  'statblocks/values/valueCoercion.ts',
  'statblocks/values/numberText.ts',
  'statblocks/values/fillReferences.ts',
];
