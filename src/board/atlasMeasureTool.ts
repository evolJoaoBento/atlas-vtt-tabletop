/**
 * Atlas's Measure tool choices (`measureTool` in the store of the map view, `setMeasureTool` to change them), as the
 * board reads and writes them so the board's bar and Atlas's own toolbar agree. Feature-checked: an Atlas without them
 * (before 0.16) leaves the board its own copy. Pure.
 */
import { readMeasureToolOptions, type MeasureToolOptions } from './measureOptions';

/** The Measure tool's choices of an Atlas view's state; null where the state has no such choices. */
export function readAtlasMeasureTool(state: unknown): MeasureToolOptions | null {
  if (typeof state !== 'object' || state === null) return null;
  const { measureTool, setMeasureTool } = state as { measureTool?: unknown; setMeasureTool?: unknown };
  if (typeof measureTool !== 'object' || measureTool === null || typeof setMeasureTool !== 'function') return null;
  return readMeasureToolOptions(measureTool);
}

/** Changes the Measure tool's choices of an Atlas view's state; false where it has none (nothing is changed). */
export function writeAtlasMeasureTool(state: unknown, changes: Partial<MeasureToolOptions>): boolean {
  if (readAtlasMeasureTool(state) === null) return false;
  try { (state as { setMeasureTool(changes: Partial<MeasureToolOptions>): void }).setMeasureTool(changes); } catch { return false; }
  return true;
}
