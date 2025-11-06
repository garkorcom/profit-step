/**
 * Test Helpers
 * Вспомогательные функции для тестирования Firebase Functions
 */

import * as admin from 'firebase-admin';
import * as functionsTest from 'firebase-functions-test';

const testEnv = functionsTest({
  projectId: 'demo-test-project',
});

/**
 * Очищает Firestore коллекцию в эмуляторе
 */
export async function clearFirestoreCollection(collectionPath: string): Promise<void> {
  const db = admin.firestore();
  const snapshot = await db.collection(collectionPath).get();
  const batch = db.batch();

  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
}

/**
 * Ждет указанное количество миллисекунд
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Создает mock DocumentSnapshot для тестирования
 */
export function makeChange(
  before: any,
  after: any,
  path: string
): functionsTest.Change<admin.firestore.DocumentSnapshot> {
  return testEnv.firestore.makeDocumentSnapshot(after, path);
}

/**
 * Создает mock EventContext для тестирования
 */
export function makeEventContext(params: Record<string, string>): any {
  return {
    eventId: 'test-event-id',
    timestamp: new Date().toISOString(),
    eventType: 'providers/cloud.firestore/eventTypes/document.update',
    resource: {
      service: 'firestore.googleapis.com',
      name: 'test-resource',
    },
    params,
  };
}

export { testEnv };
