/**
 * Scaffold de l'infrastructure next-intl : crée les fichiers manquants.
 *
 * Discipline : on ne crée que ce qui est absent. La seule mutation tolérée est
 * l'enrobage du `next.config` par `withNextIntl` (avec backup) ; si la structure
 * n'est pas reconnue, on bascule en `manual` plutôt que de risquer une casse.
 * La restructuration `app/[locale]` n'est jamais automatique → guide.
 */

import { join } from 'path';
import { Project, SyntaxKind } from 'ts-morph';
import {
  fileExists, writeText, ensureDir, backupFile, readText,
} from '../fs/index.js';
import { findNextConfig, type ProjectInfo } from '../project/index.js';
import {
  routingTemplate, requestTemplate, middlewareTemplate, switcherTemplate,
} from './templates.js';

export type ScaffoldStatus = 'created' | 'already_present' | 'manual';

export type ScaffoldTargetName = 'routing' | 'request' | 'middleware' | 'config' | 'switcher';

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

async function scaffoldRouting(project: ProjectInfo, opts: ScaffoldOptions): Promise<ScaffoldTargetResult> {
  const baseDir = baseDirOf(project);
  const filePath = join(baseDir, 'i18n', 'routing.ts');
  const existing = await existsInAny([filePath, join(project.root, 'i18n', 'routing.ts')]);
  if (existing) return { target: 'routing', status: 'already_present', path: existing };

  await ensureDir(join(baseDir, 'i18n'));
  await writeText(filePath, routingTemplate({ locales: opts.locales, defaultLocale: opts.defaultLocale }));
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
    join(baseDir, 'middleware.ts'), join(baseDir, 'proxy.ts'),
    join(project.root, 'middleware.ts'), join(project.root, 'proxy.ts'),
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
    return { target: 'config', status: 'manual', note: 'next.config introuvable — ajoutez createNextIntlPlugin manuellement.' };
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
  const defaultExport = sf.getDescendantsOfKind(SyntaxKind.ExportAssignment).find(e => !e.isExportEquals());

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
  sf.addImportDeclaration({ moduleSpecifier: 'next-intl/plugin', defaultImport: 'createNextIntlPlugin' });
  sf.insertStatements(sf.getImportDeclarations().length, 'const withNextIntl = createNextIntlPlugin();');

  await backupFile(configPath);
  await sf.save();
  return { target: 'config', status: 'created', path: configPath };
}

/** Crée l'infrastructure next-intl manquante. N'écrase jamais l'existant. */
export async function scaffoldProject(
  project: ProjectInfo,
  options: ScaffoldOptions,
): Promise<ScaffoldTargetResult[]> {
  return [
    await scaffoldRouting(project, options),
    await scaffoldRequest(project),
    await scaffoldMiddleware(project),
    await scaffoldConfig(project),
    await scaffoldSwitcher(project),
  ];
}
