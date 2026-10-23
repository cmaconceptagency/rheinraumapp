import { defineConfig } from 'vitest/config';

// Nur reine TypeScript-Module (Warteschlange, Zeitlogik) werden mit Vitest geprüft.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
