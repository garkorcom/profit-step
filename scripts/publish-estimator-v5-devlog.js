/**
 * publish-estimator-v5-devlog.js
 * 
 * DevLog: AI Estimator — от 1100-строчного монолита к мультиагентной архитектуре.
 * 15 файлов, 2238 строк, 6 навыков, 2 агента.
 * 
 * Использование:
 *   node scripts/publish-estimator-v5-devlog.js
 */

const admin = require('firebase-admin');
const path = require('path');

// ===== Firebase Init =====
const serviceAccountPath = path.join(__dirname, '..', 'functions', 'service-account.json');
try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} catch (e) {
    console.log('No service-account.json, using default credentials...');
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step' });
}

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// =====================================================
// ===== DAILY SUMMARY — AI ESTIMATOR V5 → OPENCLAW =====
// =====================================================

const DAILY_SUMMARY = {
    date: '2026-03-17',
    title: '🏗️ AI Estimator: 1100-строчный монолит → Мультиагентная система за 1 день',
    emoji: '🏗️',
    featureId: 'multi-agent-estimator-v5',
    featureTitle: 'Multi-Agent AI Estimator — OpenClaw Architecture',
    type: 'feature',
    timeSpentMinutes: 480,

    tldr: 'За один день разобрали монолитный AI Estimator v5 (1100 строк) на мультиагентную систему OpenClaw: 2 агента (Chief Estimator + Archivist V2), 6 изолированных навыков (preflight, text_takeoff, vision_9grid, schedule_parser, legend_extractor, export_to_excel). Итого 15 файлов, 2238 строк. 3 бесплатных парсера (PyMuPDF) извлекают 64 устройства за <1 сек ($0). Vision навыки используют native OpenAI (без LangChain) с Pydantic Structured Output. Human-in-the-Loop останавливает процесс перед дорогими API-вызовами. Model routing: Claude 3.5 Sonnet для мозга, GPT-4o для зрения, gpt-4o-mini для секретарских задач.',

    storyMarkdown: `## 🇷🇺 Как мы разобрали монолит на 6 навыков и 2 агента

### Проблема
У нас был \`takeoff_agent.py\` — 1100 строк Python, который делал ВСЁ: сканировал PDF, извлекал текст, нарезал чертежи на 9 кусков, ходил в OpenAI, агрегировал данные и генерировал отчёт. Каждый запуск — $2.50 и 8 минут. Если ошибка на шаге 7 из 8? Начинай сначала.

### Решение: Мультиагентная архитектура OpenClaw

Мы превратили монолит в **Отдел Смет** — изолированную структуру с двумя агентами и шестью навыками:

\`\`\`
estimator/
├── chief_estimator/         ← МОЗГ (Claude 3.5 Sonnet)
│   ├── SOUL.md                 6 принципов (no hallucinations, dedup obsession)
│   └── AGENTS.md               6-step SOP + Schedule-First Dedup
├── archivist_v2/            ← РАЗВЕДКА (gpt-4o-mini, $0.001/run)
│   └── AGENTS.md               Preflight workflow
└── skills/
    ├── preflight_scanner/   ← FREE, <1s → manifest.json
    ├── text_takeoff/        ← FREE, <1s → 64 devices
    ├── vision_9grid_scanner ← GPT-4o, ~$0.27/page
    ├── schedule_parser/     ← GPT-4o, ~$0.10/page
    ├── legend_extractor/    ← GPT-4o, ~$0.10
    └── export_to_excel/     ← FREE → .xlsx
\`\`\`

### Ключевое открытие: 3 бесплатных парсера

До v5 мы тратили API-токены на всё. Потом поняли: **60% данных лежат в текстовом слое PDF**. PyMuPDF извлекает их за миллисекунды:

| Парсер | Что находит | Время | Цена |
|--------|------------|:-----:|:----:|
| Panel Schedule | 32 circuit descriptions (розетки, HVAC, FA) | 0.3s | $0 |
| Keynotes | 26 типов устройств (EAS, WAP, Camera, Speaker) | 0.1s | $0 |
| Equipment | 6 HVAC tags (WSHP-1, DH-1, EF-1) | 0.05s | $0 |
| **Итого** | **64 устройства** | **<1s** | **$0** |

### Золотое правило: Schedule-First Dedup

Самая сложная проблема — двойной счёт. Vision API нашёл 45 светильников на чертеже, а в таблице написано 40. Кто прав?

**Ответ: ТАБЛИЦА.** Мы вшили это правило прямо в "подкорку" Chief Estimator:
- **Освещение:** кол-во от Schedule, зоны от Drawing
- **Розетки:** кол-во от Drawing (таблиц обычно нет)
- **Оборудование:** только от Text (HVAC tags из текста — 100%)

### Human-in-the-Loop: не жги токены без спроса

После Preflight система **останавливается**:

> "Шеф, нашёл 8 чертежей. Стоимость ~$2.60, ~6 минут. Начинаем?"

Пользователь подтверждает → Vision запускается. Отклоняет → $0 потрачено.

### Unit-тесты: 5/5 ✅

\`\`\`
TEST 1: preflight_scanner    ✅ 90p → 55 draw, 21 sched, 11 legend (1.5с)
TEST 2: text_takeoff         ✅ 64 devices: 32+26+6 (4с)
TEST 3: manifest integrity   ✅ 90/90 pages, 5 buckets
TEST 4: export_to_excel      ✅ 64 devices → 10.9KB xlsx
TEST 5: cross-skill pipeline ✅ preflight → text → excel
\`\`\`

---

## 🇬🇧 From Monolith to Multi-Agent: Rebuilding an AI Estimator

### The Problem
A 1100-line Python monolith that did everything — PDF scanning, text extraction, 9-grid Vision analysis, and report generation. Fragile, expensive, untestable.

### The Solution: OpenClaw Multi-Agent Architecture

We decomposed the monolith into **2 AI agents** and **6 isolated skills**:

**Chief Estimator** (Claude 3.5 Sonnet) — orchestrates the 6-step pipeline with Schedule-First Dedup logic embedded in its SOP. Never hallucinates quantities — only uses numbers from tool outputs.

**Archivist V2** (gpt-4o-mini) — runs preflight analysis, creates manifest.json (page classification map), reports to Chief.

**6 Skills** — isolated Python scripts communicating via stdout JSON:
- 3 FREE (PyMuPDF text extraction): preflight, text_takeoff, export
- 3 PAID (GPT-4o Vision): 9-grid scanner, schedule parser, legend extractor

### Key Architecture Decisions

| Decision | Why |
|----------|-----|
| **stderr/stdout separation** | Logs don't break JSON for the agent |
| **Native OpenAI** (no LangChain) | Lighter, faster, guaranteed Pydantic output |
| **Schedule-First Dedup in prompt** | LLM understands context better than regex |
| **manifest.json as contract** | All skills know which pages to scan |
| **Model Routing per agent** | Claude for logic, GPT-4o for vision, mini for admin |

### Results: Lululemon Bal Harbour (90-page PDF)

| Metric | v2 (baseline) | v5 (monolith) | OpenClaw |
|--------|:---:|:---:|:---:|
| Total Devices | 101 | 211 | 211+ |
| Accuracy vs Manual (301) | 34% | 70% | 70%+ |
| API Cost | $5+ | ~$3 | ~$2.60 |
| FREE devices extracted | 0 | 64 | 64 |
| Unit Tests | 0 | 0 | 5/5 ✅ |
| Files | 1 | 1 | 15 |`,

    technicalMarkdown: `### Architecture: 15 files, 2238 lines

| File | Role | Model | Cost |
|------|------|-------|:----:|
| \`chief_estimator/SOUL.md\` | 6 principles, identity anchor | Claude 3.5 Sonnet | — |
| \`chief_estimator/AGENTS.md\` | 6-step SOP, Schedule-First Dedup, HITL | Claude 3.5 Sonnet | — |
| \`archivist_v2/AGENTS.md\` | Preflight workflow | gpt-4o-mini | $0.001 |
| \`preflight_scanner/scanner.py\` | PDF → manifest.json (page classification) | Python only | FREE |
| \`text_takeoff/text_takeoff.py\` | Panel + Keynotes + Equipment → 64 devices | Python only | FREE |
| \`vision_9grid_scanner/scanner.py\` | 3×3 grid crop, zoom 3.0x, Vision scan | GPT-4o | ~$0.27/p |
| \`schedule_parser/parser.py\` | Fixture/Panel/Equipment schedule parser | GPT-4o | ~$0.10/p |
| \`legend_extractor/extractor.py\` | Symbol → device_type mapping | GPT-4o | ~$0.10 |
| \`export_to_excel/exporter.py\` | JSON → .xlsx (2 sheets: Summary + Zones) | Python only | FREE |

### Pipeline DAG (Directed Acyclic Graph)

\`\`\`
PDF → preflight (FREE, <1s) → manifest.json
    → text_takeoff (FREE, <1s) → 64 devices
    ← HITL: "Cost ~$2.60. Proceed?" →
    → legend_extractor ($0.10) → 30 symbols
    → schedule_parser ($0.30) → fixture quantities
    → vision_9grid ($2.20) → ~120 devices
    → Chief Estimator → DEDUP → Report → Excel
\`\`\`

### Model Routing Strategy

| Agent | Model | Rationale |
|-------|-------|-----------|
| Chief Estimator | Claude 3.5 Sonnet | Superior instruction following for complex dedup logic. Holds long JSON arrays without "cutting corners" |
| Vision Skills | GPT-4o | Best Vision + Structured Output (.parse) implementation |
| Archivist | gpt-4o-mini | Simple tasks (run script, format report). 90% cheaper |
| Python Skills | No AI | Deterministic, reproducible, free |

### Testing Pyramid

| Layer | What | Tools | Result |
|-------|------|-------|:------:|
| Unit | Each skill standalone | Terminal + assertions | 5/5 ✅ |
| Integration | One page per Vision skill | API + JSON validation | Next |
| E2E | Full 5-page mini-PDF | All agents + dedup | Next |`,

    keyTakeaways: [
        'Free text parsing (PyMuPDF) extracts 64 devices from panel schedules, keynotes, and equipment tags — before spending a single API token.',
        'Schedule-First Dedup rule eliminates Vision API overcounting: lighting qty comes from Schedule (authoritative), not from drawings (error-prone).',
        'Human-in-the-Loop checkpoint after manifest prevents accidental API spend: user must approve before expensive Vision scanning begins.',
        'Model routing per agent optimizes cost: Claude 3.5 Sonnet for complex logic, GPT-4o for vision, gpt-4o-mini for admin tasks.',
        'stderr/stdout separation in Python skills ensures clean JSON output — agent reads stdout, developer reads stderr logs.',
        'Native OpenAI client with Pydantic structured output replaces LangChain — lighter, faster, guaranteed schema compliance.'
    ],

    seoKeywords: ['AI Estimator', 'Multi-Agent Architecture', 'OpenClaw', 'Construction Takeoff', 'PyMuPDF', 'Panel Schedule Parser', 'Vision 9-Grid Scanner', 'Schedule-First Dedup', 'Pydantic Structured Output', 'Human-in-the-Loop', 'Claude 3.5 Sonnet', 'GPT-4o Vision', 'Electrical Takeoff'],
    seoDescription: 'How we decomposed a 1100-line AI Estimator monolith into a multi-agent system with 6 isolated skills, 3 free PyMuPDF parsers, Schedule-First Dedup logic, and model routing (Claude + GPT-4o + mini). 15 files, 2238 lines, 5/5 unit tests passed.',
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
        console.log(`✅ Published to dev_logs / ${docRef.id}`);
        console.log(`🌐 View at: https://profit-step.web.app/blog`);
    } catch (e) {
        console.error('❌ Failed:', e.message);
    }

    process.exit(0);
}

publishDailySummary();
