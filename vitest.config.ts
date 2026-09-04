import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Les tests de commandes montent un vrai projet temporaire et le scannent
    // avec le compilateur TypeScript. Sur un cache froid (première exécution,
    // runner CI), l'amorçage dépasse le budget de 5 s par défaut.
    testTimeout: 20_000,
  },
});
