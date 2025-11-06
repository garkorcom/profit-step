# 🚀 TODO - БУДУЩИЕ ДОРАБОТКИ

**Дата создания**: 2025-11-06
**Статус**: Roadmap для будущих улучшений
**Приоритет**: По мере необходимости

---

## 📋 КРАТКОСРОЧНЫЕ ЗАДАЧИ (1-2 недели)

### 🔧 Технические улучшения

#### 1. Performance Optimization
**Приоритет**: Средний
**Файлы**: `src/pages/admin/TeamAdminPage.tsx`, `src/auth/AuthContext.tsx`

**Задачи:**
- [ ] Добавить виртуализацию для больших списков (react-window)
- [ ] Implement pagination для TeamAdminPage (по 50 пользователей)
- [ ] Добавить debounce для search input (300ms)
- [ ] Оптимизировать re-renders с React.memo
- [ ] Добавить service worker для offline support

**Код для справки:**
```typescript
// TODO: Implement virtualization
import { FixedSizeList } from 'react-window';

// TODO: Add pagination
const USERS_PER_PAGE = 50;
const [page, setPage] = useState(0);
```

---

#### 2. Error Handling
**Приоритет**: Высокий
**Файлы**: Все API файлы в `src/api/`

**Задачи:**
- [ ] Добавить глобальный ErrorBoundary компонент
- [ ] Implement retry logic для failed requests
- [ ] Добавить Sentry для error tracking
- [ ] Улучшить error messages для пользователей
- [ ] Добавить offline detection

**Код для справки:**
```typescript
// TODO: Add ErrorBoundary
class ErrorBoundary extends React.Component {
  componentDidCatch(error, errorInfo) {
    // Log to Sentry
    Sentry.captureException(error);
  }
}

// TODO: Add retry logic
async function retryRequest(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(1000 * Math.pow(2, i)); // Exponential backoff
    }
  }
}
```

---

#### 3. Validation & Forms
**Приоритет**: Средний
**Файлы**: `src/pages/auth/*.tsx`, `src/components/admin/InviteUserDialog.tsx`

**Задачи:**
- [ ] Внедрить react-hook-form для всех форм
- [ ] Добавить Zod для schema validation
- [ ] Улучшить error messages
- [ ] Добавить client-side validation
- [ ] Добавить server-side validation в Cloud Functions

**Код для справки:**
```typescript
// TODO: Migrate to react-hook-form
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email('Неверный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
});
```

---

### 🎨 UI/UX улучшения

#### 4. Responsive Design
**Приоритет**: Высокий
**Файлы**: `src/components/layout/Header.tsx`, все страницы

**Задачи:**
- [ ] Добавить mobile menu (burger menu)
- [ ] Оптимизировать таблицы для mobile (cards вместо table)
- [ ] Добавить touch gestures для mobile
- [ ] Протестировать на разных разрешениях
- [ ] Добавить breakpoints constants

**Код для справки:**
```typescript
// TODO: Add mobile menu
const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

<IconButton
  edge="start"
  color="inherit"
  aria-label="menu"
  onClick={() => setMobileMenuOpen(true)}
  sx={{ display: { xs: 'block', md: 'none' } }}
>
  <MenuIcon />
</IconButton>

// TODO: Responsive table -> cards
const isMobile = useMediaQuery(theme.breakpoints.down('md'));

{isMobile ? (
  <UserCards users={users} />
) : (
  <UserTable users={users} />
)}
```

---

#### 5. Dark Mode
**Приоритет**: Низкий
**Файлы**: `src/App.tsx`, `src/theme/theme.ts` (создать)

**Задачи:**
- [ ] Создать light и dark themes
- [ ] Добавить toggle в Settings
- [ ] Сохранять preference в localStorage
- [ ] Поддержка system preference
- [ ] Smooth transition между темами

**Код для справки:**
```typescript
// TODO: Create theme.ts
export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    // ...
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#90caf9' },
    // ...
  },
});

// TODO: Add theme toggle
const [mode, setMode] = useState<'light' | 'dark'>('light');
const theme = useMemo(
  () => mode === 'light' ? lightTheme : darkTheme,
  [mode]
);
```

---

#### 6. Loading States
**Приоритет**: Средний
**Файлы**: Все страницы с async операциями

