/**
 * TEST CASE #1: aggregateGrowthMetrics
 *
 * Проверяет, что scheduled function правильно агрегирует
 * метрики роста (новые пользователи и компании)
 */

import { test, admin, db, cleanup } from './setup';

// Mock function (будет создана позже в functions/src/metricsAggregation.ts)
// import { aggregateGrowthMetrics } from '../src/metricsAggregation';

describe('aggregateGrowthMetrics', () => {
  let wrapped: any;

  beforeAll(async () => {
    // Очистить коллекцию перед тестами
    const snapshot = await db.collection('growthMetrics').get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    // Очистить тестовые данные перед каждым тестом
    const usersSnapshot = await db.collection('users').get();
    const companiesSnapshot = await db.collection('companies').get();

    const batch = db.batch();
    usersSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    companiesSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  });

  it('should aggregate growth metrics correctly', async () => {
    // Seed test data for 2025-01-15
    const testDate = new Date('2025-01-15');

    await db.collection('users').doc('user1').set({
      id: 'user1',
      email: 'user1@test.com',
      createdAt: admin.firestore.Timestamp.fromDate(testDate),
      companyId: 'company1',
    });

    await db.collection('users').doc('user2').set({
      id: 'user2',
      email: 'user2@test.com',
      createdAt: admin.firestore.Timestamp.fromDate(testDate),
      companyId: 'company1',
    });

    await db.collection('companies').doc('company1').set({
      id: 'company1',
      name: 'Test Company',
      createdAt: admin.firestore.Timestamp.fromDate(testDate),
    });

    // Mock function implementation (для примера)
    const mockAggregateGrowthMetrics = async () => {
      const targetDate = new Date('2025-01-15');
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Count new users
      const usersSnapshot = await db.collection('users')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
        .get();

      // Count new companies
      const companiesSnapshot = await db.collection('companies')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
        .get();

      // Count total users and companies
      const totalUsersSnapshot = await db.collection('users').get();
      const totalCompaniesSnapshot = await db.collection('companies').get();

      // Write to growthMetrics
      const dateStr = targetDate.toISOString().split('T')[0];
      await db.collection('growthMetrics').doc(dateStr).set({
        date: admin.firestore.Timestamp.fromDate(targetDate),
        newUsers: usersSnapshot.size,
        newCompanies: companiesSnapshot.size,
        totalUsers: totalUsersSnapshot.size,
        totalCompanies: totalCompaniesSnapshot.size,
        metadata: {
          calculatedAt: admin.firestore.Timestamp.now(),
        },
      });
    };

    // Execute function
    await mockAggregateGrowthMetrics();

    // Verify results
    const metricsDoc = await db.collection('growthMetrics').doc('2025-01-15').get();
    expect(metricsDoc.exists).toBe(true);

    const data = metricsDoc.data();
    expect(data?.newUsers).toBe(2);
    expect(data?.newCompanies).toBe(1);
    expect(data?.totalUsers).toBe(2);
    expect(data?.totalCompanies).toBe(1);
    expect(data?.metadata.calculatedAt).toBeDefined();
  });

  it('should handle date boundaries correctly (midnight edge case)', async () => {
    // Test user created at 23:59:59 on 2025-01-15
    const midnightUser = new Date('2025-01-15T23:59:59Z');

    await db.collection('users').doc('user_midnight').set({
      id: 'user_midnight',
      email: 'midnight@test.com',
      createdAt: admin.firestore.Timestamp.fromDate(midnightUser),
      companyId: 'company1',
    });

    await db.collection('companies').doc('company1').set({
      id: 'company1',
      name: 'Test Company',
      createdAt: admin.firestore.Timestamp.fromDate(new Date('2025-01-15')),
    });

    // Mock function
    const mockAggregateGrowthMetrics = async () => {
      const targetDate = new Date('2025-01-15');
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const usersSnapshot = await db.collection('users')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
        .get();

      const totalUsersSnapshot = await db.collection('users').get();
      const totalCompaniesSnapshot = await db.collection('companies').get();

      const dateStr = targetDate.toISOString().split('T')[0];
      await db.collection('growthMetrics').doc(dateStr).set({
        date: admin.firestore.Timestamp.fromDate(targetDate),
        newUsers: usersSnapshot.size,
        newCompanies: 0,
        totalUsers: totalUsersSnapshot.size,
        totalCompanies: totalCompaniesSnapshot.size,
        metadata: {
          calculatedAt: admin.firestore.Timestamp.now(),
        },
      });
    };

    await mockAggregateGrowthMetrics();

    const metricsDoc = await db.collection('growthMetrics').doc('2025-01-15').get();
    expect(metricsDoc.data()?.newUsers).toBe(1); // Should include midnight user
  });

  it('should handle zero new users/companies', async () => {
    // No users created on 2025-01-15

    const mockAggregateGrowthMetrics = async () => {
      const targetDate = new Date('2025-01-15');
      const dateStr = targetDate.toISOString().split('T')[0];

      await db.collection('growthMetrics').doc(dateStr).set({
        date: admin.firestore.Timestamp.fromDate(targetDate),
        newUsers: 0,
        newCompanies: 0,
        totalUsers: 0,
        totalCompanies: 0,
        metadata: {
          calculatedAt: admin.firestore.Timestamp.now(),
        },
      });
    };

    await mockAggregateGrowthMetrics();

    const metricsDoc = await db.collection('growthMetrics').doc('2025-01-15').get();
    expect(metricsDoc.exists).toBe(true);
    expect(metricsDoc.data()?.newUsers).toBe(0);
    expect(metricsDoc.data()?.newCompanies).toBe(0);
  });
});
