module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist/', 'node_modules/', '*.js'],
  rules: {
    // Unused arguments are prefixed with an underscore elsewhere in the repo.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Empty catch blocks appear in shutdown paths, where the surrounding
    // comment explains why the failure is deliberately ignored.
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      // Tests assert against loosely typed Neo4j driver doubles.
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // Babel and tree-sitter expose untyped AST handles: tree-sitter's
      // Language/Parser types are not published for the WASM build, and the
      // Babel traverse visitor receives `any` by design. Typing those nodes
      // would mean re-declaring both libraries' ASTs, so `any` stays confined
      // to this boundary and the surrounding layers stay fully typed.
      files: [
        'src/parser/languages/javascript.ts',
        'src/parser/languages/treeSitterParser.ts',
        'src/parser/languages/treeSitterLoader.ts',
      ],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // Neo4j driver records and result values are `any` in the driver's own
      // type definitions, so the graph layer reads them through `any`.
      files: ['src/database/neo4jClient.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};