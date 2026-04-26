/**
 * Jest config for tasktotime security rules tests.
 *
 * Separate from the unit-test jest.config.js because these need:
 *   - Firebase emulator running on localhost:8080 (use `firebase emulators:exec`)
 *   - Longer test timeout (emulator round-trips)
 *   - Different rootDir scope (test reads firestore.rules from repo root)
 *
 * Run via:
 *   firebase emulators:exec --only firestore 'npm run test:security:tasktotime'
 */

const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.resolve(__dirname, '..'), // repo root — needed to read firestore.rules
  roots: ['<rootDir>/tasktotime/tests/security'],
  testMatch: ['<rootDir>/tasktotime/tests/security/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'CommonJS',
          esModuleInterop: true,
          strict: false, // less strict for test code
        },
        diagnostics: false,
      },
    ],
  },
  testTimeout: 10000,
};
