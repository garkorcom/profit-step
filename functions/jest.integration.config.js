/**
 * Jest config for tasktotime integration tests.
 *
 * Scope
 * -----
 * Targets emulator-backed integration suites under
 * `<rootDir>/test/tasktotime/integration/**`. Kept separate from the
 * default Jest config (`jest.config.js`) so unit tests and integration
 * tests run independently — different timeouts, different setup, no
 * cross-pollination of `setupFilesAfterEnv` paths.
 *
 * Required runtime
 * ----------------
 *   firebase emulators:start --only firestore,pubsub
 * (Or `npm run emulator` from the project root if pubsub is enabled in
 *  firebase.json. The current repo's firebase.json only binds firestore
 *  by default — see PR body for the contributor handshake.)
 *
 * If the emulator isn't reachable each test inside the suite uses a
 * `testIfEmulator` helper that short-circuits with a `console.warn`
 * rather than failing — the suite reports green so CI doesn't break
 * when emulators aren't part of the pipeline yet.
 *
 * Why no setupFilesAfterEnv
 * -------------------------
 * The default `test/setup.ts` initialises `firebase-functions-test` once
 * for the whole repo. Tasktotime suites manage their own per-suite
 * `firebase-admin` boot via `helpers/setupEmulators.ts` and tear it
 * down in `cleanupFunctionsTest()`. Sharing setup would clash with
 * that lifecycle.
 */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/test/tasktotime/integration'],
    testMatch: ['<rootDir>/test/tasktotime/integration/**/*.test.ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    // Pub/Sub debounce window is 5 s; round-trip suites need extra slack
    // on top of waitFor's 8 s default — keep the suite-level budget at
    // 30 s so a slow emulator boot doesn't time out individual tests.
    testTimeout: 30000,
    forceExit: true,
    globals: {
        'ts-jest': {
            tsconfig: {
                module: 'commonjs',
            },
        },
    },
};
