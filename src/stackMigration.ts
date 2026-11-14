/**
 * The move of older Tabletop's scene stacks to Atlas levels, when the GM says so (`board/stackMove.ts` plans one;
 * `tokenWriter.applyStackMove` writes it through Atlas's own actions). For each stack, in this order, so that a stop at
 * any point loses nothing and adds no level twice:
 *
 * 1. a backup of every scene's file, Tabletop's data for it and its minis (before Atlas is made to hold anything);
 * 2. each member read as Atlas holds it (Atlas's loader makes a file of any age into records of today);
 * 3. the base held, the move planned on its state, and the plan's journal kept in Tabletop's data and saved;
 * 4. the write, if the state is still the one planned on (else planned again);
 * 5. the base's file seen with the levels (Atlas saves a moment after a change);
 * 6. Tabletop's own data adopted (`BoardData.adoptStack`: styles, minis, props, hidden floors, cutscene shots), the
 *    stack's records and the journal gone.
 *
 * A journal found at start is finished when the base's file has its levels (step 6 alone), and dropped when it has
 * not (the write never landed: the stack is as it was). Nothing here depends on Obsidian: the plugin gives the deps.
 */
import type { AtlasSceneState } from './atlas';
import type { Assignments } from './assignments';
import type { BoardData, StackJournal, StackMember } from './board/boardData';
import { planStackMove, stackSkip, type BaseSource, type MemberSource, type SceneFields, type StackPlan } from './board/stackMove';

export interface StackMigrationDeps {
  boardData: BoardData;
  assignments: Assignments;
  writer: { applyStackMove(path: string, plan: (state: AtlasSceneState) => StackPlan | null): Promise<StackPlan | null> };
  /** Makes Atlas hold the map; false when it does not come to. */
  follow(path: string): Promise<boolean>;
  /** Atlas's state while it holds the map; null otherwise. */
  heldState(path: string): AtlasSceneState | null;
  /** The map Atlas shows now: where it is brought back to. */
  shownMap(): string | null;
  /** A vault file's text; null when there is none. */
  read(path: string): Promise<string | null>;
  /** Writes files into today's backup folder; the folder. */
  backup(files: Array<{ name: string; text: string }>): Promise<string>;
  /** A scene's size in its own pixels (its image as its grid alignment draws it); null when it cannot be had. */
  worldSize(background: string | null, grid: unknown): Promise<{ width: number; height: number } | null>;
  /** Saves Tabletop's data to disk now. */
  save(): Promise<void>;
  /** Why nothing may be moved now (a session is hosted, a cutscene runs); null when it may. */
  busy(): string | null;
  newLevelId(): string;
  wait(ms: number): Promise<void>;
}

export interface StackOutcome {
  base: string;
  moved: boolean;
  /** The levels the base has (or would have), lowest first, by name. */
  levels: string[];
  /** What is not kept, in words. */
  lost: string[];
  /** Why the stack was not moved; null when it was (or, in a preview, can be). */
  skipped: string | null;
}

/** How long, and how often, the base's file is looked at for the levels after the write (Atlas saves about a second after a change). */
const FILE_WAIT_MS = 10000;
const FILE_STEP_MS = 250;
/** How often a move is planned again when the scene changed under it. */
const PLAN_TRIES = 4;

const nameOf = (path: string): string => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields of a scene's state a move reads, copied (the store's records are frozen and replaced, never changed). */
function sceneOf(state: unknown): SceneFields | null {
  if (!isObj(state) || !isObj(state.objects)) return null;
  const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
  return {
    levels: copy(state.levels),
    background: typeof state.background === 'string' ? state.background : null,
    objects: copy(state.objects) as SceneFields['objects'],
    exploredMask: typeof state.exploredMask === 'string' ? state.exploredMask : null,
    grid: isObj(state.grid) ? (copy(state.grid) as SceneFields['grid']) : null,
    lighting: copy(state.lighting),
  };
}

const hasInitiative = (state: unknown): boolean => isObj(state) && isObj(state.initiative) && Array.isArray(state.initiative.entries) && state.initiative.entries.length > 0;

function levelIds(text: string | null): Set<string> {
  try {
    const state = text ? (JSON.parse(text) as { state?: { levels?: unknown } }).state : null;
    const levels = Array.isArray(state?.levels) ? state.levels : [];
    return new Set(levels.flatMap((level) => (isObj(level) && typeof level.id === 'string' ? [level.id] : [])));
  } catch {
    return new Set();
  }
}

export class StackMigration {
  private running = false;

  constructor(private readonly deps: StackMigrationDeps) {}

  /** The stacks still kept in Tabletop's data. */
  pending(): Array<{ base: string; members: StackMember[] }> {
    return this.deps.boardData.stacks();
  }

