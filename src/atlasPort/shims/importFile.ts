// Stand-in for Atlas's randomTables/import/importFile.ts @ 0.12.0 (AGPL-3.0) in the copies: reading tables out of PDF,
// spreadsheet and text files is Atlas's (it needs nothing from the board), so the board hands it off.
import { Notice } from 'obsidian';

export const TABLE_FILE_ACCEPT = '.pdf,.xlsx,.csv,.tsv,.md,.markdown,.txt';
export type TableImportFile = Pick<File, 'name' | 'size' | 'arrayBuffer'>;

export async function importTableFile(_file: TableImportFile, _options: unknown, _readOptions: unknown = {}): Promise<never> {
  new Notice("Tabletop: import tables from a file in Atlas's random tables.");
  throw new Error('Importing table files is done in Atlas.');
}
