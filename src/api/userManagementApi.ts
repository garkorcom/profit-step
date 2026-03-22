/**
 * API для управления пользователями (Admin функции)
 */

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  Timestamp,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast,
  getCountFromServer,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, functions } from '../firebase/firebase';
import { UserProfile, UserRole, UserStatus } from '../types/user.types';
import { costProtectionBreaker } from '../utils/circuitBreaker';

// ============================================
// PAGINATION INTERFACES
// ============================================

/**
 * Результат пагинированного запроса пользователей
 */
export interface PaginatedUsersResult {
  users: UserProfile[];
  total: number;
  firstDoc: DocumentSnapshot | null;
  lastDoc: DocumentSnapshot | null;
  firestoreReads: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * Параметры для пагинированного запроса пользователей
 */
export interface GetPaginatedUsersParams {
  companyId: string;
  pageSize: number;
  startAfterDoc?: DocumentSnapshot;
  endBeforeDoc?: DocumentSnapshot;
  searchQuery?: string;
  statusFilter?: UserStatus | 'all';
  roleFilter?: UserRole | 'all';
  sortBy?: 'displayName' | 'email' | 'createdAt' | 'lastSeen';
  sortOrder?: 'asc' | 'desc';
}

// ============================================
// EXISTING METHODS
// ============================================

/**
 * Получает всех пользователей компании
 * @param companyId - ID компании
 * @returns Массив профилей пользователей
 */
export const getCompanyUsers = async (companyId: string): Promise<UserProfile[]> => {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('companyId', '==', companyId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        // Преобразуем Timestamp в строку для удобства
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        lastSeen: data.lastSeen?.toDate?.()?.toISOString() || data.lastSeen,
        dob: data.dob?.toDate?.()?.toISOString() || data.dob,
      } as UserProfile;
    });
  } catch (error) {
    console.error('Error getting company users:', error);
    throw error;
  }
};

/**
 * Обновляет роль пользователя
 * @param userId - ID пользователя
 * @param role - Новая роль
 */
export const updateUserRole = async (userId: string, role: UserRole): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { role });
    console.log(`✅ User role updated: ${userId} -> ${role}`);
  } catch (error) {
    console.error('Error updating user role:', error);
    throw error;
  }
};

/**
 * Обновляет статус пользователя (активный/неактивный)
 * @param userId - ID пользователя
 * @param status - Новый статус
 */
export const updateUserStatus = async (userId: string, status: UserStatus): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { status });
    console.log(`✅ User status updated: ${userId} -> ${status}`);
  } catch (error) {
    console.error('Error updating user status:', error);
    throw error;
  }
};

/**
 * Загружает аватар пользователя в Firebase Storage
 * @param userId - ID пользователя
 * @param file - Файл изображения
 * @returns URL загруженного файла
 */
export const uploadUserAvatar = async (userId: string, file: File): Promise<string> => {
  try {
    // Создаем ссылку на файл в Storage
    const storageRef = ref(storage, `avatars/${userId}/profile.jpg`);

    // Загружаем файл
    await uploadBytes(storageRef, file);

    // Получаем публичный URL
    const downloadURL = await getDownloadURL(storageRef);

    // Обновляем photoURL в профиле
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { photoURL: downloadURL });

    console.log(`✅ Avatar uploaded for user: ${userId}`);
    return downloadURL;
  } catch (error) {
    console.error('Error uploading avatar:', error);
    throw error;
  }
};

/**
 * Загружает эталонное фото для Face Verification
 * @param userId - ID пользователя
 * @param file - Файл изображения (селфи)
 * @returns URL загруженного файла
 */
export const uploadReferenceFacePhoto = async (userId: string, file: File): Promise<string> => {
  try {
    const storageRef = ref(storage, `avatars/${userId}/reference_face.jpg`);
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { referenceFacePhotoUrl: downloadURL });

    console.log(`✅ Reference face photo uploaded for user: ${userId}`);
    return downloadURL;
  } catch (error) {
    console.error('Error uploading reference face photo:', error);
    throw error;
  }
};

