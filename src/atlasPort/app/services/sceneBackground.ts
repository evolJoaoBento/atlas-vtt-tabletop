// Atlas source: src/app/services/sceneBackground.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { TFile, type App } from 'obsidian';
import { isPersistedMapEnvelope } from './MapPersistence';

/** The background image a scene's map file shows, if it can be read. */
export async function sceneBackground(app: App, mapPath: string): Promise<string | undefined> {
  const file = app.vault.getAbstractFileByPath(mapPath);
  if (!(file instanceof TFile)) return undefined;
  try {
    const envelope: unknown = JSON.parse(await app.vault.cachedRead(file));
    return isPersistedMapEnvelope(envelope) ? envelope.state?.background ?? undefined : undefined;
  } catch {
    return undefined;
  }
}
