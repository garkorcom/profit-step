"use strict";
/**
 * Cloud Functions для Profit Step
 *
 * Эти функции автоматически управляют жизненным циклом пользователей:
 * - onUserCreate: Создает профиль в Firestore при регистрации
 * - onUserDelete: Очищает данные при удалении аккаунта
 * - inviteUser: Приглашает нового пользователя с отправкой email
 * - adminDeleteUser: Безопасное удаление пользователя администратором
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monitorFunctionLoops = exports.updateCompanyMemberCount_v2 = exports.trackUserActivation_v2 = exports.logUserUpdates_v2 = exports.incrementLoginCount_v2 = exports.inviteUser = exports.adminDeleteUser = exports.onUserDelete = exports.onUserCreate = exports.admin_createUserWithPassword = exports.logPaginationMetrics = exports.monitorPaginationCosts = exports.updateCompanyMemberCount = exports.incrementLoginCount = exports.logInvitationAccepted = exports.logInvitationSent = exports.logUserDeleted = exports.logUserUpdates = exports.logUserCreated = exports.brevoWebhookHandler = exports.trackFirstInvite = exports.trackUserActivation = exports.initializeUserActivation = exports.aggregateEngagementMetrics = exports.aggregateGrowthMetrics = exports.processAvatar = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
const emailService_1 = require("./email/emailService");
// Инициализация Firebase Admin
admin.initializeApp();
// Avatar processing
var avatarProcessor_1 = require("./avatarProcessor");
Object.defineProperty(exports, "processAvatar", { enumerable: true, get: function () { return avatarProcessor_1.processAvatar; } });
// Dashboard metrics aggregation
var metricsAggregation_1 = require("./metricsAggregation");
Object.defineProperty(exports, "aggregateGrowthMetrics", { enumerable: true, get: function () { return metricsAggregation_1.aggregateGrowthMetrics; } });
Object.defineProperty(exports, "aggregateEngagementMetrics", { enumerable: true, get: function () { return metricsAggregation_1.aggregateEngagementMetrics; } });
Object.defineProperty(exports, "initializeUserActivation", { enumerable: true, get: function () { return metricsAggregation_1.initializeUserActivation; } });
Object.defineProperty(exports, "trackUserActivation", { enumerable: true, get: function () { return metricsAggregation_1.trackUserActivation; } });
Object.defineProperty(exports, "trackFirstInvite", { enumerable: true, get: function () { return metricsAggregation_1.trackFirstInvite; } });
// Brevo webhook handler
var brevoWebhook_1 = require("./brevoWebhook");
Object.defineProperty(exports, "brevoWebhookHandler", { enumerable: true, get: function () { return brevoWebhook_1.brevoWebhookHandler; } });
// Activity logging
var activityLogger_1 = require("./activityLogger");
Object.defineProperty(exports, "logUserCreated", { enumerable: true, get: function () { return activityLogger_1.logUserCreated; } });
Object.defineProperty(exports, "logUserUpdates", { enumerable: true, get: function () { return activityLogger_1.logUserUpdates; } });
Object.defineProperty(exports, "logUserDeleted", { enumerable: true, get: function () { return activityLogger_1.logUserDeleted; } });
Object.defineProperty(exports, "logInvitationSent", { enumerable: true, get: function () { return activityLogger_1.logInvitationSent; } });
Object.defineProperty(exports, "logInvitationAccepted", { enumerable: true, get: function () { return activityLogger_1.logInvitationAccepted; } });
Object.defineProperty(exports, "incrementLoginCount", { enumerable: true, get: function () { return activityLogger_1.incrementLoginCount; } });
Object.defineProperty(exports, "updateCompanyMemberCount", { enumerable: true, get: function () { return activityLogger_1.updateCompanyMemberCount; } });
// Pagination cost monitoring
var monitorPaginationCosts_1 = require("./monitorPaginationCosts");
Object.defineProperty(exports, "monitorPaginationCosts", { enumerable: true, get: function () { return monitorPaginationCosts_1.monitorPaginationCosts; } });
Object.defineProperty(exports, "logPaginationMetrics", { enumerable: true, get: function () { return monitorPaginationCosts_1.logPaginationMetrics; } });
// Admin: Create user with password and hierarchy
var adminCreateUserWithPassword_1 = require("./adminCreateUserWithPassword");
Object.defineProperty(exports, "admin_createUserWithPassword", { enumerable: true, get: function () { return adminCreateUserWithPassword_1.admin_createUserWithPassword; } });
const db = admin.firestore();
/**
 * Триггер: Создание нового пользователя
 *
 * Автоматически создает профиль пользователя в Firestore
 * когда пользователь регистрируется через Firebase Auth
 *
 * Путь: users/{userId}
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    const userId = user.uid;
    const email = user.email || '';
    const displayName = user.displayName || 'User';
    const photoURL = user.photoURL || null;
    try {
        console.log(`🔥 Creating user profile for: ${userId}`);
        // Создаем документ профиля пользователя
        await db.collection('users').doc(userId).set({
            email: email.toLowerCase(),
            displayName: displayName,
            companyId: userId, // По умолчанию companyId = userId
            role: 'estimator', // Роль по умолчанию
            photoURL: photoURL,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            onboarded: false,
        });
        console.log(`✅ User profile created successfully for: ${userId}`);
    }
    catch (error) {
        console.error(`❌ Error creating user profile for ${userId}:`, error);
        throw error;
    }
});
/**
 * Триггер: Удаление пользователя
 *
 * Автоматически очищает все данные пользователя из Firestore
 * когда аккаунт удаляется из Firebase Auth
 *
 * Удаляет:
 * - Профиль users/{userId}
 * - Все подколлекции пользователя (estimates, projects, и т.д.)
 */
