// Atlas source: src/app/react/components/command-palette/docsCommand.tsx @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import { BookOpen } from 'lucide-react';
import { t } from '../../../../shims/i18n';
import type { CommandOption } from './types';

/** The palette's way to the documentation: it opens the docs panel in this view and closes the palette. */
export function docsCommand(open: () => void, close: () => void): CommandOption {
  return {
    id: 'open-docs',
    icon: <BookOpen />,
    label: t('docs.title'),
    keywords: ['docs', 'documentation', 'help', 'guide', 'manual', 'tutorial', 'how to'],
    section: 'tools',
    action: () => {
      open();
      close();
    },
  };
}
