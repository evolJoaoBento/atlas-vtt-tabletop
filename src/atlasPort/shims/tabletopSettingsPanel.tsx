// Tabletop's own settings page in the copied command palette (added by the patches in scripts/atlasPortList.mjs): what the
// board's old Board settings panel held, drawn as Atlas's settings pages are drawn (their rows, switches and segmented
// choices, in one column pair under the page header), and written the way the panel wrote it. The left column is what the
// board shows (the Visibility bar's settings and the Look), the right one the board itself (walls, snapping) and dice.
import React from 'react';
import { Settings } from 'lucide-react';
import { SegmentedControl } from '../app/packages/components/primitives/SegmentedControl';
import { SettingChoiceRow, SettingRow, SettingSliderRow, SettingToggleRow } from '../app/react/components/command-palette/SettingRows';
import { paletteHost, onPaletteChange } from '../../palette/paletteHost';
import { readFogHeight, readWallThickness } from '../../board/toolbar';
import { t } from '../../i18n';
import { DEFAULT_DOF_STRENGTH, MAX_DOF_STRENGTH, MIN_DOF_STRENGTH, readDofStrength, DEFAULT_EDGES, DEFAULT_LAYER_LOOK, DEFAULT_SEE_THROUGH_SIZE, MAX_SEE_THROUGH_SIZE, MIN_SEE_THROUGH_SIZE, readSeeThroughSize, type LayerLook, type WallEdges } from '../../board/quality';

/** The page's id in the palette, its title and icon (the header's). */
export const TABLETOP_SETTINGS_PANEL = 'tabletop-settings';
/** Getters: the title is read when the page opens, in the language the plugin has set by then. */
export const tabletopSettingsMeta = (): { title: string; icon: React.ReactNode } => ({ get title() { return t('tabletopSettings.title'); }, icon: <Settings /> });

