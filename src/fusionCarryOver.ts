/**
 * The first fusion step's carry-over: what Tabletop 1.3 kept of its own and 1.4 takes from Atlas. Nothing is dropped
 * before it is backed up or handed to Atlas, and the user is told what moved. Pure (its doings are handed in), so it
 * is tested without Obsidian.
 */
import { DEFAULT_LASER, resolveLaser, type LaserSettings } from './board/laser';

export type LegacyLighting = Record<string, { ambient?: number; tint?: string }>;

export interface CarryOverDeps {
  /** The light levels and tints the boards kept of their own, by map; still kept (and saved) until dropped. */
  legacyLighting(): LegacyLighting;
  /** Stops keeping them: only after the backup is written. */
  dropLegacyLighting(): void;
  /** Writes the backup files; resolves with the folder. */
  backup(files: ReadonlyArray<{ name: string; text: string }>): Promise<string>;
  /** Tabletop's own laser (1.3), if the user ever set one. */
  ownLaser: Partial<LaserSettings> | undefined;
  /** Atlas's laser; null while Atlas is not there to ask. */
  atlasLaser(): LaserSettings | null;
  setAtlasLaser(laser: LaserSettings): boolean;
  /** The dice sound switch was off. */
  diceOff: boolean;
}

export interface CarryOverResult {
  /** Everything was carried over or backed up: never to be run again. */
  done: boolean;
  /** Tabletop's own laser was dealt with (handed to Atlas, or Atlas already had the user's own): it can be forgotten. */
  laserHandled: boolean;
  /** What to tell the user, in order; empty for nothing. */
  lines: string[];
}

const count = (n: number): string => (n === 1 ? 'one map' : `${n} maps`);

/**
 * - A map's own light level and tint: written to `board-lighting.json` first, and only then dropped. If the backup
 *   cannot be written they are kept, and it is tried again next time.
 * - Tabletop's laser: handed to Atlas while Atlas's is still its default. It needs Atlas there; without it this part
 *   waits, and nothing else waits for it.
 * - A dice sound switch that was off is named once, at the end.
 */
export async function carryOver(deps: CarryOverDeps): Promise<CarryOverResult> {
  const lines: string[] = [];
  let pending = false;

  const lighting = deps.legacyLighting();
  const maps = Object.keys(lighting).length;
  if (maps > 0) {
    try {
      const folder = await deps.backup([{ name: 'board-lighting.json', text: JSON.stringify(lighting, null, 2) }]);
      deps.dropLegacyLighting();
      lines.push(`The light level and tint of ${count(maps)} are now Atlas's scene lighting; backup in ${folder}/`);
    } catch (error) {
      console.warn("Tabletop: the maps' own light levels could not be backed up; they are kept, and it is tried again:", error);
      pending = true;
    }
  }

  const own = deps.ownLaser;
  let laserHandled = !(own !== undefined && (own.color !== undefined || own.size !== undefined));
  if (!laserHandled) {
    const atlas = deps.atlasLaser();
    if (!atlas) {
      pending = true;
    } else {
      const mine = resolveLaser(own);
      const atlasIsDefault = atlas.color === DEFAULT_LASER.color && atlas.size === DEFAULT_LASER.size;
      if (atlasIsDefault && (mine.color !== atlas.color || mine.size !== atlas.size)) {
        if (deps.setAtlasLaser(mine)) {
          lines.push("Your laser's colour and size are now Atlas's laser.");
          laserHandled = true;
        } else {
          pending = true;
        }
      } else {
        laserHandled = true;
      }
    }
  }

  if (!pending && deps.diceOff) lines.push("Dice sounds now follow Atlas's dice volume.");
  return { done: !pending, laserHandled, lines };
}
