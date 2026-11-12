import type { Setting } from 'obsidian';
import type { SoundId } from './catalog';
import { SOUND_EXTENSIONS } from './customSounds';
import { MAX_SOUND_LEVEL, soundLevel } from './soundSettings';

/** What a row of the sounds list asks of the plugin. */
export interface SoundRowHost {
  levels(): Readonly<Record<string, number>>;
  setLevel(id: SoundId, level: number): void;
  isCustom(id: SoundId): boolean;
  /** Whether the custom files of the sound all failed to decode, so the built-in sound plays. */
  isFailed(id: SoundId): boolean;
  /** Hands over the function that redraws this row, to be called when the custom files change outside it. */
  track(id: SoundId, redraw: () => void): void;
  preview(id: SoundId): void;
  replace(id: SoundId, file: File): Promise<void>;
  reset(id: SoundId): Promise<void>;
}

/**
 * The controls of one sound in the settings list: a custom mark when it is the player's own file, a play button, a
 * Replace… button that asks for a file, a Reset button while it is custom, and a volume from 0 to 200 %. Called again
 * when the sound turns custom or back, it draws afresh.
 */
export function drawSoundControls(setting: Setting, id: SoundId, host: SoundRowHost): void {
  setting.controlEl.empty();
  const redraw = (): void => drawSoundControls(setting, id, host);
  host.track(id, redraw);
  if (host.isCustom(id)) setting.controlEl.createSpan({ text: host.isFailed(id) ? 'custom (failed, using built-in)' : 'custom', cls: 'tabletop-sound-custom' });
  setting.addButton((button) => button.setButtonText('▶').setTooltip('Play (even if its group is switched off)').onClick(() => host.preview(id)));
  setting.addButton((button) => button.setButtonText('Replace…').setTooltip(`Use a file of your own (${SOUND_EXTENSIONS.join(', ')})`).onClick(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = SOUND_EXTENSIONS.map((ext) => `.${ext}`).join(',') + ',audio/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void host.replace(id, file).then(redraw);
    });
    input.click();
  }));
  if (host.isCustom(id)) setting.addButton((button) => button.setButtonText('Reset').setTooltip('Go back to the built-in sound').onClick(() => { void host.reset(id).then(redraw); }));
  setting.addSlider((slider) => slider
    .setLimits(0, MAX_SOUND_LEVEL * 100, 5)
    .setValue(Math.round(soundLevel({ levels: host.levels() }, id) * 100))
    .setDynamicTooltip()
    .onChange((percent) => host.setLevel(id, percent / 100)));
}