  private baseSource(path: string, scene: SceneFields): BaseSource {
    const { boardData } = this.deps;
    return { path, name: nameOf(path), scene, fogHeight: boardData.fogHeight(path), wallThickness: boardData.wallThickness(path) };
  }

  private async memberSource(member: StackMember, state: unknown): Promise<MemberSource | null> {
    const { boardData } = this.deps;
    const scene = sceneOf(state);
    if (!scene) return null;
    return {
      path: member.path, name: nameOf(member.path), elevation: member.elevation, placement: member.placement, scene,
      size: await this.deps.worldSize(scene.background, scene.grid).catch(() => null),
      legacyExtras: boardData.legacyExtras(member.path), legacyWater: boardData.legacyWater(member.path),
      fogHeight: boardData.fogHeight(member.path), wallThickness: boardData.wallThickness(member.path), hasInitiative: hasInitiative(state),
    };
  }

  /** What a move would do, read from the scenes' files (nothing is held, nothing written): the levels, what is not kept, why a stack would be skipped. */
  async preview(): Promise<StackOutcome[]> {
    const outcomes: StackOutcome[] = [];
    const fileState = async (path: string): Promise<unknown> => {
      try { return (JSON.parse((await this.deps.read(path)) ?? 'null') as { state?: unknown } | null)?.state ?? null; } catch { return null; }
    };
    for (const { base, members } of this.pending()) {
      const baseScene = sceneOf(await fileState(base));
      const sources: MemberSource[] = [];
      const read: Array<{ name: string; scene: SceneFields | null }> = [];
      for (const member of members) {
        const source = await this.memberSource(member, await fileState(member.path));
        read.push({ name: nameOf(member.path), scene: source?.scene ?? null });
        if (source) sources.push(source);
      }
      const skipped = stackSkip(baseScene, read);
      if (skipped || !baseScene) { outcomes.push({ base, moved: false, levels: [], lost: [], skipped: skipped ?? 'the base scene could not be read' }); continue; }
      const plan = planStackMove(this.baseSource(base, baseScene), sources, () => `level_preview_${outcomes.length}_${Math.random().toString(36).slice(2, 8)}`);
      outcomes.push({ base, moved: false, levels: levelNames(plan), lost: plan.lost, skipped: null });
    }
    return outcomes;
  }

  /**
   * Moves every stack. `refused` says why nothing was tried (a session is hosted, a move is already running);
   * `backup` is the folder the scenes were backed up to (null when there was nothing to move).
   */
  async move(): Promise<{ outcomes: StackOutcome[]; backup: string | null; refused: string | null }> {
    const busy = this.running ? 'a move is already under way' : this.deps.busy();
    if (busy) return { outcomes: [], backup: null, refused: busy };
    const stacks = this.pending();
    if (stacks.length === 0) return { outcomes: [], backup: null, refused: null };
    this.running = true;
    const back = this.deps.shownMap();
    try {
      const folder = await this.deps.backup(await this.backupFiles(stacks));
      const outcomes: StackOutcome[] = [];
      for (const stack of stacks) {
        try {
          outcomes.push(await this.moveOne(stack.base, stack.members));
        } catch (error) {
          outcomes.push({ base: stack.base, moved: false, levels: [], lost: [], skipped: error instanceof Error ? error.message : String(error) });
        }
      }
      if (back) await this.deps.follow(back).catch(() => false);
      await this.deps.backup([{ name: 'Stacks moved.md', text: summaryOf(outcomes) }]).catch(() => folder);
      return { outcomes, backup: folder, refused: null };
    } finally {
      this.running = false;
    }
  }

  private async backupFiles(stacks: ReadonlyArray<{ base: string; members: StackMember[] }>): Promise<Array<{ name: string; text: string }>> {
    const { boardData, assignments } = this.deps;
    const files: Array<{ name: string; text: string }> = [];
    for (const path of new Set(stacks.flatMap(({ base, members }) => [base, ...members.map((member) => member.path)]))) {
      const name = nameOf(path);
      const text = await this.deps.read(path);
      if (text !== null) files.push({ name: `${name}.atlasmap`, text });
      files.push({ name: `${name}.tabletop.json`, text: JSON.stringify(boardData.toJSON()[path] ?? {}, null, 2) });
      files.push({ name: `${name}.minis.json`, text: JSON.stringify(assignments.forMap(path), null, 2) });
    }
    return files;
  }

