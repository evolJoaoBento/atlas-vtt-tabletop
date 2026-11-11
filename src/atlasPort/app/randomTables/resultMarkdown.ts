// Atlas source: src/app/randomTables/resultMarkdown.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { TableResult } from '../loot/lootHistory';

/** A rolled result as Markdown to paste into a note: its text, then a line per column. */
export function resultMarkdown(result: TableResult): string {
  const lines = [result.text.trim(), ...result.fields.map((field) => `- **${field.label}:** ${field.value}`)];
  return lines.filter(Boolean).join('\n');
}
