import { writeFile } from 'fs/promises';
import type { ExtractedString } from '../scanner/string-extractor.js';

export interface FileDocEntry {
  filePath: string;
  /** Chemin relatif depuis projectRoot (pour l'affichage). */
  relPath: string;
  strings: ExtractedString[];
  /** Valeurs des strings au module-scope (non réécrivables automatiquement). */
  moduleScopeValues: Set<string>;
}

export interface DocOptions {
  projectRoot: string;
  sourceLocale: string;
  targetLocales: string[];
  /** Chemin relatif du dossier messages (pour l'affichage). */
  messagesDir: string;
  keyMap: Map<string, string>;
  files: FileDocEntry[];
  outputPath: string;
  date: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function trunc(s: string, max = 55): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function typeLabel(type: ExtractedString['type']): string {
  switch (type) {
    case 'jsx-text':                return 'JSX texte';
    case 'jsx-attribute':           return 'Attribut';
    case 'template-literal':        return 'Template';
    case 'template-literal-dynamic':return 'Template dynamique';
    case 'string-literal':          return 'Constante';
  }
}

function replacementCode(s: ExtractedString, key: string): string {
  if (s.type === 'template-literal-dynamic' && s.variables?.length) {
    const params = s.variables.join(', ');
    return `{t("${key}", { ${params} })}`;
  }
  if (s.type === 'string-literal') {
    return `t("${key}")`;
  }
  return `{t("${key}")}`;
}

// ── Markdown builder ───────────────────────────────────────────────────────

export function buildDoc(options: DocOptions): string {
  const { sourceLocale, targetLocales, messagesDir, keyMap, files, date } = options;

  const totalStrings = files.reduce((sum, f) => sum + f.strings.length, 0);
  const totalKeys    = keyMap.size;
  const moduleScopeTotal = files.reduce((sum, f) => sum + f.moduleScopeValues.size, 0);

  const L: string[] = [];

  // ── En-tête ──────────────────────────────────────────────────────────────
  L.push('# Guide d\'intégration i18n — next-auto-i18n');
  L.push('');
  L.push(`> Généré le **${date}**&nbsp;&nbsp;·&nbsp;&nbsp;✅ Aucun fichier source modifié.`);
  L.push('');

  // ── Résumé ───────────────────────────────────────────────────────────────
  L.push('## Résumé');
  L.push('');
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Strings détectées | **${totalStrings}** dans **${files.length}** fichier${files.length > 1 ? 's' : ''} |`);
  L.push(`| Clés i18n générées | **${totalKeys}** → \`${messagesDir}/${sourceLocale}.json\` |`);
  L.push(`| Traductions générées | ${targetLocales.map(l => `\`${messagesDir}/${l}.json\``).join(', ')} |`);
  if (moduleScopeTotal > 0) {
    L.push(`| ⚠️ Action manuelle | **${moduleScopeTotal}** string${moduleScopeTotal > 1 ? 's' : ''} module-scope (voir section dédiée) |`);
  }
  L.push('');

  // ── Fichiers générés ─────────────────────────────────────────────────────
  L.push('## Fichiers générés');
  L.push('');
  L.push('| Fichier | Description |');
  L.push('|---------|-------------|');
  L.push(`| \`${messagesDir}/${sourceLocale}.json\` | Textes source (${sourceLocale}) |`);
  for (const locale of targetLocales) {
    L.push(`| \`${messagesDir}/${locale}.json\` | Traductions (${locale}) |`);
  }
  L.push('');

  // ── Guide d'utilisation ───────────────────────────────────────────────────
  L.push('## Comment utiliser les traductions');
  L.push('');
  L.push('### Composant Client (`\'use client\'`)');
  L.push('');
  L.push('```tsx');
  L.push("'use client';");
  L.push("import { useTranslations } from 'next-intl';");
  L.push('');
  L.push('export function MonComposant() {');
  L.push('  const t = useTranslations();');
  L.push('  return <p>{t("ma_cle")}</p>;');
  L.push('}');
  L.push('```');
  L.push('');
  L.push('### Composant Serveur (async)');
  L.push('');
  L.push('```tsx');
  L.push("import { getTranslations } from 'next-intl/server';");
  L.push('');
  L.push('export default async function Page() {');
  L.push('  const t = await getTranslations();');
  L.push('  return <p>{t("ma_cle")}</p>;');
  L.push('}');
  L.push('```');
  L.push('');
  L.push('> 💡 Lancez `npx next-auto-i18n init` pour configurer automatiquement le routing, le middleware et les layouts.');
  L.push('');

  // ── Section module-scope ─────────────────────────────────────────────────
  if (moduleScopeTotal > 0) {
    L.push('---');
    L.push('');
    L.push('## ⚠️ Strings module-scope — action manuelle requise');
    L.push('');
    L.push('Ces strings sont dans des `const` **en dehors du corps d\'un composant**.');
    L.push('La fonction `t()` n\'est accessible qu\'à l\'intérieur d\'un composant.');
    L.push('Elles ont été traduites dans les fichiers JSON, mais le code source doit être adapté manuellement.');
    L.push('');
    L.push('**Solution :** déplacez la `const` à l\'intérieur de votre composant :');
    L.push('');
    L.push('```tsx');
    L.push('// ❌ Module-scope — t() inaccessible ici');
    L.push("const items = [{ label: 'Mon texte' }];");
    L.push('export function Page() {');
    L.push('  return <ul>{items.map(i => <li>{i.label}</li>)}</ul>;');
    L.push('}');
    L.push('');
    L.push('// ✅ Function-scope — t() accessible');
    L.push("import { useTranslations } from 'next-intl';");
    L.push('export function Page() {');
    L.push('  const t = useTranslations();');
    L.push("  const items = [{ label: t('ma_cle') }];");
    L.push('  return <ul>{items.map(i => <li>{i.label}</li>)}</ul>;');
    L.push('}');
    L.push('```');
    L.push('');
  }

  // ── Strings par fichier ───────────────────────────────────────────────────
  L.push('---');
  L.push('');
  L.push('## Strings par fichier');
  L.push('');
  L.push('Pour chaque string, remplacez le texte original par le code indiqué dans la colonne **Code**.');
  L.push('');

  for (const fileEntry of files) {
    const { relPath, strings, moduleScopeValues } = fileEntry;
    const hasModuleScope = moduleScopeValues.size > 0;
    const autoStrings    = strings.filter(s => !moduleScopeValues.has(s.value));
    const manualStrings  = strings.filter(s => moduleScopeValues.has(s.value));

    L.push(`### \`${relPath}\``);
    L.push('');

    if (hasModuleScope) {
      L.push(`> ⚠️ **${moduleScopeValues.size}** string${moduleScopeValues.size > 1 ? 's' : ''} module-scope dans ce fichier.`);
      L.push('');
    }

    // Strings auto-remplaçables
    if (autoStrings.length > 0) {
      if (hasModuleScope) L.push('**Remplacements automatiques :**');
      L.push('');
      L.push('| Ligne | Type | Texte original | Clé | Code |');
      L.push('|------:|------|----------------|-----|------|');
      for (const s of autoStrings) {
        const key  = keyMap.get(s.value) ?? '';
        const text = escapeCell(trunc(s.value));
        const code = replacementCode(s, key);
        L.push(`| ${s.line} | ${typeLabel(s.type)} | \`${text}\` | \`${key}\` | \`${code}\` |`);
      }
      L.push('');
    }

    // Strings module-scope (action manuelle)
    if (manualStrings.length > 0) {
      L.push('**Action manuelle requise (module-scope) :**');
      L.push('');
      L.push('| Ligne | Texte original | Clé | Code cible |');
      L.push('|------:|----------------|-----|-----------|');
      for (const s of manualStrings) {
        const key  = keyMap.get(s.value) ?? '';
        const text = escapeCell(trunc(s.value));
        L.push(`| ${s.line} | \`${text}\` | \`${key}\` | \`t("${key}")\` |`);
      }
      L.push('');
      L.push('> Déplacez la `const` contenant ces strings à l\'intérieur du composant.');
      L.push('');
    }

    L.push('---');
    L.push('');
  }

  // ── Toutes les clés ───────────────────────────────────────────────────────
  L.push('## Référence complète des clés');
  L.push('');
  L.push(`Toutes les clés générées dans \`${messagesDir}/${sourceLocale}.json\` :`);
  L.push('');
  L.push('| Clé | Valeur source |');
  L.push('|-----|--------------|');
  for (const [value, key] of [...keyMap.entries()].sort(([, a], [, b]) => a.localeCompare(b))) {
    L.push(`| \`${key}\` | ${escapeCell(trunc(value, 70))} |`);
  }
  L.push('');

  return L.join('\n');
}

export async function generateDoc(options: DocOptions): Promise<void> {
  const content = buildDoc(options);
  await writeFile(options.outputPath, content, 'utf-8');
}
