/**
 * Which graphics card Obsidian draws on, on Windows. Chromium (and so Obsidian) takes the card Windows gives the app
 * when it starts, and ignores WebGL's `powerPreference` there, so a laptop with a fast card often draws the 3D board
 * on its built-in chip. Windows keeps the choice per app, as one line under
 * `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` (what Settings → System → Display → Graphics writes):
 * `GpuPreference=0;` lets Windows decide, `1` is power saving, `2` high performance. Tabletop reads and writes that
 * line for Obsidian when the GM picks a card in its settings; it takes effect when Obsidian is next started.
 * The parsing is pure and tested; `GpuSettings` runs the Windows commands.
 */

export interface Adapter {
  name: string;
  /** Its memory in bytes as Windows reports it (capped at 4 GB); 0 when unknown. */
  memory: number;
}

/** 0 lets Windows decide, 1 is the power-saving card, 2 the high-performance one. */
export type GpuPreference = 0 | 1 | 2;

const BUILT_IN = /\b(intel|uhd|iris)\b|radeon\(tm\) graphics|radeon graphics/i;
/** Display adapters that are not a card to draw on (remote desktop, a missing driver). */
const NOT_A_CARD = /microsoft basic|remote display|virtual|parsec|citrix/i;

/** The graphics cards from `Get-CimInstance Win32_VideoController | Select Name,AdapterRAM | ConvertTo-Json`. */
export function parseAdapters(json: string): Adapter[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { Name, AdapterRAM } = entry as { Name?: unknown; AdapterRAM?: unknown };
    if (typeof Name !== 'string' || !Name.trim()) return [];
    return [{ name: Name.trim(), memory: typeof AdapterRAM === 'number' && AdapterRAM > 0 ? AdapterRAM : 0 }];
  });
}

/**
 * The two cards Windows chooses between: the power-saving one (the built-in chip) and the high-performance one; null
 * when there is nothing to choose. Windows does the choosing; these are the names shown for its two options.
 */
export function gpuChoices(adapters: readonly Adapter[]): { power: string; performance: string } | null {
  const cards = adapters.filter((adapter) => !NOT_A_CARD.test(adapter.name));
  if (cards.length < 2) return null;
  // The fast card has more memory of its own; where Windows reports none, the built-in chip is told by its name.
  const rank = (adapter: Adapter): number => adapter.memory + (BUILT_IN.test(adapter.name) ? 0 : 1);
  const sorted = [...cards].sort((a, b) => rank(b) - rank(a));
  return { performance: sorted[0].name, power: sorted[sorted.length - 1].name };
}

/** The chip a WebGL renderer string names: ANGLE's `ANGLE (Vendor, Chip (0x…) Direct3D11 …, D3D11)`, else the string. */
export function chipName(renderer: string): string {
  if (!renderer.startsWith('ANGLE (')) return renderer.trim();
  const chip = renderer.slice(renderer.indexOf(',') + 1);
  return chip.split(/\s\(0x[0-9a-f]+\)|\sDirect3D|\sOpenGL|\sVulkan|,/i)[0].trim();
}

/** The preference a value's data holds; no value lets Windows decide. */
export function readPreference(data: string | null): GpuPreference {
  const found = /GpuPreference=(\d)/.exec(data ?? '');
  const value = found ? Number(found[1]) : 0;
  return value === 1 || value === 2 ? value : 0;
}

/** A value's data with the preference set, keeping the other settings Windows stores beside it. */
export function withPreference(data: string | null, preference: GpuPreference): string {
  const others = (data ?? '').split(';').filter((part) => part.trim() && !part.trim().startsWith('GpuPreference='));
  return [...others, `GpuPreference=${preference}`].map((part) => `${part};`).join('');
}

/** The data of the one value `reg query … /v` printed, or null. */
export function readRegValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf('REG_SZ');
    if (at >= 0) return line.slice(at + 'REG_SZ'.length).trim();
  }
  return null;
}

// ── Windows ─────────────────────────────────────────────────────────────────

const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

type ExecFile = (file: string, args: string[], options: { windowsHide: boolean; encoding: string }, done: (error: Error | null, stdout: string) => void) => void;

interface DesktopWindow {
  require?: (module: string) => unknown;
  process?: { platform?: string; execPath?: string };
}

/** Reads the cards, the chip in use and Obsidian's preference, and saves a new preference; Windows only. */
export class GpuSettings {
  private readonly execFile: ExecFile;
  /** Obsidian's own program, the value's name. */
  readonly exe: string;

  private constructor(execFile: ExecFile, exe: string) {
    this.execFile = execFile;
    this.exe = exe;
  }

  /** Null where there is nothing to set: not Windows, or not Obsidian's desktop app. */
  static here(): GpuSettings | null {
    const desktop = window as unknown as DesktopWindow;
    if (desktop.process?.platform !== 'win32' || !desktop.process.execPath || !desktop.require) return null;
    const childProcess = desktop.require('child_process') as { execFile?: ExecFile };
    return childProcess.execFile ? new GpuSettings(childProcess.execFile, desktop.process.execPath) : null;
  }

  private run(file: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      this.execFile(file, args, { windowsHide: true, encoding: 'utf8' }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
  }

  async adapters(): Promise<Adapter[]> {
    const json = await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress']);
    return parseAdapters(json);
  }

  /** Obsidian's line as Windows holds it, or null when there is none (Windows decides). */
  private async value(): Promise<string | null> {
    try {
      return readRegValue(await this.run('reg.exe', ['query', KEY, '/v', this.exe]));
    } catch {
      // `reg query` fails when the value (or the key) is not there.
      return null;
    }
  }

  async preference(): Promise<GpuPreference> {
    return readPreference(await this.value());
  }

  /** Saves the preference for Obsidian; it takes effect when Obsidian is next started. */
  async save(preference: GpuPreference): Promise<void> {
    const data = withPreference(await this.value(), preference);
    await this.run('reg.exe', ['add', KEY, '/v', this.exe, '/t', 'REG_SZ', '/d', data, '/f']);
    if (readPreference(await this.value()) !== preference) throw new Error('Windows did not keep the setting');
  }
}

/** The chip this window's WebGL draws on, or null when it cannot tell. */
export function currentChip(doc: Document): string | null {
  const canvas = doc.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as unknown : null;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return typeof renderer === 'string' ? chipName(renderer) : null;
}
