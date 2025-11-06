module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['tsconfig.json', 'tsconfig.dev.json'],
    sourceType: 'module',
    ecmaVersion: 2021,
  },
  ignorePatterns: [
    '/lib/**/*', // Ignore built files.
    '/test/**/*', // Ignore test files from linting
    'jest.config.js',
    '.eslintrc.js',
  ],
  plugins: ['@typescript-eslint', 'import', 'local-rules'],
  rules: {
    // Import rules
    'import/no-unresolved': 0,
    'import/prefer-default-export': 0,

    // TypeScript rules
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],

    // General rules
    'no-console': 'off', // We use console.log for Cloud Functions logging
    'max-len': ['warn', { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true }],

    // 🔥 CUSTOM ANTI-LOOP RULE - THE MOST IMPORTANT!
    'local-rules/firebase-no-trigger-loop': 'error', // ← THIS WILL BLOCK DEPLOYMENT!
  },
  settings: {
    'local-rules': {
      'local-path': './eslint-rules',
    },
  },
};
