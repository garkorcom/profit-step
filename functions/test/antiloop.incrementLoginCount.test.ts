/**
 * 🚨 CRITICAL Anti-Loop Test: incrementLoginCount
 *
 * Это КРИТИЧЕСКИЙ тест для функции которая вызвала $174 счет!
 * Проверяет что исправленная версия с Idempotency Guards НЕ создает infinite loop
 */

import * as admin from 'firebase-admin';
import { clearFirestoreCollection, wait } from './helpers';

describe('🚨 CRITICAL Anti-Loop: incrementLoginCount', () => {
  const db = admin.firestore();
  const testUserId = 'test-user-login-count';

  beforeEach(async () => {
    // Очищаем тестовые данные
    await clearFirestoreCollection('users');
  });

  afterAll(async () => {
    await clearFirestoreCollection('users');
  });

  /**
   * TEST 1: Первый вход должен увеличить loginCount на +1
   */
  test('должен увеличить loginCount на +1 при первом входе', async () => {
    // 1. Создаем пользователя с loginCount = 0
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      loginCount: 0,
      lastSeen: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Симулируем вход пользователя (обновляем lastSeen)
    await db.collection('users').doc(testUserId).update({
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Ждем чтобы onUpdate trigger сработал
    await wait(2000);

    // 3. ПРОВЕРКА: loginCount должен быть = 1
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    expect(userDoc.exists).toBe(true);
    expect(userData?.loginCount).toBe(1);
  });

  /**
   * TEST 2: Второй вход должен увеличить loginCount на +1 (не на +1000)
   */
  test('должен увеличить loginCount на +1 при втором входе (НЕ infinite loop)', async () => {
    // 1. Создаем пользователя с loginCount = 1
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      loginCount: 1,
      lastSeen: admin.firestore.Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Симулируем второй вход (обновляем lastSeen)
    await db.collection('users').doc(testUserId).update({
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Ждем
    await wait(2000);

    // 3. ПРОВЕРКА: loginCount должен быть = 2 (НЕ 1000+!)
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    expect(userDoc.exists).toBe(true);
    expect(userData?.loginCount).toBe(2);

    // КРИТИЧЕСКАЯ ПРОВЕРКА: если был infinite loop - loginCount был бы 100+
    expect(userData?.loginCount).toBeLessThan(10);
  });

  /**
   * TEST 3: 🔥 STRESS TEST - 10 входов подряд не должны создать infinite loop
   */
  test('🔥 STRESS: должен выдержать 10 входов подряд без infinite loop', async () => {
    // 1. Создаем пользователя
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      loginCount: 0,
      lastSeen: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Симулируем 10 входов подряд
    for (let i = 0; i < 10; i++) {
      await db.collection('users').doc(testUserId).update({
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });
      await wait(500); // Ждем между входами
    }

    // Ждем чтобы все триггеры обработались
    await wait(3000);

    // 3. КРИТИЧЕСКАЯ ПРОВЕРКА: loginCount должен быть = 10 (НЕ 10,000+!)
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    expect(userDoc.exists).toBe(true);
    expect(userData?.loginCount).toBe(10);

    // Если был infinite loop - loginCount был бы в тысячах
    expect(userData?.loginCount).toBeLessThan(20);
  });

  /**
   * TEST 4: Idempotency Guard должен пропустить обновление если loginCount уже изменился
   */
  test('Idempotency Guard должен пропустить обновление если loginCount уже изменился', async () => {
    // 1. Создаем пользователя
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      loginCount: 5, // ← loginCount уже установлен
      lastSeen: admin.firestore.Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Вручную обновляем loginCount (имитируем что trigger уже сработал)
    await db.collection('users').doc(testUserId).update({
      loginCount: admin.firestore.FieldValue.increment(1), // 5 → 6
    });

    await wait(2000);

    // 3. ПРОВЕРКА: loginCount должен быть = 6 (НЕ 7, потому что Guard должен пропустить)
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    expect(userDoc.exists).toBe(true);

    // loginCount увеличился на 1 (НЕ на 2 или больше из-за повторного триггера)
    expect(userData?.loginCount).toBe(6);
  });

  /**
   * TEST 5: Обновление других полей НЕ должно увеличивать loginCount
   */
  test('обновление других полей (НЕ lastSeen) НЕ должно увеличивать loginCount', async () => {
    // 1. Создаем пользователя
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      loginCount: 3,
      lastSeen: admin.firestore.Timestamp.fromDate(new Date('2025-01-01T00:00:00Z')),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(1000);

    // 2. Обновляем ДРУГИЕ поля (НЕ lastSeen)
    await db.collection('users').doc(testUserId).update({
      phone: '+1234567890',
      title: 'Engineer',
      photoURL: 'https://example.com/photo.jpg',
    });

    await wait(2000);

    // 3. ПРОВЕРКА: loginCount НЕ должен измениться
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    expect(userDoc.exists).toBe(true);
    expect(userData?.loginCount).toBe(3); // Должен остаться = 3
  });

  /**
   * TEST 6: 💰 BILLING PROTECTION - симуляция "worst case scenario"
   */
  test('💰 BILLING PROTECTION: worst case scenario - 50 быстрых обновлений', async () => {
    // Это симуляция того что случилось в production:
    // Множество быстрых обновлений подряд

    // 1. Создаем пользователя
    await db.collection('users').doc(testUserId).set({
      email: 'test@example.com',
      displayName: 'Test User',
      companyId: 'test-company',
      loginCount: 0,
      lastSeen: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await wait(500);

    // 2. 50 очень быстрых обновлений (симуляция атаки или бага)
    const updatePromises = [];
    for (let i = 0; i < 50; i++) {
      updatePromises.push(
        db.collection('users').doc(testUserId).update({
          lastSeen: admin.firestore.Timestamp.fromDate(new Date(`2025-01-01T00:00:${String(i).padStart(2, '0')}Z`)),
        })
      );
    }

    await Promise.all(updatePromises);

    // Ждем обработки
    await wait(5000);

    // 3. КРИТИЧЕСКАЯ ПРОВЕРКА: loginCount должен быть близок к 50 (НЕ 50,000+!)
    const userDoc = await db.collection('users').doc(testUserId).get();
    const userData = userDoc.data();

    expect(userDoc.exists).toBe(true);

    // С идеальным Guard должно быть ~50
    // Допускаем небольшую погрешность из-за race conditions
    expect(userData?.loginCount).toBeGreaterThan(40);
    expect(userData?.loginCount).toBeLessThan(70);

    // ГЛАВНОЕ: НЕ должно быть тысяч!
    expect(userData?.loginCount).toBeLessThan(100);

    console.log(`✅ Billing Protection Test: loginCount = ${userData?.loginCount} (expected ~50)`);
  });
});
