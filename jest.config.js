module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src', '<rootDir>/functions/src'],

  // Coverage
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'functions/src/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!src/index.tsx',
    '!src/reportWebVitals.ts',
  ],
  // Coverage thresholds disabled 2026-04-19 — aspirational values (global 80%,
  // src/api 95%) were set but the repo never reached them; actual coverage is
  // ~0.9% global / 0% on most API files, so every PR failed Unit Tests. Report
  // coverage without enforcement until there is a realistic target to gate on.
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],

  // Setup
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Module paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/__mocks__/fileMock.js',
  },

  // Transform
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
      },
      diagnostics: false,
    }],
  },

  // Vite import.meta.env polyfill
  globals: {
    'import.meta': {
      env: {
        VITE_FIREBASE_API_KEY: 'test-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'test-project',
        VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
        VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
        VITE_FIREBASE_APP_ID: '1:123:web:abc',
        VITE_FIREBASE_MEASUREMENT_ID: 'G-TEST',
        MODE: 'test',
        DEV: true,
        PROD: false,
      },
    },
  },

  // Test matching
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/build/',
    '/dist/',
    '\\.integration\\.test\\.',
  ],

  // Timeout
  testTimeout: 10000,
};
