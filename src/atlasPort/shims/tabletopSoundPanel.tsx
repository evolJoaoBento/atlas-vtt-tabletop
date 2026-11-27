// Tabletop's Sound Settings page in the copied command palette (added by the patches in scripts/atlasPortList.mjs): the board
// sounds of this device (the volume, the mute and a switch for each kind of sound), drawn as Atlas's settings pages are,
// and written as the plugin's own settings tab writes them. Atlas's music and ambience are Atlas's Sound page's.
import React from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '../app/packages/components/primitives/button';
import { SettingRow, SettingSliderRow, SettingToggleRow } from '../app/react/components/command-palette/SettingRows';
import { onPaletteChange, paletteHost } from '../../palette/paletteHost';
import { t } from '../../i18n';
import { soundGroupText, SWITCHED_SOUND_GROUPS } from '../../sound/soundGroupText';

/** The page's id in the palette. */
export const TABLETOP_SOUND_PANEL = 'tabletop-sound-settings';
/** Getters: the title is read when the page opens, in the language the plugin has set by then. */
export const tabletopSoundMeta = (): { title: string; icon: React.ReactNode } => ({ get title() { return t('soundSettings.title'); }, icon: <Volume2 /> });

export function TabletopSoundPanel(): React.ReactElement {
  // The settings live in the plugin; a change (here, in the plugin's tab, on another board) asks the page to read them again.
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => onPaletteChange(redraw), []);
  const host = paletteHost()?.boardSound?.();
  if (!host) return <div className="atlas-command-palette-panel" />;
  const sound = host.settings();
  const volume = Math.round(sound.volume * 100);
  return (
    <div className="atlas-command-palette-panel" data-tabletop-sound-settings="">
      <div className="atlas-command-palette-panel-column">
        <h3 className="atlas-command-palette-panel-heading">{t('soundSettings.boardHeading')}</h3>
        <SettingSliderRow
          label={t('soundSettings.volume')}
          hint={t('soundSettings.volumeHint')}
          value={sound.volume}
          min={0}
          max={1}
          step={0.05}
          disabled={sound.muted}
          displayValue={`${volume}%`}
          onChange={(value) => host.set({ volume: Math.round(value * 20) / 20 })}
        />
        <SettingToggleRow label={t('soundSettings.mute')} hint={t('soundSettings.muteHint')} value={sound.muted} onToggle={() => host.set({ muted: !sound.muted })} />
        {host.openPluginSettings && (
          <SettingRow label={t('soundSettings.each')} hint={t('soundSettings.eachHint')}>
            <Button variant="default" size="sm" onClick={() => host.openPluginSettings?.()}>{t('soundSettings.open')}</Button>
          </SettingRow>
        )}
      </div>
      <div className="atlas-command-palette-panel-column">
        <h3 className="atlas-command-palette-panel-heading">{t('soundSettings.kindsHeading')}</h3>
        {SWITCHED_SOUND_GROUPS.map((group) => {
          const text = soundGroupText(group);
          return <SettingToggleRow key={group} label={text.name} hint={text.hint} value={sound.groups[group]} onToggle={() => host.set({ groups: { [group]: !sound.groups[group] } })} />;
        })}
        <SettingRow label={t('soundSettings.diceLabel')} hint={t('soundSettings.dice')}>{null}</SettingRow>
      </div>
    </div>
  );
}
