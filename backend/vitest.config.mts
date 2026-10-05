import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tree-sitter WASM runtime and the scanner both touch the filesystem
    // and spawn no browser APIs, so the plain node environment is correct.
    // jsdom also breaks the indirect dynamic import used to load the
    // ESM-only web-tree-sitter package from CommonJS.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Measured 2026-10: 86.3% statements, 70.4% branches across the
      // modules the suite reaches. The floor sits just below that so the gate
      // fails when coverage falls, not when it merely stops improving.
      // Raising it is a deliberate act, not a side effect of adding tests.
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 80,
        lines: 85,
      },
      // Entry points and types carry no logic worth asserting on, and
      // excluding them keeps the number about the code that does work.
      exclude: ['src/types/**', 'src/scripts/**', 'src/parser/languages/grammars.ts'],
    },
  },
});