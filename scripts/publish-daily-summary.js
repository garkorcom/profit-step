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
    title: '🛠️ AI Estimator Stabilization: File Saving & Data Sync Fixes',
    emoji: '🛠️',
    featureId: 'ai-estimator-fixes',
    featureTitle: 'AI Estimator Data Flow',
    type: 'bugfix',
    timeSpentMinutes: 120,

    tldr: 'Исправлены критические ошибки в V2 пайплайне ИИ Сметчика. Восстановлена двусторонняя синхронизация Square Footage (Площадь) между калькулятором и окном анализа ИИ. Исправлено сохранение PDF чертежей и сканов от ИИ в облако. Исправлен UI-баг, из-за которого прятался индикатор работы модели OpenAI GPT-4o.',

    // Подробное описание (RU + EN, markdown)
    storyMarkdown: `![Code Stabilization](https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=2000&auto=format&fit=crop)

## 🇷🇺 Что сделали сегодня

Сегодня мы сфокусировались на стабилизации V2 пайплайна **AI Estimator** (Фазы 11 и 12), устранив досадные ошибки потери данных и проблемы с загрузкой файлов проектов в облако. 

### 1. Двусторонняя синхронизация Square Footage (Sqft)
**Проблема:** Ввод метража (Sqft) в базовом калькуляторе часто сбрасывался или не передавался в диалог ИИ анализа, что приводило к потере данных после применения результатов сканирования.
**Решение:** Внедрен строгий двусторонний мост данных. Если проект уже имеет метраж, он предзаполняет диалог ИИ. Если пользователь меняет метраж во время ИИ пайплайна, новое значение безопасно передается обратно в калькулятор при нажатии кнопки "Apply", ничего не перезатирая.

### 2. Сохранение Чертежей (PDF) и Изображений ИИ (PNG)
**Проблема:** При сохранении проекта (Save Project) в V2 загрузчике, файлы таинственным образом исчезали и не появлялись в Библиотеке Проектов.
**Решение:** Исправлены правила безопасности Firebase Storage (\`storage.rules\`). Теперь оригинальные PDF-файлы и конвертированные ИИ PNG-страницы корректно привязываются к ID проекта и успешно загружаются в облако.

### 3. Восстановление логики OpenAI
**Проблема:** При выборе агента OpenAI GPT-4o система не отображала его в статус-баре, а в финальной таблице рисовалась пустая колонка.
**Решение:** Починили логику динамического вывода агентов в UI (\`gemini + claude + openai\`). В саму таблицу добавлен явный лейбл **"Нет данных / Тайм-аут"**, который корректно высвечивается при ошибках генерации вместо пустых брешей в интерфейсе.

---

## 🇬🇧 What We Built Today

Today\'s focus was stabilizing the **V2 AI Estimator Pipeline** (Phases 11 & 12) by resolving silent data loss issues and diagnosing file upload roadblocks to Google Cloud Storage.

### 1. Bidirectional Square Footage (Sqft) Syncing
**The Bug:** Setting the Square Footage in the main estimator and then launching the AI analysis flow often resulted in the data being dropped or overridden.
**The Fix:** Engineered a strict bidirectional data flow. The main estimator now passes its initial state into the AI modal, and the modal safely passes the validated \`sqft\` metric back out explicitly upon "Apply", preserving the user's manual inputs.

### 2. Original PDF & AI PNG Persistence
**The Bug:** Saving a project straight from the V2 Analysis modal resulted in missing blueprint libraries in the Project Workspace.
**The Fix:** Fixed a blocking Firebase Storage security \`storage.rules\` bug. The system now flawlessly chains the upload of original user PDFs and the processed AI PNG scans, assigning them all to the correct \`projectId\` directory for future auditing.

### 3. OpenAI GPT-4o UI Visibility
**The Bug:** Selecting the OpenAI agent did not update the progress text and returned empty, confusing table columns.
**The Fix:** Overhauled the UI text mapping. The progress label now dynamically parses the selected models (\`gemini + claude + openai\`), and any dropped payloads proactively render an explicit **"No Data / Timeout"** warning rather than an empty void.`,

    technicalMarkdown: `### Architectural Decisions
| Stage | Component | Change |
|------|-----------|-----------|
| **Data Sync** | \`ElectricalEstimatorPage.tsx\` | Decoupled \`sqft\` handling so manual adjustments persist alongside AI responses. |
| **Storage Security** | \`storage.rules\` | Patched restrictive rules to explicitly allow RW auth requests against \`companies/{companyId}/projects/{projectId}/files\`. |
| **Progress State** | \`BlueprintV2Pipeline.tsx\` | Re-wired the UI arrays to display explicit runtime agents dynamically instead of hard-coded defaults. |
`,

    keyTakeaways: [
        'Bidirectional data sharing across modal forms requires robust and explicitly typed callbacks to avoid accidental state overwriting.',
        'Silent failures in cloud architecture are often due to overly restrictive default security rules (Firebase rules). Always cross-reference client payload errors with backend logs.',
        'Intelligent empty states ("No Data / Timeout") dramatically improve UX compared to silent failures or blank inputs, specifically when managing multi-agent AI ecosystems.'
    ],

    seoKeywords: ['AI Estimator', 'React state sync', 'Firebase Storage rules', 'GPT-4o logging', 'Data Persistence', 'Typescript Callbacks'],
    seoDescription: 'Diagnosed and resolved critical architecture bugs in the AI Estimator V2 pipeline including bidirectional data sync, storage rule blockages, and explicit AI model logging.',
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
    console.log(`   Slug: ${slug} `);
    console.log(`   Feature: ${s.featureTitle} `);
    console.log(`   Type: ${s.type} `);
    console.log(`   Time: ${s.timeSpentMinutes} min\n`);

    try {
        const docRef = await db.collection('dev_logs').add(article);
        console.log(`✅ Published to dev_logs / ${docRef.id} `);
        console.log(`🌐 View at: https://profit-step.web.app/blog`);
    } catch (e) {
        console.error('❌ Failed:', e.message);
    }

    process.exit(0);
}

publishDailySummary();
