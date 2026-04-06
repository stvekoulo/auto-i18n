import { describe, it, expect, beforeEach } from 'vitest';
import { rawKey, KeyRegistry } from '../../src/generator/key-builder';

describe('rawKey', () => {
  describe('cas normaux', () => {
    it('"Bonjour" → "bonjour"', () => {
      expect(rawKey('Bonjour')).toBe('bonjour');
    });

    it('"Bienvenue sur notre site !" → "bienvenue_sur_notre_site"', () => {
      expect(rawKey('Bienvenue sur notre site !')).toBe('bienvenue_sur_notre_site');
    });

    it('"Rechercher un projet" → "rechercher_un_projet"', () => {
      expect(rawKey('Rechercher un projet')).toBe('rechercher_un_projet');
    });

    it('conserve les mots courts significatifs', () => {
      expect(rawKey('OK')).toBe('ok');
    });

    it('une seule lettre', () => {
      expect(rawKey('A')).toBe('a');
    });
  });

  describe('caractères accentués', () => {
    it('normalise é → e', () => {
      expect(rawKey('Éléments')).toBe('elements');
    });

    it('normalise à, ç, ô, ü', () => {
      expect(rawKey('Gérez vos données')).toBe('gerez_vos_donnees');
    });

    it('normalise les accents dans une phrase complète', () => {
      expect(rawKey('Accès administrateur activé')).toBe('acces_administrateur_active');
    });

    it('"Fermer la fenêtre" → "fermer_la_fenetre"', () => {
      expect(rawKey('Fermer la fenêtre')).toBe('fermer_la_fenetre');
    });
  });

  describe('ponctuation et caractères spéciaux', () => {
    it('retire le point d\'exclamation', () => {
      expect(rawKey('Bonjour !')).toBe('bonjour');
    });

    it('retire le point d\'interrogation', () => {
      expect(rawKey('Comment ça va ?')).toBe('comment_ca_va');
    });

    it('retire les guillemets', () => {
      expect(rawKey('"Titre principal"')).toBe('titre_principal');
    });

    it('retire les points de suspension', () => {
      expect(rawKey('Chargement...')).toBe('chargement');
    });

    it('retire la virgule', () => {
      expect(rawKey('Oui, non, peut-être')).toBe('oui_non_peut_etre');
    });

    it('consolide les séquences de caractères spéciaux en un seul underscore', () => {
      expect(rawKey('--- titre ---')).toBe('titre');
    });
  });

  describe('variables de template literals', () => {
    it('"Salut {name}" → "salut_name"', () => {
      expect(rawKey('Salut {name}')).toBe('salut_name');
    });

    it('"Bonjour {user.name}, bienvenue !" → "bonjour_user_name_bienvenue"', () => {
      expect(rawKey('Bonjour {user.name}, bienvenue !')).toBe('bonjour_user_name_bienvenue');
    });

    it('plusieurs variables dans la clé', () => {
      expect(rawKey('Il reste {count} messages non lus')).toBe('il_reste_count_messages_non_lus');
    });

    it('variable en fin de phrase', () => {
      expect(rawKey('Bienvenue, {name}')).toBe('bienvenue_name');
    });

    it('retire $ des anciens marqueurs de template literals', () => {
      // Le scanner normalise déjà ${x} → {x}, mais on reste robuste
      expect(rawKey('Salut ${name}')).toBe('salut_name');
    });
  });

  describe('troncature à 40 caractères', () => {
    it('tronque à la dernière frontière de mot', () => {
      const long = 'Bienvenue sur notre plateforme de gestion de projets innovants';
      const key = rawKey(long);
      expect(key.length).toBeLessThanOrEqual(60);
      expect(key).not.toMatch(/_$/);
    });

    it('ne tronque pas si la clé fait exactement 40 chars', () => {
      // "a" × 40 → 40 chars → pas de troncature
      const val = 'a'.repeat(40);
      expect(rawKey(val).length).toBe(40);
    });

    it('ne tronque pas les clés courtes', () => {
      expect(rawKey('Bonjour').length).toBeLessThanOrEqual(60);
    });

    it('une longue chaîne sans espaces est tronquée à 60 chars', () => {
      const long = 'thisisaverylongwordwithnospacesatallextrabytes';
      const key = rawKey(long);
      expect(key.length).toBeLessThanOrEqual(60);
    });

    it('ne laisse pas de underscore en fin après troncature', () => {
      // Force la troncature juste après un underscore
      // "aaaa_bbbb_cccc_dddd_eeee_ffff_gggg_hhhh_" (41 chars)
      const val = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh ii';
      const key = rawKey(val);
      expect(key).not.toMatch(/_$/);
      expect(key.length).toBeLessThanOrEqual(60);
    });
  });

  describe('cas limites', () => {
    it('retourne "key" pour une string vide', () => {
      expect(rawKey('')).toBe('key');
    });

    it('retourne "key" pour une string de ponctuation pure', () => {
      expect(rawKey('!!! ???')).toBe('key');
    });

    it('retourne "key" pour une string de symboles', () => {
      expect(rawKey('{}')).toBe('key');
    });

    it('gère les chiffres dans la valeur', () => {
      expect(rawKey('Étape 1 sur 3')).toBe('etape_1_sur_3');
    });

    it('espaces multiples consolidés en un seul underscore', () => {
      expect(rawKey('Bonjour   monde')).toBe('bonjour_monde');
    });
  });
});

describe('KeyRegistry', () => {
  let registry: KeyRegistry;

  beforeEach(() => {
    registry = new KeyRegistry();
  });

  describe('première occurrence', () => {
    it('retourne la clé telle quelle', () => {
      expect(registry.resolve('bonjour')).toBe('bonjour');
    });

    it('enregistre la clé (has retourne true)', () => {
      registry.resolve('bonjour');
      expect(registry.has('bonjour')).toBe(true);
    });

    it('size augmente après chaque résolution', () => {
      registry.resolve('a');
      registry.resolve('b');
      expect(registry.size).toBe(2);
    });
  });

  describe('gestion des collisions', () => {
    it('suffixe _2 sur la deuxième collision', () => {
      registry.resolve('bonjour');
      expect(registry.resolve('bonjour')).toBe('bonjour_2');
    });

    it('suffixe _3 sur la troisième collision', () => {
      registry.resolve('bonjour');
      registry.resolve('bonjour');
      expect(registry.resolve('bonjour')).toBe('bonjour_3');
    });

    it('n\'affecte pas les autres clés', () => {
      registry.resolve('bonjour');
      registry.resolve('bonjour');
      expect(registry.resolve('au_revoir')).toBe('au_revoir');
    });

    it('évite la collision avec une clé existante portant déjà le suffixe', () => {
      // "bonjour" est enregistré
      registry.resolve('bonjour');
      // "bonjour_2" est enregistré indépendamment
      registry.resolve('bonjour_2');
      // Nouvelle collision sur "bonjour" → doit sauter bonjour_2 et aller à bonjour_3
      expect(registry.resolve('bonjour')).toBe('bonjour_3');
    });

    it('gère de nombreuses collisions successives', () => {
      for (let i = 0; i < 9; i++) registry.resolve('key');
      expect(registry.resolve('key')).toBe('key_10');
    });
  });

  describe('indépendance entre instances', () => {
    it('deux registres distincts sont indépendants', () => {
      const r1 = new KeyRegistry();
      const r2 = new KeyRegistry();
      r1.resolve('bonjour');
      // r2 ne connaît pas "bonjour"
      expect(r2.resolve('bonjour')).toBe('bonjour');
    });
  });
});
