/**
 * Point d'entrée des templates de scaffold (`next-intl`, `react-i18next`, `expo`).
 */

export {
  routingTemplate,
  requestTemplate,
  middlewareTemplate,
  switcherTemplate,
  type RoutingConfig,
} from './templates/next-intl.js';

export {
  reactI18nConfigTemplate,
  reactI18nSwitcherTemplate,
  reactEntryImportLine,
  type ReactI18nConfig,
} from './templates/react-i18next.js';

export {
  expoI18nConfigTemplate,
  expoSwitcherTemplate,
  type ExpoI18nConfig,
} from './templates/expo.js';