/**
 * Обновляет расширенный профиль пользователя
 * @param userId - ID пользователя
 * @param data - Данные для обновления
 */
export const updateUserExtendedProfile = async (
  userId: string,
  data: {
    displayName?: string;
    title?: string;
    department?: string;
    phone?: string;
    telegramId?: string;
    reportsTo?: string;
    hourlyRate?: number;
    dob?: Date | null;
    referredBy?: string;
  }
): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    const updateData: any = {};

    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.telegramId !== undefined) updateData.telegramId = data.telegramId;
    if (data.reportsTo !== undefined) updateData.reportsTo = data.reportsTo;
    if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate;
    if (data.referredBy !== undefined) updateData.referredBy = data.referredBy;
    if (data.dob !== undefined) {
      updateData.dob = data.dob ? Timestamp.fromDate(data.dob) : null;
    }

    await updateDoc(userRef, updateData);
    console.log(`✅ Extended profile updated for user: ${userId}`);
  } catch (error) {
    console.error('Error updating extended profile:', error);
    throw error;
  }
};

/**
 * Деактивирует пользователя (безопасное "удаление")
 * @param userId - ID пользователя
 */
export const deactivateUser = async (userId: string): Promise<void> => {
  await updateUserStatus(userId, 'inactive');
};

/**
 * Активирует пользователя
 * @param userId - ID пользователя
 */
export const activateUser = async (userId: string): Promise<void> => {
  await updateUserStatus(userId, 'active');
};

/**
 * Удаляет пользователя из Firestore (только документ профиля)
 * ВАЖНО: Этот метод НЕ удаляет пользователя из Firebase Auth!
 * Для полного удаления используйте Cloud Function adminDeleteUser
 * @param userId - ID пользователя
 */
export const deleteUserProfile = async (userId: string): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await deleteDoc(userRef);
    console.log(`✅ User profile deleted: ${userId}`);
  } catch (error) {
    console.error('Error deleting user profile:', error);
    throw error;
  }
};

/**
 * Вызывает Cloud Function для полного и безопасного удаления пользователя
 * Эта функция:
 * - Проверяет права администратора
 * - Переназначает все данные (сметы, проекты) текущему администратору
 * - Удаляет пользователя из Firebase Auth
 * - Удаляет профиль из Firestore
 *
 * @param userIdToDelete - ID пользователя для удаления
 * @returns Promise с результатом операции
 */
export const adminDeleteUser = async (userIdToDelete: string): Promise<{ success: boolean; message: string }> => {
  try {
    // Вызываем Cloud Function (используем централизованный functions из firebase.ts)
    const deleteUserFunction = httpsCallable(functions, 'adminDeleteUser');
    const result = await deleteUserFunction({ userIdToDelete });

    console.log('✅ User deleted successfully:', result.data);
    return result.data as { success: boolean; message: string };
  } catch (error: any) {
    console.error('Error calling adminDeleteUser function:', error);
    throw new Error(error.message || 'Не удалось удалить пользователя');
  }
};

/**
 * Приглашает нового пользователя в команду
 * Вызывает Cloud Function которая:
 * - Создает пользователя в Firebase Auth
 * - Создает профиль в Firestore
 * - Генерирует ссылку для установки пароля
 *
 * @param email - Email пользователя
 * @param displayName - Имя пользователя
 * @param role - Роль пользователя
 * @param title - Должность (опционально)
 * @returns Promise с результатом и ссылкой для установки пароля
 */
