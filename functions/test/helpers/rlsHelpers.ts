/**
 * @fileoverview rlsHelpers — shared scaffolding for Firestore-rules-emulator
 * tests in `functions/test/rlsCrossTenant.test.ts` and friends.
 *
 * These helpers wrap `@firebase/rules-unit-testing` so each test can:
 *   - boot a `RulesTestEnvironment` against the project's compiled
 *     `firestore.rules` file (resolved from repo root regardless of CWD)
 *   - seed canonical company-scoped users (companyA / companyB)
 *   - bypass rules during seeding (`testEnv.withSecurityRulesDisabled`)
 *   - get an authed Firestore client for a given uid (`authedAs`)
 *   - get an unauthed client (`unauthed`)
 *
 * Why a thin wrapper rather than copy/paste per file:
 *   - The repo's `firestore.rules` lives at the workspace root, but Jest may
 *     be invoked from `functions/`. Reading it via `path.resolve(__dirname,
 *     '..', '..', '..', 'firestore.rules')` is brittle, so we walk up until
 *     we find the file. This mirrors the convention used by the existing
 *     `tasktotime/tests/security/firestore-rules.test.ts`.
 *   - User documents (with `companyId`, `role`, `hierarchyPath`) are
 *     read by many `firestore.rules` predicates (e.g. `getUserCompany()`,
 *     `isAdmin()`). Tests that forget to seed them silently look "denied"
 *     for the wrong reason. `seedUsers()` keeps that consistent.
 *
 * The helpers are imported by tests that need the Firestore emulator on
 * `localhost:8080`. When the emulator is unreachable, callers gate their
 * suites with `describeIfEmulator` (defined inline in the test file).
 */

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

/** Walk parents from `__dirname` until we find `firestore.rules`. */
function findFirestoreRulesPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'firestore.rules');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback to common locations relative to functions/test/helpers/
  const fallbacks = [
    resolve(__dirname, '..', '..', '..', 'firestore.rules'),
    resolve(process.cwd(), 'firestore.rules'),
  ];
  for (const c of fallbacks) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    'rlsHelpers: could not locate firestore.rules. Searched parents of ' +
      __dirname +
      ' and ' +
      fallbacks.join(', '),
  );
}

/**
 * Boot the rules test environment against the repo's `firestore.rules`.
 * Uses a fresh, distinct projectId per call so concurrent suites do not
 * collide on the emulator's per-project state.
 */
export async function makeRulesEnv(opts: {
  projectId?: string;
} = {}): Promise<RulesTestEnvironment> {
  const projectId =
    opts.projectId ??
    `pst-rls-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const rulesPath = findFirestoreRulesPath();
  return await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(rulesPath, 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
}

// ─── Canonical company-scoped users ───────────────────────────────────

export const COMPANY_A = 'company_A';
export const COMPANY_B = 'company_B';

export const USER_A_ADMIN = 'user_A_admin';
export const USER_A_OWNER = 'user_A_owner';
export const USER_A_ASSIGNEE = 'user_A_assignee';
export const USER_A_REVIEWER = 'user_A_reviewer';
export const USER_A_MANAGER = 'user_A_manager';
export const USER_A_RANDOM = 'user_A_random';
export const USER_B_ADMIN = 'user_B_admin';
export const USER_B_RANDOM = 'user_B_random';

interface SeedUserSpec {
  uid: string;
  companyId: string;
  role: 'employee' | 'manager' | 'admin' | 'superadmin';
  hierarchyPath?: string[];
}

export const DEFAULT_USERS: SeedUserSpec[] = [
  { uid: USER_A_ADMIN, companyId: COMPANY_A, role: 'admin', hierarchyPath: [USER_A_ADMIN] },
  {
    uid: USER_A_OWNER,
    companyId: COMPANY_A,
    role: 'employee',
    hierarchyPath: [USER_A_OWNER, USER_A_MANAGER],
  },
  {
    uid: USER_A_ASSIGNEE,
    companyId: COMPANY_A,
    role: 'employee',
    hierarchyPath: [USER_A_ASSIGNEE, USER_A_MANAGER],
  },
  {
    uid: USER_A_REVIEWER,
    companyId: COMPANY_A,
    role: 'employee',
    hierarchyPath: [USER_A_REVIEWER, USER_A_MANAGER],
  },
  {
    uid: USER_A_MANAGER,
    companyId: COMPANY_A,
    role: 'manager',
    hierarchyPath: [USER_A_MANAGER],
  },
  { uid: USER_A_RANDOM, companyId: COMPANY_A, role: 'employee', hierarchyPath: [USER_A_RANDOM] },
  { uid: USER_B_ADMIN, companyId: COMPANY_B, role: 'admin', hierarchyPath: [USER_B_ADMIN] },
  { uid: USER_B_RANDOM, companyId: COMPANY_B, role: 'employee', hierarchyPath: [USER_B_RANDOM] },
];

/** Seed `users/{uid}` documents needed by `firestore.rules` helpers. */
export async function seedUsers(
  env: RulesTestEnvironment,
  users: SeedUserSpec[] = DEFAULT_USERS,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const u of users) {
      await db.doc(`users/${u.uid}`).set({
        companyId: u.companyId,
        role: u.role,
        status: 'active',
        hierarchyPath: u.hierarchyPath ?? [u.uid],
      });
    }
  });
}

/** Seed an arbitrary doc with rules disabled (for fixtures inside specific tests). */
export async function seedDoc(
  env: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(path).set(data);
  });
}

/** Authenticated client for a given uid. */
export function authedAs(env: RulesTestEnvironment, uid: string): RulesTestContext {
  return env.authenticatedContext(uid);
}

/** Unauthenticated client. */
export function unauthed(env: RulesTestEnvironment): RulesTestContext {
  return env.unauthenticatedContext();
}
