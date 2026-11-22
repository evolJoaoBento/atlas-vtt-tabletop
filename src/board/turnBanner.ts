/**
 * Atlas 0.18's turn banner on the 3D board: a capsule over the toolbar that names whose turn it is for a moment as the turn
 * moves on, and a fight's start and end. What it says and when is Atlas's (`atlasPort/app/initiative/banner`, copied); this
 * is the board's wiring of it, as Atlas's `TurnAnnouncer` wires it on the GM's map: the GM's banner always names the turn
 * (the players' look is Atlas's player window's and Connect's), nothing is said on a scene's load or the first look at a
 * fight, and the GM's switch (`initiativeTurnOptions().banner`, Atlas's tracker menu) turns it off.
 */
import { FightWatch, fightBanner } from '../atlasPort/app/initiative/banner/fightWatch';
import { TurnWatch, type TurnBanner } from '../atlasPort/app/initiative/banner/turnBanner';
import type { BoardToken } from './mapModel';
import type { InitiativeState } from './initiative';

/** What Atlas's watches read of a store: the fight, the scene, and the tokens its entries name. */
export type TurnBannerState = Parameters<TurnWatch['next']>[0];

/** What the board does with its banner: show these in turn, or let a standing turn banner go (a fight's end stays its time). */
export type TurnBannerCommand = { readonly show: TurnBanner[] } | { readonly hideTurn: true } | null;

/** The state of a map the board reads from its file (Atlas does not hold it): its fight and the tokens the entries name. */
export function bannerStateOf(mapPath: string, initiative: InitiativeState | null, tokens: readonly BoardToken[]): TurnBannerState {
  const byId: Record<string, unknown> = {};
  for (const token of tokens) byId[token.id] = { ...token, isHidden: token.hidden, statblockPath: token.statblockPath ?? undefined };
  return { initiative: (initiative ?? undefined) as TurnBannerState['initiative'], mapPath, isMapLoading: false, objects: { tokens: byId as TurnBannerState['objects']['tokens'] } };
}

/** Whether Atlas's switch lets the banner show: on unless Atlas says it is off (an Atlas without the setting, or no Atlas, shows it). */
export function turnBannerEnabled(settings: { initiativeTurnOptions?: () => { banner?: boolean } } | null): boolean {
  try {
    return settings?.initiativeTurnOptions?.().banner !== false;
  } catch {
    return true;
  }
}

/** Follows a map's fight and says what its banner does at each look (Atlas's `TurnAnnouncer`, without the camera). */
export class TurnAnnouncer {
  private readonly turns = new TurnWatch();
  private readonly fights = new FightWatch();

  look(state: TurnBannerState, enabled: boolean): TurnBannerCommand {
    const banner = this.turns.next(state, { kind: 'gm' });
    const change = this.fights.next(state);
    if (!state.initiative?.isActive) {
      // The fight ended: its banner replaces the turn's; a turn's banner leaves with the fight
      if (change === 'ended' && enabled) return { show: [fightBanner('ended')] };
      return { hideTurn: true };
    }
    // A fight that starts says so, then names its first turn
    if (change === 'started' && enabled) return { show: [fightBanner('started'), ...(banner ? [banner] : [])] };
    if (banner && enabled) return { show: [banner] };
    return null;
  }

  /** Forget what was seen: the next look starts afresh. */
  reset(): void {
    this.turns.reset();
    this.fights.reset();
  }
}