**Задачи:**
- [ ] Добавить skeleton screens
- [ ] Улучшить loading indicators
- [ ] Добавить progress bar для file uploads
- [ ] Оптимистичные UI updates
- [ ] Loading states для каждой операции

**Код для справки:**
```typescript
// TODO: Add skeleton loader
import { Skeleton } from '@mui/material';

{loading ? (
  <Skeleton variant="rectangular" width="100%" height={400} />
) : (
  <UserTable users={users} />
)}

// TODO: Optimistic UI update
const handleUpdateRole = async (userId, newRole) => {
  // Optimistic update
  setUsers(prev => prev.map(u =>
    u.id === userId ? { ...u, role: newRole } : u
  ));

  try {
    await updateUserRole(userId, newRole);
  } catch (error) {
    // Revert on error
    loadUsers();
    showError(error);
  }
};
```

---

## 📦 СРЕДНЕСРОЧНЫЕ ЗАДАЧИ (1-2 месяца)

### 🔐 Security & Permissions

#### 7. Advanced Permissions
**Приоритет**: Высокий
**Файлы**: `src/types/user.types.ts`, Cloud Functions

**Задачи:**
- [ ] Гранулярные permissions (не только роли)
- [ ] Permission-based UI (показывать/скрывать элементы)
- [ ] Audit log для всех критических действий
- [ ] 2FA authentication
- [ ] Session management (max sessions, auto logout)

**Структура:**
```typescript
// TODO: Add granular permissions
interface Permission {
  resource: 'users' | 'projects' | 'tasks' | 'documents';
  action: 'create' | 'read' | 'update' | 'delete';
  scope: 'own' | 'team' | 'company' | 'all';
}

interface UserProfile {
  // ...existing fields
  permissions?: Permission[];
  permissionGroups?: string[]; // 'team_lead', 'hr', etc.
}

// Usage
const canEditUser = hasPermission(currentUser, {
  resource: 'users',
  action: 'update',
  scope: 'company'
});
```

---

#### 8. Data Privacy & GDPR
**Приоритет**: Средний
**Файлы**: Новые файлы + API

**Задачи:**
- [ ] Privacy policy page
- [ ] Cookie consent banner
- [ ] Data export feature (GDPR)
- [ ] Data deletion requests
- [ ] Audit trail для personal data access
- [ ] Encryption для sensitive data

**Код для справки:**
```typescript
// TODO: Add data export
export async function exportUserData(userId: string): Promise<Blob> {
  const userData = await getUserProfile(userId);
  const activityLog = await getUserActivityLog(userId);

  const exportData = {
    profile: userData,
    activity: activityLog,
    exportedAt: new Date().toISOString(),
  };

  return new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json'
  });
}
```

---

### 📊 Analytics & Reporting

#### 9. Advanced Analytics
**Приоритет**: Средний
**Файлы**: Новые компоненты в `src/pages/analytics/`

**Задачи:**
- [ ] User activity dashboard
- [ ] Team productivity metrics
- [ ] Custom reports builder
- [ ] Export reports (PDF, Excel)
- [ ] Scheduled reports via email
- [ ] Charts с Chart.js или Recharts

**Компоненты:**
```typescript
// TODO: Create analytics pages
src/pages/analytics/
  ├── AnalyticsDashboard.tsx
  ├── UserActivityReport.tsx
  ├── TeamProductivityReport.tsx
  └── components/
      ├── Chart.tsx
      ├── ReportBuilder.tsx
      └── ExportButton.tsx
```

---

#### 10. Notifications System
**Приоритет**: Высокий
**Файлы**: Новые компоненты + Cloud Functions

**Задачи:**
- [ ] In-app notifications (bell icon)
- [ ] Email notifications
- [ ] Push notifications (PWA)
- [ ] Notification preferences
- [ ] Real-time notifications через Firestore
- [ ] Notification history

