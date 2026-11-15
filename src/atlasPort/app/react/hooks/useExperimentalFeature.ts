// Atlas source: src/app/react/hooks/useExperimentalFeature.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { ExperimentalFeatureId } from '../../../shims/atlasTypes';
import { useAtlasSettings } from '../../keyboard/useMapHotkeys';
import type { SettingsService } from '../../../shims/settingsService';

/** Whether an experimental feature is switched on, kept current as the GM switches it. */
export function useExperimentalFeature(id: ExperimentalFeatureId, settings?: SettingsService): boolean {
  return useAtlasSettings(settings)?.isExperimentalOn(id) ?? false;
}
