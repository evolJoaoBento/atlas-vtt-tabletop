/**
 * The Sound files window on the 3D board: every board sound with its own level, a preview, and the player's own file in
 * its place (Replace…, Reset), with the custom sounds folder and the export of the built-in sounds. Drawn in the frame and
 * the parts of Atlas's asset manager (its window, sidebar, header and settings rows, styled by Atlas's live stylesheet)
 * inside an `.atlas-vtt-plugin` root, over the board, as the asset manager is. This is the only place these are set.
 */
import '../atlasPort/installHost';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dices, Droplets, DoorOpen, Footprints, Search, Sparkles, Swords, CloudFog, Volume2, ListMusic, Play, Upload, RotateCcw, FolderOpen, Download } from 'lucide-react';
import { AssetManagerWindow } from '../atlasPort/app/packages/components/asset-manager/components/AssetManagerWindow';
import { Button } from '../atlasPort/app/packages/components/primitives/button';
import { CloseButton } from '../atlasPort/app/packages/components/primitives/CloseButton';
import { Slider } from '../atlasPort/app/packages/components/primitives/slider';
import { useDialogEscape } from '../atlasPort/app/packages/components/primitives/useDialogEscape';
import { SettingRow } from '../atlasPort/app/react/components/command-palette/SettingRows';
import { t } from '../i18n';
import type { SoundId } from './catalog';
import { SOUND_EXTENSIONS } from './customSounds';
import { findSounds, soundKinds, type SoundFilesKind } from './soundFiles';
import { soundGroupText } from './soundGroupText';
import { SOUND_INFO } from './soundInfo';
import { MAX_SOUND_LEVEL, soundLevel, type SoundGroup } from './soundSettings';

/** What the window reads and asks of the plugin. */
export interface SoundFilesHost {
  levels(): Readonly<Record<string, number>>;
  setLevel(id: SoundId, level: number): void;
  muted(): boolean;
  isCustom(id: SoundId): boolean;
  /** Whether the custom files of the sound all failed to decode, so the built-in sound plays. */
  isFailed(id: SoundId): boolean;
  /** Tells `listener` when the custom files or the sound settings change; returns the way to stop. */
  onChange(listener: () => void): () => void;
  /** Plays the sound once in this window's document, even if its kind is switched off. */
  preview(id: SoundId, win: Window): void;
  replace(id: SoundId, file: File): Promise<void>;
  reset(id: SoundId): Promise<void>;
  /** The folder setting as typed (empty for the default), the folder in use, and a change of the setting. */
  folderSetting(): string;
  folder(): string;
  defaultFolder(): string;
  setFolder(value: string): void;
  exportBuiltIn(): Promise<void>;
  /** Gives the sound engine of `win` back once the window has closed. */
  release(win: Window): void;
}

const KIND_ICON: Record<SoundGroup, React.ComponentType<{ className?: string }>> = { dice: Dices, minis: Footprints, spells: Sparkles, conditions: Swords, turns: Volume2, fog: CloudFog, doors: DoorOpen, water: Droplets };

const kindName = (kind: SoundGroup): string => (kind === 'dice' ? t('soundFiles.dice') : soundGroupText(kind).name);

/** One sound's row: its name and when it plays, a custom mark, play, Replace…, Reset (while custom) and its level. */
function SoundFileRow({ id, host, win }: { id: SoundId; host: SoundFilesHost; win: Window }): React.ReactElement {
  const info = SOUND_INFO[id];
  const stored = Math.round(soundLevel({ levels: host.levels() }, id) * 100);
  // The level the thumb shows while it is dragged; written when let go, so a drag is one change, not dozens.
  const [dragged, setDragged] = React.useState<number | null>(null);
  const percent = dragged ?? stored;
  const custom = host.isCustom(id);
  const failed = custom && host.isFailed(id);
  const pick = (): void => {
    const input = win.document.createElement('input');
    input.type = 'file';
    input.accept = `${SOUND_EXTENSIONS.map((ext) => `.${ext}`).join(',')},audio/*`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void host.replace(id, file);
    });
    input.click();
  };
  return (
    <div className="atlas-tabletop-sound-file" data-sound={id}>
      <SettingRow label={info.name} hint={info.when}>
        {custom && <span className={`atlas-tabletop-sound-file-mark${failed ? ' is-failed' : ''}`} title={failed ? t('soundFiles.failed') : undefined}>{failed ? t('soundFiles.failed') : t('soundFiles.custom')}</span>}
        <Button variant="ghost" size="icon" className="atlas-am-icon-btn" aria-label={t('soundFiles.play')} title={t('soundFiles.play')} onClick={() => host.preview(id, win)}><Play /></Button>
        <Button variant="default" size="sm" title={t('soundFiles.replaceHint', { types: SOUND_EXTENSIONS.join(', ') })} onClick={pick}><Upload />{t('soundFiles.replace')}</Button>
        {custom && <Button variant="ghost" size="sm" title={t('soundFiles.resetHint')} onClick={() => { void host.reset(id); }}><RotateCcw />{t('soundFiles.reset')}</Button>}
        <Slider
          className="atlas-tabletop-sound-file-level"
          value={[percent]}
          min={0}
          max={MAX_SOUND_LEVEL * 100}
          step={5}
          aria-label={t('soundFiles.level', { name: info.name })}
          getValueText={(value) => `${value}%`}
          onValueChange={([value]) => setDragged(value ?? stored)}
          onValueCommit={([value]) => { setDragged(null); if (value !== undefined && value !== stored) host.setLevel(id, value / 100); }}
        />
        <span className="atlas-tabletop-sound-file-percent">{percent}%</span>
      </SettingRow>
    </div>
  );
}

