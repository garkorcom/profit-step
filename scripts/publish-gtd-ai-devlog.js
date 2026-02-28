const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

initializeApp({
    credential: applicationDefault(),
    projectId: 'profit-step',
});

const db = getFirestore();

const article = {
    featureId: 'gtd-ai-cockpit-timeline',
    featureTitle: 'AI Cockpit Assistant & History Timeline',
    authorId: 'system',
    type: 'feature',
    rawInput: {
        notes: 'Integrated Claude UI and modifyAiTask Firebase function in GTD Cockpit. Created TaskHistoryTimeline to visualize GTD status changes. Fixed DnD bugs.',
        codeDiff: '',
        images: [],
        timeSpentMinutes: 300,
    },
    content: {
        title: 'AI Ассистент и Таймлайн Истории в GTD | AI Cockpit & History Timeline',
        slug: 'gtd-ai-cockpit-history-timeline',
        emoji: '🤖',
        tldr: 'Интегрировали AI (Claude) прямо в карточку задачи для интерактивного редактирования и добавили красивый Таймлайн истории изменений. | Integrated an AI assistant to interactively edit GTD tasks, alongside a beautiful chronological History Timeline for tracking task evolution.',
        storyMarkdown: `## 🇷🇺 AI Ассистент в GTD Cockpit и Журнал Версий
Мы добавили мощного **Интерактивного AI-Ассистента** прямо в карточку задачи (Cockpit) и реализовали красивый визуальный **Таймлайн Истории** для отслеживания эволюции каждой задачи.

### Что было сделано:
1. **AI Интеграция в Карточку (Smart Cockpit Input):** Теперь вы можете текстово или голосом (с анимацией микрофона) попросить AI "переписать описание", "добавить пункты в чеклист" или "оценить время".
2. **Cloud-Функция \`modifyAiTask\`:** Обновленный алгоритм отправляет запрос к Claude через строгие схемы Zod (Structured Outputs), гарантируя, что AI вернёт идеальный JSON-патч для задачи. Изменения моментально подставляются в локальные поля карточки для визуального ревью перед сохранением.
3. **Хронологический ТАЙМЛАЙН Истории:** Мы переработали вкладку "История". Теперь это красивый вертикальный таймлайн, на котором шаг за шагом фиксируются создание задачи, смена дедлайнов, резолюции AI (\`ai_mutation_snapshot\`) и перетаскивания карточки по Канбан-доске (\`status_changed\`).
4. **Стабильный Drag & Drop:** Провели глубокий аудит и починили "прыгающие" задачи и потерю стейтов при перетаскивании.

---

## 🇬🇧 AI Cockpit Assistant & History Timeline
We've integrated a powerful **Interactive AI Assistant** directly into the GTD task cockpit and implemented a beautiful visual **History Timeline** to track task evolution.

### What's been done:
1. **In-Cockpit AI Integration (Smart Cockpit Input):** You can now use text or voice (with microphone animation UI) to ask the AI to "rewrite the description," "expand the checklist," or "estimate duration."
2. **Cloud Function \`modifyAiTask\`:** A revamped backend algorithm utilizes Claude and strict Zod schemas (Structured Outputs) to guarantee a perfectly formatted JSON patch. Changes are immediately populated into the local task fields for visual review before saving.
3. **Chronological HISTORY TIMELINE:** We redesigned the "History" tab into a beautiful vertical timeline. It seamlessly plots task creation events, deadlines, AI edits (\`ai_mutation_snapshot\`), and Kanban board movements (\`status_changed\`).
4. **Stable Drag & Drop:** Conducted a deep code audit to fix bouncing tasks and state loss during board drag-and-drop operations.`,
        technicalMarkdown: `### 🇷🇺 Технические Детали | 🇬🇧 Technical Details

**Zod Schema for AI Output (\`modifyAiTask.ts\`)**
\`\`\`typescript
const zModifiedTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  checklistItems: z.array(z.object({
    id: z.string(),
    text: z.string(),
    isCompleted: z.boolean()
  })).optional(),
  estimatedDurationMinutes: z.number().optional()
});
\`\`\`

**Task History Timeline Snapshot**
\`\`\`typescript
interface TaskHistoryEvent {
    type: 'created' | 'status_changed' | 'ai_mutation_snapshot' | 'materials_added';
    description: string;
    userId?: string;
    userName?: string;
    timestamp: any;
}
\`\`\``,
        keyTakeaways: [
            'Using LLM Structured Outputs (Zod) is critical for deterministically parsing AI interactions into strict database models without breakage.',
            'Deep cloning is essential during Drag and Drop operations in React to prevent Stale State and optimistic UI revert bugs.',
            'Visual history logs (Timelines) drastically increase user trust by creating transparency on how and when tasks change statuses.'
        ],
    },
    seo: {
        metaDescription: 'Интегрировали AI (Claude) прямо в карточку задачи для интерактивного редактирования и добавили Таймлайн истории. | Integrated an AI assistant to edit GTD tasks, alongside a History Timeline.',
        keywords: ['GTD', 'AI Assistant', 'Claude', 'Zod', 'Firebase Cloud Functions', 'MUI Timeline', 'React DnD'],
    },
    isPublished: true,
    publishedAt: Timestamp.now(),
    createdAt: Timestamp.now(),
};

async function publishDevLog() {
    console.log('Publishing new DevLog...');
    try {
        const docRef = await db.collection('dev_logs').add(article);
        console.log(`✅ Successfully published to dev_logs with ID: ${docRef.id}`);
    } catch (e) {
        console.error('❌ Failed to publish dev log:', e);
    }
    process.exit(0);
}

publishDevLog();
