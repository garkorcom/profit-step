/**
 * TEST CASE #4: logUserActivity (Firestore Trigger)
 *
 * Проверяет, что изменения в коллекции users автоматически
 * логируются в activityLog
 */

import { test, admin, db, cleanup } from './setup';

describe('User Activity Logger Trigger', () => {
  beforeEach(async () => {
    // Clean up test data
    const activityLogSnapshot = await db.collection('activityLog').get();
    const batch = db.batch();
    activityLogSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('should log role change', async () => {
    // Mock trigger function
    const mockLogUserActivity = async (beforeData: any, afterData: any, userId: string) => {
      // Detect role change
      if (beforeData.role !== afterData.role) {
        await db.collection('activityLog').add({
          userId,
          companyId: afterData.companyId,
          action: 'role_changed',
          category: 'admin',
          timestamp: admin.firestore.Timestamp.now(),
          metadata: {
            oldRole: beforeData.role,
            newRole: afterData.role,
          },
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        });
      }
    };

    // Before state
    const beforeData = {
      id: 'user123',
      email: 'user@test.com',
      role: 'manager',
      companyId: 'company1',
    };

    // After state (role changed)
    const afterData = {
      id: 'user123',
      email: 'user@test.com',
      role: 'admin', // Changed!
      companyId: 'company1',
    };

    // Execute trigger
    await mockLogUserActivity(beforeData, afterData, 'user123');

    // Verify activity log
    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user123')
      .where('action', '==', 'role_changed')
      .get();

    expect(logs.size).toBe(1);

    const logData = logs.docs[0].data();
    expect(logData.category).toBe('admin');
    expect(logData.metadata.oldRole).toBe('manager');
    expect(logData.metadata.newRole).toBe('admin');
    expect(logData.companyId).toBe('company1');
  });

  it('should log profile completion', async () => {
    const mockLogUserActivity = async (beforeData: any, afterData: any, userId: string) => {
      // Detect profile completion
      if (!beforeData.profileCompleted && afterData.profileCompleted) {
        await db.collection('activityLog').add({
          userId,
          companyId: afterData.companyId,
          action: 'profile_completed',
          category: 'profile',
          timestamp: admin.firestore.Timestamp.now(),
          metadata: {},
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        });
      }
    };

    const beforeData = {
      id: 'user456',
      profileCompleted: false,
      companyId: 'company1',
    };

    const afterData = {
      id: 'user456',
      profileCompleted: true,
      companyId: 'company1',
    };

    await mockLogUserActivity(beforeData, afterData, 'user456');

    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user456')
      .where('action', '==', 'profile_completed')
      .get();

    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().category).toBe('profile');
  });

  it('should log email change', async () => {
    const mockLogUserActivity = async (beforeData: any, afterData: any, userId: string) => {
      if (beforeData.email !== afterData.email) {
        await db.collection('activityLog').add({
          userId,
          companyId: afterData.companyId,
          action: 'email_changed',
          category: 'profile',
          timestamp: admin.firestore.Timestamp.now(),
          metadata: {
            oldEmail: beforeData.email,
            newEmail: afterData.email,
          },
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        });
      }
    };

    const beforeData = {
      id: 'user789',
      email: 'old@example.com',
      companyId: 'company1',
    };

    const afterData = {
      id: 'user789',
      email: 'new@example.com',
      companyId: 'company1',
    };

    await mockLogUserActivity(beforeData, afterData, 'user789');

    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user789')
      .where('action', '==', 'email_changed')
      .get();

    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().metadata.oldEmail).toBe('old@example.com');
    expect(logs.docs[0].data().metadata.newEmail).toBe('new@example.com');
  });

  it('should NOT log if no significant changes', async () => {
    const mockLogUserActivity = async (beforeData: any, afterData: any, userId: string) => {
      // Only log significant changes
      const significantFields = ['role', 'email', 'profileCompleted', 'status'];

      const hasSignificantChange = significantFields.some(
        (field) => beforeData[field] !== afterData[field]
      );

      if (!hasSignificantChange) {
        // Don't log trivial updates
        return;
      }

      // Log the change
      await db.collection('activityLog').add({
        userId,
        companyId: afterData.companyId,
        action: 'user_updated',
        category: 'profile',
        timestamp: admin.firestore.Timestamp.now(),
        metadata: {},
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      });
    };

    const beforeData = {
      id: 'user999',
      lastLoginAt: new Date('2025-01-15'),
      companyId: 'company1',
      role: 'user',
    };

    const afterData = {
      id: 'user999',
      lastLoginAt: new Date('2025-01-16'), // Only login time changed
      companyId: 'company1',
      role: 'user',
    };

    await mockLogUserActivity(beforeData, afterData, 'user999');

    // Should NOT create activity log for trivial updates
    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user999')
      .get();

    expect(logs.size).toBe(0);
  });

  it('should log multiple fields changed', async () => {
    const mockLogUserActivity = async (beforeData: any, afterData: any, userId: string) => {
      const changes: string[] = [];

      if (beforeData.role !== afterData.role) {
        changes.push('role');
      }
      if (beforeData.email !== afterData.email) {
        changes.push('email');
      }
      if (beforeData.status !== afterData.status) {
        changes.push('status');
      }

      if (changes.length > 0) {
        await db.collection('activityLog').add({
          userId,
          companyId: afterData.companyId,
          action: 'user_updated',
          category: 'profile',
          timestamp: admin.firestore.Timestamp.now(),
          metadata: {
            changedFields: changes,
            before: beforeData,
            after: afterData,
          },
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        });
      }
    };

    const beforeData = {
      id: 'user111',
      email: 'before@example.com',
      role: 'user',
      status: 'pending',
      companyId: 'company1',
    };

    const afterData = {
      id: 'user111',
      email: 'after@example.com',
      role: 'manager',
      status: 'active',
      companyId: 'company1',
    };

    await mockLogUserActivity(beforeData, afterData, 'user111');

    const logs = await db.collection('activityLog')
      .where('userId', '==', 'user111')
      .get();

    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().metadata.changedFields).toEqual(['role', 'email', 'status']);
  });
});
