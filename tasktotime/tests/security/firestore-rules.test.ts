/**
 * Firestore Security Rules Tests — tasktotime_tasks + tasktotime_transitions
 *
 * Verifies the tasktotime rules block fixes the gtd_tasks public-read security
 * hole and enforces company-scoping per spec/04-storage/rules.md.
 *
 * Run via:
 *   npm run test:security  (or jest tasktotime.rules.test.ts)
 *
 * Requires Firebase emulator on localhost:8080 (loaded by test setup).
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { setLogLevel } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

setLogLevel('error');

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'profit-step-tasktotime-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ───────────────────────────────────────────────────────────────────────────
// Test fixtures
// ───────────────────────────────────────────────────────────────────────────

const COMPANY_A = 'company_A';
const COMPANY_B = 'company_B';

const USER_A_OWNER = 'user_A_owner';
const USER_A_ASSIGNEE = 'user_A_assignee';
const USER_A_REVIEWER = 'user_A_reviewer';
const USER_A_MANAGER = 'user_A_manager';
const USER_A_RANDOM = 'user_A_random';
const USER_A_ADMIN = 'user_A_admin';
const USER_B_RANDOM = 'user_B_random';

const TASK_A_ID = 'task_in_company_A';

/** Seed users + a task owned by company A. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // Users
    await db.doc(`users/${USER_A_OWNER}`).set({
      companyId: COMPANY_A,
      role: 'employee',
      hierarchyPath: [USER_A_OWNER, USER_A_MANAGER],
    });
    await db.doc(`users/${USER_A_ASSIGNEE}`).set({
      companyId: COMPANY_A,
      role: 'employee',
      hierarchyPath: [USER_A_ASSIGNEE, USER_A_MANAGER],
    });
    await db.doc(`users/${USER_A_REVIEWER}`).set({
      companyId: COMPANY_A,
      role: 'employee',
      hierarchyPath: [USER_A_REVIEWER, USER_A_MANAGER],
    });
    await db.doc(`users/${USER_A_MANAGER}`).set({
      companyId: COMPANY_A,
      role: 'manager',
      hierarchyPath: [USER_A_MANAGER],
    });
    await db.doc(`users/${USER_A_RANDOM}`).set({
      companyId: COMPANY_A,
      role: 'employee',
      hierarchyPath: [USER_A_RANDOM],
    });
    await db.doc(`users/${USER_A_ADMIN}`).set({
      companyId: COMPANY_A,
      role: 'admin',
      hierarchyPath: [USER_A_ADMIN],
    });
    await db.doc(`users/${USER_B_RANDOM}`).set({
      companyId: COMPANY_B,
      role: 'employee',
      hierarchyPath: [USER_B_RANDOM],
    });
    // Task in company A
    await db.doc(`tasktotime_tasks/${TASK_A_ID}`).set({
      companyId: COMPANY_A,
      title: 'Demo bathroom',
      lifecycle: 'ready',
      createdBy: { id: USER_A_OWNER, name: 'Owner' },
      assignedTo: { id: USER_A_ASSIGNEE, name: 'Assignee' },
      reviewedBy: { id: USER_A_REVIEWER, name: 'Reviewer' },
    });
  });
}

const ctx = (uid: string) => testEnv.authenticatedContext(uid).firestore();

// ───────────────────────────────────────────────────────────────────────────
// READ access
// ───────────────────────────────────────────────────────────────────────────

describe('tasktotime_tasks: READ', () => {
  it('ALLOWS same-company employee to read', async () => {
    await seed();
    await assertSucceeds(ctx(USER_A_RANDOM).doc(`tasktotime_tasks/${TASK_A_ID}`).get());
  });

  it('DENIES cross-company read (fixes gtd_tasks public-read bug)', async () => {
    await seed();
    await assertFails(ctx(USER_B_RANDOM).doc(`tasktotime_tasks/${TASK_A_ID}`).get());
  });

  it('DENIES unauthenticated read', async () => {
    await seed();
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(anon.doc(`tasktotime_tasks/${TASK_A_ID}`).get());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CREATE access
// ───────────────────────────────────────────────────────────────────────────

describe('tasktotime_tasks: CREATE', () => {
  beforeEach(seed);

  it('ALLOWS create with own companyId + own createdBy.id', async () => {
    await assertSucceeds(
      ctx(USER_A_OWNER).doc('tasktotime_tasks/new1').set({
        companyId: COMPANY_A,
        title: 'New task',
        createdBy: { id: USER_A_OWNER, name: 'Owner' },
        assignedTo: { id: USER_A_ASSIGNEE, name: 'Assignee' },
      }),
    );
  });

  it('DENIES create with foreign companyId', async () => {
    await assertFails(
      ctx(USER_A_OWNER).doc('tasktotime_tasks/new2').set({
        companyId: COMPANY_B,
        title: 'Cross-tenant attack',
        createdBy: { id: USER_A_OWNER, name: 'Owner' },
        assignedTo: { id: USER_A_OWNER, name: 'Owner' },
      }),
    );
  });

  it('DENIES create with spoofed createdBy.id', async () => {
    await assertFails(
      ctx(USER_A_OWNER).doc('tasktotime_tasks/new3').set({
        companyId: COMPANY_A,
        title: 'Spoofed creator',
        createdBy: { id: 'someone_else', name: 'Fake' },
        assignedTo: { id: USER_A_ASSIGNEE, name: 'Assignee' },
      }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// UPDATE access — multiple roles per spec/04-storage/rules.md
// ───────────────────────────────────────────────────────────────────────────

describe('tasktotime_tasks: UPDATE', () => {
  beforeEach(seed);

  it('ALLOWS createdBy to update', async () => {
    await assertSucceeds(
      ctx(USER_A_OWNER).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ title: 'Updated by owner' }),
    );
  });

  it('ALLOWS assignedTo to update', async () => {
    await assertSucceeds(
      ctx(USER_A_ASSIGNEE).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ lifecycle: 'started' }),
    );
  });

  it('ALLOWS reviewedBy to update (NEW in v0.2)', async () => {
    await assertSucceeds(
      ctx(USER_A_REVIEWER).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ lifecycle: 'accepted' }),
    );
  });

  it('ALLOWS manager via hierarchyPath to update', async () => {
    await assertSucceeds(
      ctx(USER_A_MANAGER).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ priority: 'high' }),
    );
  });

  it('ALLOWS admin to update', async () => {
    await assertSucceeds(
      ctx(USER_A_ADMIN).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ archivedAt: Date.now() }),
    );
  });

  it('DENIES random same-company user (not in any role)', async () => {
    await assertFails(
      ctx(USER_A_RANDOM).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ title: 'Hijack' }),
    );
  });

  it('DENIES cross-company user', async () => {
    await assertFails(
      ctx(USER_B_RANDOM).doc(`tasktotime_tasks/${TASK_A_ID}`).update({ title: 'Cross-tenant' }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DELETE access — admin only
// ───────────────────────────────────────────────────────────────────────────

describe('tasktotime_tasks: DELETE', () => {
  beforeEach(seed);

  it('ALLOWS admin to physically delete', async () => {
    await assertSucceeds(ctx(USER_A_ADMIN).doc(`tasktotime_tasks/${TASK_A_ID}`).delete());
  });

  it('DENIES owner physical delete (must use soft-delete via update)', async () => {
    await assertFails(ctx(USER_A_OWNER).doc(`tasktotime_tasks/${TASK_A_ID}`).delete());
  });

  it('DENIES manager physical delete', async () => {
    await assertFails(ctx(USER_A_MANAGER).doc(`tasktotime_tasks/${TASK_A_ID}`).delete());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Subcollection wiki_history — read-only for clients
// ───────────────────────────────────────────────────────────────────────────

describe('tasktotime_tasks/{taskId}/wiki_history', () => {
  beforeEach(async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context
        .firestore()
        .doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v1`)
        .set({ version: 1, contentMd: '# Initial' });
    });
  });

  it('ALLOWS same-company read', async () => {
    await assertSucceeds(
      ctx(USER_A_RANDOM).doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v1`).get(),
    );
  });

  it('DENIES cross-company read', async () => {
    await assertFails(
      ctx(USER_B_RANDOM).doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v1`).get(),
    );
  });

  it('DENIES any client write (server-only writes)', async () => {
    await assertFails(
      ctx(USER_A_OWNER)
        .doc(`tasktotime_tasks/${TASK_A_ID}/wiki_history/v2`)
        .set({ version: 2, contentMd: '# Hacked' }),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// tasktotime_transitions — append-only audit log
// ───────────────────────────────────────────────────────────────────────────

describe('tasktotime_transitions', () => {
  beforeEach(async () => {
    await seed();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`tasktotime_transitions/t1`).set({
        companyId: COMPANY_A,
        taskId: TASK_A_ID,
        action: 'start',
        from: 'ready',
        to: 'started',
        at: Date.now(),
      });
    });
  });

  it('ALLOWS same-company read', async () => {
    await assertSucceeds(ctx(USER_A_RANDOM).doc('tasktotime_transitions/t1').get());
  });

  it('DENIES cross-company read', async () => {
    await assertFails(ctx(USER_B_RANDOM).doc('tasktotime_transitions/t1').get());
  });

  it('DENIES any client write', async () => {
    await assertFails(
      ctx(USER_A_ADMIN).doc('tasktotime_transitions/t2').set({
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