export const inviteUser = async (
  email: string,
  displayName: string,
  role: UserRole,
  title?: string
): Promise<{
  success: boolean;
  message: string;
  userId: string;
  passwordResetLink: string;
  emailSent?: boolean;
  emailError?: string;
}> => {
  try {
    // Вызываем Cloud Function (используем централизованный functions из firebase.ts)
    const inviteUserFunction = httpsCallable(functions, 'inviteUser');
    const result = await inviteUserFunction({
      email,
      displayName,
      role,
      title: title || '',
    });

    console.log('✅ User invited successfully:', result.data);
    return result.data as {
      success: boolean;
      message: string;
      userId: string;
      passwordResetLink: string;
      emailSent?: boolean;
      emailError?: string;
    };
  } catch (error: any) {
    console.error('Error calling inviteUser function:', error);
    throw new Error(error.message || 'Не удалось пригласить пользователя');
  }
};

// ============================================
// PAGINATION METHODS
// ============================================

/**
 * Получает общее количество пользователей компании
 * Оптимизированный метод с минимальным количеством Firestore reads
 *
 * Стратегия:
 * 1. Сначала проверяет поле memberCount в документе компании (1 read)
 * 2. Если нет - использует Firestore getCountFromServer() (1 read)
 *
 * @param companyId - ID компании
 * @param statusFilter - Фильтр по статусу (опционально)
 * @param roleFilter - Фильтр по роли (опционально)
 * @returns Количество пользователей
 */
export const getCompanyUserCount = async (
  companyId: string,
  statusFilter?: UserStatus | 'all',
  roleFilter?: UserRole | 'all'
): Promise<number> => {
  try {
    // Если нет фильтров - пытаемся получить из поля memberCount компании
    if ((!statusFilter || statusFilter === 'all') && (!roleFilter || roleFilter === 'all')) {
      try {
        const companyDoc = await getDocs(query(collection(db, 'companies'), where('id', '==', companyId)));
        if (!companyDoc.empty) {
          const companyData = companyDoc.docs[0].data();
          if (companyData.memberCount !== undefined) {
            console.log('📊 User count from company.memberCount:', companyData.memberCount);
            return companyData.memberCount;
          }
        }
      } catch (error) {
        console.warn('⚠️ Could not get memberCount from company doc, falling back to count query');
      }
    }

    // Fallback: используем getCountFromServer с фильтрами
    const usersRef = collection(db, 'users');
    let q = query(usersRef, where('companyId', '==', companyId));

    // Добавляем фильтры если указаны
    if (statusFilter && statusFilter !== 'all') {
      q = query(q, where('status', '==', statusFilter));
    }
    if (roleFilter && roleFilter !== 'all') {
      q = query(q, where('role', '==', roleFilter));
    }

    const countSnapshot = await getCountFromServer(q);
    const count = countSnapshot.data().count;

    console.log('📊 User count from getCountFromServer:', count);
    return count;
  } catch (error) {
    console.error('Error getting company user count:', error);
    throw error;
  }
};

/**
 * Получает пагинированный список пользователей компании
 * Enterprise-grade реализация с защитой от высоких затрат
 *
 * Особенности:
 * - Cursor-based pagination (startAfter/endBefore)
 * - Минимальное количество Firestore reads (только pageSize + 1 для hasNextPage)
 * - Client-side фильтрация по поиску (не тратит reads)
 * - Поддержка сортировки и фильтров
 * - Tracking количества reads для мониторинга
 * - Circuit Breaker защита от runaway costs
 *
 * @param params - Параметры пагинации
 * @returns Результат с пользователями и метаданными пагинации
 */
