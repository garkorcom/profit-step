/**
 * publish-daily-summary.js
 * 
 * Генерирует DevLog-статью с подитогом дня и публикует в коллекцию dev_logs.
 * 
 * Использование:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/<user>_application_default_credentials.json node scripts/publish-daily-summary.js
 * 
 * Инструкция для AI-агента:
 *   1. Агент вызывает этот скрипт в конце рабочей сессии
 *   2. Перед вызовом — агент редактирует DAILY_SUMMARY ниже с актуальными данными
 *   3. Скрипт публикует статью в Firestore → она появляется на /blog
 * 
 * Workflow (для агента):
 *   - Ссылка: /publish-summary
 *   - Агент заполняет DAILY_SUMMARY объект реальными данными сессии
 *   - Запускает: node scripts/publish-daily-summary.js
 */

const admin = require('firebase-admin');
const path = require('path');

// ===== Firebase Init =====
const serviceAccountPath = path.join(__dirname, '..', 'functions', 'service-account.json');
try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
    console.log('No service-account.json, using default credentials with explicit projectId...');
    admin.initializeApp({ projectId: 'profit-step' });
}

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// =====================================================
// ===== DAILY SUMMARY — ЗАПОЛНЯЕТСЯ АГЕНТОМ =====
// =====================================================

const DAILY_SUMMARY = {
    date: '2026-03-05',
    title: '🏗️ Project Library & AI Versioning: Architecture & UX Polish',
    emoji: '🏗️',
    featureId: 'project-library',
    featureTitle: 'Project Library & AI Versioning',
    type: 'feature',
    timeSpentMinutes: 300,

    tldr: 'Завершили огромный блок работ по "Библиотеке Проектов". Теперь сметы объединяются в Проекты, поддерживают версионирование (QA сравнение v1 и v2 от ИИ). Проведена масштабная работа над ошибками сохранения (чистка payload от undefined) и глубокая полировка UX (роутинг, модалки создания).',

    // Подробное описание (RU + EN, markdown)
    storyMarkdown: `![Project Library Architecture](https://images.unsplash.com/photo-1541888081622-38666c1f1742?q=80&w=2000&auto=format&fit=crop)

## 🇷🇺 Что сделали сегодня

Сегодня мы полностью завершили интеграцию **Библиотеки Проектов (Project Library)** и **Версионирования ИИ (Estimate Versioning)**. Это важнейший шаг для перехода приложения от "одноразовых калькуляторов" к полноценной CRM-системе для работы со сметами.

### Сессия 1: Архитектура Проектов и Версионирование
- Реализована иерархия данных: \`Projects\` -> \`Estimates (Versions)\`. Теперь один проект может содержать множество вариантов расчета (например, базовый план v1 и измененный план v2).
- Разработана вкладка **"Сравнение (QA)"**, позволяющая визуально сравнивать версии смет бок о бок. Были добавлены наглядные информационные карточки с расчетом финансовой разницы (Delta Δ) по трем главным метрикам: Total Price, Labor Cost, Materials Cost (с цветовой индикацией).

### Сессия 2: Укрощение Firebase и Багов ИИ
- **Индексы Firestore:** Решена критическая ошибка загрузки списков из-за отсутствующего композитного индекса (\`companyId ASC\`, \`updatedAt DESC\`).
- **Защита от "Галлюцинаций" ИИ:** Была найдена хитрая проблема — при неудачном парсинге сложных чертежей ИИ возвращал \`undefined\` значения для некоторых полей (например, пустой адрес или площадь). При попытке сохранить это в Firestore приложение "падало". Мы внедрили рекурсивную утилиту \`cleanPayload\`, которая жестко санирует любые данные перед отправкой в БД, делая процесс загрузки чертежей пуленепробиваемым.

### Сессия 3: Глубокая Полировка UX (UX Polish)
Мы запустили автоматизированного браузерного агента для прохождения полного E2E (End-to-End) пути пользователя. Он выявил ряд проблем, которые мы немедленно устранили:
1. **Явная Навигация**: Вынесли "Библиотеку проектов" из скрытого меню "Настройки" в главную верхнюю панель (\`AppRouter\`).
2. **Smooth SPA Routing**: Избавились от "моргания" и жесткой перезагрузки страницы при сохранении проекта, перейдя на плавный внутренний роутинг (\`react-router-dom navigate\`).
3. **Modal Создания Проекта**: Теперь при нажатии "Новый проект" сначала всплывает аккуратное модальное окно для ввода названия и адреса, а уже потом открывается калькулятор.
4. **Защита от сиротских смет (Orphaned Saves)**: Стандартное сохранение из калькулятора без привязки к Проекту теперь заблокировано.

---

## 🇬🇧 What We Built Today

Today we successfully completed the integration of the **Project Library** and **AI Estimate Versioning**. This marks a massive transition from a "sandbox calculator" to a robust CRM ecosystem for electrical estimates.

### Session 1: Project Architecture & Versioning
- Implemented a hierarchical data model: \`Projects\` -> \`Estimates (Versions)\`. A single project can now house multiple iterations of an estimate.
- Built a deeply interactive **"Compare (QA)"** tab allowing side-by-side verification of versions. We implemented visual financial delta cards that instantly calculate the mathematical differences (Total Price, Materials, Labor) and color-code increases/decreases.

### Session 2: Taming Firebase & AI Parsing Bugs
- **Firestore Indexing:** Resolved a critical query failure by deploying the necessary composite index (\`companyId ASC\`, \`updatedAt DESC\`).
- **Bulletproof DB Writes:** Discovered a silent crash where AI-generated structures occasionally assigned \`undefined\` to missing fields (like an unparsed address). Since Firebase rejects explicit undefines, we engineered a recursive \`cleanPayload\` utility inside the Blueprint Upload dialog. It aggressively sanitizes the entire deeply-nested object before writing to Firestore.

### Session 3: Deep UX Polish (Phase 5)
Following a comprehensive E2E simulation by an autonomous browser agent, we patched several friction points:
1. **Prominent Navigation**: Moved the Project Library entry point out of a nested Settings dropdown directly onto the primary Top-Bar.
2. **Smooth SPA Nav**: Replaced hard page reloads with seamless React Router transitions upon project save.
3. **Creation Flow Modal**: Introduced a "Create Project" modal interceptor before entering the raw estimator workspace, ensuring metadata is captured upfront.
4. **Orphan Prevention**: Blocked standalone saves if an estimate isn't explicitly linked to a \`projectId\`.`,

    technicalMarkdown: `### Architectural Decisions
| Component | Change |
|------|-----------|
| \`BlueprintUploadDialog.tsx\` | Implemented recursive \`cleanPayload\` traversal to strip \`undefined\` from V1/V2 generated JSON structures before \`setDoc\`. Fixed SPA redirection using \`useNavigate\`. |
| \`ProjectWorkspacePage.tsx\` | Mapped QA Comparison Logic, parsing financial deltas. Corrected MUI Grid v6 syntax. |
| \`SavedEstimatesPage.tsx\` | Migrated from direct estimators to a \`CreateDialog\` interrupter. |
| \`firestore.indexes.json\` | Added composite index for \`projects\` collection. |

### The \`cleanPayload\` Utility
Firebase Admin SDK / Client SDK explicitly fails on \`undefined\` properties within an object. Rather than manually checking every single field returned by the volatile AI parsing pipeline, a unified utility recursively walks the object map and deletes \`undefined\` keys, ensuring 100% stable database writes.`,

    keyTakeaways: [
        'AI structured output is inherently volatile. Implementing aggressive data sanitization (like dropping undefined keys recursively) immediately prior to database writes is a mandatory defense-in-depth practice.',
        'Exploratory UX testing via an automated browser agent proved highly effective at discovering hidden behavioral bugs (e.g., orphaned estimate saves that technically succeed but lack relational keys).',
        'Shifting from full-page reloads (window.location.href) to specialized internal routing (useNavigate) dramatically elevates the perceived performance of the Single Page Application.'
    ],

    seoKeywords: ['Project Library', 'Estimate Versioning', 'Firebase strict nulls', 'React Router SPA', 'UX Polish', 'Automated E2E Testing', 'Firestore Composite Indexes'],
    seoDescription: 'Completed the Project Library and Estimate Versioning ecosystem for Profit Step. Addressed critical Firebase undefined data crashes and polished the SPA user experience via automated agent testing.',
};

