/**
 * Типы для пользователей и профилей
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Роли пользователей в системе
 */
export type UserRole = 'admin' | 'manager' | 'estimator' | 'guest';

/**
 * Статус пользователя в системе
 */
export type UserStatus = 'active' | 'inactive';

/**
 * Профиль пользователя в Firestore
 * Путь: users/{userId}
 */
export interface UserProfile {
  id: string;              // == userId/uid из Firebase Auth
  email: string;           // Email (lowercase)
  displayName: string;     // Имя пользователя
  companyId: string;       // ID компании (для мульти-арендности)
  role: UserRole;          // Роль в системе
  photoURL?: string;       // Ссылка на аватар
  createdAt: Timestamp | string;  // Дата создания
  onboarded: boolean;      // Флаг прохождения онбординга

  // --- Новые поля для управления командой ---
  title?: string;          // Должность (напр., "Ведущий сметчик")
  phone?: string;          // Контактный телефон
  dob?: Timestamp | string;  // Дата рождения (Date of Birth)
  lastSeen?: Timestamp | string;  // Дата последней активности
  status: UserStatus;      // Статус активности ('active' по умолчанию)
}

/**
 * Данные для создания пользователя при регистрации
 */
export interface SignUpData {
  displayName: string;
  email: string;
  password: string;
}

/**
 * Данные для входа
 */
export interface SignInData {
  email: string;
  password: string;
}