  private async moveOne(base: string, members: readonly StackMember[]): Promise<StackOutcome> {
    const { boardData } = this.deps;
    const skip = (skipped: string): StackOutcome => ({ base, moved: false, levels: [], lost: [], skipped });
    // Each member as Atlas holds it.
    const sources: MemberSource[] = [];
    for (const member of members) {
      const source = (await this.deps.follow(member.path)) ? await this.memberSource(member, this.deps.heldState(member.path)) : null;
      if (!source) return skip(stackSkip({ background: null, objects: {}, grid: null }, [{ name: nameOf(member.path), scene: null }]) ?? `${nameOf(member.path)} could not be read`);
      sources.push(source);
    }
    if (!(await this.deps.follow(base))) return skip(stackSkip(null, sources) ?? 'the base scene could not be read');
    let journal: StackJournal | null = null;
    let written: StackPlan | null = null;
    for (let attempt = 0; attempt < PLAN_TRIES && !written; attempt++) {
      const state = this.deps.heldState(base);
      const scene = sceneOf(state);
      const skipped = stackSkip(scene, sources);
      if (skipped || !state || !scene) { if (journal) { boardData.setStackJournal(base, null); await this.deps.save(); } return skip(skipped ?? 'the base scene could not be read'); }
      // What the plan is made on, by identity: Atlas replaces these when anything changes.
      const { objects, levels } = state;
      const plan = planStackMove(this.baseSource(base, scene), sources, this.deps.newLevelId);
      // What Tabletop's side needs to finish is on disk before Atlas is written: a stop after the write loses nothing.
      journal = { baseLevel: plan.baseLevel, members: plan.members };
      boardData.setStackJournal(base, journal);
      await this.deps.save();
      // Written only on the state it was planned on (asked again at the write itself, with no wait between).
      const same = (now: AtlasSceneState | null): boolean => now !== null && now.objects === objects && now.levels === levels;
      try {
        written = same(this.deps.heldState(base)) ? await this.deps.writer.applyStackMove(base, (now) => (same(now) ? plan : null)) : null;
      } catch (error) {
        boardData.setStackJournal(base, null);
        await this.deps.save();
        throw error;
      }
    }
    if (!written || !journal) {
      boardData.setStackJournal(base, null);
      await this.deps.save();
      return skip('the base scene kept changing while it was being moved; try again');
    }
    // Atlas saves a moment after a change: Tabletop's side waits for the file.
    const wanted = [journal.baseLevel, ...journal.members.map((member) => member.level)];
    let saved = false;
    for (let waited = 0; waited <= FILE_WAIT_MS && !saved; waited += FILE_STEP_MS) {
      const ids = levelIds(await this.deps.read(base));
      saved = wanted.every((id) => ids.has(id));
      if (!saved) await this.deps.wait(FILE_STEP_MS);
    }
    if (!saved) return { base, moved: false, levels: levelNames(written), lost: written.lost, skipped: 'Atlas has the levels but has not saved the scene yet; Tabletop finishes its side at the next start' };
    await this.adopt(base, journal);
    return { base, moved: true, levels: levelNames(written), lost: written.lost, skipped: null };
  }

  private async adopt(base: string, journal: StackJournal): Promise<void> {
    const { boardData, assignments } = this.deps;
    for (const member of journal.members) assignments.adopt(member.path, base, member.ids.tokens ?? {});
    boardData.adoptStack(base, journal);
    await this.deps.save();
  }

  /** At start: a move that stopped after its journal was kept is finished (the base's file has its levels) or dropped (it has not). */
  async finishJournals(): Promise<void> {
    const { boardData } = this.deps;
    for (const base of Object.keys(boardData.toJSON())) {
      const journal = boardData.stackJournal(base);
      if (!journal) continue;
      const ids = levelIds(await this.deps.read(base).catch(() => null));
      if ([journal.baseLevel, ...journal.members.map((member) => member.level)].every((id) => ids.has(id))) await this.adopt(base, journal);
      else { boardData.setStackJournal(base, null); await this.deps.save(); }
    }
  }
}

function levelNames(plan: StackPlan): string[] {
  return (Array.isArray(plan.scene.levels) ? plan.scene.levels : []).map((level) => (isObj(level) && typeof level.name === 'string' ? level.name : '?'));
}

/** What a move did, as a note kept beside the backup. */
export function summaryOf(outcomes: readonly StackOutcome[]): string {
  const lines = ['# Scene stacks moved to Atlas levels', '', 'The scenes that were stacked are still there, each as a scene of its own; the base scene now has them as its levels.', ''];
  for (const outcome of outcomes) {
    lines.push(`## ${nameOf(outcome.base)}`, '');
    if (outcome.moved) lines.push(`Moved. Its levels, lowest first: ${outcome.levels.join(', ')}.`);
    else lines.push(`Not moved: ${outcome.skipped ?? 'unknown'}.`);
    if (outcome.lost.length > 0) lines.push('', 'Not kept:', ...outcome.lost.map((line) => `- ${line}`));
    lines.push('');
  }
  return lines.join('\n');
}
