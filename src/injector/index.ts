import { injectLayout } from './layout-injector.js';
import { injectNextConfig } from './config-injector.js';
import { injectMiddleware } from './middleware-injector.js';
import { injectRouting } from './routing-injector.js';
import { injectLanguageSwitcher } from './switcher-injector.js';

export { injectLayout } from './layout-injector.js';
export { injectNextConfig } from './config-injector.js';
export { injectMiddleware } from './middleware-injector.js';
export { injectRouting } from './routing-injector.js';
export { injectLanguageSwitcher } from './switcher-injector.js';

export type { LayoutInjectorResult } from './layout-injector.js';
export type { ConfigInjectorResult } from './config-injector.js';
export type { MiddlewareInjectorResult } from './middleware-injector.js';
export type { RoutingInjectorResult, RoutingConfig } from './routing-injector.js';
export type { SwitcherInjectorResult } from './switcher-injector.js';

export interface InjectOptions {
  /** Racine du projet Next.js cible. */
  projectRoot: string;
  /** Liste des locales (ex: ['fr', 'en', 'es']). */
  locales: string[];
  /** Locale source par défaut (ex: 'fr'). */
  defaultLocale: string;
  /** Supprime les logs terminal. */
  silent?: boolean;
}

export interface InjectAllResult {
  layout: { ok: boolean; skipped: boolean; error?: string };
  config: { ok: boolean; skipped: boolean; error?: string };
  middleware: { ok: boolean; skipped: boolean; warning?: string; error?: string };
  routing: { ok: boolean; skipped: boolean; error?: string };
  switcher: { ok: boolean; skipped: boolean; error?: string };
}

export async function injectAll(options: InjectOptions): Promise<InjectAllResult> {
  const { projectRoot, locales, defaultLocale, silent = false } = options;
  const result: InjectAllResult = {
    layout: { ok: false, skipped: false },
    config: { ok: false, skipped: false },
    middleware: { ok: false, skipped: false },
    routing: { ok: false, skipped: false },
    switcher: { ok: false, skipped: false },
  };

  // 1. Layout
  try {
    const r = await injectLayout(projectRoot, { silent });
    result.layout = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ layout.tsx — ${error}`);
    result.layout = { ok: false, skipped: false, error };
  }

  // 2. Next config
  try {
    const r = await injectNextConfig(projectRoot, { silent });
    result.config = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ next.config — ${error}`);
    result.config = { ok: false, skipped: false, error };
  }

  // 3. Middleware
  try {
    const r = await injectMiddleware(projectRoot, { silent });
    result.middleware = { ok: true, skipped: r.skipped, warning: r.warning };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ middleware.ts — ${error}`);
    result.middleware = { ok: false, skipped: false, error };
  }

  // 4. Routing
  try {
    const r = await injectRouting(projectRoot, { locales, defaultLocale }, { silent });
    result.routing = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ i18n/routing.ts — ${error}`);
    result.routing = { ok: false, skipped: false, error };
  }

  // 5. Language Switcher
  try {
    const r = await injectLanguageSwitcher(projectRoot, { silent });
    result.switcher = { ok: true, skipped: r.skipped };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (!silent) console.error(`  ✗ LanguageSwitcher — ${error}`);
    result.switcher = { ok: false, skipped: false, error };
  }

  return result;
}
