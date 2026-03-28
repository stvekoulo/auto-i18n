import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateMessages } from '../../src/generator/index';
import type { ExtractedString } from '../../src/generator/index';

function str(value: string, type: ExtractedString['type'] = 'jsx-text'): ExtractedString {
  return { value, type, filePath: 'Test.tsx', line: 1, column: 1 };
}

let tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'auto-i18n-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('generateMessages', () => {
  describe('JSON généré — structure et contenu', () => {
    it('génère { clé: valeur } pour chaque string', async () => {
      const dir = await makeTmpDir();
      const { messages } = await generateMessages(
        [str('Bonjour'), str('Au revoir')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(messages['bonjour']).toBe('Bonjour');
      expect(messages['au_revoir']).toBe('Au revoir');
    });

    it('les clés sont triées alphabétiquement', async () => {
      const dir = await makeTmpDir();
      const { messages } = await generateMessages(
        [str('Zèbre'), str('Arbre'), str('Mangue')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      const keys = Object.keys(messages);
      expect(keys).toEqual([...keys].sort());
    });

    it('les valeurs sont les strings originales (non modifiées)', async () => {
      const dir = await makeTmpDir();
      const { messages } = await generateMessages(
        [str('Bienvenue sur notre site !')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(Object.values(messages)).toContain('Bienvenue sur notre site !');
    });

    it('gère une liste vide sans erreur', async () => {
      const dir = await makeTmpDir();
      const { messages, keyMap } = await generateMessages(
        [],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(messages).toEqual({});
      expect(keyMap.size).toBe(0);
    });
  });

  describe('déduplication', () => {
    it('strings identiques → une seule clé partagée', async () => {
      const dir = await makeTmpDir();
      const { keyMap, messages } = await generateMessages(
        [str('Bonjour'), str('Bonjour'), str('Bonjour')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(keyMap.size).toBe(1);
      expect(Object.keys(messages)).toHaveLength(1);
      expect(keyMap.get('Bonjour')).toBe('bonjour');
    });

    it('strings différentes → clés différentes', async () => {
      const dir = await makeTmpDir();
      const { keyMap } = await generateMessages(
        [str('Bonjour'), str('Salut')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(keyMap.get('Bonjour')).toBe('bonjour');
      expect(keyMap.get('Salut')).toBe('salut');
      expect(keyMap.size).toBe(2);
    });

    it('même valeur depuis types différents (jsx-text vs jsx-attribute) → même clé', async () => {
      const dir = await makeTmpDir();
      const { keyMap, messages } = await generateMessages(
        [str('Bonjour', 'jsx-text'), str('Bonjour', 'jsx-attribute')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(keyMap.size).toBe(1);
      expect(Object.keys(messages)).toHaveLength(1);
    });

    it('même valeur depuis fichiers différents → même clé', async () => {
      const dir = await makeTmpDir();
      const s1: ExtractedString = { ...str('Rechercher'), filePath: 'Header.tsx' };
      const s2: ExtractedString = { ...str('Rechercher'), filePath: 'Footer.tsx' };

      const { keyMap } = await generateMessages([s1, s2], {
        sourceLocale: 'fr',
        messagesDir: dir,
      });

      expect(keyMap.size).toBe(1);
      expect(keyMap.get('Rechercher')).toBe('rechercher');
    });
  });

  describe('collisions de clés', () => {
    it('deux valeurs produisant la même clé brute → suffixe _2', async () => {
      const dir = await makeTmpDir();
      const { keyMap } = await generateMessages(
        [str('Bonjour !'), str('Bonjour.')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      const keys = [...keyMap.values()];
      expect(keys).toContain('bonjour');
      expect(keys).toContain('bonjour_2');
    });

    it('trois collisions → _2 puis _3', async () => {
      const dir = await makeTmpDir();
      const { keyMap } = await generateMessages(
        [str('OK!'), str('OK?'), str('OK.')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      const keys = [...keyMap.values()];
      expect(keys).toContain('ok');
      expect(keys).toContain('ok_2');
      expect(keys).toContain('ok_3');
    });
  });

  describe('template literals dynamiques (format next-intl)', () => {
    it('la valeur dans le JSON conserve les placeholders {varName}', async () => {
      const dir = await makeTmpDir();
      const dynStr: ExtractedString = {
        value: 'Bonjour {name}, vous avez {count} messages',
        type: 'template-literal-dynamic',
        filePath: 'Test.tsx',
        line: 1,
        column: 1,
        variables: ['name', 'count'],
      };

      const { messages } = await generateMessages([dynStr], {
        sourceLocale: 'fr',
        messagesDir: dir,
      });

      expect(Object.values(messages)).toContain('Bonjour {name}, vous avez {count} messages');
    });

    it('la clé est générée sans les accolades', async () => {
      const dir = await makeTmpDir();
      const dynStr: ExtractedString = {
        value: 'Salut {name}',
        type: 'template-literal-dynamic',
        filePath: 'Test.tsx',
        line: 1,
        column: 1,
        variables: ['name'],
      };

      const { keyMap } = await generateMessages([dynStr], {
        sourceLocale: 'fr',
        messagesDir: dir,
      });

      expect(keyMap.get('Salut {name}')).toBe('salut_name');
    });

    it('variable avec expression composée (user.name)', async () => {
      const dir = await makeTmpDir();
      const dynStr: ExtractedString = {
        value: 'Bonjour {user.name}',
        type: 'template-literal-dynamic',
        filePath: 'Test.tsx',
        line: 1,
        column: 1,
        variables: ['user.name'],
      };

      const { keyMap, messages } = await generateMessages([dynStr], {
        sourceLocale: 'fr',
        messagesDir: dir,
      });

      expect(keyMap.get('Bonjour {user.name}')).toBe('bonjour_user_name');
      expect(Object.values(messages)).toContain('Bonjour {user.name}');
    });
  });

  describe('écriture du fichier JSON', () => {
    it('crée le fichier {sourceLocale}.json dans messagesDir', async () => {
      const dir = await makeTmpDir();
      const { outputPath } = await generateMessages(
        [str('Bonjour')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(outputPath).toMatch(/fr\.json$/);
      const content = await readFile(outputPath, 'utf-8');
      expect(content).toBeTruthy();
    });

    it('le fichier contient du JSON valide et lisible', async () => {
      const dir = await makeTmpDir();
      const { outputPath } = await generateMessages(
        [str('Bonjour'), str('Au revoir')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      const raw = await readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, string>;

      expect(parsed['bonjour']).toBe('Bonjour');
      expect(parsed['au_revoir']).toBe('Au revoir');
    });

    it('le fichier est formaté avec indentation 2 espaces', async () => {
      const dir = await makeTmpDir();
      const { outputPath } = await generateMessages(
        [str('Bonjour')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      const raw = await readFile(outputPath, 'utf-8');
      expect(raw).toContain('  "bonjour"');
    });

    it('crée le dossier messages/ s\'il n\'existe pas', async () => {
      const dir = await makeTmpDir();
      const nestedDir = join(dir, 'messages', 'nested');

      await generateMessages(
        [str('Bonjour')],
        { sourceLocale: 'fr', messagesDir: nestedDir },
      );

      const content = await readFile(join(nestedDir, 'fr.json'), 'utf-8');
      expect(JSON.parse(content)['bonjour']).toBe('Bonjour');
    });

    it('supporte différentes locales (en, de, es…)', async () => {
      const dir = await makeTmpDir();
      const { outputPath } = await generateMessages(
        [str('Hello')],
        { sourceLocale: 'en', messagesDir: dir },
      );

      expect(outputPath).toMatch(/en\.json$/);
    });
  });

  describe('keyMap (pour le rewriter)', () => {
    it('mappe chaque valeur originale à sa clé', async () => {
      const dir = await makeTmpDir();
      const { keyMap } = await generateMessages(
        [str('Bonjour'), str('Rechercher un projet'), str('Fermer')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      expect(keyMap.get('Bonjour')).toBe('bonjour');
      expect(keyMap.get('Rechercher un projet')).toBe('rechercher_un_projet');
      expect(keyMap.get('Fermer')).toBe('fermer');
    });

    it('les clés du keyMap correspondent aux clés du JSON', async () => {
      const dir = await makeTmpDir();
      const { keyMap, messages } = await generateMessages(
        [str('Bonjour'), str('Au revoir')],
        { sourceLocale: 'fr', messagesDir: dir },
      );

      for (const [, key] of keyMap) {
        expect(messages).toHaveProperty(key);
      }
    });
  });

  describe('newCount', () => {
    it('retourne le nombre de nouvelles clés (sans existingMessages)', async () => {
      const dir = await makeTmpDir();
      const { newCount } = await generateMessages(
        [str('Bonjour'), str('Au revoir')],
        { sourceLocale: 'fr', messagesDir: dir },
      );
      expect(newCount).toBe(2);
    });

    it('retourne 0 si toutes les strings sont déjà dans existingMessages', async () => {
      const dir = await makeTmpDir();
      const { newCount } = await generateMessages(
        [str('Bonjour'), str('Au revoir')],
        {
          sourceLocale: 'fr',
          messagesDir: dir,
          existingMessages: { bonjour: 'Bonjour', au_revoir: 'Au revoir' },
        },
      );
      expect(newCount).toBe(0);
    });

    it('retourne le bon compte pour un ajout partiel', async () => {
      const dir = await makeTmpDir();
      const { newCount } = await generateMessages(
        [str('Bonjour'), str('Au revoir'), str('Merci')],
        {
          sourceLocale: 'fr',
          messagesDir: dir,
          existingMessages: { bonjour: 'Bonjour', au_revoir: 'Au revoir' },
        },
      );
      expect(newCount).toBe(1);
    });
  });

  describe('merge incrémental avec existingMessages', () => {
    it('préserve les clés existantes à l\'identique', async () => {
      const dir = await makeTmpDir();
      const { keyMap, messages } = await generateMessages(
        [str('Bonjour'), str('Au revoir')],
        {
          sourceLocale: 'fr',
          messagesDir: dir,
          existingMessages: { bonjour: 'Bonjour', au_revoir: 'Au revoir' },
        },
      );
      expect(keyMap.get('Bonjour')).toBe('bonjour');
      expect(keyMap.get('Au revoir')).toBe('au_revoir');
      expect(messages['bonjour']).toBe('Bonjour');
    });

    it('conserve les clés existantes même si la string disparaît du scan', async () => {
      const dir = await makeTmpDir();
      // Scan ne trouve que "Bonjour", mais "Au revoir" était déjà dans existingMessages
      const { messages } = await generateMessages(
        [str('Bonjour')],
        {
          sourceLocale: 'fr',
          messagesDir: dir,
          existingMessages: { bonjour: 'Bonjour', au_revoir: 'Au revoir' },
        },
      );
      // "au_revoir" doit rester dans le JSON (pour ne pas casser les t() déjà en place)
      expect(messages['au_revoir']).toBe('Au revoir');
      expect(messages['bonjour']).toBe('Bonjour');
    });

    it('génère une nouvelle clé sans collision avec les existantes', async () => {
      const dir = await makeTmpDir();
      // "Bonjour !" produirait aussi "bonjour" → doit devenir "bonjour_2"
      const { keyMap } = await generateMessages(
        [str('Bonjour !')],
        {
          sourceLocale: 'fr',
          messagesDir: dir,
          existingMessages: { bonjour: 'Bonjour' },
        },
      );
      expect(keyMap.get('Bonjour !')).toBe('bonjour_2');
    });

    it('la clé existante est réutilisée même avec une collision potentielle', async () => {
      const dir = await makeTmpDir();
      // Les deux strings sont déjà dans existingMessages avec leurs clés
      const { keyMap } = await generateMessages(
        [str('Bonjour'), str('Bonjour !')],
        {
          sourceLocale: 'fr',
          messagesDir: dir,
          existingMessages: { bonjour: 'Bonjour', bonjour_2: 'Bonjour !' },
        },
      );
      expect(keyMap.get('Bonjour')).toBe('bonjour');
      expect(keyMap.get('Bonjour !')).toBe('bonjour_2');
    });
  });
});
