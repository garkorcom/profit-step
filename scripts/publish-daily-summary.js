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
    date: '2026-02-27',
    title: '⚡ Electrical Estimator: Wire Tab, PDF Export, V2 Pipeline Save & Edit',
    emoji: '⚡',
    featureId: 'electrical-estimator',
    featureTitle: 'Electrical Estimator Pro',
    type: 'feature', // 'feature' | 'bugfix' | 'refactor' | 'infrastructure'
    timeSpentMinutes: 240,

    tldr: 'Добавили Wire & Conduit tab (17 позиций), PDF-экспорт сметы через jsPDF, V2 pipeline review screen с inline editing, metadata, save to Firestore и PDF export. Build ✅.',

    // Подробное описание (RU + EN, markdown)
    storyMarkdown: `## 🇷🇺 Что сделали сегодня

### Сессия 1: V2 Blueprint Pipeline — Save & Edit

V2 pipeline раньше закрывал диалог при нажатии «Применить». Теперь:

1. **Review Screen** — после анализа показывает итоговый экран с результатами
2. **Inline Editing** — количества можно редактировать прямо в таблице
3. **Metadata** — поля Project Name, Address, Area перед сохранением
4. **Save to Firestore** — кнопка «Сохранить проект» через \`savedEstimateApi\`
5. **PDF Export** — экспорт V2 результатов в PDF с group'ированной таблицей
6. **Memory Optimization** — blob'ы невыбранных страниц освобождаются при approve

### Сессия 2: Wire Tab + PDF Export + Диагностика

#### 🔌 Block 5: Wire & Conduit Tab
Новая вкладка **Wire** между Devices и Gear. 17 позиций:
- NM-B Romex: 14/2, 14/3, 12/2, 12/3, 10/2, 10/3
- SER Cable: 6/3, 4/3, 2/0
- EMT Conduit: 1/2", 3/4", 1", 2"
- PVC Conduit: 1", 2"
- MC Cable 12/2, THHN #10

#### 📄 Block 4: PDF Export
Кнопка Export заменена на **Export ▾ dropdown**:
- 📄 Смета (PDF) — jsPDF + autoTable с категориями и summary
- 📥 Download .txt
- 📋 Copy to Clipboard
- 🖨 Print

#### 🔍 Block 3.1: Диагностика
Валидация размера файлов (50MB) уже была реализована в \`addFiles()\`.

---

## 🇬🇧 What We Built Today

### Session 1: V2 Pipeline Save & Edit
- Review screen after analysis (no auto-close)
- Inline quantity editing in results table
- Project metadata fields (name, address, area)
- Save to Firestore via \`savedEstimateApi\`
- PDF export for V2 results
- Memory optimization: release unused page blobs

### Session 2: Wire Tab + PDF Export
- **17 wire/conduit items** in new Wire tab
- **PDF Estimate Export** via jsPDF with categorized tables
- **Export dropdown menu** replacing old txt-only export
- File size validation (50MB) confirmed working`,

    technicalMarkdown: `### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| \`electricalDevices.ts\` | +20 строк: WIRE array (17 items), ITEM_NAMES update |
| \`ElectricalEstimatorPage.tsx\` | Wire tab, wireQty state, PDF export, Export menu |
| \`BlueprintV2Pipeline.tsx\` | editedResult state, memory opt in handleApproveFile |
| \`BlueprintUploadDialog.tsx\` | v2Completed review screen, metadata, save, PDF |

### Архитектура Wire Tab
\`\`\`
WIRE[] (electricalDevices.ts)
  → wireQty state (ElectricalEstimatorPage)
  → processItems(WIRE, wireQty, false) in calc useMemo
  → sectionsData.wire_manual { mat, labor }
  → Summary section + PDF export
\`\`\`

### PDF Export Stack
\`\`\`
jsPDF + jspdf-autotable
  → generateEstimatePDF()
  → Header: project info
  → Sections: only items with qty > 0
  → autoTable per category
  → Summary table
  → pdf.save()
\`\`\``,

    keyTakeaways: [
        'V2 pipeline review screen enables save/edit/export before closing — much better UX than auto-close.',
        'Wire costs in estimator are now split: wire_auto (calculated from device wireType/wireLen) and wire_manual (user-entered wire quantities).',
        'jsPDF + autoTable provides professional PDF estimates without any backend dependency.',
        'Export dropdown (MUI Menu) is cleaner than toggle-based export panel.',
        'Memory optimization: filtering page blobs on approve prevents OOM in browsers with many large blueprint files.',
    ],

    seoKeywords: ['Electrical Estimator', 'Wire Tab', 'PDF Export', 'Blueprint V2', 'jsPDF', 'Profit Step', 'React', 'Firebase'],
    seoDescription: 'Added Wire & Conduit tab (17 items), PDF estimate export, and V2 pipeline review screen with inline editing, Firestore save, and memory optimization.',
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