**Структура:**
```typescript
// TODO: Create notifications system
interface Notification {
  id: string;
  userId: string;
  type: 'invite' | 'mention' | 'task_assigned' | 'comment';
  title: string;
  message: string;
  read: boolean;
  createdAt: Timestamp;
  actionUrl?: string;
  actionLabel?: string;
}

// Cloud Function
export const sendNotification = functions.firestore
  .document('activityLog/{logId}')
  .onCreate(async (snap, context) => {
    const activity = snap.data();

    // Create notification
    await db.collection('notifications').add({
      userId: activity.targetUserId,
      type: activity.action,
      title: `New ${activity.action}`,
      message: activity.message,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send email if user has email notifications enabled
    if (userPreferences.emailNotifications) {
      await sendEmail({ ... });
    }
  });
```

---

### 🎯 New Modules

#### 11. Projects/Deals Module
**Приоритет**: Высокий
**Файлы**: Создать новую структуру

**Задачи:**
- [ ] CRUD для projects
- [ ] Project dashboard
- [ ] Kanban board для stages
- [ ] Team assignment
- [ ] Time tracking
- [ ] Budget tracking
- [ ] Files/Documents связь

**Структура:**
```typescript
// TODO: Create projects module
interface Project {
  id: string;
  name: string;
  description: string;
  companyId: string;
  clientId?: string;

  // Team
  ownerId: string;
  teamMemberIds: string[];

  // Status
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  stage: string; // Customizable stages
  priority: 'low' | 'medium' | 'high' | 'urgent';

  // Dates
  startDate?: Timestamp;
  endDate?: Timestamp;
  deadline?: Timestamp;

  // Financials
  budgetEstimate?: number;
  budgetActual?: number;
  currency: string;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

// Pages
src/pages/projects/
  ├── ProjectsListPage.tsx
  ├── ProjectDetailPage.tsx
  ├── ProjectKanbanPage.tsx
  └── components/
      ├── ProjectCard.tsx
      ├── ProjectForm.tsx
      └── ProjectTimeline.tsx
```

---

#### 12. Tasks/Calendar Module
**Приоритет**: Высокий
**Файлы**: Создать новую структуру

**Задачи:**
- [ ] CRUD для tasks
- [ ] Kanban board
- [ ] Calendar view
- [ ] Task assignments
- [ ] Subtasks
- [ ] Due dates & reminders
- [ ] Task comments
- [ ] Time tracking

**Структура:**
```typescript
// TODO: Create tasks module
interface Task {
  id: string;
  title: string;
  description: string;
  companyId: string;
  projectId?: string;

  // Assignment
  assignedTo: string[];
  createdBy: string;

  // Status
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';

  // Dates
  dueDate?: Timestamp;
  startDate?: Timestamp;
  completedAt?: Timestamp;

  // Organization
  tags?: string[];
  labels?: string[];

  // Subtasks
  subtasks?: {
    id: string;
    title: string;
    completed: boolean;
  }[];

  // Time tracking
  estimatedHours?: number;
  actualHours?: number;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Pages
src/pages/tasks/
  ├── TasksListPage.tsx
  ├── TaskDetailPage.tsx
  ├── TaskKanbanPage.tsx
  ├── CalendarPage.tsx
  └── components/
      ├── TaskCard.tsx
      ├── TaskForm.tsx
      ├── TaskComments.tsx
      └── TimeTracker.tsx
```

---

#### 13. Documents/Files Module
**Приоритет**: Средний
**Файлы**: Создать новую структуру

**Задачи:**
- [ ] File upload/download
- [ ] Folders structure
- [ ] Version control
- [ ] Share links
- [ ] Permissions
- [ ] Preview для images/PDFs
- [ ] Search по файлам

**Структура:**
```typescript
// TODO: Create documents module
interface Document {
  id: string;
  name: string;
  description?: string;
  companyId: string;

  // File info
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;

  // Organization
  folderId?: string;
  projectId?: string;
  taskId?: string;

  // Access
  uploadedBy: string;
  sharedWith: string[]; // userIds
  public: boolean;
  shareLink?: string;

  // Versioning
  version: number;
  previousVersions?: string[]; // documentIds

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Pages
src/pages/documents/
  ├── DocumentsPage.tsx
  ├── FolderView.tsx
  └── components/
      ├── FileUpload.tsx
      ├── FilePreview.tsx
      ├── FolderTree.tsx
      └── ShareDialog.tsx
```

---

#### 14. Clients/Contractors Module
**Приоритет**: Средний
**Файлы**: Создать новую структуру

