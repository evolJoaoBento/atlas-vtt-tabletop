// Stand-in for Atlas's onboarding/lootTutorials.ts @ 0.15.0 (AGPL-3.0) in the copies: Atlas's guided tours (and their
// pictures) are not shown on the board, so they have no steps.
type TutorialStep = Record<string, unknown>;

export const LOOT_TUTORIAL_LABEL = '';
export const LOOT_SETTINGS_STEPS: TutorialStep[] = [];
export const LOOT_RESULT_STEPS: TutorialStep[] = [];
export function lootRollerSteps(_hotkey: string, _hasRarities: boolean): TutorialStep[] {
  return [];
}
