/**
 * Firestore Security Rules Tests
 *
 * TEST CASE #5: Company Admin Isolation
 * TEST CASE #6: User Data Isolation
 * TEST CASE #7: Super Admin Access
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

// Suppress logs
setLogLevel('error');

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'profit-step-test',
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

// ===========================================================================
// TEST CASE #5: Company Admin Isolation
// ===========================================================================

describe('TEST CASE #5: Company Admin Isolation', () => {
  it('should DENY cross-company activityLog access', async () => {
    // Seed data for Company B
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('activityLog')
        .doc('log1')
        .set({
          companyId: 'company_B',
          userId: 'user_B_1',
          action: 'login',
          timestamp: new Date(),
        });
    });

    // Try to read as Company A admin
    const companyAContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const queryAttempt = companyAContext
      .firestore()
      .collection('activityLog')
      .where('companyId', '==', 'company_B')
      .get();

    await assertFails(queryAttempt); // ❌ Should be DENIED
  });

  it('should ALLOW same-company activityLog access', async () => {
    // Seed data for Company A
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('activityLog')
        .doc('log2')
        .set({
          companyId: 'company_A',
          userId: 'user_A_1',
          action: 'login',
          timestamp: new Date(),
        });
    });

    // Try to read as Company A admin
    const companyAContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const queryAttempt = companyAContext
      .firestore()
      .collection('activityLog')
      .where('companyId', '==', 'company_A')
      .get();

    await assertSucceeds(queryAttempt); // ✅ Should be ALLOWED
  });

  it('should DENY cross-company user access', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('users')
        .doc('user_B_1')
        .set({
          id: 'user_B_1',
          email: 'user@companyB.com',
          companyId: 'company_B',
          role: 'user',
        });
    });

    const companyAContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const readAttempt = companyAContext
      .firestore()
      .collection('users')
      .doc('user_B_1')
      .get();

    await assertFails(readAttempt); // ❌ Should be DENIED
  });

  it('should DENY cross-company invitations access', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('invitations')
        .doc('inv_B_1')
        .set({
          email: 'invite@companyB.com',
          companyId: 'company_B',
          status: 'pending',
        });
    });

    const companyAContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const queryAttempt = companyAContext
      .firestore()
      .collection('invitations')
      .where('companyId', '==', 'company_B')
      .get();

    await assertFails(queryAttempt); // ❌ Should be DENIED
  });
});

// ===========================================================================
// TEST CASE #6: User Data Isolation
// ===========================================================================

describe('TEST CASE #6: User Data Isolation', () => {
  it('should DENY reading other user activation data', async () => {
    // Seed activation data for another user
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('userActivation')
        .doc('other_user_id')
        .set({
          userId: 'other_user_id',
          companyId: 'company_A',
          signupCompleted: true,
          emailVerified: true,
        });
    });

    // Try to read as different user
    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const readAttempt = userContext
      .firestore()
      .collection('userActivation')
      .doc('other_user_id')
      .get();

    await assertFails(readAttempt); // ❌ Should be DENIED
  });

  it('should ALLOW reading own activation data', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('userActivation')
        .doc('user123')
        .set({
          userId: 'user123',
          companyId: 'company_A',
          signupCompleted: true,
          emailVerified: false,
        });
    });

    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const readAttempt = userContext
      .firestore()
      .collection('userActivation')
      .doc('user123')
      .get();

    await assertSucceeds(readAttempt); // ✅ Should be ALLOWED
  });

  it('should DENY regular user from reading company activityLog', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('activityLog')
        .doc('log1')
        .set({
          companyId: 'company_A',
          userId: 'other_user',
          action: 'login',
        });
    });

    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const queryAttempt = userContext
      .firestore()
      .collection('activityLog')
      .where('companyId', '==', 'company_A')
      .get();

    await assertFails(queryAttempt); // ❌ Regular users can't read activity logs
  });

  it('should ALLOW user to read their own profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('users')
        .doc('user123')
        .set({
          id: 'user123',
          email: 'user@test.com',
          companyId: 'company_A',
          role: 'user',
        });
    });

    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const readAttempt = userContext
      .firestore()
      .collection('users')
      .doc('user123')
      .get();

    await assertSucceeds(readAttempt); // ✅ Users can read their own profile
  });
});

// ===========================================================================
// TEST CASE #7: Super Admin Access
// ===========================================================================

describe('TEST CASE #7: Super Admin Access', () => {
  it('should ALLOW super admin to read systemErrors', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('systemErrors')
        .doc('error1')
        .set({
          timestamp: new Date(),
          errorType: 'timeout',
          functionName: 'testFunction',
          message: 'Test error',
        });
    });

    const superAdminContext = testEnv.authenticatedContext('super_admin_1', {
      role: 'super_admin',
    });

    const readAttempt = superAdminContext
      .firestore()
      .collection('systemErrors')
      .doc('error1')
      .get();

    await assertSucceeds(readAttempt); // ✅ Should be ALLOWED
  });

  it('should ALLOW super admin to read all costReports', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('costReports')
        .doc('2025-01-15')
        .set({
          date: new Date('2025-01-15'),
          totalCost: 100.50,
          breakdown: {},
        });
    });

    const superAdminContext = testEnv.authenticatedContext('super_admin_1', {
      role: 'super_admin',
    });

    const queryAttempt = superAdminContext
      .firestore()
      .collection('costReports')
      .get();

    await assertSucceeds(queryAttempt); // ✅ Should be ALLOWED
  });

  it('should ALLOW super admin to read growthMetrics', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('growthMetrics')
        .doc('2025-01-15')
        .set({
          date: new Date('2025-01-15'),
          newUsers: 10,
          newCompanies: 2,
        });
    });

    const superAdminContext = testEnv.authenticatedContext('super_admin_1', {
      role: 'super_admin',
    });

    const queryAttempt = superAdminContext
      .firestore()
      .collection('growthMetrics')
      .get();

    await assertSucceeds(queryAttempt); // ✅ Should be ALLOWED
  });

  it('should ALLOW super admin to read engagementMetrics', async () => {
    const superAdminContext = testEnv.authenticatedContext('super_admin_1', {
      role: 'super_admin',
    });

    const queryAttempt = superAdminContext
      .firestore()
      .collection('engagementMetrics')
      .get();

    await assertSucceeds(queryAttempt); // ✅ Should be ALLOWED
  });

  it('should DENY regular admin from reading systemErrors', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection('systemErrors')
        .doc('error1')
        .set({
          timestamp: new Date(),
          errorType: 'timeout',
        });
    });

    const adminContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const readAttempt = adminContext
      .firestore()
      .collection('systemErrors')
      .doc('error1')
      .get();

    await assertFails(readAttempt); // ❌ Should be DENIED
  });

  it('should DENY regular admin from reading costReports', async () => {
    const adminContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const queryAttempt = adminContext
      .firestore()
      .collection('costReports')
      .get();

    await assertFails(queryAttempt); // ❌ Should be DENIED
  });

  it('should DENY regular user from reading growthMetrics', async () => {
    const userContext = testEnv.authenticatedContext('user123', {
      companyId: 'company_A',
      role: 'user',
    });

    const queryAttempt = userContext
      .firestore()
      .collection('growthMetrics')
      .get();

    await assertFails(queryAttempt); // ❌ Should be DENIED
  });
});

// ===========================================================================
// Additional Security Tests
// ===========================================================================

describe('Additional Security Tests', () => {
  it('should DENY unauthenticated access to any collection', async () => {
    const unauthedContext = testEnv.unauthenticatedContext();

    const readAttempt = unauthedContext
      .firestore()
      .collection('users')
      .doc('any_user')
      .get();

    await assertFails(readAttempt); // ❌ Should be DENIED
  });

  it('should DENY write access to metrics collections', async () => {
    const adminContext = testEnv.authenticatedContext('admin_company_A', {
      companyId: 'company_A',
      role: 'admin',
    });

    const writeAttempt = adminContext
      .firestore()
      .collection('growthMetrics')
      .doc('2025-01-15')
      .set({
        newUsers: 999,
      });

    await assertFails(writeAttempt); // ❌ Only cloud functions should write
  });
});
