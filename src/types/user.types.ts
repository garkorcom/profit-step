/**
 * Типы для пользователей и профилей
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Роли пользователей в системе
 */
export type UserRole = 'superadmin' | 'company_admin' | 'admin' | 'manager' | 'user' | 'estimator' | 'guest';

/**
 * Статус пользователя в системе
 */
export type UserStatus = 'active' | 'inactive';

/**
 * Отделы компании
 */
export type Department = 'sales' | 'procurement' | 'accounting' | 'construction' | 'management' | 'other';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  sales: 'Продажи',
  procurement: 'Снабжение',
  accounting: 'Бухгалтерия',
  construction: 'Строительство',
  management: 'Руководство',
  other: 'Другое',
};

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
  department?: Department; // Отдел (Продажи, Снабжение и т.д.)
  phone?: string;          // Контактный телефон
  telegramId?: string;     // Telegram User ID for bot linking
  reportsTo?: string;      // UID руководителя

  /**
   * Цепочка руководителей от пользователя до топ-менеджера
   * [self, directManager, managerOfManager, ..., topManager]
   * Используется для быстрых запросов иерархии в Firestore
   */
  hierarchyPath?: string[];

  /**
   * Количество прямых подчинённых (денормализовано для быстрого UI)
   * Пересчитывается Cloud Function при изменении reportsTo
   */
  subordinateCount?: number;

  dob?: Timestamp | string;  // Дата рождения (Date of Birth)
  lastSeen?: Timestamp | string;  // Дата последней активности
  status: UserStatus;      // Статус активности ('active' по умолчанию)
  hourlyRate?: number;     // Почасовая ставка (для расчета зарплаты)
  defaultRate?: number;    // Ставка по умолчанию (System Setting)

  // --- Поля для дашбордов ---
  loginCount?: number;     // Количество входов в систему
  invitedBy?: string;      // userId пользователя, который пригласил
  signupMethod?: 'email' | 'google'; // Метод регистрации
  avatarUpdatedAt?: Timestamp | string; // Когда обновлен аватар
  timezone?: string;       // Часовой пояс (напр., 'America/New_York')

  /**
   * AI-friendly aliases for name matching (RAG context)
   * Examples: ["Леша", "Алексей", "Алексею", "Alex"]
   * Used by Smart Dispatcher to match voice mentions to user IDs
   */
  aliases?: string[];

  // --- Face Recognition ---
  referenceFacePhotoUrl?: string; // Эталонное фото для сверки ИИ

  // --- Referral ---
  referredBy?: string; // Кто привёл (имя, контакт или userId)
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
