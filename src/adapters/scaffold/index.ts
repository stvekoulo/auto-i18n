/**
 * Scaffold de l'infrastructure i18n : crée les fichiers manquants.
 *
 * Deux chemins selon `project.framework` :
 * - `next-intl` (Next.js App Router) : routing, request config, middleware,
 *   plugin next.config, switcher.
 * - `react-i18next` (React/Vite hors Next.js) : config i18n (catalogues déjà
 *   traduits par `sync`), import ajouté au point d'entrée, switcher.
 *
 * Discipline commune : on ne crée que ce qui est absent. Les seules mutations
 * tolérées sont l'enrobage du `next.config` par `withNextIntl` et l'ajout d'un
 * `import './i18n'` au point d'entrée React — toujours avec backup, et on
 * bascule en `manual` si la structure n'est pas reconnue plutôt que de risquer
 * une casse. La restructuration `app/[locale]` n'est jamais automatique → guide.
 */

import { join, relative } from 'path';
import { Project, SyntaxKind } from 'ts-morph';
import { fileExists, writeText, ensureDir, backupFile, readText } from '../fs/index.js';
import { findNextConfig, type ProjectInfo } from '../project/index.js';
import {
  routingTemplate,
  requestTemplate,
  middlewareTemplate,
  switcherTemplate,
  reactI18nConfigTemplate,
  reactI18nSwitcherTemplate,
  reactEntryImportLine,
} from './templates.js';

export type ScaffoldStatus = 'created' | 'already_present' | 'manual';

export type ScaffoldTargetName =
  | 'routing'
  | 'request'
  | 'middleware'
  | 'config'
  | 'switcher'
  | 'react-i18n-config'
  | 'react-entry';

export interface ScaffoldTargetResult {
  target: ScaffoldTargetName;
  status: ScaffoldStatus;
  path?: string;
  note?: string;
}

export interface ScaffoldOptions {
  locales: string[];
  defaultLocale: string;
}

function baseDirOf(project: ProjectInfo): string {
  return project.useSrc ? join(project.root, 'src') : project.root;
}

async function existsInAny(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (await fileExists(p)) return p;
  }
  return null;
}

async function scaffoldRouting(
  project: ProjectInfo,
  opts: ScaffoldOptions,
): Promise<ScaffoldTargetResult> {
  const baseDir = baseDirOf(project);
  const filePath = join(baseDir, 'i18n', 'routing.ts');
  const existing = await existsInAny([filePath, join(project.root, 'i18n', 'routing.ts')]);
  if (existing) return { target: 'routing', status: 'already_present', path: existing };

  await ensureDir(join(baseDir, 'i18n'));
  await writeText(
    filePath,
    routingTemplate({ locales: opts.locales, defaultLocale: opts.defaultLocale }),
  );
  return { target: 'routing', status: 'created', path: filePath };
}

async function scaffoldRequest(project: ProjectInfo): Promise<ScaffoldTargetResult> {
  const baseDir = baseDirOf(project);
  const filePath = join(baseDir, 'i18n', 'request.ts');
  const existing = await existsInAny([filePath, join(project.root, 'i18n', 'request.ts')]);
  if (existing) return { target: 'request', status: 'already_present', path: existing };

  await ensureDir(join(baseDir, 'i18n'));
  await writeText(filePath, requestTemplate(project.useSrc));
  return { target: 'request', status: 'created', path: filePath };
}

async function scaffoldMiddleware(project: ProjectInfo): Promise<ScaffoldTargetResult> {
  const baseDir = baseDirOf(project);
  const useProxy = project.nextMajor !== null && project.nextMajor >= 16;
  const fileName = useProxy ? 'proxy.ts' : 'middleware.ts';

  const existing = await existsInAny([
    join(baseDir, 'middleware.ts'),
    join(baseDir, 'proxy.ts'),
    join(project.root, 'middleware.ts'),
    join(project.root, 'proxy.ts'),
  ]);
  if (existing) return { target: 'middleware', status: 'already_present', path: existing };

  const filePath = join(baseDir, fileName);
  await writeText(filePath, middlewareTemplate());
  return { target: 'middleware', status: 'created', path: filePath };
}

async function scaffoldSwitcher(project: ProjectInfo): Promise<ScaffoldTargetResult> {
  const baseDir = baseDirOf(project);
  const componentsDir = join(baseDir, 'components');
  const filePath = join(componentsDir, 'LanguageSwitcher.tsx');
  const existing = await existsInAny([filePath, join(componentsDir, 'LanguageSwitcher.jsx')]);
  if (existing) return { target: 'switcher', status: 'already_present', path: existing };

  await ensureDir(componentsDir);
  await writeText(filePath, switcherTemplate('../i18n/routing'));
  return { target: 'switcher', status: 'created', path: filePath };
}

