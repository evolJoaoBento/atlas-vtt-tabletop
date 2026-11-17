import { TFile, TFolder, type App } from 'obsidian';
import type { BackgroundFiles } from './backgroundStore';

const SETTINGS_FILE = 'background.json';

function parentOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

/** The store's file actions over the Obsidian vault: folders are made as needed, and delete and rename go through Obsidian so links and the trash setting are respected. */
export function vaultBackgroundFiles(app: App): BackgroundFiles {
  const vault = app.vault;

  /** Makes `path` and the folders above it. A folder that turns up meanwhile is fine. */
  const ensureFolder = async (path: string): Promise<void> => {
    if (!path) return;
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const at = parts.slice(0, i).join('/');
      if (vault.getAbstractFileByPath(at)) continue;
      try { await vault.createFolder(at); } catch (error) {
        if (!vault.getAbstractFileByPath(at)) throw error;
      }
    }
  };

  const fileAt = (path: string): TFile | null => {
    const found = vault.getAbstractFileByPath(path);
    return found instanceof TFile ? found : null;
  };

  return {
    async read(path) {
      const file = fileAt(path);
      return file ? vault.readBinary(file) : null;
    },
    async readText(path) {
      const file = fileAt(path);
      return file ? vault.read(file) : null;
    },
    async write(path, data) {
      await ensureFolder(parentOf(path));
      const existing = fileAt(path);
      if (existing) {
        if (typeof data === 'string') await vault.modify(existing, data); else await vault.modifyBinary(existing, data);
      } else if (typeof data === 'string') await vault.create(path, data);
      else await vault.createBinary(path, data);
    },
    async folders(root) {
      const folder = vault.getAbstractFileByPath(root);
      if (!(folder instanceof TFolder)) return [];
      return folder.children
        .filter((child): child is TFolder => child instanceof TFolder && child.children.some((inner) => inner instanceof TFile && inner.name === SETTINGS_FILE))
        .map((child) => child.path);
    },
    async remove(folder) {
      const found = vault.getAbstractFileByPath(folder);
      if (found instanceof TFolder) await app.fileManager.trashFile(found);
    },
    async rename(from, to) {
      const found = vault.getAbstractFileByPath(from);
      if (!(found instanceof TFolder)) throw new Error(`Cannot rename "${from}": it is not a folder`);
      await ensureFolder(parentOf(to));
      if (from !== to && from.toLowerCase() === to.toLowerCase()) {
        // Only the capitals change. Windows sees the same name and refuses, so the folder takes a detour.
        let detour = `${from}-renaming`;
        for (let n = 2; vault.getAbstractFileByPath(detour); n++) detour = `${from}-renaming-${n}`;
        await app.fileManager.renameFile(found, detour);
        try {
          await app.fileManager.renameFile(found, to);
        } catch (error) {
          // Put the folder back, so it is not left under the detour name (the store would list it as another background).
          await app.fileManager.renameFile(found, from);
          throw error;
        }
        return;
      }
      await app.fileManager.renameFile(found, to);
    },
  };
}
