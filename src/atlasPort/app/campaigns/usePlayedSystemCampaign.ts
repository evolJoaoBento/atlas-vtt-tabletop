// Atlas source: src/app/campaigns/usePlayedSystemCampaign.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useCallback, useSyncExternalStore } from 'react';
import type { App } from 'obsidian';
import { CampaignFiles } from './CampaignFiles';
import type { CampaignService } from './CampaignService';
import type { Campaign } from '../../shims/atlasTypes';
import { PlayedRules } from './playedRules';
import { useCampaigns } from './useCampaigns';

export interface PlayedSystemCampaign {
  readonly campaign: Campaign;
  readonly service: CampaignService;
}

/**
 * The campaign this device plays while its game system applies to every map in place of the
 * collections' (`PlayedRules`, which the maps read too); null otherwise. Follows Play, Stop and edits.
 */
export function usePlayedSystemCampaign(app: App | null | undefined): PlayedSystemCampaign | null {
  const rules = PlayedRules.forApp(app ?? undefined);
  const subscribe = useCallback((listener: () => void) => rules?.onChange(listener) ?? ((): void => undefined), [rules]);
  const campaignId = useSyncExternalStore(subscribe, () => rules?.played()?.campaignId ?? null);
  const { service, campaigns } = useCampaigns(app ? CampaignFiles.forApp(app) : undefined);
  const campaign = campaignId === null ? undefined : campaigns.find((candidate) => candidate.id === campaignId);
  return service && campaign ? { campaign, service } : null;
}