exports.onUserDelete = functions.auth.user().onDelete(async (user) => {
    const userId = user.uid;
    try {
        console.log(`🔥 Deleting user data for: ${userId}`);
        // 1. Удаляем профиль пользователя
        await db.collection('users').doc(userId).delete();
        console.log(`✅ User profile deleted for: ${userId}`);
        // 2. Удаляем все подколлекции пользователя
        // Примечание: В production рекомендуется использовать
        // Firebase Extension "Delete User Data" для надежного
        // рекурсивного удаления всех подколлекций
        // Список подколлекций для удаления
        const subcollections = [
            'estimates',
            'projects',
            'counterparties',
            'tasks',
            'documents',
            'products',
        ];
        // Удаляем каждую подколлекцию
        const deletePromises = subcollections.map(async (subcollection) => {
            const snapshot = await db
                .collection(`users/${userId}/${subcollection}`)
                .limit(500) // Batch limit
                .get();
            if (snapshot.empty) {
                return;
            }
            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            console.log(`✅ Deleted ${snapshot.size} documents from ${subcollection}`);
        });
        await Promise.all(deletePromises);
        console.log(`✅ User data cleanup completed for: ${userId}`);
    }
    catch (error) {
        console.error(`❌ Error deleting user data for ${userId}:`, error);
        throw error;
    }
});
/**
 * Callable Function: Полное удаление пользователя (только для Admin)
 *
 * Безопасно удаляет пользователя из системы:
 * 1. Проверяет права администратора
 * 2. Проверяет, что пользователи в одной компании
 * 3. Переназначает данные (сметы, проекты) администратору
 * 4. Удаляет пользователя из Auth
 * 5. Удаляет профиль из Firestore
 */
exports.adminDeleteUser = functions.https.onCall(async (data, context) => {
    // 1. Валидация: Пользователь должен быть аутентифицирован
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Требуется аутентификация');
    }
    const adminUid = context.auth.uid;
    const userIdToDelete = data.userIdToDelete;
    if (!userIdToDelete) {
        throw new functions.https.HttpsError('invalid-argument', 'userIdToDelete обязателен');
    }
    // Нельзя удалить самого себя
    if (adminUid === userIdToDelete) {
        throw new functions.https.HttpsError('failed-precondition', 'Вы не можете удалить свой собственный аккаунт');
    }
    try {
        // 2. Получаем профиль админа
        const adminProfile = await db.collection('users').doc(adminUid).get();
        if (!adminProfile.exists) {
            throw new functions.https.HttpsError('not-found', 'Профиль администратора не найден');
        }
        const adminData = adminProfile.data();
        if ((adminData === null || adminData === void 0 ? void 0 : adminData.role) !== 'admin') {
            throw new functions.https.HttpsError('permission-denied', 'Только администраторы могут удалять пользователей');
        }
        // 3. Получаем профиль удаляемого пользователя
        const userProfile = await db.collection('users').doc(userIdToDelete).get();
        if (!userProfile.exists) {
            throw new functions.https.HttpsError('not-found', 'Пользователь не найден');
        }
        const userData = userProfile.data();
        // 4. Проверяем, что пользователи в одной компании
        if ((adminData === null || adminData === void 0 ? void 0 : adminData.companyId) !== (userData === null || userData === void 0 ? void 0 : userData.companyId)) {
            throw new functions.https.HttpsError('permission-denied', 'Вы можете удалять только пользователей из своей компании');
        }
        console.log(`🔥 Admin ${adminUid} is deleting user ${userIdToDelete}`);
        // 5. Переназначение данных (Критично!)
        // Примечание: В реальном проекте здесь может быть много коллекций
        // Для примера показываем общую логику
        const batch = db.batch();
        // Список подколлекций для переназначения
        const subcollections = [
            'estimates', // Сметы
            'projects', // Проекты
            'tasks', // Задачи
            'documents', // Документы
        ];
        for (const subcollection of subcollections) {
            const userDataRef = db.collection(`users/${userIdToDelete}/${subcollection}`);
            const snapshot = await userDataRef.limit(500).get();
            if (!snapshot.empty) {
                console.log(`📦 Reassigning ${snapshot.size} documents from ${subcollection}`);
                // Перемещаем данные в профиль администратора
                snapshot.docs.forEach((doc) => {
                    const newDocRef = db.doc(`users/${adminUid}/${subcollection}/${doc.id}`);
                    batch.set(newDocRef, Object.assign(Object.assign({}, doc.data()), { previousOwnerId: userIdToDelete, reassignedAt: admin.firestore.FieldValue.serverTimestamp() }));
                    batch.delete(doc.ref);
                });
            }
        }
        await batch.commit();
        console.log('✅ Data reassignment completed');
        // 6. Удаляем пользователя из Firebase Auth
        await admin.auth().deleteUser(userIdToDelete);
        console.log('✅ User deleted from Auth');
        // 7. Удаляем профиль из Firestore
        await db.collection('users').doc(userIdToDelete).delete();
        console.log('✅ User profile deleted from Firestore');
        return {
            success: true,
            message: `Пользователь ${userIdToDelete} успешно удален`,
        };
    }
    catch (error) {
        console.error(`❌ Error deleting user ${userIdToDelete}:`, error);
        throw new functions.https.HttpsError('internal', `Ошибка удаления пользователя: ${error.message}`);
    }
});
/**
 * Callable Function: Приглашение нового пользователя (только для Admin)
 *
 * Создает нового пользователя в системе:
 * 1. Проверяет права администратора
 * 2. Создает пользователя в Firebase Auth
 * 3. Создает профиль в Firestore с указанной ролью
 * 4. Отправляет email с инструкциями для входа
 */
