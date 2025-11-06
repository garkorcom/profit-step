/**
 * INDEX V2 - Enterprise Anti-Loop Architecture
 *
 * Экспортирует новые версии функций с полной защитой от infinite loops
 * Все функции имеют суффикс _v2 для безопасной миграции
 */

import * as admin from 'firebase-admin';

// Инициализация Firebase Admin (если еще не инициализирован)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ========================================
// USER TRIGGERS (v2 - с полной защитой)
// ========================================

export { incrementLoginCount as incrementLoginCount_v2 } from './triggers/users/incrementLoginCount';
export { logUserUpdates as logUserUpdates_v2 } from './triggers/users/logUserUpdates';
export { trackUserActivation as trackUserActivation_v2 } from './triggers/users/trackUserActivation';
export { updateCompanyMemberCount as updateCompanyMemberCount_v2 } from './triggers/users/updateCompanyMemberCount';

// ========================================
// SCHEDULED FUNCTIONS (v2)
// ========================================

export { monitorFunctionLoops } from './scheduled/monitorFunctionLoops';

// ========================================
// СТАРЫЕ ФУНКЦИИ (для обратной совместимости)
// ========================================
// Импортируем старые функции из оригинального index.ts
// Они будут работать параллельно с новыми до полной миграции

export * from './index';

/**
 * ПЛАН МИГРАЦИИ:
 *
 * ЭТАП 1: Deploy v2 functions (параллельно со старыми)
 * - firebase deploy --only functions:incrementLoginCount_v2
 * - firebase deploy --only functions:logUserUpdates_v2
 * - firebase deploy --only functions:trackUserActivation_v2
 * - firebase deploy --only functions:updateCompanyMemberCount_v2
 * - firebase deploy --only functions:monitorFunctionLoops
 *
 * ЭТАП 2: Тестирование v2 (24 часа)
 * - Мониторинг логов: проверка "⏩" и "✅" сообщений
 * - Проверка processedEvents коллекции
 * - Проверка billing dashboard
 * - Сравнение метрик v1 vs v2
 *
 * ЭТАП 3: Переключение трафика
 * - Удаляем старые функции:
 *   firebase functions:delete incrementLoginCount
 *   firebase functions:delete logUserUpdates
 *   firebase functions:delete trackUserActivation
 *   firebase functions:delete updateCompanyMemberCount
 *
 * ЭТАП 4: Переименование v2 → production
 * - Экспорт без суффикса _v2
 * - Обновление документации
 */
