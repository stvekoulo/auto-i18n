import { describe, it, expect } from 'vitest';
import { shouldIgnore } from '../../src/scanner/filters';

describe('shouldIgnore', () => {

  describe('strings vides', () => {
    it('ignore une string vide', () => {
      expect(shouldIgnore('')).toBe(true);
    });
    it('ignore espaces uniquement', () => {
      expect(shouldIgnore('   ')).toBe(true);
    });
    it('ignore tabulations et retours chariot', () => {
      expect(shouldIgnore('\t\n  ')).toBe(true);
    });
  });

  describe('valeurs numériques', () => {
    it('ignore un entier positif', () => expect(shouldIgnore('42')).toBe(true));
    it('ignore un flottant', () => expect(shouldIgnore('3.14')).toBe(true));
    it('ignore un entier négatif', () => expect(shouldIgnore('-7')).toBe(true));
    it('ne ignore pas "2 éléments" (chiffre + texte)', () => {
      expect(shouldIgnore('2 éléments')).toBe(false);
    });
  });

  describe('valeurs CSS avec unités', () => {
    it('ignore "16px"', () => expect(shouldIgnore('16px')).toBe(true));
    it('ignore "2rem"', () => expect(shouldIgnore('2rem')).toBe(true));
    it('ignore "100vh"', () => expect(shouldIgnore('100vh')).toBe(true));
    it('ignore "50%"', () => expect(shouldIgnore('50%')).toBe(true));
    it('ignore "0.5s" (durée)', () => expect(shouldIgnore('0.5s')).toBe(true));
    it('ignore "200ms"', () => expect(shouldIgnore('200ms')).toBe(true));
  });

  describe('couleurs hexadécimales', () => {
    it('ignore "#fff" (3 chiffres)', () => expect(shouldIgnore('#fff')).toBe(true));
    it('ignore "#3b82f6" (6 chiffres)', () => expect(shouldIgnore('#3b82f6')).toBe(true));
    it('ignore "#ffffffff" (8 chiffres, avec alpha)', () => expect(shouldIgnore('#ffffffff')).toBe(true));
    it('ne ignore pas "#gg" (hexa invalide)', () => expect(shouldIgnore('#gg')).toBe(false));
    it('ne ignore pas "#12345" (longueur invalide)', () => expect(shouldIgnore('#12345')).toBe(false));
  });

  describe('couleurs CSS fonctionnelles', () => {
    it('ignore "rgba(255,0,0,0.5)"', () => expect(shouldIgnore('rgba(255,0,0,0.5)')).toBe(true));
    it('ignore "rgb(0,0,0)"', () => expect(shouldIgnore('rgb(0,0,0)')).toBe(true));
    it('ignore "hsl(220, 100%, 50%)"', () => expect(shouldIgnore('hsl(220, 100%, 50%)')).toBe(true));
    it('ignore "oklch(0.7 0.15 230)"', () => expect(shouldIgnore('oklch(0.7 0.15 230)')).toBe(true));
    it('ne ignore pas "red" (valeur couleur → dans TECHNICAL_KEYWORDS)', () => {
      expect(shouldIgnore('red')).toBe(true);
    });
  });

  describe('URLs absolues (https / http)', () => {
    it('ignore "https://example.com"', () => expect(shouldIgnore('https://example.com')).toBe(true));
    it('ignore "http://localhost:3000"', () => expect(shouldIgnore('http://localhost:3000')).toBe(true));
    it('ignore "https://cdn.example.com/img/logo.png"', () => {
      expect(shouldIgnore('https://cdn.example.com/img/logo.png')).toBe(true);
    });
  });

  describe('URLs avec protocole spécial', () => {
    it('ignore "mailto:contact@example.com"', () => {
      expect(shouldIgnore('mailto:contact@example.com')).toBe(true);
    });
    it('ignore "tel:+33612345678"', () => {
      expect(shouldIgnore('tel:+33612345678')).toBe(true);
    });
    it('ignore "data:image/png;base64,abc123"', () => {
      expect(shouldIgnore('data:image/png;base64,abc123')).toBe(true);
    });
    it('ignore "blob:https://example.com/..."', () => {
      expect(shouldIgnore('blob:https://example.com/uuid')).toBe(true);
    });
    it('ignore "ftp://files.example.com"', () => {
      expect(shouldIgnore('ftp://files.example.com')).toBe(true);
    });
  });

  describe('URLs relatives au protocole (//)', () => {
    it('ignore "//cdn.example.com/script.js"', () => {
      expect(shouldIgnore('//cdn.example.com/script.js')).toBe(true);
    });
    it('ignore "//fonts.googleapis.com/css"', () => {
      expect(shouldIgnore('//fonts.googleapis.com/css')).toBe(true);
    });
  });

  describe('routes et chemins', () => {
    it('ignore "/dashboard"', () => expect(shouldIgnore('/dashboard')).toBe(true));
    it('ignore "/api/users"', () => expect(shouldIgnore('/api/users')).toBe(true));
    it('ignore "/api/users/[id]" (Next.js dynamic)', () => {
      expect(shouldIgnore('/api/users/[id]')).toBe(true);
    });
    it('ignore "/images/logo.png" (avec extension)', () => {
      expect(shouldIgnore('/images/logo.png')).toBe(true);
    });
    it('ignore "/about#section-1" (avec hash)', () => {
      expect(shouldIgnore('/about#section-1')).toBe(true);
    });
    it('ignore "/products?page=2&sort=asc" (avec query)', () => {
      expect(shouldIgnore('/products?page=2&sort=asc')).toBe(true);
    });
    it('ignore "/@modal/page" (Next.js parallel routes)', () => {
      expect(shouldIgnore('/@modal/page')).toBe(true);
    });
    it('ne ignore pas "/" seul (trop court)', () => {
      expect(shouldIgnore('/')).toBe(false);
    });
  });

  describe('types MIME', () => {
    it('ignore "application/json"', () => expect(shouldIgnore('application/json')).toBe(true));
    it('ignore "text/html"', () => expect(shouldIgnore('text/html')).toBe(true));
    it('ignore "image/png"', () => expect(shouldIgnore('image/png')).toBe(true));
    it('ignore "multipart/form-data"', () => expect(shouldIgnore('multipart/form-data')).toBe(true));
    it('ignore "text/html; charset=utf-8" (avec paramètre)', () => {
      expect(shouldIgnore('text/html; charset=utf-8')).toBe(true);
    });
    it('ne ignore pas "ou/et" (type invalide non standard)', () => {
      expect(shouldIgnore('ou/et')).toBe(false);
    });
  });

  describe('variables d\'environnement (SCREAMING_SNAKE)', () => {
    it('ignore "NODE_ENV"', () => expect(shouldIgnore('NODE_ENV')).toBe(true));
    it('ignore "NEXT_PUBLIC_API_URL"', () => expect(shouldIgnore('NEXT_PUBLIC_API_URL')).toBe(true));
    it('ignore "API_KEY"', () => expect(shouldIgnore('API_KEY')).toBe(true));
    it('ne ignore pas "FAQ" (pas d\'underscore)', () => expect(shouldIgnore('FAQ')).toBe(false));
    it('ne ignore pas "API" (pas d\'underscore)', () => expect(shouldIgnore('API')).toBe(false));
    it('ne ignore pas "OK" (pas d\'underscore)', () => expect(shouldIgnore('OK')).toBe(false));
  });

  describe('mots-clés techniques', () => {
    it('ignore "flex"', () => expect(shouldIgnore('flex')).toBe(true));
    it('ignore "POST"', () => expect(shouldIgnore('POST')).toBe(true));
    it('ignore "hidden"', () => expect(shouldIgnore('hidden')).toBe(true));
    it('ignore "true"', () => expect(shouldIgnore('true')).toBe(true));
    it('ignore "null"', () => expect(shouldIgnore('null')).toBe(true));
    it('ignore "undefined"', () => expect(shouldIgnore('undefined')).toBe(true));
    it('ignore "_blank"', () => expect(shouldIgnore('_blank')).toBe(true));
    it('ignore "Bearer" (auth token prefix)', () => expect(shouldIgnore('Bearer')).toBe(true));
    it('ignore "Content-Type" (header HTTP)', () => expect(shouldIgnore('Content-Type')).toBe(true));
    it('ignore "utf-8" (encodage)', () => expect(shouldIgnore('utf-8')).toBe(true));
    it('ignore "development"', () => expect(shouldIgnore('development')).toBe(true));
    it('ignore "production"', () => expect(shouldIgnore('production')).toBe(true));
  });

  describe('identifiants camelCase / PascalCase', () => {
    it('ignore "onClick"', () => expect(shouldIgnore('onClick')).toBe(true));
    it('ignore "onChange"', () => expect(shouldIgnore('onChange')).toBe(true));
    it('ignore "onSubmit"', () => expect(shouldIgnore('onSubmit')).toBe(true));
    it('ignore "MyComponent"', () => expect(shouldIgnore('MyComponent')).toBe(true));
    it('ignore "firstName" (identifiant dev, pas un label UI)', () => {
      expect(shouldIgnore('firstName')).toBe(true);
    });
    it('ignore "handleClick"', () => expect(shouldIgnore('handleClick')).toBe(true));
    it('ne ignore pas "Bonjour" (pas de transition lower→upper)', () => {
      expect(shouldIgnore('Bonjour')).toBe(false);
    });
    it('ne ignore pas "FAQ" (pas de minuscule)', () => {
      expect(shouldIgnore('FAQ')).toBe(false);
    });
    it('ne ignore pas "OK" (pas de minuscule)', () => {
      expect(shouldIgnore('OK')).toBe(false);
    });
    it('ne ignore pas "Bienvenue sur la plateforme" (a des espaces)', () => {
      expect(shouldIgnore('Bienvenue sur la plateforme')).toBe(false);
    });
  });

  describe('token CSS kebab-case unique (single token)', () => {
    it('ignore "p-4"', () => expect(shouldIgnore('p-4')).toBe(true));
    it('ignore "m-8"', () => expect(shouldIgnore('m-8')).toBe(true));
    it('ignore "w-full"', () => expect(shouldIgnore('w-full')).toBe(true));
    it('ignore "h-screen"', () => expect(shouldIgnore('h-screen')).toBe(true));
    it('ignore "flex-col"', () => expect(shouldIgnore('flex-col')).toBe(true));
    it('ignore "rounded-lg"', () => expect(shouldIgnore('rounded-lg')).toBe(true));
    it('ignore "text-sm"', () => expect(shouldIgnore('text-sm')).toBe(true));
    it('ignore "bg-blue-500"', () => expect(shouldIgnore('bg-blue-500')).toBe(true));
    it('ignore "hover:bg-gray-100" (Tailwind variant)', () => {
      expect(shouldIgnore('hover:bg-gray-100')).toBe(true);
    });
    it('ignore "2xl:hidden" (responsive variant)', () => {
      expect(shouldIgnore('2xl:hidden')).toBe(true);
    });
    it('ignore "-translate-x-full" (utilitaire négatif)', () => {
      expect(shouldIgnore('-translate-x-full')).toBe(true);
    });
    it('ignore "grid-cols-3"', () => expect(shouldIgnore('grid-cols-3')).toBe(true));
    it('ne ignore pas "vis-à-vis" (accent → texte humain)', () => {
      expect(shouldIgnore('vis-à-vis')).toBe(false);
    });
    it('ne ignore pas "bien-être" (accent → texte humain)', () => {
      expect(shouldIgnore('bien-être')).toBe(false);
    });
  });

  describe('classes CSS multi-tokens (≥ 2 tokens)', () => {
    it('ignore "flex items-center"', () => {
      expect(shouldIgnore('flex items-center')).toBe(true);
    });
    it('ignore "text-lg font-bold bg-blue-500"', () => {
      expect(shouldIgnore('text-lg font-bold bg-blue-500')).toBe(true);
    });
    it('ignore "hover:bg-gray-100 focus:outline-none"', () => {
      expect(shouldIgnore('hover:bg-gray-100 focus:outline-none')).toBe(true);
    });
    it('ignore "flex flex-col gap-4 p-6 rounded-xl shadow-md"', () => {
      expect(shouldIgnore('flex flex-col gap-4 p-6 rounded-xl shadow-md')).toBe(true);
    });
    it('ne ignore pas "Bonjour monde" (majuscule dans le premier token)', () => {
      expect(shouldIgnore('Bonjour monde')).toBe(false);
    });
    it('ne ignore pas "Gérez vos projets"', () => {
      expect(shouldIgnore('Gérez vos projets')).toBe(false);
    });
  });

  describe('liste noire personnalisée', () => {
    it('ignore une valeur dans additionalBlacklist', () => {
      expect(shouldIgnore('mon-token-custom', { additionalBlacklist: ['mon-token-custom'] })).toBe(true);
    });
    it('ne ignore pas une valeur absente de additionalBlacklist', () => {
      expect(shouldIgnore('Bonjour', { additionalBlacklist: ['autre-chose'] })).toBe(false);
    });
    it('fonctionne avec une liste vide', () => {
      expect(shouldIgnore('Bonjour', { additionalBlacklist: [] })).toBe(false);
    });
  });

  describe('strings traduisibles — doivent être conservées', () => {
    it('"Bonjour"', () => expect(shouldIgnore('Bonjour')).toBe(false));
    it('"Bienvenue sur la plateforme"', () => {
      expect(shouldIgnore('Bienvenue sur la plateforme')).toBe(false);
    });
    it('"Rechercher un projet"', () => {
      expect(shouldIgnore('Rechercher un projet')).toBe(false);
    });
    it('"Logo de l\'application"', () => {
      expect(shouldIgnore("Logo de l'application")).toBe(false);
    });
    it('"OK"', () => expect(shouldIgnore('OK')).toBe(false));
    it('"2 éléments sélectionnés"', () => {
      expect(shouldIgnore('2 éléments sélectionnés')).toBe(false);
    });
    it('"Accès administrateur activé"', () => {
      expect(shouldIgnore('Accès administrateur activé')).toBe(false);
    });
    it('"Tableau de bord"', () => expect(shouldIgnore('Tableau de bord')).toBe(false));
    it('"Fermer la fenêtre"', () => expect(shouldIgnore('Fermer la fenêtre')).toBe(false));
    it('"Zone de navigation principale"', () => {
      expect(shouldIgnore('Zone de navigation principale')).toBe(false);
    });
    it('"vis-à-vis" (mot composé avec accent)', () => {
      expect(shouldIgnore('vis-à-vis')).toBe(false);
    });
  });
});
