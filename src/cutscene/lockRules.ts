/**
 * What a person can do with the board in each part of a cutscene. `running` and `live` are the GM's; `locked` is a
 * player's during either.
 */

export type CinematicRole = 'none' | 'authoring' | 'previewing' | 'running' | 'live' | 'locked';

export type LockInput = 'camera' | 'token-drag' | 'tool' | 'eyes' | 'ar' | 'token-info' | 'dice';

export function inputAllowed(role: CinematicRole, input: LockInput): boolean {
  switch (role) {
    case 'locked':
      return input === 'token-info' || input === 'dice';
    case 'running':
    case 'previewing':
      return input !== 'camera' && input !== 'eyes' && input !== 'ar';
    case 'authoring':
      return input !== 'eyes' && input !== 'ar';
    default:
      return true;
  }
}
