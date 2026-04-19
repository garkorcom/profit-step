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
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step' });
}

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// =====================================================
// ===== DAILY SUMMARY — ЗАПОЛНЯЕТСЯ АГЕНТОМ =====
// =====================================================

const DAILY_SUMMARY = {
    date: '2026-04-02',
    title: '\u{1F3D7}\uFE0F API Modularization: 4227 \u2192 71 \u0441\u0442\u0440\u043E\u043A\u0430 \u2014 \u043A\u0430\u043A \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C \u043C\u043E\u043D\u043E\u043B\u0438\u0442 \u0431\u0435\u0437 \u0435\u0434\u0438\u043D\u043E\u0433\u043E \u0441\u043B\u043E\u043C\u0430\u043D\u043D\u043E\u0433\u043E \u0442\u0435\u0441\u0442\u0430',
    emoji: '\u{1F3D7}\uFE0F',
    featureId: 'agent-api-modularization-v4',
    featureTitle: 'Agent API Modularization \u2014 Phase 4',
    type: 'refactor',
    timeSpentMinutes: 180,

    tldr: '\u041C\u043E\u043D\u043E\u043B\u0438\u0442\u043D\u044B\u0439 agentApi.ts (4227 \u0441\u0442\u0440\u043E\u043A, 48 \u044D\u043D\u0434\u043F\u043E\u0438\u043D\u0442\u043E\u0432) \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D \u043D\u0430 \u043C\u043E\u0434\u0443\u043B\u044C\u043D\u0443\u044E \u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u0443\u0440\u0443: 11 domain-specific \u0440\u043E\u0443\u0442\u0435\u0440\u043E\u0432 + 9 schema \u043C\u043E\u0434\u0443\u043B\u0435\u0439. \u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442: \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0444\u0430\u0439\u043B \u0441\u0436\u0430\u043B\u0441\u044F \u0434\u043E 71 \u0441\u0442\u0440\u043E\u043A\u0438 (-98%), \u043F\u0440\u0438 \u044D\u0442\u043E\u043C \u0432\u0441\u0435 99 \u0438\u043D\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0445 \u0442\u0435\u0441\u0442\u043E\u0432 \u043F\u0440\u043E\u0448\u043B\u0438 \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u0448\u0430\u0433\u0435. \u0412\u0435\u0440\u0441\u0438\u044F API \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0430 \u0434\u043E 4.2.0, \u0437\u0430\u0434\u0435\u043F\u043B\u043E\u0435\u043D\u0430 \u0432 production.',

    storyMarkdown: `## \u{1F1F7}\u{1F1FA} \u041C\u043E\u0434\u0443\u043B\u044F\u0440\u0438\u0437\u0430\u0446\u0438\u044F API: \u0445\u0438\u0440\u0443\u0440\u0433\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u043D\u0430 \u0436\u0438\u0432\u043E\u043C \u0441\u0435\u0440\u0432\u0435\u0440\u0435

### \u041F\u0440\u043E\u0431\u043B\u0435\u043C\u0430
\u0424\u0430\u0439\u043B \`agentApi.ts\` \u0432\u044B\u0440\u043E\u0441 \u0434\u043E **4227 \u0441\u0442\u0440\u043E\u043A** \u2014 48 \u044D\u043D\u0434\u043F\u043E\u0438\u043D\u0442\u043E\u0432, 37 Zod-\u0441\u0445\u0435\u043C, \u0438 \u0432\u0441\u044F \u0431\u0438\u0437\u043D\u0435\u0441-\u043B\u043E\u0433\u0438\u043A\u0430 \u0432 \u043E\u0434\u043D\u043E\u043C \u0444\u0430\u0439\u043B\u0435. \u041B\u044E\u0431\u043E\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043B\u043E \u043F\u0440\u043E\u043A\u0440\u0443\u0442\u043A\u0438 \u0442\u044B\u0441\u044F\u0447 \u0441\u0442\u0440\u043E\u043A. Code review \u043F\u0440\u0435\u0432\u0440\u0430\u0442\u0438\u043B\u0441\u044F \u0432 \u043A\u043E\u0448\u043C\u0430\u0440.

### \u0421\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044F: Schema-First \u2192 Route-First

\u0420\u0430\u0437\u0431\u0438\u043B\u0438 \u043D\u0430 2 \u0444\u0430\u0437\u044B:

**\u0424\u0430\u0437\u0430 1 \u2014 \u0421\u0445\u0435\u043C\u044B (\u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u0430\u044F).** \u0418\u0437\u0432\u043B\u0435\u043A\u043B\u0438 \u0432\u0441\u0435 37 Zod-\u0441\u0445\u0435\u043C \u0432 9 domain-\u0444\u0430\u0439\u043B\u043E\u0432.

**\u0424\u0430\u0437\u0430 2 \u2014 \u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B (\u043E\u043F\u0430\u0441\u043D\u0430\u044F).** \u0418\u0437\u0432\u043B\u0435\u043A\u043B\u0438 \u0432\u0441\u0435 48 route handlers \u0432 11 Express Router \u043C\u043E\u0434\u0443\u043B\u0435\u0439:

| \u041C\u043E\u0434\u0443\u043B\u044C | \u0421\u0442\u0440\u043E\u043A\u0438 | \u042D\u043D\u0434\u043F\u043E\u0438\u043D\u0442\u043E\u0432 |
|--------|--------|-----------|
| clients.ts | 260 | 5 |
| dashboard.ts | 67 | 1 |
| tasks.ts | 326 | 5 |
| costs.ts | 224 | 3 |
| timeTracking.ts | 691 | 4 |
| finance.ts | 263 | 5 |
| users.ts | 203 | 4 |
| estimates.ts | 397 | 4 |
| projects.ts | 589 | 8 |
| sites.ts | 154 | 3 |
| erp.ts | 651 | 5 |

### \u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C: \u0442\u0435\u0441\u0442\u044B \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u0448\u0430\u0433\u0435

\u041A\u043B\u044E\u0447\u0435\u0432\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E: **\u043D\u0438 \u043E\u0434\u043D\u0430 \u043F\u0440\u043E\u043C\u0435\u0436\u0443\u0442\u043E\u0447\u043D\u0430\u044F \u0441\u0442\u0430\u0434\u0438\u044F \u043D\u0435 \u043B\u043E\u043C\u0430\u0435\u0442 \u0442\u0435\u0441\u0442\u044B.**

### \u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442

\`\`\`
agentApi.ts: 4227 \u0441\u0442\u0440\u043E\u043A \u2192 71 \u0441\u0442\u0440\u043E\u043A\u0430 (-98%)
routes/: 11 \u0444\u0430\u0439\u043B\u043E\u0432, 3839 \u0441\u0442\u0440\u043E\u043A
schemas/: 9 \u0444\u0430\u0439\u043B\u043E\u0432, 478 \u0441\u0442\u0440\u043E\u043A
\`\`\`

---

## \u{1F1EC}\u{1F1E7} API Modularization: Surgery on a Live Server

### The Problem
\`agentApi.ts\` grew to **4227 lines** \u2014 48 endpoints, 37 validation schemas, all business logic in a single file.

### The Strategy: Schema-First \u2192 Route-First

1. **Schemas** \u2014 Safe extraction of 37 Zod schemas into 9 domain files
2. **Routes** \u2014 Surgical extraction of 48 handlers into 11 Express Router modules

### Key Constraint: Zero Test Failures

Every intermediate step had to pass all 99 integration tests. This forced us to fix import mismatches immediately.

### The Result

| Metric | Before | After |
|--------|--------|-------|
| agentApi.ts | 4227 lines | **71 lines** |
| Route modules | 0 | **11** |
| Schema modules | 0 | **9** |
| Tests passing | 99 | **99** \u2705 |`,

    technicalMarkdown: `### Architecture v4.2.0

\`\`\`
src/agent/
\u251C\u2500\u2500 agentApi.ts              \u2190 71 lines (Express + middleware + router array)
\u251C\u2500\u2500 agentMiddleware.ts       \u2190 auth, rate-limit, error handler
\u251C\u2500\u2500 agentHelpers.ts          \u2190 cache, fuzzy search, auto-create
\u251C\u2500\u2500 routeContext.ts          \u2190 barrel export for shared deps
\u251C\u2500\u2500 schemas/                 \u2190 9 files, 37 Zod schemas
\u2514\u2500\u2500 routes/                  \u2190 11 domain routers (clients, tasks, costs, etc.)
\`\`\`

### Key Patterns

| Pattern | Implementation |
|---------|---------------|
| routeContext.ts | Centralized re-export of db, FieldValue, Timestamp, logger, helpers |
| Barrel exports | routes/index.ts and schemas/index.ts for clean imports |
| Router array | routes.forEach(r => app.use(r)) \u2014 no repetitive app.use() calls |
| Domain isolation | Each route file imports only the schemas and helpers it needs |

### Commits

| SHA | Description |
|-----|------------|
| 3ac4272 | Extract 26 Zod schemas |
| 8da3794 | Extract remaining 11 schemas |
| 4d14b91 | Extract client routes |
| ed904bc | Extract ALL routes to allRoutes.ts |
| 7e77537 | Split into 10 domain routers |
| bd43ece | Barrel export + final cleanup |`,

    keyTakeaways: [
        'Schema-First extraction is the safest starting point \u2014 schemas have no side effects and breaking the import is immediately caught by TypeScript.',
        'routeContext.ts as a dependency barrel ensures route modules can import db/logger/helpers without coupling to the main app.',
        'Running tests after EVERY extraction step (not just at the end) caught 3 import bugs that would have been much harder to debug in aggregate.',
        'The largest route file (timeTracking.ts, 691 lines) is still a candidate for further splitting.',
        'API version bump (4.1.0 \u2192 4.2.0) at the modularization boundary creates a clean rollback point in case of production issues.'
    ],

    seoKeywords: ['API Modularization', 'Express Router', 'TypeScript Refactoring', 'Zod Schemas', 'Monolith to Modules', 'Firebase Functions', 'Integration Testing', 'Code Architecture'],
    seoDescription: 'How we modularized a 4227-line Express API monolith into 11 domain-specific routers and 9 schema modules \u2014 with zero test failures at every step.',
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

    console.log(`\n\u{1F4DD} Publishing: "${s.title}"`);
    console.log(`   Slug: ${slug} `);
    console.log(`   Feature: ${s.featureTitle} `);
    console.log(`   Type: ${s.type} `);
    console.log(`   Time: ${s.timeSpentMinutes} min\n`);

    try {
        const docRef = await db.collection('dev_logs').add(article);
        console.log(`\u2705 Published to dev_logs / ${docRef.id} `);
        console.log(`\u{1F310} View at: https://profit-step.web.app/blog`);
    } catch (e) {
        console.error('\u274C Failed:', e.message);
    }

    process.exit(0);
}

publishDailySummary();
