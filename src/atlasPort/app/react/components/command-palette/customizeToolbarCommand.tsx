// Atlas source: src/app/react/components/command-palette/customizeToolbarCommand.tsx @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import { PanelBottom } from 'lucide-react';
import { t } from '../../../../shims/i18n';
import type { CommandOption } from './types';

/** The palette's way into the toolbar editor: it starts edit mode in this view and closes the palette. */
export function customizeToolbarCommand(start: () => void, close: () => void): CommandOption {
  return {
    id: 'customize-toolbar',
    icon: <PanelBottom />,
    label: t('toolbarEdit.customize'),
    keywords: ['toolbar', 'hide', 'reorder', 'arrange', 'tools', 'edit', 'customise'],
    section: 'settings',
    action: () => {
      start();
      close();
    },
  };
}
