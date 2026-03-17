/**
 * publish-daily-summary.js
 * 
 * Генерирует DevLog-статью с подитогом дня и публикует в коллекцию dev_logs.
 * 
 * Использование:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/<user>_application_default_credentials.json node scripts/publish-daily-summary.js
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
    date: '2026-03-17',
    title: '🤖 Multi-Agent AI Estimator: Детерминистические Инструменты заменяют LLM-математику',
    emoji: '🤖',
    featureId: 'deterministic-circuit-tools',
    featureTitle: 'Multi-Agent AI Estimator — Phase 9',
    type: 'feature',
    timeSpentMinutes: 240,

    tldr: 'Построена мультиагентная система оценки строительных смет на LangGraph. 4 агента (Circuit Designer, Panel Builder, Code Inspector, Pricing RAG) работают в связке React - Flask - LangGraph - Qdrant. Ключевое: вся математика (Manhattan distance, daisy-chaining, подбор автоматов) переведена на детерминистический Python — ноль галлюцинаций LLM, 100% воспроизводимый результат.',

    storyMarkdown: '## \uD83C\uDDF7\uD83C\uDDFA Мультиагентный ИИ Сметчик — как 4 агента считают смету за 3 секунды\n\n### Проблема\nРучной подсчёт строительной сметы — это 2-4 часа на один чертёж. Даже с помощью ChatGPT результаты нестабильны: LLM может «забыть» добавить 15% запас кабеля или неправильно подобрать автомат для влажной зоны.\n\n### Решение: Мультиагентный пайплайн\n\nМы построили конвейер из **4 специализированных агентов**, каждый из которых решает свою задачу:\n\n| Агент | Задача | Технология |\n|-------|--------|-----------|\n| \uD83D\uDD0C **Circuit Designer** | Группировка устройств в цепи, расчёт кабеля | Manhattan Distance + Daisy-Chain |\n| ⚡ **Panel Builder** | Подбор автоматов и сборка щита | NEC/IEC таблицы + RCBO для влажных зон |\n| \uD83E\uDDD0 **Code Inspector** | Проверка на пожарную безопасность | 4 детерминистические проверки |\n| \uD83D\uDCB0 **Pricing RAG** | Поиск цен в базе материалов | Qdrant Vector DB (semantic search) |\n\n### Как считается каждый метр кабеля\n\nФормула длины провода для одной цепи:\n\n```\nTotal = HomeRun + DaisyChain + Drops + 15% Waste\n```\n\n- **Home Run** — Manhattan расстояние от щитка до первого устройства\n- **Daisy Chain** — Manhattan расстояние между устройствами в шлейфе\n- **Drops** — 4ft вниз + 4ft вверх на каждое устройство\n- **+15% Waste** — запас на повороты и обрезки\n\n### Пример: Квартира «Kitchen + Bedroom»\n\n| Цепь | Комната | Автомат | Длина кабеля |\n|------|---------|---------|-------------|\n| C1 | Кухня \uD83D\uDFE6WET | **20A RCBO/GFCI** | 508.9 ft |\n| C2 \uD83D\uDFE7DEDICATED | Кухня (духовка) | **40A Double-Pole** | 537.4 ft |\n| C3 | Спальня | 16A Single-Pole | 848.5 ft |\n\n> Кухня — влажная зона (wet zone). Система автоматически ставит RCBO/GFCI вместо обычного автомата. Духовка >20A — выделенная линия.\n\n### Human-in-the-Loop\n\nПайплайн **останавливается** перед финальной оценкой. Человек видит:\n- ⚡ Таблицу маршрутизации цепей (HomeRun / Chain / Drops / Waste / Total)\n- \uD83D\uDD0C Расписание щита (тип автомата, ампераж, полюсов)\n- \uD83D\uDCCB Полный BOM (Bill of Materials)\n\nТолько после нажатия **«Looks Good, Get Prices»** система запрашивает цены из Qdrant и считает итого.\n\n---\n\n## \uD83C\uDDEC\uD83C\uDDE7 Multi-Agent AI Estimator: How 4 Agents Build a Quote in 3 Seconds\n\n### The Problem\nManual takeoff from a blueprint takes 2-4 hours. Even with ChatGPT, results are inconsistent — LLMs hallucinate wire lengths and forget NEC code requirements.\n\n### The Solution: Deterministic Tool Calls\n\nWe built a **LangGraph pipeline** with 4 specialized agents. The critical insight: instead of asking an LLM to calculate wire lengths (unreliable), we use **deterministic Python functions** that the LLM agents call as tools:\n\n- **Manhattan Distance** — calculates wire routing along walls, not straight lines\n- **Daisy-Chain Optimization** — groups sockets into circuits, connects them in series\n- **NEC/IEC Compliance** — automatically selects RCBO/GFCI breakers for wet zones\n- **Panel Sizing** — picks the right enclosure (12/24/36-way) based on pole count + 20% reserve\n\n### The Pipeline\n\n```\nReact UI -> Flask API -> LangGraph Orchestrator\n    -> Circuit Designer (geometry_tools.py)\n    -> Panel Builder (breaker selection)\n    -> Code Inspector (4 NEC checks, reject -> retry loop)\n    -> Human Review\n    -> Pricing RAG (Qdrant Vector DB)\n    -> $$ Final Estimate\n```\n\n### Key Innovation: JSON 2.0 Input Format\n\nInstead of flat device lists, the system now accepts **room-based structured input** with zone types and scale multipliers. This enables the deterministic tools to make precise calculations based on real-world geometry, replacing LLM guesswork with reproducible Python math.',

    technicalMarkdown: '### Architecture: React - Flask - LangGraph - Qdrant\n\n| File | Role |\n|------|------|\n| `geometry_tools.py` | Deterministic math: Manhattan distance, daisy-chain, wire gauge selection, breaker sizing, NEC compliance |\n| `langgraph_orchestrator.py` | StateGraph pipeline: orchestrator -> circuit_designer -> panel_builder -> qa -> human_review -> pricing |\n| `estimator_api.py` | Flask API bridge (port 8000) — exposes /api/estimate and /api/estimate/resume |\n| `EstimatorLangGraphUI.tsx` | React frontend: Accordion UI for circuits, panel schedule, BOM, human approval |\n\n### Wire Gauge Selection Table (NEC/IEC)\n| Device Type | Wire Gauge | Breaker |\n|-------------|-----------|---------|\n| Lighting / Switches | 1.5 mm2 (14/2 AWG) | 16A |\n| Standard Sockets | 2.5 mm2 (12/2 AWG) | 20A |\n| Ovens / HVAC | 6.0 mm2 (10/2 AWG) | 40A 2P |\n| EV Chargers | 10.0 mm2 (8/3 AWG) | 50A 2P |\n\n### Code Compliance Checks\n1. **Overload** — max 8 devices per 20A circuit\n2. **Wire/Breaker Mismatch** — 40A breaker on 2.5mm2 wire -> REJECT\n3. **Wet Zone Protection** — kitchen/bathroom without RCBO -> REJECT\n4. **Dedicated Lines** — oven sharing circuit with sockets -> REJECT',

    keyTakeaways: [
        'Deterministic Python tools eliminate LLM math hallucinations — wire lengths are 100% reproducible across runs.',
        'Manhattan distance + daisy-chain routing produces ~15% waste margin estimates, close to real-world electrician practice.',
        'Room-based JSON 2.0 input with zone types enables automatic NEC/IEC code compliance without human intervention.',
        'Human-in-the-Loop at the right point (after design, before pricing) builds trust without slowing down the pipeline.',
        'LangGraph StateGraph with SqliteSaver enables pause/resume workflows — critical for construction approval processes.'
    ],

    seoKeywords: ['AI Estimator', 'Multi-Agent System', 'LangGraph', 'Construction Takeoff', 'NEC Compliance', 'Deterministic Tools', 'Circuit Design', 'Manhattan Distance', 'Qdrant RAG', 'Bill of Materials'],
    seoDescription: 'Multi-Agent AI Estimator pipeline using LangGraph with deterministic geometry tools for circuit design, NEC code compliance, and automated pricing via Qdrant Vector DB. Zero LLM math errors.',
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
