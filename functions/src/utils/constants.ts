/**
 * Constants for Firebase Functions
 * Централизованные константы для всех функций
 */

export const COLLECTIONS = {
  USERS: 'users',
  COMPANIES: 'companies',
  INVITATIONS: 'invitations',
  USER_LOGS: 'userLogs',
  METRICS: 'metrics',
  PROCESSED_EVENTS: 'processedEvents',
  FUNCTION_ERRORS: 'functionErrors',
  USER_ACTIVATION: 'userActivation',
  ACTIVITY_LOG: 'activityLog',
} as const;

export const FUNCTION_NAMES = {
  // Auth Triggers
  ON_USER_CREATE: 'onUserCreate',
  ON_USER_DELETE: 'onUserDelete',

  // User Document Triggers
  LOG_USER_CREATED: 'logUserCreated',
  LOG_USER_UPDATES: 'logUserUpdates',
  LOG_USER_DELETED: 'logUserDeleted',
  INCREMENT_LOGIN_COUNT: 'incrementLoginCount',
  TRACK_USER_ACTIVATION: 'trackUserActivation',
  UPDATE_COMPANY_MEMBER_COUNT: 'updateCompanyMemberCount',
  INITIALIZE_USER_ACTIVATION: 'initializeUserActivation',

  // Invitation Triggers
  LOG_INVITATION_SENT: 'logInvitationSent',
  LOG_INVITATION_ACCEPTED: 'logInvitationAccepted',
  TRACK_FIRST_INVITE: 'trackFirstInvite',

  // HTTP Functions
  INVITE_USER: 'inviteUser',
  ADMIN_DELETE_USER: 'adminDeleteUser',
  TEST_EMAIL: 'testEmail',
  BREVO_WEBHOOK_HANDLER: 'brevoWebhookHandler',
  TEST_BREVO_WEBHOOK: 'testBrevoWebhook',

  // Scheduled Functions
  AGGREGATE_GROWTH_METRICS: 'aggregateGrowthMetrics',
  AGGREGATE_ENGAGEMENT_METRICS: 'aggregateEngagementMetrics',
  MONITOR_FUNCTION_LOOPS: 'monitorFunctionLoops',

  // Storage Triggers
  PROCESS_AVATAR: 'processAvatar',
} as const;

export const USER_FIELDS = {
  // Основные данные
  UID: 'uid',
  EMAIL: 'email',
  DISPLAY_NAME: 'displayName',
  PHOTO_URL: 'photoURL',
  COMPANY_ID: 'companyId',
  ROLE: 'role',
  TITLE: 'title',
  PHONE: 'phone',
  STATUS: 'status',

  // Счетчики и метрики
  LOGIN_COUNT: 'loginCount',
  IS_ACTIVATED: 'isActivated',
  ACTIVATED_AT: 'activatedAt',

  // Временные метки
  CREATED_AT: 'createdAt',
  LAST_LOGIN_AT: 'lastLoginAt',
  LAST_SEEN: 'lastSeen',

  // Служебные поля для защиты от циклов
  LAST_MODIFIED_BY: 'lastModifiedBy',
  LAST_MODIFIED_AT: 'lastModifiedAt',
  LAST_LOGIN_COUNT_UPDATE: 'lastLoginCountUpdate',
  LAST_ACTIVATION_CHECK: 'lastActivationCheck',
  ONBOARDED: 'onboarded',
} as const;

export const RATE_LIMITS = {
  INVITATIONS_PER_MINUTE: 10,
  INVITATIONS_PER_HOUR: 60,
} as const;

export const TIMEOUTS = {
  DEFAULT: 60, // seconds
  SCHEDULED: 540, // 9 minutes
  PROCESSING: 120, // 2 minutes
} as const;

export const MEMORY = {
  DEFAULT: '256MB',
  HEAVY: '512MB',
  VERY_HEAVY: '1GB',
  SCHEDULED: '2GB',
} as const;

export const BATCH_SIZES = {
  DEFAULT: 500,
  SMALL: 100,
  LARGE: 1000,
} as const;

export const ALERT_THRESHOLDS = {
  INVOCATIONS_PER_5_MIN: 1000,
  ERRORS_PER_HOUR: 100,
} as const;

export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
  INTERNAL: 'INTERNAL',
  FUNCTION_ERROR: 'FUNCTION_ERROR',
} as const;
