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
const Timestamp = admin.firestore.Timestamp;

const article = {
    featureId: 'blueprint-ai-pipeline',
    featureTitle: 'Multi-Agent Blueprint AI Analysis',
    authorId: 'system',
    type: 'feature',
    rawInput: {
        notes: 'Full overhaul of the Blueprint AI pipeline: native PDF support, enhanced prompts with quadrant scanning, OpenAI smart skip for PDFs, memory optimization, and 7 UX improvements.',
        codeDiff: '',
        images: [],
        timeSpentMinutes: 480,
    },
    content: {
        title: '🏗️ Blueprint AI Pipeline v2: Нативная обработка PDF, 3 агента ИИ | Native PDF Processing, 3 AI Agents',
        slug: 'blueprint-ai-pipeline-v2-native-pdf',
        emoji: '🏗️',
        tldr: 'Полностью переделали Pipeline анализа чертежей: Gemini и Claude читают PDF нативно, OpenAI умно пропускается, промпт с квадрантной стратегией, 7 UX-улучшений. | Rebuilt the Blueprint analysis pipeline: native PDF for Gemini & Claude, smart OpenAI skip, quadrant scanning prompts, and 7 UX improvements.',
        storyMarkdown: `## 🇷🇺 Blueprint AI Pipeline v2

Сегодня мы полностью переделали систему анализа электрических чертежей — от загрузки до результатов.

### 🔥 Проблема
Старая версия использовала \`pdf2pic\` для конвертации PDF → PNG перед отправкой в ИИ. Но \`pdf2pic\` зависит от **GraphicsMagick** и **Ghostscript** — системных утилит, которых нет в Cloud Functions. Результат: все 3 ИИ получали **пустые буферы** и возвращали ошибки.

### ✅ Решение: Нативная обработка PDF

| AI Агент | PDF | Image | Статус |
|----------|-----|-------|--------|
| **Gemini 2.0 Flash** | ✅ \`application/pdf\` inline | ✅ | Основной |
| **Claude Sonnet 4** | ✅ \`document\` type | ✅ | Второй голос |
| **GPT-4o** | ⏭️ Skip (не умеет) | ✅ | Только для изображений |

### 🧠 Улучшенный Промпт
Вместо простого «посчитай устройства» теперь ИИ получает **стратегию сканирования**:
1. Найти **Symbol Legend** на чертеже
2. Разделить план на **4 квадранта** (NW, NE, SW, SE)
3. Сканировать каждый квадрант систематически
4. Сверить с легендой и суммировать

Добавлены **37 стандартных ключей** (было 28) — включая Pool, Generator, Landscape.

### ⚡ 7 Улучшений за 1 день

1. **Промпт**: 37 ключей + квадрантная стратегия
2. **OpenAI Skip**: мгновенный skip для PDF (без 2 бесполезных retry)
3. **Memory**: base64 кодируется 1 раз вместо 3 (~7MB вместо ~21MB)
4. **UI**: OpenAI показывает серый «Skipped (PDF)» вместо красного «Failed»
5. **Таблица**: реальные числа каждого агента (не копия Gemini)
6. **Валидация**: лимит 20MB + проверка формата
7. **PDF Export**: «–» для пропущенных агентов вместо «Err»

---

## 🇬🇧 Blueprint AI Pipeline v2

Today we completely rebuilt the electrical blueprint analysis system — from upload to results.

### 🔥 The Problem
The old version used \`pdf2pic\` to convert PDF → PNG before sending to AI. But \`pdf2pic\` depends on **GraphicsMagick** and **Ghostscript** — system binaries not available in Cloud Functions. Result: all 3 AIs received **empty buffers** and returned errors.

### ✅ Solution: Native PDF Processing

Instead of converting, we now send PDFs **directly** to AI:
- **Gemini 2.0 Flash** — accepts \`application/pdf\` as inline data ✅
- **Claude Sonnet 4** — accepts PDFs via \`document\` content type ✅
- **GPT-4o** — gracefully skipped for PDFs (images only) ⏭️

### 🧠 Enhanced Prompt with Quadrant Strategy
Instead of a simple "count devices," the AI now receives a **scanning strategy**:
1. Locate the **Symbol Legend** on the blueprint
2. Divide the floor plan into **4 quadrants** (NW, NE, SW, SE)
3. Scan each quadrant systematically
4. Cross-reference with legend and sum totals

Added **37 standard keys** (was 28) — including Pool, Generator, and Landscape equipment.

### ⚡ 7 Improvements in 1 Day

1. **Prompt**: 37 keys + quadrant scanning
2. **OpenAI Skip**: instant skip for PDF (no 2 wasted retries)
3. **Memory**: base64 encoded once instead of 3× (~7MB vs ~21MB)
4. **UI**: OpenAI shows gray "Skipped (PDF)" instead of red "Failed"
5. **Table**: real per-agent counts (not Gemini copy for all)
6. **Validation**: 20MB limit + format check
7. **PDF Export**: "–" for skipped agents instead of "Err"`,
        technicalMarkdown: `### 🇷🇺 Технические Детали | 🇬🇧 Technical Details

**Архитектура Pipeline v2**
\`\`\`
User Upload → Storage → Firestore trigger
  → detectMimeType(buffer) → PDF or Image?
  → PDF: Gemini ✅ + Claude ✅ + OpenAI ⏭️
  → Image: Gemini ✅ + Claude ✅ + OpenAI ✅
  → Consensus Engine (median/voting)
  → V3 Arbiter (if discrepancies)
  → Final Result
\`\`\`

**Определение MIME по Magic Bytes**
\`\`\`typescript
export function detectMimeType(buffer: Buffer, fileName: string): string {
    if (buffer[0] === 0x25 && buffer[1] === 0x50) return 'application/pdf'; // %PDF
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
    // fallback to extension...
}
\`\`\`

**BlueprintInput с pre-computed base64**
\`\`\`typescript
export interface BlueprintInput {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    base64: string;   // Pre-computed ONCE
    isPdf: boolean;
}
\`\`\`

**OpenAI Smart Skip**
\`\`\`typescript
export async function analyzeWithOpenAI(input: BlueprintInput) {
    if (input.isPdf) {
        logger.info('OpenAI: PDF → skipping (GPT-4o images only)');
        return null; // Caller treats null as 'skipped'
    }
    // ... normal image analysis
}
\`\`\`

**Измененные файлы:**
- \`functions/src/services/blueprintAIService.ts\` — полный rewrite
- \`functions/src/triggers/firestore/onBlueprintJobCreated.ts\` — интеграция skip logic
- \`functions/src/types/blueprint.types.ts\` — новый статус 'skipped'
- \`src/types/blueprint.types.ts\` — фронтенд типы
- \`src/components/estimates/BlueprintUploadDialog.tsx\` — 4 UX фикса
- \`src/api/blueprintApi.ts\` — без изменений (стабилен)`,
        keyTakeaways: [
            'pdf2pic (and similar native-binary-dependent libraries) fail silently in serverless environments — always verify system dependencies exist in the runtime.',
            'Native PDF support in Gemini and Claude eliminates unnecessary conversion steps and preserves original document quality.',
            'Pre-computing base64 once and sharing across all consumers saves significant memory in serverless functions with tight limits.',
            'Smart agent skipping (returning null vs throwing) prevents wasted retry cycles and provides clearer UX status feedback.',
            'Magic bytes detection is more reliable than file extensions for MIME type identification.',
        ],
    },
    seo: {
        metaDescription: 'Blueprint AI Pipeline v2: нативная обработка PDF через Gemini и Claude, умный skip OpenAI, квадрантная стратегия и 7 UX-улучшений. | Native PDF processing with Gemini & Claude, smart OpenAI skip, and 7 UX improvements.',
        keywords: ['Blueprint AI', 'PDF Analysis', 'Gemini 2.0', 'Claude Sonnet', 'GPT-4o', 'Multi-Agent', 'Electrical Blueprint', 'Firebase Functions', 'Profit Step'],
    },
    isPublished: true,
    publishedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
};

async function publishDevLog() {
    console.log('Publishing Blueprint AI Pipeline v2 DevLog...');
    try {
        const docRef = await db.collection('dev_logs').add(article);
        console.log(`✅ Successfully published to dev_logs with ID: ${docRef.id}`);
    } catch (e) {
        console.error('❌ Failed to publish dev log:', e);
    }
    process.exit(0);
}

publishDevLog();