async function scaffoldConfig(project: ProjectInfo): Promise<ScaffoldTargetResult> {
  const configPath = await findNextConfig(project.root);
  if (!configPath) {
    return {
      target: 'config',
      status: 'manual',
      note: 'next.config introuvable — ajoutez createNextIntlPlugin manuellement.',
    };
  }

  const content = await readText(configPath);
  if (content.includes('withNextIntl') || content.includes('createNextIntlPlugin')) {
    return { target: 'config', status: 'already_present', path: configPath };
  }

  const proj = new Project({
    compilerOptions: { allowJs: true, skipLibCheck: true },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sf = proj.addSourceFileAtPath(configPath);
  const defaultExport = sf
    .getDescendantsOfKind(SyntaxKind.ExportAssignment)
    .find(e => !e.isExportEquals());

  if (!defaultExport) {
    return {
      target: 'config',
      status: 'manual',
      path: configPath,
      note: 'export default non reconnu — enrobez votre config avec withNextIntl() manuellement.',
    };
  }

  const expr = defaultExport.getExpression();
  expr.replaceWithText(`withNextIntl(${expr.getText()})`);
  sf.addImportDeclaration({
    moduleSpecifier: 'next-intl/plugin',
    defaultImport: 'createNextIntlPlugin',
  });
  sf.insertStatements(
    sf.getImportDeclarations().length,
    'const withNextIntl = createNextIntlPlugin();',
  );

  await backupFile(configPath);
  await sf.save();
  return { target: 'config', status: 'created', path: configPath };
}

// ── react-i18next (projets React/Vite hors Next.js) ─────────────────────────

async function scaffoldReactI18nConfig(
  project: ProjectInfo,
  opts: ScaffoldOptions,
): Promise<ScaffoldTargetResult> {
  const srcDir = join(project.root, 'src');
  const filePath = join(srcDir, 'i18n.ts');
  if (await fileExists(filePath)) {
    return { target: 'react-i18n-config', status: 'already_present', path: filePath };
  }

  await ensureDir(srcDir);
  const messagesDir = join(project.root, 'messages');
  const messagesRelativePath = relative(srcDir, messagesDir).replace(/\\/g, '/');
  await writeText(
    filePath,
    reactI18nConfigTemplate({
      locales: opts.locales,
      defaultLocale: opts.defaultLocale,
      messagesRelativePath: messagesRelativePath.startsWith('.')
        ? messagesRelativePath
        : `./${messagesRelativePath}`,
    }),
  );
  return { target: 'react-i18n-config', status: 'created', path: filePath };
}

async function scaffoldReactEntry(project: ProjectInfo): Promise<ScaffoldTargetResult> {
  if (!project.reactEntryFile) {
    return {
      target: 'react-entry',
      status: 'manual',
      note: "Point d'entrée introuvable (src/main.tsx ou src/index.tsx) — ajoutez \"import './i18n';\" en première ligne, avant le rendu de votre app.",
    };
  }

  const content = await readText(project.reactEntryFile);
  if (content.includes("'./i18n'") || content.includes('"./i18n"')) {
    return { target: 'react-entry', status: 'already_present', path: project.reactEntryFile };
  }

  await backupFile(project.reactEntryFile);
  await writeText(project.reactEntryFile, reactEntryImportLine() + content);
  return { target: 'react-entry', status: 'created', path: project.reactEntryFile };
}

async function scaffoldReactSwitcher(
  project: ProjectInfo,
  opts: ScaffoldOptions,
): Promise<ScaffoldTargetResult> {
  const componentsDir = join(project.root, 'src', 'components');
  const filePath = join(componentsDir, 'LanguageSwitcher.tsx');
  const existing = await existsInAny([filePath, join(componentsDir, 'LanguageSwitcher.jsx')]);
  if (existing) return { target: 'switcher', status: 'already_present', path: existing };

  await ensureDir(componentsDir);
  await writeText(filePath, reactI18nSwitcherTemplate(opts.locales));
  return { target: 'switcher', status: 'created', path: filePath };
}

/** Crée l'infrastructure i18n manquante pour le framework détecté. N'écrase jamais l'existant. */
export async function scaffoldProject(
  project: ProjectInfo,
  options: ScaffoldOptions,
): Promise<ScaffoldTargetResult[]> {
  if (project.framework === 'react-i18next') {
    return [
      await scaffoldReactI18nConfig(project, options),
      await scaffoldReactEntry(project),
      await scaffoldReactSwitcher(project, options),
    ];
  }

  return [
    await scaffoldRouting(project, options),
    await scaffoldRequest(project),
    await scaffoldMiddleware(project),
    await scaffoldConfig(project),
    await scaffoldSwitcher(project),
  ];
}
