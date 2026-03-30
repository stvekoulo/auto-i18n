import { injectNextConfig } from './config-injector.js';
import { injectMiddleware } from './middleware-injector.js';
import { injectRouting } from './routing-injector.js';
import { injectRequest } from './request-injector.js';
import { injectLanguageSwitcher } from './switcher-injector.js';
import { injectLocaleStructure } from './locale-structure-injector.js';

export { injectLayout } from './layout-injector.js';
export { injectNextConfig } from './config-injector.js';
export { injectMiddleware } from './middleware-injector.js';
export { injectRouting } from './routing-injector.js';
export { injectRequest } from './request-injector.js';
export { injectLanguageSwitcher } from './switcher-injector.js';
export { injectLocaleStructure } from './locale-structure-injector.js';

export type { LayoutInjectorResult } from './layout-injector.js';
export type { ConfigInjectorResult } from './config-injector.js';
export type { MiddlewareInjectorResult } from './middleware-injector.js';
export type { RoutingInjectorResult, RoutingConfig } from './routing-injector.js';
export type { RequestInjectorResult } from './request-injector.js';
export type { SwitcherInjectorResult } from './switcher-injector.js';
export type { LocaleStructureResult } from './locale-structure-injector.js';

export interface InjectOptions {
  /** Racine du projet Next.js cible. */
  projectRoot: string;
  locales: string[];
  /** Locale source par défaut (ex: 'fr'). */
  defaultLocale: string;
  /** Supprime les logs terminal. */
  silent?: boolean;
}

export interface InjectAllResult {
  config: { ok: boolean; skipped: boolean; error?: string };
  middleware: { ok: boolean; skipped: boolean; warning?: string; error?: string };
  routing: { ok: boolean; skipped: boolean; error?: string };
  request: { ok: boolean; skipped: boolean; error?: string };
  switcher: { ok: boolean; skipped: boolean; error?: string };
  localeStructure: { ok: boolean; skipped: boolean; error?: string };
}

export async function injectAll(options: InjectOptions): Promise<InjectAllResult> {
  const { projectRoot, locales, defaultLocale, silent = false } = options;
  const result: InjectAllResult = {
    config: { ok: false, skipped: false },
    middleware: { ok: false, skipped: false },
    routing: { ok: false, skipped: false },
    request: { ok: false, skipped: false },
    switcher: { ok: false, skipped: false },
    localeStructure: { ok: false, skipped: false },
  };

  // 1. Next config (createNextIntlPlugin)
  try {
    const r = await injectNextConfig(projectRoot, { silent });
    result.config = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ next.config — ${error}`);
    result.config = { ok: false, skipped: false, error };
  }

  // 2. Middleware
  try {
    const r = await injectMiddleware(projectRoot, { silent });
    result.middleware = { ok: true, skipped: r.skipped, warning: r.warning };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ middleware.ts — ${error}`);
    result.middleware = { ok: false, skipped: false, error };
  }

  // 3. Routing (i18n/routing.ts)
  try {
    const r = await injectRouting(projectRoot, { locales, defaultLocale }, { silent });
    result.routing = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ i18n/routing.ts — ${error}`);
    result.routing = { ok: false, skipped: false, error };
  }

  // 4. Request config (i18n/request.ts)
  try {
    const r = await injectRequest(projectRoot, { silent });
    result.request = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ i18n/request.ts — ${error}`);
    result.request = { ok: false, skipped: false, error };
  }

  // 5. Language Switcher component
  try {
    const r = await injectLanguageSwitcher(projectRoot, { silent });
    result.switcher = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ LanguageSwitcher — ${error}`);
    result.switcher = { ok: false, skipped: false, error };
  }

  // 6. Locale structure (app/[locale]/, root layout, locale layout)
  try {
    const r = await injectLocaleStructure(projectRoot, locales, defaultLocale, { silent });
    result.localeStructure = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ app/[locale]/ — ${error}`);
    result.localeStructure = { ok: false, skipped: false, error };
  }

  return result;
}
