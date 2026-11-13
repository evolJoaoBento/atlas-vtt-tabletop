/**
 * Backups Tabletop writes before it changes something of the user's in a way they did not ask for step by step (a
 * migration): plain copies in the vault, under `Tabletop backups/<date>/`, which Tabletop never deletes.
 */
import type { App } from 'obsidian';

export const BACKUP_FOLDER = 'Tabletop backups';

const two = (value: number): string => String(value).padStart(2, '0');
/** The day as folders are named: `YYYY-MM-DD`, in local time. */
export const backupDay = (date: Date): string => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

/** A file name safe in a vault: no path separators or characters a file system refuses. */
const safeName = (name: string): string => name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'backup';

/** `name` when free, else `name-2`, `name-3`… before its extension. */
function freeName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${extension}`;
    if (!taken(candidate)) return candidate;
  }
}

/** Writes each file into `Tabletop backups/<YYYY-MM-DD>/` (a name taken gets `-2`, `-3`); returns the folder. */
export async function writeBackup(app: App, date: Date, files: ReadonlyArray<{ name: string; text: string }>): Promise<string> {
  const { adapter } = app.vault;
  const folder = `${BACKUP_FOLDER}/${backupDay(date)}`;
  if (!(await adapter.exists(BACKUP_FOLDER))) await adapter.mkdir(BACKUP_FOLDER);
  if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
  const written = new Set<string>();
  for (const file of files) {
    const existing = new Set((await adapter.list(folder)).files.map((path) => path.split('/').pop() ?? path));
    const name = freeName(safeName(file.name), (candidate) => existing.has(candidate) || written.has(candidate));
    written.add(name);
    await adapter.write(`${folder}/${name}`, file.text);
  }
  return folder;
}