/** A number field as Atlas's rows draw one (`SceneUnitDistanceRow`): written when it is left or Enter is pressed; text that is no value puts the kept one back. */
function NumberRow({ label, hint, aria, value, read, onCommit, disabled = false }: { label: string; hint: string; aria: string; value: number; read: (text: string) => number | null; onCommit: (value: number) => void; disabled?: boolean }): React.ReactElement {
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
        value={draft ?? String(Math.round(value * 1000) / 1000)}
        aria-label={aria}
        disabled={disabled}
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

const LAYER_LOOKS = (): ReadonlyArray<{ value: LayerLook; label: string }> => [
  { value: 'solid', label: t('tabletopSettings.layersSolid') },
  { value: 'faded', label: t('tabletopSettings.layersFaded') },
  { value: 'transparent', label: t('tabletopSettings.layersHidden') },
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
  const edges = settings.wallEdges?.() ?? DEFAULT_EDGES;
  const seeThrough = settings.seeThrough?.() === true;
  const windowSize = readSeeThroughSize(settings.seeThroughSize?.() ?? DEFAULT_SEE_THROUGH_SIZE);
  const layerLook = settings.layerLook?.() ?? DEFAULT_LAYER_LOOK;
  // Walls reaching the level above: the default height is worked out, shown but not typed.
  const reach = settings.wallsReachNext?.() === true;
  const dof = settings.depthOfField?.() === true;
  const dofStrength = readDofStrength(settings.dofStrength?.() ?? DEFAULT_DOF_STRENGTH);
  return (
    <div className="atlas-command-palette-panel" data-tabletop-settings="">
      <div className="atlas-command-palette-panel-column">
        <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.visibilityHeading')}</h3>
        {settings.setSeeThrough && (
          <SettingToggleRow label={t('tabletopSettings.seeThrough')} hint={t('tabletopSettings.seeThroughHint')} value={seeThrough} onToggle={() => write(() => settings.setSeeThrough?.(!seeThrough))} />
        )}
        {settings.setSeeThroughSize && (
          <SettingSliderRow
            label={t('tabletopSettings.windowSize')}
            hint={t('tabletopSettings.windowSizeHint')}
            value={windowSize}
            min={MIN_SEE_THROUGH_SIZE}
            max={MAX_SEE_THROUGH_SIZE}
            step={0.1}
            disabled={!seeThrough}
            displayValue={t('tabletopSettings.squares', { n: windowSize.toFixed(1) })}
            onChange={(value) => write(() => settings.setSeeThroughSize?.(readSeeThroughSize(Math.round(value * 10) / 10)))}
          />
        )}
        {settings.setLayerLook && (
          <SettingChoiceRow label={t('tabletopSettings.layers')} hint={t('tabletopSettings.layersHint')}>
            <SegmentedControl
              ariaLabel={t('tabletopSettings.layersAria')}
              value={layerLook}
              options={LAYER_LOOKS()}
              onChange={(value: LayerLook) => write(() => settings.setLayerLook?.(value))}
            />
          </SettingChoiceRow>
        )}
        <SettingToggleRow label={t('tabletopSettings.initiative')} hint={t('tabletopSettings.initiativeHint')} value={settings.initiativeOpen()} onToggle={() => write(() => settings.toggleInitiative())} />
        <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.lookHeading')}</h3>
        {settings.setGrade && settings.setHalo && (
          <>
            <SettingToggleRow label={t('tabletopSettings.grade')} hint={t('tabletopSettings.gradeHint')} value={settings.grade?.() === true} onToggle={() => write(() => settings.setGrade?.(settings.grade?.() !== true))} />
            <SettingToggleRow label={t('tabletopSettings.halo')} hint={t('tabletopSettings.haloHint')} value={settings.halo?.() === true} onToggle={() => write(() => settings.setHalo?.(settings.halo?.() !== true))} />
          </>
        )}
        {settings.setDepthOfField && (
          <SettingToggleRow label={t('tabletopSettings.depthOfField')} hint={t('tabletopSettings.depthOfFieldHint')} value={dof} onToggle={() => write(() => settings.setDepthOfField?.(!dof))} />
        )}
        {settings.setDofStrength && (
          <div className="atlas-tabletop-sub-setting">
            <SettingSliderRow
              label={t('tabletopSettings.dofStrength')}
              hint={t('tabletopSettings.dofStrengthHint')}
              value={dofStrength}
              min={MIN_DOF_STRENGTH}
              max={MAX_DOF_STRENGTH}
              step={0.05}
              disabled={!dof}
              displayValue={`${Math.round(dofStrength * 100)}%`}
              onChange={(value) => write(() => settings.setDofStrength?.(readDofStrength(Math.round(value * 20) / 20)))}
            />
          </div>
        )}
        {settings.setDofCenter && (
          <div className="atlas-tabletop-sub-setting">
            <SettingToggleRow label={t('tabletopSettings.dofCenter')} hint={t('tabletopSettings.dofCenterHint')} value={settings.dofCenter?.() === true} disabled={!dof} onToggle={() => write(() => settings.setDofCenter?.(settings.dofCenter?.() !== true))} />
          </div>
        )}
        <SettingToggleRow label={t('lighting.tilt')} hint={t('lighting.tiltHint')} value={settings.tiltShift()} onToggle={() => write(() => settings.setTiltShift(!settings.tiltShift()))} />
        <SettingToggleRow label={t('lighting.occlusion')} hint={t('lighting.occlusionHint')} value={settings.occlusion()} onToggle={() => write(() => settings.setOcclusion(!settings.occlusion()))} />
      </div>

      <div className="atlas-command-palette-panel-column">
        <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.walls')}</h3>
        <NumberRow
          label={t('tabletopSettings.wallHeight')}
          hint={t('tabletopSettings.wallHeightHint')}
          aria={t('tabletopSettings.wallHeightAria')}
          value={settings.fogHeight()}
          read={readFogHeight}
          onCommit={(value) => write(() => settings.setFogHeight(value))}
          disabled={reach}
        />
        {settings.setWallsReachNext && (
          // A setting of the default wall height's: drawn under it, set in.
          <div className="atlas-tabletop-sub-setting">
            <SettingToggleRow label={t('tabletopSettings.wallsReachNext')} hint={t('tabletopSettings.wallsReachNextHint')} value={reach} onToggle={() => write(() => settings.setWallsReachNext?.(!reach))} />
          </div>
        )}
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
        {settings.setSnap && (
          <>
            <h3 className="atlas-command-palette-panel-heading">{t('tabletopSettings.snapHeading')}</h3>
            <SettingToggleRow label={t('tabletopSettings.snapTokens')} hint={t('tabletopSettings.snapTokensHint')} value={snap.tokens} onToggle={() => write(() => settings.setSnap?.('tokens', !snap.tokens))} />
            <SettingToggleRow label={t('tabletopSettings.snapProps')} hint={t('tabletopSettings.snapPropsHint')} value={snap.props} onToggle={() => write(() => settings.setSnap?.('props', !snap.props))} />
          </>
        )}
        <h3 className="atlas-command-palette-panel-heading">{t('dice.heading')}</h3>
        <SettingToggleRow label={t('dice.autoRoll')} hint={t('dice.autoRollHint')} value={settings.autoRoll()} onToggle={() => write(() => settings.setAutoRoll(!settings.autoRoll()))} />
      </div>
    </div>
  );
}