**Задачи:**
- [ ] CRUD для clients
- [ ] Contact management
- [ ] Company profiles
- [ ] Interaction history
- [ ] Documents связь
- [ ] Projects связь
- [ ] Communication log

**Структура:**
```typescript
// TODO: Create clients module
interface Client {
  id: string;
  name: string;
  type: 'individual' | 'company';
  companyId: string; // Our company

  // Company info (if type === 'company')
  companyName?: string;
  industry?: string;
  taxId?: string;
  website?: string;

  // Contact info
  email: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    country: string;
    postalCode: string;
  };

  // Relationship
  status: 'lead' | 'client' | 'partner' | 'inactive';
  source: string; // How they found us
  assignedTo: string; // userId

  // Financials
  totalRevenue?: number;
  currency: string;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastContactDate?: Timestamp;
}

// Pages
src/pages/clients/
  ├── ClientsListPage.tsx
  ├── ClientDetailPage.tsx
  └── components/
      ├── ClientCard.tsx
      ├── ClientForm.tsx
      └── InteractionLog.tsx
```

---

## 🔮 ДОЛГОСРОЧНЫЕ ЗАДАЧИ (3-6 месяцев)

### 🌐 Internationalization (i18n)

#### 15. Multi-language Support
**Приоритет**: Средний
**Файлы**: Все компоненты

**Задачи:**
- [ ] Внедрить react-i18next
- [ ] Создать translation files (ru, en, de, fr)
- [ ] Language switcher в Settings
- [ ] RTL support для Arabic/Hebrew
- [ ] Date/Time localization
- [ ] Number formatting по локали

**Код для справки:**
```typescript
// TODO: Setup i18n
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: require('./locales/en.json') },
      ru: { translation: require('./locales/ru.json') },
    },
    lng: 'ru',
    fallbackLng: 'en',
  });

// Usage
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
<Typography>{t('welcome.message')}</Typography>
```

---

### 📱 Mobile Apps

#### 16. React Native App
**Приоритет**: Низкий
**Файлы**: Новый репозиторий

**Задачи:**
- [ ] Setup React Native project
- [ ] Shared types/utils с web app
- [ ] Push notifications
- [ ] Offline support
- [ ] Biometric authentication
- [ ] Camera integration

---

### 🤖 AI & Automation

#### 17. AI Features
**Приоритет**: Низкий
**Файлы**: Новые Cloud Functions + OpenAI integration

**Задачи:**
- [ ] AI-powered search
- [ ] Smart task suggestions
- [ ] Auto-categorization
- [ ] Email draft generation
- [ ] Meeting summarization
- [ ] Predictive analytics

---

### 🔌 Integrations

#### 18. Third-party Integrations
**Приоритет**: Средний
**Файлы**: Новые API integrations

**Задачи:**
- [ ] Google Calendar sync
- [ ] Slack notifications
- [ ] Telegram bot
- [ ] Email providers (Gmail, Outlook)
- [ ] Cloud storage (Google Drive, Dropbox)
- [ ] Payment gateways (Stripe)
- [ ] Webhooks API для external systems

---

## 🏗️ INFRASTRUCTURE & DevOps

### 19. CI/CD Improvements
**Приоритет**: Средний
**Файлы**: `.github/workflows/`, Firebase config

**Задачи:**
- [ ] Automated testing в CI/CD
- [ ] E2E tests с Cypress
- [ ] Visual regression tests
- [ ] Автоматический deploy на staging
- [ ] Preview deployments для PR
- [ ] Performance monitoring

---

### 20. Monitoring & Logging
**Приоритет**: Высокий
**Файлы**: Cloud Functions

**Задачи:**
- [ ] Structured logging
- [ ] Log aggregation (Datadog, CloudWatch)
- [ ] Performance monitoring (Firebase Performance)
- [ ] Error tracking (Sentry)
- [ ] User session replay
- [ ] Custom metrics dashboard

---

## 📝 DOCUMENTATION

### 21. Documentation Improvements
**Приоритет**: Средний
**Файлы**: README, docs/ folder

**Задачи:**
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Component Storybook
- [ ] Architecture diagrams
- [ ] Onboarding guide для новых разработчиков
- [ ] User manual
- [ ] Video tutorials

---

## 🧹 CODE QUALITY

### 22. Code Quality Improvements
**Приоритет**: Высокий
**Файлы**: Все файлы