exports.inviteUser = functions.https.onCall(async (data, context) => {
    // 1. Валидация: Пользователь должен быть аутентифицирован
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Требуется аутентификация');
    }
    const adminUid = context.auth.uid;
    const { email, displayName, role, title } = data;
    // Валидация входных данных
    if (!email || !displayName || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'Email, displayName и role обязательны');
    }
    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new functions.https.HttpsError('invalid-argument', 'Некорректный email адрес');
    }
    // Валидация роли
    const validRoles = ['admin', 'manager', 'estimator', 'guest'];
    if (!validRoles.includes(role)) {
        throw new functions.https.HttpsError('invalid-argument', 'Некорректная роль пользователя');
    }
    try {
        // 2. Получаем профиль администратора
        const adminProfile = await db.collection('users').doc(adminUid).get();
        if (!adminProfile.exists) {
            throw new functions.https.HttpsError('not-found', 'Профиль администратора не найден');
        }
        const adminData = adminProfile.data();
        if ((adminData === null || adminData === void 0 ? void 0 : adminData.role) !== 'admin') {
            throw new functions.https.HttpsError('permission-denied', 'Только администраторы могут приглашать пользователей');
        }
        const companyId = adminData.companyId;
        console.log(`🔥 Admin ${adminUid} is inviting user: ${email}`);
        // 3. Rate Limiting: ВРЕМЕННО ОТКЛЮЧЕНО до полного построения индекса
        // TODO: Включить когда индекс будет 100% готов
        /*
        const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 3600000);
        const recentInvitesQuery = await db
          .collection('invitations')
          .where('invitedBy', '==', adminUid)
          .where('createdAt', '>', oneHourAgo)
          .get();
    
        if (recentInvitesQuery.size >= 10) {
          throw new functions.https.HttpsError(
            'resource-exhausted',
            'Превышен лимит приглашений (максимум 10 в час). Попробуйте позже.'
          );
        }
        */
        // 4. Проверяем, не существует ли уже пользователь с таким email в компании
        const existingUsersQuery = await db
            .collection('users')
            .where('email', '==', email.toLowerCase())
            .where('companyId', '==', companyId)
            .get();
        if (!existingUsersQuery.empty) {
            throw new functions.https.HttpsError('already-exists', `Пользователь с email ${email} уже существует в вашей компании`);
        }
        // 5. Создаем пользователя в Firebase Auth
        // Генерируем криптографически стойкий временный пароль
        const tempPassword = crypto.randomBytes(32).toString('hex');
        let newUserId = null;
        try {
            const userRecord = await admin.auth().createUser({
                email: email.toLowerCase(),
                emailVerified: false,
                password: tempPassword,
                displayName: displayName,
                disabled: false,
            });
            newUserId = userRecord.uid;
            console.log(`✅ User created in Auth: ${newUserId}`);
            // 6. Создаем профиль в Firestore
            await db.collection('users').doc(newUserId).set({
                email: email.toLowerCase(),
                displayName: displayName,
                companyId: companyId,
                role: role,
                title: title || '',
                photoURL: null,
                status: 'active',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                onboarded: false,
            });
            console.log(`✅ User profile created in Firestore: ${newUserId}`);
            // 7. Записываем приглашение для rate limiting - ВРЕМЕННО ОТКЛЮЧЕНО
            /*
            await db.collection('invitations').add({
              invitedBy: adminUid,
              invitedEmail: email.toLowerCase(),
              invitedUserId: newUserId,
              companyId: companyId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            */
            // 8. Генерируем ссылку для сброса пароля
            // Это позволит пользователю установить свой собственный пароль
            const resetLink = await admin.auth().generatePasswordResetLink(email);
            console.log(`📧 Password reset link generated for: ${email}`);
            // 9. Отправляем email приглашение
            const emailResult = await (0, emailService_1.sendInviteEmail)({
                toEmail: email,
                userName: displayName,
                invitedByName: adminData.displayName || 'Администратор',
                role: role,
                companyName: adminData.companyId, // TODO: Получать реальное название компании из БД
                passwordResetLink: resetLink,
            });
            if (emailResult.success) {
                console.log(`✅ Invitation email sent to: ${email}`);
            }
            else {
                console.warn(`⚠️ Failed to send email: ${emailResult.error}`);
                // Не бросаем ошибку, т.к. пользователь уже создан
                // Администратор все равно получит ссылку в ответе
            }
            return {
                success: true,
                message: `Пользователь ${email} успешно приглашен`,
                userId: newUserId,
                passwordResetLink: resetLink,
                emailSent: emailResult.success,
                emailError: emailResult.error,
            };
        }
        catch (setupError) {
            // Rollback: удаляем созданного пользователя из Auth если что-то пошло не так
            if (newUserId) {
                try {
                    await admin.auth().deleteUser(newUserId);
                    console.log(`🔄 Rolled back user creation: ${newUserId}`);
                }
                catch (rollbackError) {
                    console.error('⚠️ Failed to rollback user creation:', rollbackError);
                }
            }
            // Пробрасываем исходную ошибку
            throw setupError;
        }
    }
    catch (error) {
        console.error(`❌ Error inviting user:`, error);
        // Специальная обработка ошибки "email already exists"
        if (error.code === 'auth/email-already-exists') {
            throw new functions.https.HttpsError('already-exists', 'Пользователь с таким email уже существует');
        }
        throw new functions.https.HttpsError('internal', `Ошибка при приглашении пользователя: ${error.message}`);
    }
});
/**
 * ПРИМЕЧАНИЕ ПО РАЗВЕРТЫВАНИЮ:
 *
 * Для развертывания этих функций:
 * 1. Установите Firebase CLI: npm install -g firebase-tools
 * 2. Войдите в Firebase: firebase login
 * 3. Инициализируйте проект: firebase init functions
 * 4. Установите зависимости: cd functions && npm install
 * 5. Разверните функции: firebase deploy --only functions
 *
 * ВАЖНО:
 * - Убедитесь, что Firebase project настроен в .firebaserc
 * - Для production рассмотрите использование Firebase Extension
 *   "Delete User Data" для более надежного удаления данных
 * - Эти функции запустятся автоматически при регистрации/удалении
 *   пользователей через Firebase Auth
 */
