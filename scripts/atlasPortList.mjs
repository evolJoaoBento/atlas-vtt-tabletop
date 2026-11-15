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
  'react/components/CommandPalette.tsx',
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
  'react/components/command-palette/GridSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/TokenSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/WidgetSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/LocalPlayerViewSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/DiceSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/ExperimentalFeaturesPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/GraphicsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/SceneSnapshotsPanel.tsx': 'palettePages.tsx',
  'react/components/command-palette/SceneLevelsPanel.tsx': 'palettePages.tsx',
  // Atlas 0.14's lighting page writes the scene lighting of Atlas's map view.
  'react/components/command-palette/LightingSettingsPanel.tsx': 'palettePages.tsx',
  'react/components/levels/replaceMapImage.ts': 'palettePages.tsx',
  'react/components/levels/MapImagePickerModal.ts': 'palettePages.tsx',
  'packages/components/shared/useMapProcessing.ts': 'mapProcessing.ts',
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
  {
    // Tabletop's own lighting and board settings in the palette's Settings tab, before Atlas's toolbar editor entry.
    file: 'react/components/CommandPalette.tsx',
    find: "    ...(onCustomizeToolbar ? [customizeToolbarCommand(",
    replace: "    ...tabletopCommands(onClose),\n    ...(onCustomizeToolbar ? [customizeToolbarCommand(",
  },
  {
    file: 'react/components/CommandPalette.tsx',
    find: "import { customizeToolbarCommand } from './command-palette/customizeToolbarCommand';",
    replace: "import { customizeToolbarCommand } from './command-palette/customizeToolbarCommand';\nimport { tabletopCommands } from '@shims/tabletopCommands';",
  },
];
// (Until Atlas 0.12 three more patches swapped the palette's OverlayScroll for a plain div; Atlas 0.15's own palette
// renders the options as that plain scrolling div, so they are gone.)
