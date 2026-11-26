// Atlas source: src/app/services/mapInitiativeRules.ts @ 0.20.0 (AGPL-3.0, hand-copied for Tabletop: the board's player window shows Atlas's own initiative list; only the imports differ).
// @ts-nocheck
import type { App } from 'obsidian';
import { DEFAULT_INITIATIVE_RULES, collectionInitiativeRules } from '../gameSystems/initiativeRules';
import type { InitiativeRules } from '../../shims/atlasTypes';
import { systemPresetsOf } from './mapCollectionRules';
import { mapRules } from './mapRules';

/** Initiative rules the map plays by (`mapRules`); the default rules without any. */
export function mapInitiativeRules(app: App, mapPath: string | null | undefined): InitiativeRules {
  const { settings } = mapRules(app, mapPath);
  return settings ? collectionInitiativeRules(settings, systemPresetsOf(app)) : { ...DEFAULT_INITIATIVE_RULES };
}