// ========================================
// V2 FUNCTIONS - Enterprise Anti-Loop Architecture
// С полной защитой от infinite loops
// ========================================
var incrementLoginCount_1 = require("./triggers/users/incrementLoginCount");
Object.defineProperty(exports, "incrementLoginCount_v2", { enumerable: true, get: function () { return incrementLoginCount_1.incrementLoginCount; } });
var logUserUpdates_1 = require("./triggers/users/logUserUpdates");
Object.defineProperty(exports, "logUserUpdates_v2", { enumerable: true, get: function () { return logUserUpdates_1.logUserUpdates; } });
var trackUserActivation_1 = require("./triggers/users/trackUserActivation");
Object.defineProperty(exports, "trackUserActivation_v2", { enumerable: true, get: function () { return trackUserActivation_1.trackUserActivation; } });
var updateCompanyMemberCount_1 = require("./triggers/users/updateCompanyMemberCount");
Object.defineProperty(exports, "updateCompanyMemberCount_v2", { enumerable: true, get: function () { return updateCompanyMemberCount_1.updateCompanyMemberCount; } });
// Monitoring
var monitorFunctionLoops_1 = require("./scheduled/monitorFunctionLoops");
Object.defineProperty(exports, "monitorFunctionLoops", { enumerable: true, get: function () { return monitorFunctionLoops_1.monitorFunctionLoops; } });
//# sourceMappingURL=index.js.map