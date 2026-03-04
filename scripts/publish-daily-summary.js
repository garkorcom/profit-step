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
    date: '2026-03-01',
    title: '🤖 AI Estimator V2: OpenAI Integration & PDF Analytics Export',
    emoji: '🤖',
    featureId: 'electrical-estimator',
    featureTitle: 'Electrical Estimator Pro',
    type: 'feature',
    timeSpentMinutes: 180,

    tldr: 'Внедрён OpenAI (GPT-4o) для кросс-сверки чертежей (вместе с Gemini и Claude). Добавлен выбор ИИ агентов через чекбоксы (Gemini, Claude, OpenAI). Разработан продвинутый PDF экспорт аналитики чертежей с разбивкой по страницам и общей сводкой на базе jsPDF.',

    // Подробное описание (RU + EN, markdown)
    storyMarkdown: `## 🇷🇺 Что сделали сегодня

### Сессия 1: Интеграция OpenAI (GPT-4o) в пайплайн V2
Ранее для анализа чертежей использовались только Gemini и Claude. Теперь:
1. **Поддержка трех ИИ**: Интегрирован OpenAI (GPT-4o) как третий независимый источник для перекрестной сверки распознавания оборудования на проектах.
2. **Адаптация Backend**: Облачная функция \`analyzePageCallable\` переписана на использование \`Promise.allSettled\` с динамическим массивом агентов. 
3. **Безопасная обработка PDF**: Так как GPT-4o не умеет напрямую анализировать PDF-документы (только изображения), реализована строгая типизация (strict null checks), позволяющая безопасно передавать пустые результаты для API OpenAI без падения алгоритма \`compareResults\`.

### Сессия 2: Выбор Агентов & Результаты Сверки
- В компоненте \`BlueprintFileSummary\` добавлены **интерактивные чекбоксы** для включения/отключения конкретных ИИ (✨ Gemini 2.0, 🧠 Claude 3.5, 💬 OpenAI GPT-4o) перед началом сканирования.
- Компонент **PageResultsView** существенно обновлен: статусы сверки (✅ Match / ⚠️ Discrepancy) теперь вычисляются динамически на основе $N$-агентов (вместо жесткой проверки \`A === B\`).

### Сессия 3: Экспорт AI Сводки в PDF 
- Разработана новая утилита \`exportBlueprintPdf.ts\` (на базе \`jsPDF\` + \`jspdf-autotable\`).
- **Глобальная сводка (Global Summary)**: агрегирует суммарные подсчеты со всех обработанных страниц в единую смету.
- **Постраничная разбивка (Drill-down)**: генерирует отдельные таблицы для каждой страницы чертежа с колонками для каждого из используемых ИИ, показывая расхождения мнений моделей до участия человека.
- **Оптимизация шрифтов**: Для избежания огромных бандлов с кириллическими шрифтами Base64, весь каркас PDF (колонки, статусы, метаданные) рендерится на английском, а названия позиций парсятся из локального словаря (\`ITEM_NAMES\`).

---

## 🇬🇧 What We Built Today

### Session 1: OpenAI (GPT-4o) Integration
- Integrated OpenAI into the V2 Estimator Pipeline alongside Gemini and Claude.
- Rewrote the \`analyzePageCallable\` Firebase Function to accept a dynamic \`agents\` array and process them asynchronously via \`Promise.allSettled\`.
- Implemented rigorous TypeScript strict null checks to safely handle OpenAI's inability to natively process PDF payloads, allowing the \`compareResults\` matching algorithm to adapt safely based on actual agent participation.

### Session 2: Dynamic Agent Selection & Cross-Verification
- Added AI Agent selection checkboxes to the blueprint summary UI prior to analysis.
- Updated the Multi-Agent Cross Verification Table (\`PageResultsView\`) to render dynamic columns for $N$ agents and output consensus badges (Match vs. Discrepancy) using array filtering.

### Session 3: Professional PDF Analytics Export
- Developed \`exportBlueprintPdf.ts\` using \`jsPDF\` & \`jspdf-autotable\`.
- Generates a "Global Summary" roll-up table across all files and pages.
- Appends per-page drill-down tables revealing what each individual AI discovered before human refinement.
- Utilizes English scaffolding strings to bypass native Base64 Cyrillic font weight requirements, maintaining a highly lightweight client-side export footprint.`,

    technicalMarkdown: `### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| \`analyzePage.ts\` | \`Promise.allSettled\`, dynamic array mapping, \`safeOpenAi\` casting |
| \`BlueprintFileSummary.tsx\` | Checkboxes state & UI validation for Agent Selection |
| \`PageResultsView.tsx\` | $N$-agent dynamic columns rendering, disparity logic rework |
| \`BlueprintV2Pipeline.tsx\` | Export PDF button injected, \`globalMerged\` aggregation |
| \`exportBlueprintPdf.ts\` | **NEW**: jsPDF multi-table iterative generator utility |

### Архитектура динамической сверки
\`\`\`typescript
const validCounts = [geminiQty, claudeQty, openaiQty].filter(v => v !== null)
const match = validCounts.length > 0 && validCounts.every(v => v === validCounts[0]);
// -> if all match -> ✅
// -> if diverge -> ⚠️
\`\`\`

### PDF Export Stack
\`\`\`text
jsPDF + jspdf-autotable
  -> Project Metadata Header (Agents Used, Date, Page count)
  -> Global Summary AutoTable (Aggregated sums)
  -> loop(pageResults) 
      -> Per-Page AutoTable (Raw Agent inputs)
  -> Column count scales based on the selectedAgents array
\`\`\``,

    keyTakeaways: [
        'Dynamically handling N number of AI agents (1, 2, or 3) required shifting the frontend discrepancy logic from strict `a === b` to array filtering, proving much more scalable.',
        'jsPDFs lack of native Cyrillic support is easily bypassed by keeping the document scaffolding (headers/labels) in English, saving us from injecting a 1MB+ base64 font file into the React bundle.',
        'The `Promise.allSettled` approach in the cloud function ensures that if one specific AI agent API fails (e.g., Anthropic is down), the other agents still return their blueprint estimates flawlessly without crashing the entire run.',
    ],

    seoKeywords: ['Electrical Estimator', 'OpenAI Integration', 'GPT-4o', 'PDF Export', 'Blueprint V2', 'Cross Verification', 'Firebase Cloud Functions'],
    seoDescription: 'Integrated OpenAI GPT-4o into the Electrical Estimator V2 pipeline for triple cross-verification, added dynamic AI agent selection, and built a comprehensive PDF report exporter.',
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
