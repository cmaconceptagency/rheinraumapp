import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integrationstests teilen sich eine Test-Datenbank und laufen daher nacheinander.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: './test/global-setup.ts',
  },
});
