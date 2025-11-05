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
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase/firebase';
import { UserProfile, UserRole, UserStatus } from '../types/user.types';

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
 * Обновляет расширенный профиль пользователя
 * @param userId - ID пользователя
 * @param data - Данные для обновления
 */
export const updateUserExtendedProfile = async (
  userId: string,
  data: {
    displayName?: string;
    title?: string;
    phone?: string;
    dob?: Date | null;
  }
): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    const updateData: any = {};

    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.phone !== undefined) updateData.phone = data.phone;
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
    // Импортируем функции Firebase для вызова Cloud Functions
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const functions = getFunctions();

    // Вызываем Cloud Function
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
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const functions = getFunctions();

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
