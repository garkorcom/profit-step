# self-docs — portable starter kit

**Каждая страница несёт свой ТЗ, свои тесты, свой фидбек, свои dev notes.**
Zero dependencies. Vanilla JS. Подключается в любой проект (HTML / React / Vue / Next) за 3 минуты.

---

## Что это

Один файл `self-docs.js` — сразу даёт на любой странице:

| Слой | Что делает |
|---|---|
| **UC-counter** в top-bar | `33% 🟢2 🔴1 ⚪2 🔵1` — стата use cases |
| **UC-footer** под контентом | acceptance tests: manual / AI-generated / voice. Статусы 🟢🔴⚪🟡🟣🔵 |
| **ТЗ-footer** | inputs · outputs · characteristics · advantages · benefits · agents · APIs |
| **Floating ❓** в углу | открывает debug drawer: feedback · history · code-snapshot · dev notes |
| **Dev-mode** `Cmd+Shift+D` | включает/выключает full debug panel |
| **Auto-context** при submit | DOM · source · click trail · errors → AI-ready пакет для triage |

Плюс 4 мета-страницы для агрегации (feedback Kanban, master TZ, TZ lint, review).

---

## Установка

### 1. Скопируй файлы

```bash
# скопируй 1 файл — это всё что нужно
curl -O https://raw.githubusercontent.com/.../self-docs.js
```

Или просто скачай `self-docs.js` (~25 KB) и положи в `public/` или `static/`.

### 2. Подключи к странице

```html
<script src="/self-docs.js"></script>
<script>
  SelfDocs.config({ locale: 'en', currentUser: 'alice' });

  SelfDocs.registerPage('users', {
    title: 'Users',
    owner: 'admin',
    purpose: 'CRUD for app users',
    inputs:  [{ name: 'users[]', from: 'UserService', required: true }],
    outputs: [{ name: 'invite',  to: 'UserService.invite', trigger: '+ button' }],
    features:   ['Sortable table', 'Bulk invite'],
    advantages: ['One-click', 'CSV import'],
    benefits:   ['Onboard 10 users/min'],
    agents:     ['auth-guard'],
    apis:       ['POST /api/users/invite'],
    devNotes: {
      rules:   ['Soft-delete only'],
      access:  { roles: ['admin'], permissions: ['users.read'] },
      gotchas: [],
      changelog: [],
    },
  });

  SelfDocs.mount('users');
</script>
```

**Требования к HTML:**
- Контейнер `#page-content` — куда вставятся UC-footer + TZ-footer
- Топбар `.topbar` — куда вставится UC-counter chip

(селекторы настраиваются через `SelfDocs.config({ contentSelector, topbarSelector })`)

### 3. Проверь

Открой страницу, внизу справа увидишь маленькую «?» иконку. Нажми — появится debug drawer. `Cmd+Shift+D` — переключает в dev mode со всеми табами.

---

## React / Next.js

Смотри [examples/react-adapter.tsx](examples/react-adapter.tsx) — готовый компонент:

```tsx
<SelfDocsPage pageId="users" spec={{ title, owner, purpose, ... }}>
  <YourPageContent />
</SelfDocsPage>
```

Просто оберни content страницы. Self-docs layer подключится после mount.

---

## Templates

Готовые HTML-шаблоны в [templates/](templates/):

- `page-template.html` — скелет обычной страницы (скопируй, замени `{{PAGE_ID}}`, `{{PAGE_TITLE}}`)

Генерация новой страницы одной командой:
```bash
PAGE_ID=reports PAGE_TITLE="Reports"
sed -e "s/{{PAGE_ID}}/$PAGE_ID/g" -e "s/{{PAGE_TITLE}}/$PAGE_TITLE/g" \
  starter-kit/templates/page-template.html > src/pages/$PAGE_ID.html
```

---

## Мета-страницы (агрегаторы)

Скопируй из `easytimercost/prototype/`:

| Файл | Что показывает |
|---|---|
| `_feedback.html` | Kanban всех 🐛 со всех страниц — raw→triaged→in-scope→done |
| `_master_tz.html` | Coverage map + roadmap + agents registry + APIs surface |
| `_tz_lint.html` | 11 автоматических проверок целостности (missing owners / sparse / orphan / drift / ...) |
| `_review.html` | Morning entry point — каталог всех страниц |
| `infodebag.html` | Визуальная документация системы (SVG-диаграммы) |

---

## Конфигурация

```js
SelfDocs.config({
  locale: 'en' | 'ru',          // default 'en'
  currentUser: 'alice',
  contentSelector: '#page-content',  // куда инжектить UC/TZ footers
  topbarSelector:  '.topbar',        // куда инжектить UC-counter
  storage: 'localStorage',           // 'localStorage' | custom adapter (см. ниже)

  aiGenerateFn: async (page) => {   // hook для ✨ AI-generate UC кнопки
    const res = await fetch('/api/claude/generate-uc', { method: 'POST', body: JSON.stringify({ page }) });
    return await res.json();  // [{ title, role, preconditions, steps, status }, ...]
  },

  onFeedbackSubmit: (fb) => {        // hook для телеметрии/backend sync
    fetch('/api/feedback', { method: 'POST', body: JSON.stringify(fb) });
  },

  onUseCaseChange: (uc) => { /* ... */ },
});
```