export const getCompanyUsersPaginated = async (
  params: GetPaginatedUsersParams
): Promise<PaginatedUsersResult> => {
  // Оборачиваем в Circuit Breaker для защиты от перерасхода
  return costProtectionBreaker.execute(async () => {
    const {
      companyId,
      pageSize,
      startAfterDoc,
      endBeforeDoc,
      statusFilter = 'all',
      roleFilter = 'all',
      sortBy = 'displayName',
      sortOrder = 'asc',
      searchQuery,
    } = params;

    try {
      const startTime = performance.now();
      let firestoreReads = 0;

      // 1️⃣ Получаем общее количество (1 read)
      const total = await getCompanyUserCount(companyId, statusFilter, roleFilter);
      firestoreReads += 1;

      // 2️⃣ Строим базовый запрос
      const usersRef = collection(db, 'users');
      let q = query(usersRef, where('companyId', '==', companyId));

      // Добавляем фильтры
      if (statusFilter && statusFilter !== 'all') {
        q = query(q, where('status', '==', statusFilter));
      }
      if (roleFilter && roleFilter !== 'all') {
        q = query(q, where('role', '==', roleFilter));
      }

      // Добавляем сортировку
      const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';
      q = query(q, orderBy(sortBy, sortDirection));

      // 3️⃣ Добавляем курсоры для пагинации
      if (endBeforeDoc) {
        // Назад: загружаем предыдущую страницу
        q = query(q, endBefore(endBeforeDoc), limitToLast(pageSize + 1));
      } else if (startAfterDoc) {
        // Вперед: загружаем следующую страницу
        q = query(q, startAfter(startAfterDoc), limit(pageSize + 1));
      } else {
        // Первая страница
        q = query(q, limit(pageSize + 1));
      }

      // 4️⃣ Выполняем запрос
      const snapshot = await getDocs(q);
      firestoreReads += snapshot.size;

      // Track reads в Circuit Breaker для защиты от перерасхода
      costProtectionBreaker.trackReads(snapshot.size);

      // 5️⃣ Обрабатываем результаты
      let users = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          lastSeen: data.lastSeen?.toDate?.()?.toISOString() || data.lastSeen,
          dob: data.dob?.toDate?.()?.toISOString() || data.dob,
        } as UserProfile;
      });

      // 6️⃣ Определяем hasNextPage/hasPrevPage
      const hasNextPage = users.length > pageSize;
      const hasPrevPage = !!startAfterDoc || !!endBeforeDoc;

      // Если есть следующая страница - убираем последний элемент (он был для проверки)
      if (hasNextPage) {
        users = users.slice(0, pageSize);
      }

      // 7️⃣ Client-side поиск (не тратит reads!)
      if (searchQuery && searchQuery.trim()) {
        const search = searchQuery.toLowerCase().trim();
        users = users.filter((user) => {
          const displayName = user.displayName?.toLowerCase() || '';
          const email = user.email?.toLowerCase() || '';
          const title = user.title?.toLowerCase() || '';
          return displayName.includes(search) || email.includes(search) || title.includes(search);
        });
      }

      // 8️⃣ Получаем первый и последний документы для курсоров
      const firstDoc = snapshot.docs[0] || null;
      const lastDoc = snapshot.docs[users.length - 1] || null;

      const duration = performance.now() - startTime;
      console.log(`✅ Paginated query completed in ${duration.toFixed(0)}ms`);
      console.log(`📊 Firestore reads: ${firestoreReads} (pageSize: ${pageSize})`);
      console.log(`📄 Returned ${users.length} users out of ${total} total`);

      // 9️⃣ Проверка на превышение reads (защита от ошибок)
      const MAX_READS_PER_REQUEST = 100;
      if (firestoreReads > MAX_READS_PER_REQUEST) {
        console.warn(`⚠️ WARNING: Firestore reads (${firestoreReads}) exceeded limit (${MAX_READS_PER_REQUEST})`);
        console.warn('⚠️ This may indicate a configuration error in pagination!');
      }

      // 🔟 Проверяем приближение к лимиту для warning
      const stats = costProtectionBreaker.getStats();
      if (stats.totalReads > stats.warningThreshold && stats.totalReads < stats.warningThreshold + 100) {
        console.warn(`⚠️ Approaching read limit: ${stats.totalReads}/${stats.readLimit}`);
        console.warn(`⚠️ Estimated cost: $${stats.estimatedCost.toFixed(4)}`);
      }

      return {
        users,
        total,
        firstDoc,
        lastDoc,
        firestoreReads,
        hasNextPage,
        hasPrevPage,
      };
    } catch (error) {
      console.error('Error getting paginated users:', error);
      throw error;
    }
  }); // Закрываем costProtectionBreaker.execute()
};
