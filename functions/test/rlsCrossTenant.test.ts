/**
 * @fileoverview rlsCrossTenant.test.ts — Firestore rules emulator tests.
 *
 * Spec source of truth:
 *   - tasktotime/spec/04-storage/rules.md:114-127 (cross-tenant RLS smoke test
 *     contract)
 *   - tasktotime/spec/11-success-metrics.md:23 ("Cross-tenant RLS test
 *     PASSES — was not run regularly per CLAUDE.md §4")
 *
 * Coverage:
 *   1. tasktotime_tasks
 *      - read scoped by companyId (denies cross-tenant)
 *      - create requires own companyId AND own createdBy.id (no spoofing)
 *      - update permitted for creator/assignee/reviewer/manager/admin only,
 *        all gated by same-company; cross-tenant always denied
 *      - delete: admin only (others denied)
 *   2. tasktotime_tasks/{taskId}/wiki_history/{vId}
 *      - read scoped by parent task's companyId
 *      - write permanently denied (server-only path)
 *   3. tasktotime_transitions
 *      - read scoped by companyId
 *      - write permanently denied (append-only via server-side writes)
 *   4. work_sessions  ← cross-tenant gap CLOSED in fix/work-sessions-cross-tenant-rls
 *      - read scoped by companyId (denies cross-tenant)
 *      - delete remains hard-denied (server-only via Admin SDK)
 *      - unauthenticated read denied (sanity check)
 *
 * Runtime gating:
 *   These tests need the Firestore rules emulator on `localhost:8080`. We
 *   probe reachability at module load (synchronous TCP probe), then either
 *   use `describe` (when reachable) or `describe.skip` (graceful CI skip).
 *
 *   Run via:
 *
 *       firebase emulators:exec --only firestore \
 *         'npm --prefix functions test -- rlsCrossTenant'
 *
 * @see functions/test/rlsCrossTenantRoutes.test.ts — separate suite for
 *      route-layer (HTTP) RLS via `jest.mock('firebase-admin')`.
 */

import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';
import { execSync } from 'child_process';

import {
  COMPANY_A,
  USER_A_ADMIN,
  USER_A_ASSIGNEE,
  USER_A_MANAGER,
  USER_A_OWNER,
  USER_A_RANDOM,
  USER_A_REVIEWER,
  USER_B_ADMIN,
  USER_B_RANDOM,
  authedAs,
  makeRulesEnv,
  seedDoc,
  seedUsers,
  unauthed,
} from './helpers/rlsHelpers';

// ─── Synchronous emulator availability probe ────────────────────────────
//
// `describe.skip` must be decided at module-load time because Jest does not
// allow conditionally producing different describe trees from inside an
// async beforeAll hook. We use a sync `nc -z localhost 8080`-style probe via
// `execSync`, which is fast (~5-30ms) and only runs once per file load.

