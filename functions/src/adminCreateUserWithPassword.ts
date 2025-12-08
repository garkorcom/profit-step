/**
 * Cloud Function: admin_createUserWithPassword
 *
 * Позволяет company_admin создавать пользователей напрямую с паролем и иерархией
 *
 * Security:
 * - Только company_admin или super_admin могут вызывать
 * - Проверка прав через context.auth.token.role
 * - Новый пользователь получает companyId от создателя
 *
 * Features:
 * - Создание в Firebase Auth с паролем
 * - Создание профиля в Firestore
 * - Установка иерархии (reportsTo)
 * - Валидация входных данных
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const db = admin.firestore();

/**
 * Интерфейс входных данных
 */
interface CreateUserData {
  email: string;
  password: string;
  displayName: string;
  role: 'manager' | 'user' | 'estimator' | 'guest';
  reportsTo?: string; // UID руководителя (опционально)
  title?: string; // Должность (опционально)
}

/**
 * Интерфейс ответа
 */
interface CreateUserResponse {
  success: boolean;
  message: string;
  userId: string;
  userEmail: string;
}

/**
 * Callable Function: Создание пользователя админом
 */
export const admin_createUserWithPassword = functions.https.onCall(
  async (data: CreateUserData, context): Promise<CreateUserResponse> => {
    const startTime = Date.now();

    // ============================================
    // 1️⃣ SECURITY: Auth Guard
    // ============================================
    if (!context.auth) {
      console.error('❌ Unauthorized: No auth context');
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Требуется аутентификация'
      );
    }

    const callerRole = context.auth.token.role as string | undefined;
    const callerCompanyId = context.auth.token.companyId as string | undefined;
    const callerUid = context.auth.uid;

    // Проверка роли: сначала смотрим токен, если нет - проверяем Firestore
    let effectiveRole = callerRole;
    let effectiveCompanyId = callerCompanyId;

    if (effectiveRole !== 'company_admin' && effectiveRole !== 'super_admin' && effectiveRole !== 'admin') {
      console.log(`⚠️ Token role '${effectiveRole}' insufficient, checking Firestore profile...`);

      const callerDoc = await db.collection('users').doc(callerUid).get();
      if (callerDoc.exists) {
        const callerData = callerDoc.data();
        effectiveRole = callerData?.role;
        effectiveCompanyId = callerData?.companyId;
        console.log(`✅ Retrieved role from Firestore: ${effectiveRole}`);
      }
    }

    if (effectiveRole !== 'company_admin' && effectiveRole !== 'super_admin' && effectiveRole !== 'admin') {
      console.error(`❌ Permission denied: Role ${effectiveRole} not authorized`);
      throw new functions.https.HttpsError(
        'permission-denied',
        'Только администраторы могут создавать пользователей'
      );
    }

    // Fallback: If admin has no companyId, assume they are their own company (Dev/Solo mode)
    if (!effectiveCompanyId && (effectiveRole === 'admin' || effectiveRole === 'super_admin' || effectiveRole === 'company_admin')) {
      console.log(`⚠️ Admin ${callerUid} has no companyId, defaulting to userId`);
      effectiveCompanyId = callerUid;
    }

    // Update variables for later use
    const finalCompanyId = effectiveCompanyId;

    console.log(`✅ Auth Guard passed: ${callerUid} (role: ${callerRole})`);

    // ============================================
    // 2️⃣ VALIDATION: Входные данные
    // ============================================
    const { email, password, displayName, role, title } = data;

    // Sanitize reportsTo (handle empty strings)
    const reportsTo = data.reportsTo || null;

    // Валидация обязательных полей
    if (!email || !password || !displayName || !role) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Обязательные поля: email, password, displayName, role'
      );
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Некорректный формат email'
      );
    }

    // Валидация password (минимум 6 символов)
    if (password.length < 6) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Пароль должен содержать минимум 6 символов'
      );
    }

    // Валидация роли
    const validRoles = ['manager', 'user', 'estimator', 'guest'];
    if (!validRoles.includes(role)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Некорректная роль. Допустимые: ${validRoles.join(', ')}`
      );
    }

    // Валидация companyId
    if (!finalCompanyId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'У администратора не установлен companyId'
      );
    }

    console.log(`✅ Validation passed for email: ${email}`);

    // ============================================
    // 3️⃣ VALIDATION: Проверка reportsTo (если указан)
    // ============================================
    if (reportsTo) {
      try {
        const managerDoc = await db.collection('users').doc(reportsTo).get();

        if (!managerDoc.exists) {
          throw new functions.https.HttpsError(
            'not-found',
            'Указанный руководитель не найден'
          );
        }

        const managerData = managerDoc.data();

        // Проверка что руководитель из той же компании
        if (managerData?.companyId !== finalCompanyId) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Руководитель должен быть из вашей компании'
          );
        }

        // Проверка что руководитель имеет подходящую роль
        const managerRole = managerData?.role;
        if (managerRole !== 'manager' && managerRole !== 'company_admin' && managerRole !== 'admin') {
          throw new functions.https.HttpsError(
            'invalid-argument',
            'Руководителем может быть только manager или admin'
          );
        }

        console.log(`✅ ReportsTo validation passed: ${reportsTo}`);
      } catch (error: any) {
        if (error.code) throw error; // Re-throw HttpsError
        console.error('Error validating reportsTo:', error);
        throw new functions.https.HttpsError(
          'internal',
          'Ошибка валидации руководителя'
        );
      }
    }

    // ============================================
    // 4️⃣ ACTION: Создание пользователя в Firebase Auth
    // ============================================
    let newUser: admin.auth.UserRecord;

    try {
      newUser = await admin.auth().createUser({
        email: email.toLowerCase(),
        password: password,
        displayName: displayName,
        emailVerified: true, // Сразу подтверждаем email
      });

      console.log(`✅ User created in Firebase Auth: ${newUser.uid}`);
    } catch (error: any) {
      console.error('❌ Error creating user in Auth:', error);

      // Обработка специфичных ошибок Firebase Auth
      if (error.code === 'auth/email-already-exists') {
        throw new functions.https.HttpsError(
          'already-exists',
          `Email ${email} уже используется другим пользователем`
        );
      }

      if (error.code === 'auth/invalid-password') {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Пароль не соответствует требованиям безопасности'
        );
      }

      throw new functions.https.HttpsError(
        'internal',
        `Ошибка создания пользователя: ${error.message}`
      );
    }

    // ============================================
    // 5️⃣ ACTION: Создание профиля в Firestore
    // ============================================
    try {
      const userProfile = {
        email: email.toLowerCase(),
        displayName: displayName,
        role: role,
        companyId: finalCompanyId,
        reportsTo: reportsTo || null,
        title: title || null,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
        loginCount: 0,
        onboarded: false,
        photoURL: null,
      };

      await db.collection('users').doc(newUser.uid).set(userProfile);

      console.log(`✅ User profile created in Firestore: ${newUser.uid}`);
    } catch (error: any) {
      console.error('❌ Error creating user profile in Firestore:', error);

      // Rollback: удаляем пользователя из Auth если не смогли создать профиль
      try {
        await admin.auth().deleteUser(newUser.uid);
        console.log(`🔄 Rollback: User deleted from Auth after Firestore error`);
      } catch (rollbackError) {
        console.error('❌ Rollback failed:', rollbackError);
      }

      throw new functions.https.HttpsError(
        'internal',
        `Ошибка создания профиля пользователя: ${error.message}`
      );
    }

    // ============================================
    // 6️⃣ ACTION: Установка custom claims (для role)
    // ============================================
    try {
      await admin.auth().setCustomUserClaims(newUser.uid, {
        role: role,
        companyId: finalCompanyId,
      });

      console.log(`✅ Custom claims set for user: ${newUser.uid}`);
    } catch (error) {
      console.error('⚠️ Warning: Could not set custom claims:', error);
      // Не критично - пользователь все равно создан
    }

    // ============================================
    // 7️⃣ LOGGING: Создание activity log
    // ============================================
    try {
      await db.collection('activityLogs').add({
        type: 'user_created_by_admin',
        userId: newUser.uid,
        createdBy: callerUid,
        companyId: finalCompanyId,
        details: {
          email: email.toLowerCase(),
          displayName: displayName,
          role: role,
          reportsTo: reportsTo || null,
        },
        timestamp: FieldValue.serverTimestamp(),
      });

      console.log(`✅ Activity log created`);
    } catch (error) {
      console.error('⚠️ Warning: Could not create activity log:', error);
      // Не критично
    }

    // ============================================
    // 8️⃣ SUCCESS: Возврат результата
    // ============================================
    const duration = Date.now() - startTime;
    console.log(`🎉 User created successfully in ${duration}ms`);
    console.log(`   - UID: ${newUser.uid}`);
    console.log(`   - Email: ${email}`);
    console.log(`   - Role: ${role}`);
    console.log(`   - ReportsTo: ${reportsTo || 'none'}`);
    console.log(`   - CompanyId: ${finalCompanyId}`);

    return {
      success: true,
      message: 'Пользователь успешно создан',
      userId: newUser.uid,
      userEmail: email.toLowerCase(),
    };
  }
);
