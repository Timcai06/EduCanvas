import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    passWithNoTests: true,
  },
});
