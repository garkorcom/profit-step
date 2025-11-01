/**
 * API для работы с профилями пользователей в Firestore
 */

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { UserProfile, UserRole } from '../types/user.types';

/**
 * Создает профиль пользователя в Firestore
 * Вызывается после успешной регистрации или входа через Google
 *
 * @param userId - UID пользователя из Firebase Auth
 * @param data - Данные профиля
 */
export const createUserProfile = async (
  userId: string,
  data: {
    email: string;
    displayName: string;
    photoURL?: string;
  }
): Promise<void> => {
  const userRef = doc(db, 'users', userId);

  const profileData: any = {
    email: data.email.toLowerCase(),
    displayName: data.displayName,
    companyId: userId, // По умолчанию companyId = userId (для одиночных пользователей)
    role: 'estimator' as UserRole, // Роль по умолчанию
    photoURL: data.photoURL,
    createdAt: serverTimestamp(),
    onboarded: false,
    status: 'active', // Статус по умолчанию
    lastSeen: serverTimestamp(), // Устанавливаем время создания как первый вход
  };

  await setDoc(userRef, profileData);
  console.log(`✅ User profile created for: ${userId}`);
};

/**
 * Получает профиль пользователя из Firestore
 *
 * @param userId - UID пользователя
 * @returns Профиль пользователя или null
 */
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data();
      return {
        id: userSnap.id,
        ...data,
        // Преобразуем Timestamp в строку для удобства
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      } as UserProfile;
    }

    return null;
  } catch (error) {
    console.error('Error getting user profile:', error);
    throw error;
  }
};

/**
 * Обновляет профиль пользователя
 *
 * @param userId - UID пользователя
 * @param updates - Обновляемые поля
 */
export const updateUserProfile = async (
  userId: string,
  updates: Partial<Omit<UserProfile, 'id' | 'createdAt'>>
): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, updates as any);
    console.log(`✅ User profile updated for: ${userId}`);
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
};

/**
 * Отмечает, что пользователь прошел онбординг
 *
 * @param userId - UID пользователя
 */
export const markUserAsOnboarded = async (userId: string): Promise<void> => {
  await updateUserProfile(userId, { onboarded: true });
};

/**
 * Обновляет время последней активности пользователя
 * Вызывается автоматически при каждом входе
 *
 * @param userId - UID пользователя
 */
export const updateLastSeen = async (userId: string): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      lastSeen: serverTimestamp(),
    } as any);
  } catch (error) {
    // Не выбрасываем ошибку, чтобы не блокировать вход пользователя
    console.error('Error updating lastSeen:', error);
  }
};