**Задачи:**
- [ ] Setup ESLint правила (строже)
- [ ] Setup Prettier
- [ ] Pre-commit hooks (Husky)
- [ ] Code coverage минимум 80%
- [ ] TypeScript strict mode
- [ ] Удалить unused code
- [ ] Reduce bundle size

**Конфиг для справки:**
```json
// TODO: .eslintrc.json
{
  "extends": [
    "react-app",
    "airbnb",
    "airbnb-typescript",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "react-hooks/exhaustive-deps": "error",
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "@typescript-eslint/no-unused-vars": "error"
  }
}

// TODO: .prettierrc
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

---

## 🎨 DESIGN SYSTEM

### 23. Component Library
**Приоритет**: Средний
**Файлы**: Создать `src/components/ui/`

**Задачи:**
- [ ] Создать reusable компоненты
- [ ] Design tokens (colors, spacing, typography)
- [ ] Storybook для всех компонентов
- [ ] Accessibility compliance (WCAG 2.1)
- [ ] Component props documentation
- [ ] Usage examples

**Структура:**
```
src/components/ui/
├── Button/
│   ├── Button.tsx
│   ├── Button.stories.tsx
│   ├── Button.test.tsx
│   └── Button.module.css
├── Input/
├── Card/
├── Modal/
└── index.ts
```

---

## 💾 DATABASE

### 24. Database Optimizations
**Приоритет**: Средний
**Файлы**: Firestore rules, indexes

**Задачи:**
- [ ] Query optimization
- [ ] Add missing composite indexes
- [ ] Data archiving strategy
- [ ] Backup automation
- [ ] Data retention policies
- [ ] Audit старых queries

---

## 🔒 SECURITY

### 25. Security Hardening
**Приоритет**: Высокий
**Файлы**: Все

**Задачи:**
- [ ] Security audit
- [ ] Penetration testing
- [ ] Rate limiting для всех endpoints
- [ ] CSRF protection
- [ ] XSS prevention
- [ ] SQL injection prevention (N/A для Firestore, но для будущих интеграций)
- [ ] Security headers
- [ ] Content Security Policy

---

## 📊 ПРИОРИТИЗАЦИЯ

### Критерий приоритизации:

**Высокий приоритет:**
- Влияет на безопасность
- Влияет на performance
- Часто запрашивается пользователями
- Блокирует другие задачи

**Средний приоритет:**
- Улучшает UX
- Упрощает разработку
- Новая функциональность

**Низкий приоритет:**
- Nice to have
- Можно отложить
- Требует много времени

---

## 📅 ROADMAP

### Q1 2026 (Январь - Март)
- [x] ~~V2 Anti-Loop Guards~~ ✅ DONE
- [ ] Projects Module (задача 11)
- [ ] Tasks Module (задача 12)
- [ ] Advanced Permissions (задача 7)
- [ ] Notifications System (задача 10)

### Q2 2026 (Апрель - Июнь)
- [ ] Documents Module (задача 13)
- [ ] Clients Module (задача 14)
- [ ] Analytics Dashboard (задача 9)
- [ ] Mobile Responsive (задача 4)

### Q3 2026 (Июль - Сентябрь)
- [ ] Internationalization (задача 15)
- [ ] Third-party Integrations (задача 18)
- [ ] Performance Optimizations (задачи 1, 24)

### Q4 2026 (Октябрь - Декабрь)
- [ ] React Native App (задача 16)
- [ ] AI Features (задача 17)
- [ ] Security Audit (задача 25)

---

## 📝 NOTES

**Как использовать этот документ:**

1. **Для разработчиков:**
   - Смотрите секции с TODO комментариями
   - Копируйте code snippets как стартовую точку
   - Обновляйте статус задач по мере выполнения

2. **Для менеджеров:**
   - Используйте для планирования спринтов
   - Приоритизируйте задачи по business value
   - Отслеживайте прогресс через roadmap

3. **Для тестировщиков:**
   - Создавайте тест-кейсы по описанным задачам
   - Проверяйте новые фичи согласно requirements

---

**Последнее обновление**: 2025-11-06
**Всего задач**: 25
**Завершено**: 1
**В работе**: 0
**Запланировано**: 24

🤖 Generated with Claude Code
