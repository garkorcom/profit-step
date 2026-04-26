/**
 * Jest config for tasktotime module — pure unit tests only.
 *
 * Used standalone (faster than rooting from project root):
 *   npx jest --config tasktotime/jest.config.js
 *
 * Or integrated via root jest.config.js `projects: [...]`.
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  // Pure unit tests — no setup files, no mocks of MUI/firebase.
  globals: {},
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        diagnostics: false,
      },
    ],
  },
  collectCoverageFrom: [
    '<rootDir>/domain/**/*.ts',
    '<rootDir>/ports/**/*.ts',
    '<rootDir>/application/**/*.ts',
    '!**/*.d.ts',
    '!**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: 5000,
};
