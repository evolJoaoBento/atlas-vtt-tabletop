// Stand-ins for the asset manager's authoring windows and actions that are Atlas's (Atlas 0.12.0, AGPL-3.0): the token
// creator, encounter builder, new scene, statblock link, new collection, collection export/import, Universal VTT import,
// player characters, and deleting token assets (Atlas checks the maps that use them first). None needs the board, so the
// board opens Atlas's own asset manager on the tab instead of carrying a second copy of them.
import { useEffect } from 'react';
import { Notice, type App } from 'obsidian';
import { AtlasBridge, type AssetTab } from '../../atlasBridge';

/** The app the asset manager on the board was opened with (set by src/assets/AssetWindow.tsx). */
let boardApp: App | null = null;
export function setHandOffApp(app: App | null): void { boardApp = app; }

function handOff(what: string, tab?: AssetTab): void {
  const opened = boardApp ? new AtlasBridge(boardApp).openGlobalAssetManager(tab) : false;
  new Notice(opened ? `Tabletop: ${what} in Atlas's asset manager.` : `Tabletop: ${what} needs Atlas.`);
}

/** A dialog that, when it opens, hands over to Atlas and closes. */
function HandOff({ open, onClose, what, tab }: { open: boolean; onClose?: () => void; what: string; tab?: AssetTab }): null {
  useEffect(() => {
    if (!open) return;
    handOff(what, tab);
    onClose?.();
  }, [open, onClose, what, tab]);
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Props = Record<string, any>;

export function TokenCreator(props: Props): null {
  return HandOff({ open: props.isOpen === true, onClose: props.onClose, what: props.mode === 'map' ? 'Make maps' : 'Make tokens', tab: props.mode === 'map' ? 'maps' : 'tokens' });
}
export function EncounterBuilder(props: Props): null {
  return HandOff({ open: true, onClose: props.onClose, what: 'Build encounters', tab: 'encounters' });
}
export function CreateCollectionModal(props: Props): null {
  return HandOff({ open: true, onClose: props.onClose, what: 'Make collections' });
}
export function CollectionTransferLayer(props: Props): null {
  return HandOff({ open: props.transfer != null, onClose: props.closeTransfer, what: 'Export and import collections' });
}
/** CreateSceneModal and StatblockLinkModal (both default exports in Atlas). */
export default function DialogHandOff(props: Props): null {
  return HandOff({ open: props.isOpen !== false, onClose: props.onClose, what: props.asset ? 'Link statblocks' : 'Make scenes', tab: props.asset ? undefined : 'scenes' });
}

export const TokenStatblockLinkService = {
  getInstance: (_app: App) => ({
    linkTokenToStatblock: async (): Promise<void> => { handOff('Link statblocks'); },
  }),
};

export async function findTokenDeleteImpact(..._args: unknown[]): Promise<never> {
  handOff('Delete token assets', 'tokens');
  throw new Error('Token assets are deleted in Atlas, which first checks the maps that use them.');
}
export function describeTokenDeleteImpact(..._args: unknown[]): string[] { return []; }
export async function applyTokenDeleteImpact(..._args: unknown[]): Promise<void> {}

export async function createScenesFromMaps(..._args: unknown[]): Promise<[]> {
  handOff('Make scenes from maps', 'maps');
  return [];
}

export async function setPlayerCharacters(..._args: unknown[]): Promise<void> { handOff('Mark player characters', 'party'); }
export function playerCharacterEntry(isOn: boolean, onToggle: (on: boolean) => void): { id: string; label: string; checked: boolean; onClick: () => void } {
  return { id: 'player-character', label: 'Player character', checked: isOn, onClick: () => onToggle(!isOn) };
}

export function transferTargets(..._args: unknown[]): [] { return []; }
export async function transferToCollection(..._args: unknown[]): Promise<void> { handOff('Move assets between collections'); }

export function useCollectionTransfer(_deps: unknown): {
  transfer: null; handleExportCollection: () => Promise<void>; handleImportCollection: () => void;
  confirmExport: () => Promise<null>; confirmImport: () => Promise<void>; closeTransfer: () => void;
} {
  return {
    transfer: null,
    handleExportCollection: async () => { handOff('Export collections'); },
    handleImportCollection: () => { handOff('Import collections'); },
    confirmExport: async () => null,
    confirmImport: async () => {},
    closeTransfer: () => {},
  };
}

export type ImportMaps = (files: readonly File[], collectionId: string, stay?: () => boolean) => Promise<void>;
export function mapFilesAmong(_files: readonly File[]): File[] { return []; }
export function mayCarryMapFile(_transfer: unknown): boolean { return false; }
export function useUvttImport(_options: unknown): ImportMaps {
  return async () => { handOff('Import Universal VTT maps', 'maps'); };
}