---

## Custom storage (Firestore / Supabase / PostgreSQL)

По умолчанию — localStorage. Для продакшна замени на backend-backed:

```js
// Override STORAGE методы
const FIRESTORE_STORAGE = {
  async listUseCases(pageId) {
    const snap = await firebase.firestore().collection('pages').doc(pageId).collection('useCases').get();
    return snap.docs.map(d => d.data());
  },
  async saveUseCase(uc) { /* ... */ },
  // ... rest of STORAGE API
};

// NOTE: текущая версия uses synchronous STORAGE. For async backend нужно обернуть UI calls.
// v1 roadmap: async storage adapter с cache layer.
```

В v1 — localStorage only. Async-адаптер — на roadmap.

---

## Data model

```ts
interface Page {
  id: string;
  title: string;
  owner: string;              // agent id or human role
  purpose?: string;
  inputs?:  Array<{ name: string; from: string; required?: boolean }>;
  outputs?: Array<{ name: string; to: string; trigger?: string }>;
  features?:   string[];      // Characteristics
  advantages?: string[];      // Over competitors
  benefits?:   string[];      // User outcomes
  agents?:     string[];      // Agent IDs involved
  apis?:       string[];      // Endpoints touched
  devNotes?: {
    rules?:   string[];       // Don't-touch constraints
    access?:  { roles: string[]; envVars: string[]; permissions: string[] };
    gotchas?: Array<{ author: string; date: string; note: string }>;
    changelog?: Array<{ author: string; date: string; change: string }>;
  };
}

interface UseCase {
  id: string;
  pageId: string;
  title: string;
  role: 'admin' | 'user' | 'agent' | 'system' | string;
  preconditions: string[];
  steps: Array<{ action: string; expected: string }>;
  status: 'passing' | 'failing' | 'untested' | 'flaky' | 'draft' | 'spec-only';
  source: 'manual' | 'voice' | 'ai-generated' | 'from-bug';
  lastRun?: string;
  failureReason?: string;
  linkedBugs?: string[];
  createdBy: string;
}

interface Feedback {
  id: string;
  pageId: string;
  type: 'bug' | 'improvement';
  severity: 'low' | 'med' | 'high' | 'blocker';
  text: string;
  status: 'raw' | 'triaged' | 'in-scope' | 'done';
  createdBy: string;
  createdAt: string;
  context?: {                  // auto-attached on submit
    url: string;
    viewport: { w: number; h: number };
    liveDom: string;           // up to 50KB
    sourceFile: string;        // up to 50KB
    lastClicks: Array<{ selector: string; text: string; at: string }>;
    consoleErrors: any[];
  };
  triagedBy?: string;
  suggestedFix?: string;
}
```

---

## API

```js
SelfDocs.config(opts)                  // see Configuration above
SelfDocs.registerPage(id, spec)        // before mount
SelfDocs.mount(pageId)                 // render UC-counter/footer/TZ/debug bar

SelfDocs.storage.listUseCases(pageId?) // all or filtered
SelfDocs.storage.saveUseCase(uc)
SelfDocs.storage.deleteUseCase(id)
SelfDocs.storage.listFeedback(pageId?)
SelfDocs.storage.saveFeedback(fb)

SelfDocs.ucStats(pageId)               // { total, passing, failing, coverage, ... }
SelfDocs.captureContext(pageId)        // async — returns context object
SelfDocs.toggleDevMode()               // toggle + reload
SelfDocs.isDevMode()                   // boolean

SelfDocs.PAGES                         // { [id]: pageSpec }
SelfDocs.UC_STATUS_META                // { passing: { emoji, color }, ... }
```

---

## FAQ

**Q: Работает без framework?**
A: Да. Vanilla JS, 1 файл, 0 dependencies. Работает в любой странице с `<script>`.

**Q: React/Vue/Angular?**
A: Через adapter (React — в examples/). Для Vue/Angular adapter пишется за 10 строк по паттерну React.

**Q: Storage в production?**
A: Сейчас localStorage. Для Firestore/Postgres — override `SelfDocs.storage.*` методы (v1 sync, v2 async).

**Q: Стили конфликтуют с моим CSS?**
A: Все классы префиксованы `sd-` · `uc-` · `dbg-`. Конфликт маловероятен. Стили инлайн injected, override'ятся через !important или отключить `injectStyles()` и сделать свои.

**Q: i18n?**
A: `SelfDocs.config({ locale: 'en' | 'ru' })`. Добавить язык — пропатчить `SelfDocs.I18N.xx = {...}`.

**Q: Multi-tenant?**
A: В v1 через prefix `storageKeys` (`SelfDocs.config({ storageKeys: { useCases: 'tenant-42:useCases' }, ... })`). Full RLS — на backend через custom storage adapter.

---

## Файловая структура starter-kit

```
starter-kit/
├── self-docs.js                     ← единственный обязательный файл (~25KB)
├── README.md                        ← этот файл
├── MIGRATION.md                     ← как перенести из prototype в новый проект
├── templates/
│   └── page-template.html           ← скелет новой страницы
└── examples/
    ├── minimal.html                 ← самый простой пример (работает из коробки)
    └── react-adapter.tsx            ← <SelfDocsPage> компонент для React
```

---

## License

MIT
