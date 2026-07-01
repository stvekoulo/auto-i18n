/**
 * Rendu terminal du déroulé `init`.
 */

import { relative } from 'path';
import { logger } from '../utils/logger.js';
import type { ScaffoldTargetResult } from '../adapters/scaffold/index.js';

const LABELS: Record<ScaffoldTargetResult['target'], string> = {
  routing: 'i18n/routing.ts',
  request: 'i18n/request.ts',
  middleware: 'middleware',
  config: 'next.config',
  switcher: 'LanguageSwitcher',
  'react-i18n-config': 'src/i18n.ts',
  'react-entry': "point d'entrée (import './i18n')",
};

export function renderScaffold(projectRoot: string, results: ScaffoldTargetResult[]): void {
  for (const r of results) {
    const label = LABELS[r.target];
    switch (r.status) {
      case 'created':
        logger.success(`${label} créé${r.path ? ` (${relative(projectRoot, r.path)})` : ''}`);
        break;
      case 'already_present':
        logger.dim(`${label} — déjà présent`);
        break;
      case 'manual':
        logger.warn(`${label} — action manuelle : ${r.note ?? 'voir guide'}`);
        break;
    }
  }
}
