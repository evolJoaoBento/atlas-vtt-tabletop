// Atlas source: src/app/services/offlineDiceInputs.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { t } from '../../shims/i18n';
import type { DiceRollInputs } from '../../shims/atlasTypes';
import { showNotice } from '../ui/notice';

/** The local roller's random stream: dice, initiative and hit points joining a scene all roll with it. */
export const diceRandom = (): number => Math.random();

/** Keep the local roller's random stream, id format and label at the plugin boundary. */
export function offlineDiceInputs(): DiceRollInputs {
  return {
    random: diceRandom,
    rollId: (): string => `roll_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    roller: (): string => t('dice.player'),
    onFormulaError: (error): void => { showNotice(t(`dice.formulaError.${error.code}`)); },
  };
}
