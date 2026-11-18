/**
 * Scaffold de l'infrastructure i18n : crée les fichiers manquants pour
 * `next-intl` (Next.js), `react-i18next` (React/Vite) et `expo` (Expo / React Native).
 *
 * Utilise directement le parseur `typescript` (zéro dépendance `ts-morph`).
 */

import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { fileExists, writeText, ensureDir, backupFile, readText } from '../fs/index.js';
import { findNextConfig, type ProjectInfo } from '../project/index.js';
import { parseSource } from '../../core/extraction/parse.js';
import { applyEdits, type WriteEdit } from '../../core/write/index.js';
import {
  routingTemplate,
  requestTemplate,
  middlewareTemplate,
  switcherTemplate,
  reactI18nConfigTemplate,
  reactI18nSwitcherTemplate,
  reactEntryImportLine,
  expoI18nConfigTemplate,
  expoSwitcherTemplate,
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
  /** Dossier des catalogues configuré (défaut `./messages`). */
  messagesDir?: string;
}

function baseDirOf(project: ProjectInfo): string {
  return project.useSrc ? join(project.root, 'src') : project.root;
}

function toPosixImportPath(fromFile: string, toTarget: string): string {
  const rel = relative(dirname(fromFile), toTarget).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : `./${rel}`;
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

async function scaffoldRequest(
  project: ProjectInfo,
  opts: ScaffoldOptions,
): Promise<ScaffoldTargetResult> {
  const baseDir = baseDirOf(project);
  const filePath = join(baseDir, 'i18n', 'request.ts');
  const existing = await existsInAny([filePath, join(project.root, 'i18n', 'request.ts')]);
  if (existing) return { target: 'request', status: 'already_present', path: existing };

  const absMessagesDir = resolve(project.root, opts.messagesDir ?? './messages');
  const messagesRel = toPosixImportPath(filePath, absMessagesDir);

  await ensureDir(join(baseDir, 'i18n'));
  await writeText(filePath, requestTemplate(messagesRel));
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

  const sf = parseSource(content, configPath);
  const defaultExport = sf.statements.find(
    (s): s is ts.ExportAssignment => ts.isExportAssignment(s) && !s.isExportEquals,
  );

  if (!defaultExport) {
    return {
      target: 'config',
      status: 'manual',
      path: configPath,
      note: 'export default non reconnu — enrobez votre config avec withNextIntl() manuellement.',
    };
  }

  const expr = defaultExport.expression;
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const insertHeaderAt = imports.length > 0 ? imports[imports.length - 1].getEnd() : 0;
  const header =
    (insertHeaderAt > 0 ? '\n' : '') +
    "import createNextIntlPlugin from 'next-intl/plugin';\nconst withNextIntl = createNextIntlPlugin();\n";

  const edits: WriteEdit[] = [
    { start: insertHeaderAt, end: insertHeaderAt, replacement: header },
    {
      start: expr.getStart(sf),
      end: expr.getEnd(),
      replacement: `withNextIntl(${expr.getText(sf)})`,
    },
  ];

  await backupFile(configPath);
  await writeText(configPath, applyEdits(content, edits));
  return { target: 'config', status: 'created', path: configPath };
}

async function scaffoldClientI18nConfig(
  project: ProjectInfo,
  opts: ScaffoldOptions,
): Promise<{ result: ScaffoldTargetResult; i18nFilePath: string }> {
  const targetDir =
    project.framework === 'expo' &&
    !project.useSrc &&
    !(await fileExists(join(project.root, 'src')))
      ? project.root
      : join(project.root, 'src');
  const filePath = join(targetDir, 'i18n.ts');
  if (await fileExists(filePath)) {
    return {
      result: { target: 'react-i18n-config', status: 'already_present', path: filePath },
      i18nFilePath: filePath,
    };
  }

  await ensureDir(targetDir);
  const absMessagesDir = resolve(project.root, opts.messagesDir ?? './messages');
  const messagesRelativePath = toPosixImportPath(filePath, absMessagesDir);

  const template =
    project.framework === 'expo'
      ? expoI18nConfigTemplate({
          locales: opts.locales,
          defaultLocale: opts.defaultLocale,
          messagesRelativePath,
          useExpoLocalization: project.hasExpoLocalization,
        })
      : reactI18nConfigTemplate({
          locales: opts.locales,
          defaultLocale: opts.defaultLocale,
          messagesRelativePath,
        });

  await writeText(filePath, template);
  return {
    result: { target: 'react-i18n-config', status: 'created', path: filePath },
    i18nFilePath: filePath,
  };
}

async function scaffoldClientEntry(
  project: ProjectInfo,
  i18nFilePath: string,
): Promise<ScaffoldTargetResult> {
  const entryFile = project.framework === 'expo' ? project.expoEntryFile : project.reactEntryFile;
  if (!entryFile) {
    return {
      target: 'react-entry',
      status: 'manual',
      note: "Point d'entrée introuvable — importez la configuration i18n en première ligne.",
    };
  }

  const i18nNoExt = i18nFilePath.replace(/\.ts$/, '');
  const relImport = toPosixImportPath(entryFile, i18nNoExt);
  const content = await readText(entryFile);
  if (content.includes(`'${relImport}'`) || content.includes(`"${relImport}"`)) {
    return { target: 'react-entry', status: 'already_present', path: entryFile };
  }

  await backupFile(entryFile);
  await writeText(entryFile, reactEntryImportLine(relImport) + content);
  return { target: 'react-entry', status: 'created', path: entryFile };
}

async function scaffoldClientSwitcher(
  project: ProjectInfo,
  opts: ScaffoldOptions,
): Promise<ScaffoldTargetResult> {
  const base =
    project.framework === 'expo' &&
    !project.useSrc &&
    !(await fileExists(join(project.root, 'src')))
      ? project.root
      : join(project.root, 'src');
  const componentsDir = join(base, 'components');
  const filePath = join(componentsDir, 'LanguageSwitcher.tsx');
  const existing = await existsInAny([filePath, join(componentsDir, 'LanguageSwitcher.jsx')]);
  if (existing) return { target: 'switcher', status: 'already_present', path: existing };

  await ensureDir(componentsDir);
  const code =
    project.framework === 'expo'
      ? expoSwitcherTemplate(opts.locales)
      : reactI18nSwitcherTemplate(opts.locales);
  await writeText(filePath, code);
  return { target: 'switcher', status: 'created', path: filePath };
}

export async function scaffoldProject(
  project: ProjectInfo,
  options: ScaffoldOptions,
): Promise<ScaffoldTargetResult[]> {
  if (project.framework === 'react-i18next' || project.framework === 'expo') {
    const { result: cfgResult, i18nFilePath } = await scaffoldClientI18nConfig(project, options);
    return [
      cfgResult,
      await scaffoldClientEntry(project, i18nFilePath),
      await scaffoldClientSwitcher(project, options),
    ];
  }

  return [
    await scaffoldRouting(project, options),
    await scaffoldRequest(project, options),
    await scaffoldMiddleware(project),
    await scaffoldConfig(project),
    await scaffoldSwitcher(project),
  ];
}
