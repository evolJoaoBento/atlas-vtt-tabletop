// Tabletop's own settings page in the copied command palette (added by the patches in scripts/atlasPortList.mjs): what the
// board's old Board settings panel held, drawn as Atlas's settings pages are drawn (their rows, switches and segmented
// choices, in one column pair under the page header), and written the way the panel wrote it.
import React from 'react';
import { Settings } from 'lucide-react';
import { Button } from '../app/packages/components/primitives/button';
import { SegmentedControl } from '../app/packages/components/primitives/SegmentedControl';
import { SettingChoiceRow, SettingRow, SettingToggleRow } from '../app/react/components/command-palette/SettingRows';
import { paletteHost, onPaletteChange } from '../../palette/paletteHost';
import { readFogHeight, readWallThickness } from '../../board/toolbar';
import { t } from '../../i18n';
import { DEFAULT_EDGES, type WallEdges } from '../../board/quality';

/** The page's id in the palette, its title and icon (the header's). */
export const TABLETOP_SETTINGS_PANEL = 'tabletop-settings';
/** Getters: the title is read when the page opens, in the language the plugin has set by then. */
export const tabletopSettingsMeta = (): { title: string; icon: React.ReactNode } => ({ get title() { return t('tabletopSettings.title'); }, icon: <Settings /> });

/** A number field as Atlas's rows draw one (`SceneUnitDistanceRow`): written when it is left or Enter is pressed; text that is no value puts the kept one back. */
function NumberRow({ label, hint, aria, value, read, onCommit }: { label: string; hint: string; aria: string; value: number; read: (text: string) => number | null; onCommit: (value: number) => void }): React.ReactElement {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [invalid, setInvalid] = React.useState(false);
  const commit = (): void => {
    const text = draft;
    setDraft(null);
    if (text === null) return;
    const next = read(text);
    setInvalid(next === null);
    if (next !== null && next !== value) onCommit(next);
  };
  return (
    <SettingRow label={label} hint={hint}>
      <input
        type="text"
        inputMode="decimal"
        className="atlas-setting-input atlas-setting-input--sm"
        value={draft ?? String(value)}
        aria-label={aria}
        aria-invalid={invalid || undefined}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      />
    </SettingRow>
  );
}

const EDGES = (): ReadonlyArray<{ value: WallEdges; label: string }> => [
  { value: 'sharp', label: t('tabletopSettings.sharp') },
  { value: 'soft', label: t('tabletopSettings.soft') },
  { value: 'round', label: t('tabletopSettings.round') },
];

/** The page: Atlas's page markup (`atlas-command-palette-panel`, two columns), Tabletop's settings in it. */
export function TabletopSettingsPanel({ onClose }: { onClose?: () => void }): React.ReactElement {
  // The settings live in the board; a change asks the page to read them again.
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => onPaletteChange(redraw), []);
  const settings = paletteHost()?.tabletopSettings?.();
  if (!settings) return <div className="atlas-command-palette-panel" />;
  const write = (change: () => void): void => { change(); redraw(); };
  const snap = settings.snap?.() ?? { tokens: true, props: true };
  const sheets = settings.arTableSheets?.() ?? null;
  const edges = settings.wallEdges?.() ?? DEFAULT_EDGES;
  return (
    <div className="atlas-command-palette-panel" data-tabletop-settings="">
      <div className="atlas-command-palette-panel-column">
        <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.walls')}</h3>
        <NumberRow
          label={t('tabletopSettings.wallHeight')}
          hint={t('tabletopSettings.wallHeightHint')}
          aria={t('tabletopSettings.wallHeightAria')}
          value={settings.fogHeight()}
          read={readFogHeight}
          onCommit={(value) => write(() => settings.setFogHeight(value))}
        />
        <NumberRow
          label={t('tabletopSettings.wallThickness')}
          hint={t('tabletopSettings.wallThicknessHint')}
          aria={t('tabletopSettings.wallThicknessAria')}
          value={settings.wallThickness()}
          read={readWallThickness}
          onCommit={(value) => write(() => settings.setWallThickness(value))}
        />
        {settings.setWallEdges && (
          <SettingChoiceRow label={t('tabletopSettings.wallEdges')} hint={t('tabletopSettings.wallEdgesHint')}>
            <SegmentedControl
              ariaLabel={t('tabletopSettings.wallEdgesAria')}
              value={edges}
              options={EDGES()}
              onChange={(value: WallEdges) => write(() => settings.setWallEdges?.(value))}
            />
          </SettingChoiceRow>
        )}
      </div>

      <div className="atlas-command-palette-panel-column">
        {settings.setSnap && (
          <>
            <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.snapHeading')}</h3>
            <SettingToggleRow label={t('tabletopSettings.snapTokens')} hint={t('tabletopSettings.snapTokensHint')} value={snap.tokens} onToggle={() => write(() => settings.setSnap?.('tokens', !snap.tokens))} />
            <SettingToggleRow label={t('tabletopSettings.snapProps')} hint={t('tabletopSettings.snapPropsHint')} value={snap.props} onToggle={() => write(() => settings.setSnap?.('props', !snap.props))} />
          </>
        )}
        {settings.setGrade && settings.setHalo && (
          <>
            <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.lookHeading')}</h3>
            <SettingToggleRow label={t('tabletopSettings.grade')} hint={t('tabletopSettings.gradeHint')} value={settings.grade?.() === true} onToggle={() => write(() => settings.setGrade?.(settings.grade?.() !== true))} />
            <SettingToggleRow label={t('tabletopSettings.halo')} hint={t('tabletopSettings.haloHint')} value={settings.halo?.() === true} onToggle={() => write(() => settings.setHalo?.(settings.halo?.() !== true))} />
          </>
        )}
        <h3 className="atlas-command-palette-panel-heading">{t('dice.heading')}</h3>
        <SettingToggleRow label={t('dice.autoRoll')} hint={t('dice.autoRollHint')} value={settings.autoRoll()} onToggle={() => write(() => settings.setAutoRoll(!settings.autoRoll()))} />
        {settings.placeArTable && (
          <>
            <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.arTable')}</h3>
            <SettingRow
              label={t('tabletopSettings.arTableSheetsLabel')}
              hint={`${sheets === null ? t('tabletopSettings.arTableNone') : sheets === 1 ? t('tabletopSettings.arTableOne') : t('tabletopSettings.arTableMany', { n: sheets })} ${t('tabletopSettings.arTableFineHint')}`}
            >
              <Button variant="secondary" size="sm" disabled={sheets === null} onClick={() => { onClose?.(); settings.placeArTable?.(); }}>
                {t('tabletopSettings.arTableFine')}
              </Button>
            </SettingRow>
          </>
        )}
      </div>
    </div>
  );
}
