const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, '..', 'functions', 'service-account.json');

try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
} catch (e) {
    console.log('No service-account.json found, trying application default credentials...');
    admin.initializeApp();
}

const db = admin.firestore();

// We will inject a Wikipedia-like base article for each core module.
const coreModules = [
    {
        featureTitle: 'Дашборд',
        featureId: 'core-dashboard',
        slug: 'core-dashboard',
        type: 'infrastructure',
        emoji: '📊',
        tldr: 'Центральный пульт управления Profit Step. Аналитика, метрики и быстрые действия (Quick Actions).',
        storyMarkdown: `## Назначение\n\nДашборд (Dashboard) — это главная точка входа в систему для администраторов и менеджеров. Он обеспечивает высокоуровневый обзор здоровья бизнеса: от финансов до активных задач.\n\n## Возможности\n\n- Мониторинг ключевых показателей (KPI).\n- Управление текущими сметами.\n- Быстрый доступ к задачам.\n- Сводка недавних транзакций по Бухгалтерии.`,
        technicalMarkdown: `Дашборд агрегирует данные из коллекций \`dev_logs\`, \`projects\` и \`budget\`. Использует компоненты MUI \`Grid\` для респонсивного отображения карточек.`,
        keywords: ['dashboard', 'analytics', 'kpi'],
    },
    {
        featureTitle: 'Библиотека Проектов',
        featureId: 'project-library',
        slug: 'project-library-wiki',
        type: 'infrastructure',
        emoji: '📁',
        tldr: 'Система хранения проектной документации и версионирования AI-смет. Обеспечивает историчность и перепроверку расчетов.',
        storyMarkdown: `## Библиотека Проектов (Project Library)\n\nЦентрализованное файловое хранилище для каждого строительного объекта. Библиотека заменяет разрозненные папки в Google Drive и связывает чертежи напрямую со сметами в Firebase.\n\n## Контроль Версий (QA)\n\nГлавная особенность библиотеки — **сохранение версий смет**. Вы можете запустить AI Сметчик (Blueprint Estimator), получить Версию 1, затем изменить настройки и получить Версию 2. Система позволяет сравнивать их бок о бок, а также назначать одну из них как "Manual Approved" (Эталон).`,
        technicalMarkdown: `Файлы хранятся в \`Firebase Storage\` по пути \`companies/{companyId}/projects/{projectId}/files/\`. Сметы сохраняются в подколлекцию \`projects/{projectId}/saved_estimates\`. Интерактивное сравнение (Deltas) работает через \`diff\`-алгоритмы на клиенте.`,
        keywords: ['firebase storage', 'versioning', 'blueprints', 'qa'],
    },
    {
        featureTitle: 'AI Сметчик',
        featureId: 'ai-blueprint-estimator',
        slug: 'ai-blueprint-estimator-wiki',
        type: 'feature',
        emoji: '🤖',
        tldr: 'Двухэтапный конвейер (Two-Stage Pipeline) на базе ИИ для автоматизированного распознавания и аудита строительных чертежей.',
        storyMarkdown: `## AI Сметчик (Blueprint Estimator)\n\nAI Сметчик решает сложнейшую задачу электриков и прорабов: чтение планов этажей (Takeoffs) и подсчет материалов. \n\n## Архитектура Two-Stage\n\n1. **Визуальный анализатор (Stage 1):** Модели (Gemini, Claude, OpenAI) получают сканы PDF чертежей и кастомные промпты пользователя, после чего возвращают сырой подсчет розеток, выключателей и щитков.\n2. **Умный Аудитор (Stage 2):** Текстовая LLM-модель берет сырые подсчеты и пропускает их через строительные стандарты (NEC Codes), чтобы срезать "галлюцинации" (ложные срабатывания на картинке) и выдать итоговую математически правильную смету.\n\nФункция способна сократить часы ручной работы до нескольких минут.`,
        technicalMarkdown: `Используется Google Cloud Functions (\`analyzePageCallable\`, \`auditBlueprintTakeoff\`). Промпты динамически подстраиваются под \`projectType\` (Residential/Commercial) и площадь (\`areaSqft\`).`,
        keywords: ['ai', 'estimator', 'takeoffs', 'blueprints', 'gemini', 'claude', 'openai'],
    },
    {
        featureTitle: 'GTD Календарь',
        featureId: 'gtd-task-cockpit',
        slug: 'gtd-task-cockpit-wiki',
        type: 'feature',
        emoji: '🗓️',
        tldr: 'Универсальный Cockpit для ведения задач. Объединяет тайм-трекинг, финансы и канбан-доску на одном экране.',
        storyMarkdown: `## GTD Календарь (Task Cockpit)\n\nВместо разрозненных заметок и списков, GTD Календарь предоставляет "Unified Cockpit" (Единую панель) для управления задачей от "идеи" до "оплаты".\n\n## Особенности\n\n- **Swipeable Layout:** На мобильных устройствах интерфейс разбит на интуитивные вкладки (Свайп-меню).\n- **Встроенный тайм-трекинг:** Прямо в карточке задачи можно запустить счетчик рабочего времени, который учитывает локацию (GPS) и привязывает часы к проекту.\n- **Smart Tasks:** Использование глаголов-действий (Action Verbs) для автоматического распределения задач между отделами.`,
        technicalMarkdown: `Хранится в подколлекции \`gtd_tasks\`. Использует \`React Router\` и \`MUI Tabs\` (со свойством \`variant="scrollable"\` на мобильных). Таймеры глобально синхронизируются через хуки состояния.`,
        keywords: ['gtd', 'tasks', 'kanban', 'time-tracking', 'cockpit'],
    },
    {
        featureTitle: 'Worker Bot',
        featureId: 'telegram-worker-bot',
        slug: 'telegram-worker-bot-wiki',
        type: 'infrastructure',
        emoji: '📱',
        tldr: 'Полевой ассистент прорабов и монтажников в Telegram. Управляет чекинами, расходами и общается голосом.',
        storyMarkdown: `## Worker Bot\n\nСпециальный бот интеграции в Telegram, который "живет" в кармане каждого сотрудника на строительном объекте. Разработан для минимизации трения при внесении данных.\n\n## Функционал\n\n- **Учет времени (Check-ins):** Запуск и остановка смен с подтверждением геолокации.\n- **Shopping Parser:** Распознавание чеков покупок (Receipt OCR) и автоматическое распределение трат по проектам.\n- **Smart Dispatcher:** Позволяет бригадирам отдавать боту голосовые приказы (используя RAG-based Entity Resolution). Бот сам поймет сленг, прозвища и найдет клиента в CRM.`,
        technicalMarkdown: `Реализован через модульную архитектуру webhook в Cloud Functions. Использует \`inboxHandler\`, \`gtdHandler\`, \`shoppingHandler\` и \`sessionHandler\` для обработки контекста.`,
        keywords: ['telegram', 'bot', 'gps', 'time-tracking', 'voice', 'nlp'],
    },
    {
        featureTitle: 'Бухгалтерия',
        featureId: 'finances-ledger',
        slug: 'finances-ledger-wiki',
        type: 'infrastructure',
        emoji: '💸',
        tldr: 'Финансовый модуль (Ledger/Expenses). Парсинг банковских выписок и ведение Schedule C (доходы и расходы).',
        storyMarkdown: `## Бухгалтерия (Finances & Ledger)\n\nПолноценный налоговый и управленческий учет внутри платформы Profit Step. Модуль автоматизирует самую скучную рутину: разнос банковских выписок по правильным строительным категориям.\n\n## Автоматизация (Gemini 2.0 Flash)\n\nПри загрузке PDF из банка, AI автоматически считывает транзакции, выделяет Вендора (например, "Home Depot") и автоматически проставляет налоговую категорию расхода (по стандарту \`Schedule C\`).\nТакже поддерживается защита налогового года (Tax Year Lock) для предотвращения случайных правок старых периодов.`,
        technicalMarkdown: `Использует Firebase Functions (\`analyzeBankStatement\`). Данные записываются в колекцию \`ledger\`. Обучение AI на исправлениях (Vendor Rules) происходит динамически.`,
        keywords: ['finance', 'ledger', 'accounting', 'schedule-c', 'taxes'],
    },
    {
        featureTitle: 'CRM',
        featureId: 'crm',
        slug: 'crm-modules-wiki',
        type: 'infrastructure',
        emoji: '👥',
        tldr: 'Центральный хаб контактов. Ролевой доступ (RBAC), геолокация объектов и управление командой.',
        storyMarkdown: `## CRM (Управление Клиентами)\n\nСердце системы. CRM отвечает за хранение и связывание всех сущностей платформы: людей, проектов и гео-координат.\n\n## Функционал\n\n- **Client Management:** Карточки клиентов (B2B, B2C) с умным парсингом данных сайтов (Smart Parse).\n- **User Access Management:** Строгое разделение прав доступа (Оценщик, Менеджер, Администратор) через RBAC.\n- **Геолокация:** Привязка адресов клиентов к гео-координатам для верификации чекинов Worker Bot-а.`,
        technicalMarkdown: `Сущности хранятся в коллекциях \`clients\` и \`users\`. RBAC опирается на кастомные claims в Firebase Auth для безопасного доступа. Аудит профиля через форму \`UserFormDialog\`.`,
        keywords: ['crm', 'clients', 'rbac', 'security', 'geolocation'],
    }
];

