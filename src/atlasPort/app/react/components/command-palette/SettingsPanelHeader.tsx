// Atlas source: src/app/react/components/command-palette/SettingsPanelHeader.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import { CloseButton } from '../../../packages/components/primitives/CloseButton';
import { t } from '../../../../shims/i18n';

interface SettingsPanelHeaderProps {
  icon: React.ReactNode;
  title: string;
  onBack: () => void;
  actions?: React.ReactNode;
}

export function SettingsPanelHeader({ icon, title, onBack, actions }: SettingsPanelHeaderProps): React.ReactElement {
  return (
    <div className="atlas-command-palette-panel-header">
      <div className="atlas-command-palette-panel-title">
        <span className="atlas-command-palette-panel-title-icon">{icon}</span>
        <h2 className="atlas-command-palette-panel-heading">{title}</h2>
      </div>
      <div className="atlas-command-palette-panel-actions">
        {actions}
        <CloseButton onClick={onBack} aria-label={t('common.back')} />
      </div>
    </div>
  );
}
