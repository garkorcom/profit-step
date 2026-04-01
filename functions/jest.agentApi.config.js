/** Jest config for Agent API tests (supertest + Firestore Emulator) */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/agentApi'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testTimeout: 30000,
  forceExit: true,
  maxWorkers: 1, // Sequential — tests share Firestore emulator
  // setupFiles runs BEFORE module imports — critical for env vars
  setupFiles: ['<rootDir>/test/agentApi/jest.env.ts'],
  globals: {
    'ts-jest': {
      tsconfig: {
        module: 'commonjs',
      },
    },
  },
};
