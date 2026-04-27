/**
 * Unit tests for FirestoreTransitionLog — pin the company-scoped query
 * predicate on `findForTask`. Bug 4: admin SDK bypasses Firestore rules,
 * and a query of the shape `where('taskId', '==', X).orderBy('at', 'desc')`
 * leaks across tenants if the task id is ever re-used. Adding a leading
 * `where('companyId', '==', companyId)` keeps reads tenant-scoped using the
 * existing composite index (companyId, taskId, at desc).
 */

import type { Firestore, Query } from 'firebase-admin/firestore';

import { FirestoreTransitionLog } from '../../../adapters/firestore/FirestoreTransitionLog';
import { asCompanyId, asTaskId } from '../../../domain/identifiers';

interface RecordedQuery {
  whereCalls: Array<[string, string, unknown]>;
  orderByCalls: Array<[string, string?]>;
  limitCalls: number[];
}

function makeMockDb() {
  const calls: RecordedQuery = {
    whereCalls: [],
    orderByCalls: [],
    limitCalls: [],
  };

  const buildChain = (): Query => {
    const chain: Record<string, unknown> = {};
    chain.where = jest.fn((field: string, op: string, value: unknown) => {
      calls.whereCalls.push([field, op, value]);
      return chain as unknown as Query;
    });
    chain.orderBy = jest.fn((field: string, direction?: string) => {
      calls.orderByCalls.push([field, direction]);
      return chain as unknown as Query;
    });
    chain.limit = jest.fn((n: number) => {
      calls.limitCalls.push(n);
      return chain as unknown as Query;
    });
    chain.get = jest.fn(() => Promise.resolve({ docs: [] }));
    return chain as unknown as Query;
  };

  const db = {
    collection: jest.fn(() => buildChain()),
  } as unknown as Firestore;

  return { db, calls };
}

describe('FirestoreTransitionLog.findForTask', () => {
  test('adds where(companyId, ==, companyId) predicate when companyId supplied', async () => {
    const { db, calls } = makeMockDb();
    const log = new FirestoreTransitionLog(db);

    await log.findForTask(asTaskId('task_x'), 50, asCompanyId('co_a'));

    // Bug 4 assertion: the query is now tenant-scoped server-side.
    const companyPredicate = calls.whereCalls.find(
      ([field]) => field === 'companyId',
    );
    expect(companyPredicate).toBeDefined();
    expect(companyPredicate![1]).toBe('==');
    expect(companyPredicate![2]).toBe('co_a');

    // Other predicates we still expect.
    expect(
      calls.whereCalls.find(([field]) => field === 'taskId'),
    ).toBeDefined();
    expect(calls.orderByCalls).toContainEqual(['at', 'desc']);
  });

  test('legacy callers (no companyId) still work — single taskId predicate', async () => {
    const { db, calls } = makeMockDb();
    const log = new FirestoreTransitionLog(db);

    await log.findForTask(asTaskId('task_y'), 25);

    // Backwards-compat: without companyId we issue the legacy single-predicate
    // query. The whereCalls must NOT include a companyId equality clause.
    expect(
      calls.whereCalls.find(([field]) => field === 'companyId'),
    ).toBeUndefined();
    expect(
      calls.whereCalls.find(([field]) => field === 'taskId'),
    ).toBeDefined();
    expect(calls.limitCalls).toContain(25);
  });
});
