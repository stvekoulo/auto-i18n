import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Les tests de commandes montent un vrai projet temporaire et le scannent
    // avec le compilateur TypeScript. Sur un cache froid (première exécution,
    // runner CI), l'amorçage dépasse le budget de 5 s par défaut.
    testTimeout: 20_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        // Câblage commander et invites interactives : rien à assurer ici que
        // les tests de commandes ne couvrent pas déjà en dessous.
        'src/cli/**',
        // Ré-exports uniquement.
        'src/index.ts',
        'src/core/index.ts',
      ],
      // Seuils calés juste sous le niveau atteint : ils attrapent une
      // régression sans casser la CI au premier ajout de code.
      thresholds: {
        statements: 92,
        branches: 80,
        functions: 95,
        lines: 95,
      },
    },
  },
});