async function seedWiki() {
    console.log('🌱 Starting Wikipedia Content Seeder...');

    for (const mod of coreModules) {
        // 1. Create Feature in `features` collection (if it relies on it)
        try {
            const featureDocRef = db.collection('features').doc(mod.featureId);
            await featureDocRef.set({
                title: mod.featureTitle,
                slug: mod.slug,
                shortDescription: mod.tldr,
                fullDocumentation: mod.storyMarkdown,
                techStack: ['Wiki Data'],
                status: 'stable',
                version: '1.0.0',
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                roadmap: [],
            }, { merge: true });
            console.log(`✅ Upserted Feature: ${mod.featureTitle}`);

            // 2. Create DevLog Post in `dev_logs`
            // We'll set the date slightly back so they serve as foundational logs in the timeline.
            // But DevLog requires them to be ordered by date. Let's space them 1 minute apart 
            // starting from mid-January (to not crowd recent dev updates).
            const mockDate = new Date('2026-01-01T10:00:00Z');

            const logData = {
                featureId: mod.featureId,
                featureTitle: mod.featureTitle,
                authorId: 'system',
                type: mod.type,
                rawInput: {
                    notes: 'Auto-seeded System Wikipedia Article',
                    codeDiff: '',
                    images: [],
                    timeSpentMinutes: 0,
                },
                content: {
                    title: `System Module: ${mod.featureTitle}`,
                    slug: mod.slug,
                    emoji: mod.emoji,
                    tldr: mod.tldr,
                    storyMarkdown: mod.storyMarkdown,
                    technicalMarkdown: mod.technicalMarkdown,
                    keyTakeaways: ['Wiki Reference Entry'],
                },
                seo: {
                    metaDescription: mod.tldr,
                    keywords: mod.keywords,
                },
                isPublished: true,
                publishedAt: admin.firestore.Timestamp.fromDate(mockDate),
                createdAt: admin.firestore.Timestamp.fromDate(mockDate),
            };

            await db.collection('dev_logs').add(logData);
            console.log(`✅ Created DevLog Wiki Entry: ${mod.featureTitle}`);

        } catch (error) {
            console.error(`❌ Failed on ${mod.featureTitle}:`, error);
        }
    }

    console.log('🎉 System Wikipedia seeded successfully!');
    process.exit(0);
}

seedWiki();