function isEmulatorReachableSync(): boolean {
  try {
    // `nc -z` returns 0 if the port is open. We give it a 1-second budget.
    // On macOS/Linux nc is preinstalled. If absent, we fall back to false
    // (suite skipped), which is the safer default for CI.
    execSync('nc -z localhost 8080', {
      stdio: 'ignore',
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

const HAS_EMULATOR = isEmulatorReachableSync();
const describeIfEmulator: typeof describe = HAS_EMULATOR
  ? describe
  : (describe.skip as typeof describe);

if (!HAS_EMULATOR) {
  // eslint-disable-next-line no-console
  console.warn(
    '[rlsCrossTenant] Firestore emulator not reachable on localhost:8080; ' +
      'suite skipped. Run with: ' +
      'firebase emulators:exec --only firestore "npm --prefix functions test -- rlsCrossTenant"',
  );
}

// ─── Shared environment lifecycle ───────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  if (!HAS_EMULATOR) return;
  setLogLevel('error');
  testEnv = await makeRulesEnv({
    projectId: 'profit-step-rls-cross-tenant',
  });
});

afterAll(async () => {
  if (!HAS_EMULATOR || !testEnv) return;
  await testEnv.cleanup();
});

beforeEach(async () => {
  if (!HAS_EMULATOR || !testEnv) return;
  await testEnv.clearFirestore();
  await seedUsers(testEnv);
});

// ─── Fixtures ────────────────────────────────────────────────────────────

const TASK_A_ID = 'task_in_company_A';
const TASK_B_ID = 'task_in_company_B';

async function seedTasks(): Promise<void> {
  await seedDoc(testEnv, `tasktotime_tasks/${TASK_A_ID}`, {
    companyId: COMPANY_A,
    title: 'Demo bathroom (A)',
    lifecycle: 'ready',
    createdBy: { id: USER_A_OWNER, name: 'Owner A' },
    assignedTo: { id: USER_A_ASSIGNEE, name: 'Assignee A' },
    reviewedBy: { id: USER_A_REVIEWER, name: 'Reviewer A' },
  });
  await seedDoc(testEnv, `tasktotime_tasks/${TASK_B_ID}`, {
    companyId: 'company_B',
    title: 'Demo kitchen (B)',
    lifecycle: 'ready',
    createdBy: { id: USER_B_RANDOM, name: 'Owner B' },
    assignedTo: { id: USER_B_RANDOM, name: 'Assignee B' },
  });
}

// ─── tasktotime_tasks — READ ────────────────────────────────────────────

describeIfEmulator('rules: tasktotime_tasks — READ', () => {
  it('ALLOWS same-company employee to read', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .get(),
    );
  });

  it('DENIES cross-company read (companyA user reading companyB task)', async () => {
    await seedTasks();
    await assertFails(
      authedAs(testEnv, USER_A_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_B_ID}`)
        .get(),
    );
  });

  it('DENIES cross-company read (companyB user reading companyA task)', async () => {
    await seedTasks();
    await assertFails(
      authedAs(testEnv, USER_B_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .get(),
    );
  });

  it('DENIES unauthenticated read', async () => {
    await seedTasks();
    await assertFails(
      unauthed(testEnv).firestore().doc(`tasktotime_tasks/${TASK_A_ID}`).get(),
    );
  });
});

// ─── tasktotime_tasks — CREATE ──────────────────────────────────────────

describeIfEmulator('rules: tasktotime_tasks — CREATE', () => {
  it('ALLOWS create with own companyId + own createdBy.id', async () => {
    await assertSucceeds(
      authedAs(testEnv, USER_A_OWNER)
        .firestore()
        .doc('tasktotime_tasks/new_ok')
        .set({
          companyId: COMPANY_A,
          title: 'OK',
          createdBy: { id: USER_A_OWNER, name: 'Owner' },
          assignedTo: { id: USER_A_ASSIGNEE, name: 'Assignee' },
        }),
    );
  });

  it('DENIES create with foreign companyId (cross-tenant attack)', async () => {
    await assertFails(
      authedAs(testEnv, USER_A_OWNER)
        .firestore()
        .doc('tasktotime_tasks/new_xtenant')
        .set({
          companyId: 'company_B',
          title: 'Cross-tenant attack',
          createdBy: { id: USER_A_OWNER, name: 'Owner' },
          assignedTo: { id: USER_A_OWNER, name: 'Owner' },
        }),
    );
  });

  it('DENIES create with spoofed createdBy.id', async () => {
    await assertFails(
      authedAs(testEnv, USER_A_OWNER)
        .firestore()
        .doc('tasktotime_tasks/new_spoof')
        .set({
          companyId: COMPANY_A,
          title: 'Spoofed creator',
          createdBy: { id: 'someone_else', name: 'Fake' },
          assignedTo: { id: USER_A_ASSIGNEE, name: 'Assignee' },
        }),
    );
  });
});

// ─── tasktotime_tasks — UPDATE ──────────────────────────────────────────

describeIfEmulator('rules: tasktotime_tasks — UPDATE', () => {
  it('ALLOWS createdBy to update', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_OWNER)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ title: 'Updated by owner' }),
    );
  });

  it('ALLOWS assignedTo to update', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_ASSIGNEE)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ lifecycle: 'started' }),
    );
  });

  it('ALLOWS reviewedBy to update (NEW in v0.2)', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_REVIEWER)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ lifecycle: 'accepted' }),
    );
  });

  it('ALLOWS manager via hierarchyPath to update', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_MANAGER)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ priority: 'high' }),
    );
  });

  it('ALLOWS admin (same company) to update', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_ADMIN)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ archivedAt: Date.now() }),
    );
  });

  it('DENIES random same-company user (not in any role)', async () => {
    await seedTasks();
    await assertFails(
      authedAs(testEnv, USER_A_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ title: 'Hijack' }),
    );
  });

  it('DENIES cross-company user (companyB user updating companyA task)', async () => {
    await seedTasks();
    await assertFails(
      authedAs(testEnv, USER_B_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ title: 'Cross-tenant' }),
    );
  });

  it('DENIES cross-company admin (admin scope is company-bound)', async () => {
    await seedTasks();
    // Cross-tenant admin escalation path. The rule is structured as
    // `companyId == getUserCompany() && (...)`, so admin role on a different
    // tenant should NOT bypass the companyId scope.
    await assertFails(
      authedAs(testEnv, USER_B_ADMIN)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .update({ title: 'Cross-tenant admin' }),
    );
  });
});

// ─── tasktotime_tasks — DELETE ──────────────────────────────────────────

describeIfEmulator('rules: tasktotime_tasks — DELETE', () => {
  it('ALLOWS admin (same company) to physically delete', async () => {
    await seedTasks();
    await assertSucceeds(
      authedAs(testEnv, USER_A_ADMIN)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .delete(),
    );
  });

  it('DENIES owner physical delete (must use soft-delete via update)', async () => {
    await seedTasks();
    await assertFails(
      authedAs(testEnv, USER_A_OWNER)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .delete(),
    );
  });

  it('DENIES manager physical delete', async () => {
    await seedTasks();
    await assertFails(
      authedAs(testEnv, USER_A_MANAGER)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}`)
        .delete(),
    );
  });
});

