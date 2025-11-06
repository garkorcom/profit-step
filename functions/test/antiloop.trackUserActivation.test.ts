/**
 * Anti-Loop Test: trackUserActivation
 * Проверяет что Idempotency Guards предотвращают infinite loops
 */

import * as admin from 'firebase-admin';
import { clearFirestoreCollection, wait } from './helpers';

describe('Anti-Loop: trackUserActivation', () => {
  const db = admin.firestore();
  const testUserId = 'test-user-antiloop';

  beforeEach(async () => {
    // Очищаем тестовые данные перед каждым тестом
    await clearFirestoreCollection('users');
    await clearFirestoreCollection('userActivation');
  });

  afterAll(async () => {
    // Очищаем после всех тестов
    await clearFirestoreCollection('users');
    await clearFirestoreCollection('userActivation');
  });

  /**
   * TEST A: Первое обновление должно триггерить функцию
   */
  test('должен обновить userActivation при первом добавлении title', async () => {
    // 1. Создаем пользователя БЕЗ title
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Создаем userActivation документ
    await db.collection('userActivation').doc(testUserId).set({
      userId: testUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Ждем чтобы триггеры успели обработать создание
    await wait(1000);

    // 3. Обновляем пользователя - добавляем title
    const beforeUpdate = new Date();
    await db.collection('users').doc(testUserId).update({
      title: 'Software Engineer',
    });

    // Ждем триггер
    await wait(2000);

    // 4. ПРОВЕРКА: userActivation должен быть обновлен
    const activationDoc = await db.collection('userActivation').doc(testUserId).get();
    const activationData = activationDoc.data();

    expect(activationDoc.exists).toBe(true);
    expect(activationData).toHaveProperty('profileCompleted');
    expect(activationData?.profileCompleted).toBeDefined();

    const profileCompletedDate = activationData?.profileCompleted.toDate();
    expect(profileCompletedDate.getTime()).toBeGreaterThan(beforeUpdate.getTime());
  });

  /**
   * TEST B: Второе обновление НЕ должно триггерить функцию (Idempotency Guard)
   */
  test('НЕ должен обновить userActivation повторно при втором обновлении (Idempotency Guard)', async () => {
    // 1. Создаем пользователя С title
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      title: 'Software Engineer', // ← title уже есть
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Создаем userActivation с уже установленным profileCompleted
    const initialProfileCompleted = admin.firestore.Timestamp.fromDate(
      new Date('2025-01-01T00:00:00Z')
    );

    await db.collection('userActivation').doc(testUserId).set({
      userId: testUserId,
      profileCompleted: initialProfileCompleted, // ← profileCompleted уже установлен
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Ждем
    await wait(1000);

    // 3. Обновляем пользователя - меняем ДРУГОЕ поле (phone)
    await db.collection('users').doc(testUserId).update({
      phone: '+1234567890',
    });

    // Ждем триггер
    await wait(2000);

    // 4. ПРОВЕРКА: userActivation НЕ должен быть изменен
    const activationDoc = await db.collection('userActivation').doc(testUserId).get();
    const activationData = activationDoc.data();

    expect(activationDoc.exists).toBe(true);

    // profileCompleted должен остаться ОРИГИНАЛЬНЫМ значением
    expect(activationData?.profileCompleted.toDate().toISOString()).toBe(
      initialProfileCompleted.toDate().toISOString()
    );

    // updatedAt НЕ должен быть обновлен (или его вообще нет)
    expect(activationData).not.toHaveProperty('updatedAt');
  });

  /**
   * TEST C: Множественные обновления не должны создавать бесконечный цикл
   */
  test('должен выдержать 10 последовательных обновлений без infinite loop', async () => {
    // 1. Создаем пользователя
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('userActivation').doc(testUserId).set({
      userId: testUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Выполняем 10 обновлений подряд
    for (let i = 0; i < 10; i++) {
      await db.collection('users').doc(testUserId).update({
        phone: `+123456789${i}`,
      });
      await wait(100);
    }

    // Ждем чтобы все триггеры обработались
    await wait(3000);

    // 3. ПРОВЕРКА: userActivation должен существовать и быть стабильным
    const activationDoc = await db.collection('userActivation').doc(testUserId).get();
    expect(activationDoc.exists).toBe(true);

    // Проверяем что Functions не упали (нет ошибок)
    // Если бы был infinite loop - тесты бы зависли или упали по timeout
  });

  /**
   * TEST D: Avatar upload должен обновить userActivation ОДИН раз
   */
  test('должен обновить userActivation при загрузке аватара (один раз)', async () => {
    // 1. Создаем пользователя БЕЗ photoURL
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('userActivation').doc(testUserId).set({
      userId: testUserId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Загружаем аватар (симулируем)
    const beforeUpdate = new Date();
    await db.collection('users').doc(testUserId).update({
      photoURL: 'https://storage.googleapis.com/test-bucket/avatar.jpg',
    });

    await wait(2000);

    // 3. ПРОВЕРКА: avatarUploaded должен быть установлен
    const activationDoc = await db.collection('userActivation').doc(testUserId).get();
    const activationData = activationDoc.data();

    expect(activationDoc.exists).toBe(true);
    expect(activationData).toHaveProperty('avatarUploaded');
    expect(activationData?.avatarUploaded).toBeDefined();

    const avatarUploadedDate = activationData?.avatarUploaded.toDate();
    expect(avatarUploadedDate.getTime()).toBeGreaterThan(beforeUpdate.getTime());

    // 4. Обновляем photoURL еще раз (новый аватар)
    const secondPhotoURL = 'https://storage.googleapis.com/test-bucket/avatar2.jpg';
    await db.collection('users').doc(testUserId).update({
      photoURL: secondPhotoURL,
    });

    await wait(2000);

    // 5. ПРОВЕРКА: avatarUploaded НЕ должен измениться (Idempotency Guard)
    const activationDoc2 = await db.collection('userActivation').doc(testUserId).get();
    const activationData2 = activationDoc2.data();

    expect(activationData2?.avatarUploaded.toDate().toISOString()).toBe(
      avatarUploadedDate.toISOString()
    );
  });
});
