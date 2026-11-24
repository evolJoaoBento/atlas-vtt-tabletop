// Atlas source: src/app/dungeons/idKey.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
/** The i18n key segment of a stored id in kebab case (`no-secrets` → `noSecrets`, `long-table` → `longTable`). */
export function idKey(id: string): string {
  return id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}
