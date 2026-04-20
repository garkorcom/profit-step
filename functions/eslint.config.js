/**
 * ESLint 9 flat config for Cloud Functions.
 *
 * Migrated 2026-04-19 from the legacy .eslintrc.* format (which ESLint 9.x
 * no longer supports) — unblocks the "🔍 Static Analysis (ESLint)" gate in
 * .github/workflows/firebase-deploy-gate.yml.
 *
 * Keeps the local custom `firebase-no-trigger-loop` rule loud (error level)
 * per CLAUDE.md §2.1 — one missed idempotency guard on an onUpdate trigger
 * can burn $10k+ in Firebase billing.
 */

const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const importPlugin = require('eslint-plugin-import');
const localRules = require('./eslint-rules');

module.exports = [
  {
    ignores: [
      'lib/**',
      'node_modules/**',
      'coverage/**',
      'test/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      'src/scripts/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      'local-rules': localRules,
    },
    rules: {
      // Critical anti-loop rule (see CLAUDE.md §2.1)
      'local-rules/firebase-no-trigger-loop': 'error',

      // Basic TypeScript hygiene (warn-only to avoid blocking on legacy code)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',

      // Import hygiene
      'import/no-unresolved': 'off', // TS resolver handles this
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.js', 'eslint-rules/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
