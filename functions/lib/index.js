"use strict";
/**
 * Cloud Functions для Profit Step
 *
 * Эти функции автоматически управляют жизненным циклом пользователей:
 * - onUserCreate: Создает профиль в Firestore при регистрации
 * - onUserDelete: Очищает данные при удалении аккаунта
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminDeleteUser = exports.onUserDelete = exports.onUserCreate = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
// Инициализация Firebase Admin
admin.initializeApp();
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
//# sourceMappingURL=index.js.map