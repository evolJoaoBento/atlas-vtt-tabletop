// Stand-ins for Atlas's authoring windows the copies open (react/components/CollectionSettingsModal.tsx and
// statblocks/editor/openTemplateEditor.ts @ 0.15.0, AGPL-3.0). They need nothing from the board, so they are Atlas's:
// the board says where to find them instead of carrying a second copy of Atlas's settings and editors.
import { useEffect, type ReactNode } from 'react';
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

/**
 * A token's statblock note, as Atlas 0.15's `openStatblockNote` opens it, but always as a note the Obsidian way (Atlas's
 * statblock pane is Atlas's): `missing` when the note is gone, so the asset manager offers to link another.
 */
export function openStatblockNote(app: App, path: string, _context: unknown): 'note' | 'missing' {
  const file = app.vault.getFileByPath(path);
  if (!file) return 'missing';
  void app.workspace.openLinkText(file.path, '', true);
  return 'note';
}

/** Atlas's dungeon generator (its own view): run through Atlas's command. */
export async function showDungeonGenerator(app: App, _collectionId?: string): Promise<void> {
  const commands = (app as unknown as { commands?: { executeCommandById?(id: string): boolean } }).commands;
  if (commands?.executeCommandById?.('atlas-vtt:generate-dungeon') !== true) new Notice('Tabletop: the dungeon generator needs Atlas.');
}

/**
 * Atlas 0.15's pressable Counters pips (statblocks/render/shared/noteCounters.tsx): a press in a statblock preview writes
 * the note through Atlas's note writer. On the board the preview stays read only; the pips are pressed in Atlas.
 */
export function PressableCounters({ children }: { children: ReactNode; [prop: string]: unknown }): ReactNode {
  return children;
}
