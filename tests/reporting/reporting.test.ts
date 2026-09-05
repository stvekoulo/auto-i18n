import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderSyncReport } from '../../src/reporting/sync';
import { renderWriteReport } from '../../src/reporting/write';
import { renderScaffold } from '../../src/reporting/init';
import { renderCheckReport, renderCheckJson } from '../../src/reporting/check';
import type { SyncReport } from '../../src/pipeline/sync';
import type { WriteReport } from '../../src/pipeline/write';
import type { CheckReport } from '../../src/core/check';
import type { ExtractedString } from '../../src/core/types';

/**
 * Ces fonctions tournent après que tout le travail utile est fait : une
 * exception ici perdrait le rapport d'une synchronisation déjà écrite sur
 * disque. On les exerce donc sur les cas limites (zéro, un, beaucoup) autant
 * que sur le cas nominal.
 */

let out: string[];

beforeEach(() => {
  out = [];
  const capture = (...args: unknown[]) => {
    out.push(args.join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const text = () => out.join('\n');

function extracted(over: Partial<ExtractedString> = {}): ExtractedString {
  return {
    value: 'Texte',
    kind: 'string-literal',
    file: '/proj/src/a.ts',
    line: 3,
    column: 1,
    scope: 'module',
    safety: 'review',
    reviewReason: 'module_scope',
    ...over,
  };
}

function syncReport(over: Partial<SyncReport> = {}): SyncReport {
  return {
    filesScanned: 2,
    parseErrors: [],
    detected: { total: 3, safe: 3, review: 0 },
    reviewStrings: [],
    addedKeys: ['a'],
    reusedKeys: [],
    sourceKeyCount: 3,
    translation: { byLocale: [], totalTranslated: 0, failed: [] },
    orphanedKeys: [],
    prunedKeys: [],
    strings: [],
    keyMap: new Map(),
    fileRuntimes: new Map(),
    ...over,
  };
}

describe('reporting/sync', () => {
  it('rend les trois statuts de locale', () => {
    renderSyncReport('/proj', {
      ...syncReport(),
      translation: {
        byLocale: [
          { locale: 'en', catalog: {}, translated: 2, status: 'updated' },
          { locale: 'es', catalog: {}, translated: 0, status: 'up_to_date' },
          {
            locale: 'de',
            catalog: {},
            translated: 0,
            status: 'failed',
            error: { message: 'quota dépassé', kind: 'quota' },
          },
        ],
        totalTranslated: 2,
        failed: ['de'],
      },
    });

    expect(text()).toContain('en — 2 strings traduites');
    expect(text()).toContain('es — déjà à jour');
    expect(text()).toContain('de — échec (quota) : quota dépassé');
    expect(text()).toContain('Synchronisation partielle');
  });

  it('accorde le singulier', () => {
    renderSyncReport(
      '/proj',
      syncReport({
        filesScanned: 1,
        detected: { total: 1, safe: 1, review: 0 },
        sourceKeyCount: 1,
      }),
    );
    expect(text()).toContain('1 string détectée (1 sûre, 0 à revoir) dans 1 fichier');
  });

  it('tronque la liste des strings à revoir', () => {
    const reviewStrings = Array.from({ length: 20 }, (_, i) => extracted({ line: i + 1 }));
    renderSyncReport(
      '/proj',
      syncReport({
        detected: { total: 20, safe: 0, review: 20 },
        reviewStrings,
        parseErrors: ['/proj/src/casse.tsx'],
      }),
    );

    expect(text()).toContain('20 strings à revoir manuellement');
    expect(text()).toContain('... et 5 autre(s)');
    expect(text()).toContain('1 fichier non parsable');
  });

  it('ne plante pas sur un rapport entièrement vide', () => {
    expect(() =>
      renderSyncReport(
        '/proj',
        syncReport({
          filesScanned: 0,
          detected: { total: 0, safe: 0, review: 0 },
          addedKeys: [],
          sourceKeyCount: 0,
        }),
      ),
    ).not.toThrow();
    expect(text()).toContain('Synchronisation terminée');
  });
});

describe('reporting/write', () => {
  const outcome = (over = {}) => ({
    file: '/proj/src/a.tsx',
    written: 1,
    skipped: [],
    before: 'const a = 1;\n',
    after: 'const a = 2;\n',
    ...over,
  });

  function writeReport(over: Partial<WriteReport> = {}): WriteReport {
    return {
      dryRun: false,
      files: [outcome()],
      filesChanged: 1,
      stringsWritten: 1,
      stringsSkipped: 0,
      ...over,
    };
  }

  it('annonce le rien-à-faire', () => {
    renderWriteReport('/proj', writeReport({ files: [], filesChanged: 0, stringsWritten: 0 }));
    expect(text()).toContain('Rien à câbler automatiquement');
  });

  it('affiche un diff en dry-run', () => {
    renderWriteReport('/proj', writeReport({ dryRun: true }));
    expect(text()).toContain('dry-run');
    expect(text()).toContain('seraient câblée(s)');
    expect(text()).toContain('- const a = 1;');
    expect(text()).toContain('+ const a = 2;');
  });

  it('mentionne la sauvegarde hors dry-run', () => {
    renderWriteReport('/proj', writeReport());
    expect(text()).toContain('.backup');
  });

  it('détaille chaque motif de renoncement', () => {
    renderWriteReport(
      '/proj',
      writeReport({
        files: [
          outcome({
            written: 0,
            after: 'const a = 1;\n',
            skipped: [
              { value: 'A', line: 1, reason: 'no_host' },
              { value: 'B', line: 2, reason: 'server_not_async' },
              { value: 'C', line: 3, reason: 't_conflict' },
              { value: 'D', line: 4, reason: 'concise_body' },
            ],
          }),
        ],
        filesChanged: 0,
        stringsWritten: 0,
        stringsSkipped: 4,
      }),
    );

    expect(text()).toContain('4 string(s) safe laissée(s) au guide');
    expect(text()).toContain('aucune fonction composant/hook identifiable');
  });

  it('tronque au-delà de dix fichiers modifiés', () => {
    const files = Array.from({ length: 13 }, (_, i) => outcome({ file: `/proj/src/f${i}.tsx` }));
    renderWriteReport(
      '/proj',
      writeReport({ files, filesChanged: 13, stringsWritten: 13, dryRun: true }),
    );
    expect(text()).toContain('... et 3 autre(s) fichier(s) modifié(s)');
  });
});

describe('reporting/init', () => {
  it('rend les trois statuts de scaffold', () => {
    renderScaffold('/proj', [
      { target: 'routing', status: 'created', path: '/proj/i18n/routing.ts' },
      { target: 'request', status: 'already_present', path: '/proj/i18n/request.ts' },
      { target: 'config', status: 'manual', note: 'export default non reconnu' },
      { target: 'react-entry', status: 'manual' },
    ]);

    expect(text()).toContain('i18n/routing.ts créé');
    expect(text()).toContain('i18n/request.ts — déjà présent');
    expect(text()).toContain('next.config — action manuelle : export default non reconnu');
    expect(text()).toContain('voir guide');
  });
});

describe('reporting/check', () => {
  function checkReport(over: Partial<CheckReport> = {}): CheckReport {
    return {
      filesScanned: 2,
      parseErrors: [],
      detected: { total: 2, safe: 2, review: 0 },
      uncatalogued: [],
      sourceKeyCount: 2,
      missingByLocale: { en: [] },
      totalMissing: 0,
      orphanedKeys: [],
      ok: true,
      ...over,
    };
  }

  it('annonce un projet à jour', () => {
    renderCheckReport('/proj', checkReport());
    expect(text()).toContain('Catalogue source à jour avec le code');
    expect(text()).toContain('en — complet');
    expect(text()).toContain('Tout est à jour');
  });

  it('tronque la liste des strings non cataloguées et signale les fichiers cassés', () => {
    renderCheckReport(
      '/proj',
      checkReport({
        uncatalogued: Array.from({ length: 20 }, (_, i) => `Texte ${i}`),
        missingByLocale: { en: ['a', 'b'] },
        totalMissing: 2,
        parseErrors: ['/proj/src/casse.tsx'],
        ok: false,
      }),
    );

    expect(text()).toContain('20 strings non encore cataloguées');
    expect(text()).toContain('... et 5 autre(s)');
    expect(text()).toContain('en — 2 clés manquantes');
    expect(text()).toContain('src');
    expect(text()).toContain('Travail en attente');
  });

  it('émet un JSON complet et reparsable', () => {
    const report = checkReport({ uncatalogued: ['A'], ok: false });
    renderCheckJson(report);
    expect(JSON.parse(text())).toEqual(report);
  });
});
