/** Jest config for integration tests (no Firebase emulator needed) */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    testMatch: ['**/*.integration.test.ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testTimeout: 15000,
    // NO setupFilesAfterEnv — integration tests mock everything internally
    globals: {
        'ts-jest': {
            tsconfig: {
                module: 'commonjs',
            },
        },
    },
};