// ─── tasktotime_tasks/{id}/wiki_history/{vId} — read scoped, write server-only

describeIfEmulator('rules: tasktotime_tasks/wiki_history', () => {
  beforeEach(async () => {
    await seedTasks();
    await seedDoc(testEnv, `tasktotime_tasks/${TASK_A_ID}/wiki_history/v1`, {
      version: 1,
      contentMd: '# Initial',
    });
  });

  it('ALLOWS same-company read', async () => {
    await assertSucceeds(
      authedAs(testEnv, USER_A_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v1`)
        .get(),
    );
  });

  it('DENIES cross-company read', async () => {
    await assertFails(
      authedAs(testEnv, USER_B_RANDOM)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v1`)
        .get(),
    );
  });

  it('DENIES any client write (server-only writes via Cloud Functions)', async () => {
    await assertFails(
      authedAs(testEnv, USER_A_OWNER)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v2`)
        .set({ version: 2, contentMd: '# Hacked' }),
    );
  });

  it('DENIES even admin direct write to wiki_history', async () => {
    // Admin can update tasks but wiki_history is server-only — admin must go
    // through Cloud Functions (admin SDK bypasses these rules).
    await assertFails(
      authedAs(testEnv, USER_A_ADMIN)
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v3`)
        .set({ version: 3, contentMd: '# By admin' }),
    );
  });
});

// ─── tasktotime_transitions — append-only audit log ─────────────────────

describeIfEmulator('rules: tasktotime_transitions', () => {
  const TR_A = 'transition_in_company_A';

  beforeEach(async () => {
    await seedDoc(testEnv, `tasktotime_transitions/${TR_A}`, {
      companyId: COMPANY_A,
      taskId: TASK_A_ID,
      action: 'start',
      from: 'ready',
      to: 'started',
      at: Date.now(),
    });
  });

  it('ALLOWS same-company read', async () => {
    await assertSucceeds(
      authedAs(testEnv, USER_A_RANDOM)
        .firestore()
        .doc(`tasktotime_transitions/${TR_A}`)
        .get(),
    );
  });

  it('DENIES cross-company read', async () => {
    await assertFails(
      authedAs(testEnv, USER_B_RANDOM)
        .firestore()
        .doc(`tasktotime_transitions/${TR_A}`)
        .get(),
    );
  });

  it('DENIES any client write (server-only via Cloud Functions)', async () => {
    await assertFails(
      authedAs(testEnv, USER_A_ADMIN)
        .firestore()
        .doc('tasktotime_transitions/new_attack')
        .set({
          companyId: COMPANY_A,
          taskId: TASK_A_ID,
          action: 'cancel',
          from: 'started',
          to: 'cancelled',
          at: Date.now(),
        }),
    );
  });
});

// ─── work_sessions — cross-tenant scoping (gap closed) ──────────────────

describeIfEmulator('rules: work_sessions — cross-tenant scoping', () => {
  const WS_A = 'session_in_company_A';

  beforeEach(async () => {
    await seedDoc(testEnv, `work_sessions/${WS_A}`, {
      companyId: COMPANY_A,
      employeeId: USER_A_OWNER,
      startTime: Date.now(),
      status: 'active',
    });
  });

  it('ALLOWS same-company employee to read', async () => {
    await assertSucceeds(
      authedAs(testEnv, USER_A_RANDOM)
        .firestore()
        .doc(`work_sessions/${WS_A}`)
        .get(),
    );
  });

  it('DENIES cross-tenant read (companyB user reading companyA session)', async () => {
    await assertFails(
      authedAs(testEnv, USER_B_RANDOM)
        .firestore()
        .doc(`work_sessions/${WS_A}`)
        .get(),
    );
  });

  it('DENIES cross-tenant read even for cross-company admin', async () => {
    // Admin scope is company-bound — companyB admin must NOT read companyA sessions.
    await assertFails(
      authedAs(testEnv, USER_B_ADMIN)
        .firestore()
        .doc(`work_sessions/${WS_A}`)
        .get(),
    );
  });

  it('DENIES unauthenticated read of work_sessions (sanity check)', async () => {
    await assertFails(
      unauthed(testEnv).firestore().doc(`work_sessions/${WS_A}`).get(),
    );
  });

  it('DENIES delete (unconditionally, even by admin)', async () => {
    await assertFails(
      authedAs(testEnv, USER_A_ADMIN)
        .firestore()
        .doc(`work_sessions/${WS_A}`)
        .delete(),
    );
  });
});
