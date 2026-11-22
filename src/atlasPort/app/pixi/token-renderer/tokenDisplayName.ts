// Atlas source: src/app/pixi/token-renderer/tokenDisplayName.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { BaseToken, Character } from '../../../shims/atlasTypes';
import { t } from '../../../shims/i18n';

/**
 * The name a token's nameplate shows: its own name, else its statblock's, else a
 * placeholder while a linked statblock's name is not read yet. A token with neither
 * has none.
 */
export function tokenDisplayName(token: BaseToken & Partial<Pick<Character, 'name' | 'statblockPath' | 'statblockName'>>): string | null {
  if (token.name) return token.name;
  if (!token.statblockPath) return null;
  return token.statblockName || t('token.unknownCreature');
}