/** The custom sounds folder, taken when the field is left (or Enter): each keystroke would look the folder up afresh. */
function FolderField({ host }: { host: SoundFilesHost }): React.ReactElement {
  const [value, setValue] = React.useState(host.folderSetting());
  const take = (): void => { if (value.trim() !== host.folderSetting()) host.setFolder(value); };
  return (
    <input
      className="atlas-tabletop-sound-files-folder"
      type="text"
      spellCheck={false}
      placeholder={host.defaultFolder()}
      value={value}
      aria-label={t('soundFiles.folder')}
      onChange={(event) => setValue(event.target.value)}
      onBlur={take}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); take(); } }}
    />
  );
}

function SoundFiles({ host, win, onClose }: { host: SoundFilesHost; win: Window; onClose: () => void }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => host.onChange(redraw), [host]);
  useDialogEscape(ref, onClose);
  const [kind, setKind] = React.useState<SoundFilesKind>('all');
  const [query, setQuery] = React.useState('');
  const kinds = React.useMemo(() => soundKinds(), []);
  const sounds = findSounds(kind, query);
  const total = kinds.reduce((sum, { count }) => sum + count, 0);
  const kindButton = (id: SoundFilesKind, label: string, count: number, Icon: React.ComponentType<{ className?: string }>): React.ReactElement => (
    <button key={id} type="button" className={`atlas-tag-button ${kind === id ? 'atlas-active' : ''}`} aria-pressed={kind === id} onClick={() => setKind(id)}>
      <Icon className="atlas-tag-icon" />
      <span className="atlas-tag-text">{label}</span>
      <span className="atlas-tag-count">{count}</span>
    </button>
  );
  return (
    <div className="atlas-asset-manager-container atlas-tabletop-sound-files" ref={ref}>
      <aside className="atlas-asset-manager-sidebar">
        <div className="atlas-asset-manager-sidebar-content">
          <div className="atlas-tags">
            <div className="atlas-tags-header"><div className="atlas-tags-heading"><div className="atlas-section-title">{t('soundFiles.kinds')}</div></div></div>
            <div className="atlas-tags-list">
              {kindButton('all', t('soundFiles.all'), total, ListMusic)}
              {kinds.map(({ kind: id, count }) => kindButton(id, kindName(id), count, KIND_ICON[id]))}
            </div>
          </div>
          <div className="atlas-sidebar-spacer" />
          <div className="atlas-tabletop-sound-files-folder-box">
            <div className="atlas-section-title"><FolderOpen />{t('soundFiles.folder')}</div>
            <FolderField host={host} />
            <span className="atlas-setting-hint">{t('soundFiles.folderHint')}</span>
          </div>
        </div>
        <Button variant="ghost" className="atlas-asset-manager-manage-btn" title={t('soundFiles.exportHint', { folder: host.folder() })} onClick={() => { void host.exportBuiltIn(); }}>
          <Download />
          <span>{t('soundFiles.export')}</span>
        </Button>
      </aside>
      <header className="atlas-asset-manager-header">
        <div className="atlas-am-toolbar">
          <div className="atlas-am-toolbar-left"><span className="atlas-tabletop-sound-files-title">{kind === 'all' ? t('soundFiles.title') : kindName(kind)}</span></div>
          <div className="atlas-am-toolbar-right">
            <div className="atlas-tabletop-sound-files-search">
              <Search />
              <input type="search" spellCheck={false} placeholder={t('soundFiles.search')} aria-label={t('soundFiles.search')} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <CloseButton onClick={onClose} />
          </div>
        </div>
      </header>
      <div className="atlas-asset-manager-body">
        <div className="atlas-asset-manager-main atlas-tabletop-sound-files-list">
          {host.muted() && <div className="atlas-tabletop-sound-files-muted">{t('soundFiles.muted')}</div>}
          {sounds.length === 0 ? <div className="atlas-tabletop-sound-files-empty">{t('soundFiles.none')}</div> : sounds.map((id) => <SoundFileRow key={id} id={id} host={host} win={win} />)}
        </div>
      </div>
    </div>
  );
}

export class SoundFilesWindow {
  private readonly root: Root;
  private readonly el: HTMLElement;
  private readonly overlay = React.createRef<HTMLDivElement>();
  private open_ = false;
  private mounted = false;

  constructor(host: HTMLElement, private readonly files: () => SoundFilesHost | null, private readonly onChange?: () => void) {
    this.el = host.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui';
    host.appendChild(this.el);
    this.root = createRoot(this.el);
  }

  private get win(): Window {
    return this.el.ownerDocument.defaultView ?? window;
  }

  available(): boolean {
    return this.files() !== null;
  }

  isOpen(): boolean {
    return this.open_;
  }

  open(): boolean {
    if (this.open_) return true;
    if (!this.files()) return false;
    this.open_ = true;
    this.mounted = true;
    this.render();
    this.onChange?.();
    return true;
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.render();
    this.files()?.release(this.win);
    this.onChange?.();
  }

  dispose(): void {
    this.close();
    this.root.unmount();
    this.el.remove();
  }

  private render(): void {
    const files = this.files();
    if (!this.mounted || !files) return;
    this.root.render(
      <AssetManagerWindow isOpen={this.open_} onClose={() => this.close()} overlayRef={this.overlay}>
        <SoundFiles host={files} win={this.win} onClose={() => this.close()} />
      </AssetManagerWindow>,
    );
  }
}
