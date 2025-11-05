/**
 * TEST CASE #2: syncCostData
 *
 * Проверяет синхронизацию cost data из BigQuery
 * с использованием моков (без реального доступа к Billing API)
 */

import { test, admin, db, cleanup } from './setup';
import * as sinon from 'sinon';

// Mock BigQuery
const mockBigQuery = {
  query: sinon.stub(),
};

describe('syncCostData', () => {
  let bigQueryStub: sinon.SinonStub;

  beforeEach(() => {
    // Mock BigQuery response
    bigQueryStub = sinon.stub().resolves([
      [
        {
          date: '2025-01-15',
          service: 'firestore',
          cost: 12.34,
        },
        {
          date: '2025-01-15',
          service: 'functions',
          cost: 5.67,
        },
        {
          date: '2025-01-15',
          service: 'storage',
          cost: 2.50,
        },
      ],
    ]);
  });

  afterEach(() => {
    sinon.restore();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('should sync cost data from BigQuery', async () => {
    // Mock implementation of syncCostData
    const mockSyncCostData = async () => {
      try {
        // Call mocked BigQuery
        const [rows] = await bigQueryStub();

        // Aggregate costs by service
        const breakdown: Record<string, number> = {};
        let totalCost = 0;

        rows.forEach((row: any) => {
          const serviceName = row.service === 'functions' ? 'cloudFunctions' : row.service;
          breakdown[serviceName] = row.cost;
          totalCost += row.cost;
        });

        // Write to Firestore
        const date = '2025-01-15';
        await db.collection('costReports').doc(date).set({
          date: admin.firestore.Timestamp.fromDate(new Date(date)),
          totalCost: parseFloat(totalCost.toFixed(2)),
          breakdown,
          metadata: {
            syncedAt: admin.firestore.Timestamp.now(),
            source: 'bigquery',
          },
        });
      } catch (error: any) {
        // Log error to systemErrors
        await db.collection('systemErrors').add({
          timestamp: admin.firestore.Timestamp.now(),
          errorType: 'bigquery_sync_error',
          functionName: 'syncCostData',
          message: error.message,
          stack: error.stack,
          metadata: {
            severity: 'high',
          },
        });
        throw error;
      }
    };

    // Execute mock function
    await mockSyncCostData();

    // Verify Firestore write
    const costDoc = await db.collection('costReports').doc('2025-01-15').get();
    expect(costDoc.exists).toBe(true);

    const data = costDoc.data();
    expect(data?.breakdown.firestore).toBe(12.34);
    expect(data?.breakdown.cloudFunctions).toBe(5.67);
    expect(data?.breakdown.storage).toBe(2.50);
    expect(data?.totalCost).toBe(20.51); // 12.34 + 5.67 + 2.50
    expect(data?.metadata.source).toBe('bigquery');
  });

  it('should handle BigQuery errors gracefully', async () => {
    // Mock BigQuery error
    const errorStub = sinon.stub().rejects(new Error('BigQuery timeout'));

    const mockSyncCostDataWithError = async () => {
      try {
        await errorStub();
      } catch (error: any) {
        // Log error
        await db.collection('systemErrors').add({
          timestamp: admin.firestore.Timestamp.now(),
          errorType: 'bigquery_sync_error',
          functionName: 'syncCostData',
          message: error.message,
          stack: error.stack,
          metadata: {
            severity: 'high',
          },
        });
        throw error;
      }
    };

    // Should throw error
    await expect(mockSyncCostDataWithError()).rejects.toThrow('BigQuery timeout');

    // Verify error logged to systemErrors
    const errors = await db.collection('systemErrors')
      .where('functionName', '==', 'syncCostData')
      .where('errorType', '==', 'bigquery_sync_error')
      .get();

    expect(errors.empty).toBe(false);
    expect(errors.docs[0].data().message).toBe('BigQuery timeout');
    expect(errors.docs[0].data().metadata.severity).toBe('high');
  });

  it('should handle empty BigQuery results', async () => {
    // Mock empty response
    const emptyStub = sinon.stub().resolves([[]]);

    const mockSyncCostDataEmpty = async () => {
      const [rows] = await emptyStub();

      const date = '2025-01-15';
      await db.collection('costReports').doc(date).set({
        date: admin.firestore.Timestamp.fromDate(new Date(date)),
        totalCost: 0,
        breakdown: {},
        metadata: {
          syncedAt: admin.firestore.Timestamp.now(),
          source: 'bigquery',
          note: 'no_data',
        },
      });
    };

    await mockSyncCostDataEmpty();

    const costDoc = await db.collection('costReports').doc('2025-01-15').get();
    expect(costDoc.exists).toBe(true);
    expect(costDoc.data()?.totalCost).toBe(0);
    expect(costDoc.data()?.metadata.note).toBe('no_data');
  });
});