// =====================================================
// ===== BUILD & PUBLISH =====
// =====================================================

function buildSlug(title, date) {
    return title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-+/, '')
        .substring(0, 60) + '-' + date.replace(/-/g, '');
}

async function publishDailySummary() {
    const s = DAILY_SUMMARY;
    const slug = buildSlug(s.title, s.date);

    const article = {
        featureId: s.featureId,
        featureTitle: s.featureTitle,
        authorId: 'system',
        type: s.type,
        rawInput: {
            notes: s.tldr,
            codeDiff: '',
            images: [],
            timeSpentMinutes: s.timeSpentMinutes,
        },
        content: {
            title: s.title,
            slug,
            emoji: s.emoji,
            tldr: s.tldr,
            storyMarkdown: s.storyMarkdown,
            technicalMarkdown: s.technicalMarkdown,
            keyTakeaways: s.keyTakeaways,
        },
        seo: {
            metaDescription: s.seoDescription,
            keywords: s.seoKeywords,
        },
        isPublished: true,
        publishedAt: Timestamp.now(),
        createdAt: Timestamp.now(),
    };

    console.log(`\n📝 Publishing: "${s.title}"`);
    console.log(`   Slug: ${slug}`);
    console.log(`   Feature: ${s.featureTitle}`);
    console.log(`   Type: ${s.type}`);
    console.log(`   Time: ${s.timeSpentMinutes} min\n`);

    try {
        const docRef = await db.collection('dev_logs').add(article);
        console.log(`✅ Published to dev_logs/${docRef.id}`);
        console.log(`🌐 View at: https://profit-step.web.app/blog`);
    } catch (e) {
        console.error('❌ Failed:', e.message);
    }

    process.exit(0);
}

publishDailySummary();
