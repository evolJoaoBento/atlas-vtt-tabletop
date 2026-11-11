// Stand-ins for Atlas's authoring windows the copies open (react/components/CollectionSettingsModal.tsx and
// statblocks/editor/openTemplateEditor.ts @ 0.12.0, AGPL-3.0). They need nothing from the board, so they are Atlas's:
// the board says where to find them instead of carrying a second copy of Atlas's settings and editors.
import { useEffect } from 'react';
import { Notice, type App } from 'obsidian';

export function CollectionSettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void; [prop: string]: unknown }): null {
  useEffect(() => {
    if (!isOpen) return;
    new Notice("Tabletop: change the collection's settings in Atlas (its Dashboard).");
    onClose();
  }, [isOpen, onClose]);
  return null;
}

export async function openTemplateEditor(_app: App, _options: { templateId: string; collectionId: string }): Promise<void> {
  new Notice("Tabletop: edit statblock templates in Atlas.");
}

/** Atlas's statblock editor (statblocks/editor/create/entryPoints.ts): its menu entry is left out on the board. */
export function createStatblockEntry(_app: App, _context: unknown): null {
  return null;
}

export function newStatblockOption(_app: App, _context: unknown): undefined {
  return undefined;
}

/** Opens the statblock beside its note the Obsidian way, as a note (Atlas's pane is Atlas's). */
export function editInStatblockPane(app: App, path: string, _context: unknown): boolean {
  void app.workspace.openLinkText(path, '', true);
  return true;
}

/** Atlas's dungeon generator (its own view): run through Atlas's command. */
export async function showDungeonGenerator(app: App, _collectionId?: string): Promise<void> {
  const commands = (app as unknown as { commands?: { executeCommandById?(id: string): boolean } }).commands;
  if (commands?.executeCommandById?.('atlas-vtt:generate-dungeon') !== true) new Notice('Tabletop: the dungeon generator needs Atlas.');
}
