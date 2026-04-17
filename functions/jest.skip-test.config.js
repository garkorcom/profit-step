/**
 * Config for pure-mock unit tests that don't need the Firestore emulator
 * or the global setup.ts (which has a pre-existing firebase-functions-test
 * import chain bug). Use via:
 *   npx jest --config jest.skip-test.config.js test/mediaHandlerSkip.test.ts
 */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/test'],
    testMatch: ['**/?(*.)+(spec|test).ts'],
    transform: { '^.+\\.ts$': 'ts-jest' },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testTimeout: 15000,
    forceExit: true,
    // Intentionally no setupFilesAfterEnv — keeps this config self-contained.
    globals: {
        'ts-jest': {
            tsconfig: { module: 'commonjs' },
        },
    },
};
