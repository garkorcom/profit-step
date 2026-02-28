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

const article = {
    featureId: 'crm-contacts-gtd',
    featureTitle: 'Contacts Directory & GTD Integration',
    authorId: 'system',
    type: 'feature',
    rawInput: {
        notes: 'Integration of Central Contacts Directory into GTD. Added GlobalContactQuickAdd and UI lists inside UnifiedCockpitPage.',
        codeDiff: '',
        images: [],
        timeSpentMinutes: 300,
    },
    content: {
        title: 'Справочник Контактов в GTD | Contacts Directory in GTD',
        slug: 'contacts-directory-gtd-integration',
        emoji: '📇',
        tldr: 'Создали Справочник Контактов с геолокацией и интегрировали его прямо в задачи GTD. | Built a Central Contacts Directory with smart GPS capture, and deeply integrated it directly into GTD Tasks.',
        storyMarkdown: `## 🇷🇺 Справочник Контактов и Интеграция с GTD
Мы полностью с нуля разработали и внедрили **«Центральный Справочник Контактов» (Contacts Directory)** и глубоко интегрировали его с модулем управления задач (**GTD**).

### Что было сделано:
1. **База и страница Справочника:** Новая структура данных в Firestore (\`contacts\`) для поддержки множества телефонов/email'ов и гибких ролей (теги).
2. **Умная форма "Быстрого добавления":** Позволяет добавлять контакты на лету, **автоматически захватывая геолокацию устройства**.
3. **Глубокая интеграция с GTD:** В формы создания и редактирования задач добавлен удобный выпадающий список (Autocomplete) для выбора контактов. Теперь можно нажать **"+ Новый контакт"** прямо из задачи, и он моментально привяжется после сохранения.

### Технические решения:
- **Удобное управление телефонами:** Использован подход "dynamic field array" из React Hook Form.
- **Мгновенная привязка:** Колбэк \`onContactAdded\` автоматически дописывает свежесозданный контакт в локальный стейт формы задачи без необходимости закрывать или обновлять интерфейс.
- **Контекст и AI логирование:** При создании контакта форма фиксирует время и создателя, отправляя авто-отчет в общую систему \`devlogs\`.

---

## 🇬🇧 Contacts Directory & GTD Integration
We have successfully designed and implemented the **Central Contacts Directory** from scratch, and deeply integrated it into the Task Management module (**GTD**).

### What's been done:
1. **Directory Page & Database:** A new data structure in Firestore (\`contacts\`) to support multiple phone numbers/emails and flexible roles (tags).
2. **Smart "Quick Add" Form:** Allows adding contacts on the fly, **automatically capturing the device's geolocation** during creation.
3. **Deep GTD Integration:** An Autocomplete multi-select was added to task creation and edit forms. You can now click **"+ New contact"** directly from a task, and it will immediately link to the task upon saving.

### Technical highlights:
- **Dynamic Phone Fields:** Implemented a dynamic field array approach using React Hook Form.
- **Instant Linking:** An \`onContactAdded\` callback automatically appends newly created contacts into the local task form state without any context loss.
- **Context & AI Auditing:** The form captures creation time, creator ID, and sends an automated report to the \`devlogs\` system.`,
        technicalMarkdown: `### 🇷🇺 Технические Детали | 🇬🇧 Technical Details

**Schema: \`contacts\`**
\`\`\`typescript
interface Contact {
  id: string;
  name: string;
  phones: { number: string; label: string }[];
  emails: { address: string; label: string }[];
  roles: string[];
  createdLocation?: { lat: number; lng: number; address?: string };
}
\`\`\`

**GTD Integration**
\`\`\`tsx
<GlobalContactQuickAdd
    open={globalContactOpen}
    onClose={() => setGlobalContactOpen(false)}
    onContactAdded={(newContact) => {
        setContacts(prev => [...prev, newContact].sort((a,b) => a.name.localeCompare(b.name)));
        if (newContact.id) setLinkedContactIds(prev => [...prev, newContact.id!]);
    }}
/>
\`\`\``,
        keyTakeaways: [
            'Seamlessly linking global entities (contacts) within isolated task scopes speeds up operations.',
            'Auto-capturing geolocation during entity creation saves future data-entry time.',
            'Instant callback linking from Global modals drastically improves UX compared to page-refreshes.'
        ],
    },
    seo: {
        metaDescription: 'Мы создали Справочник Контактов с геолокацией и интегрировали его прямо в задачи GTD. | Built a Central Contacts Directory with smart GPS capture, and deeply integrated it directly into GTD Tasks.',
        keywords: ['CRM', 'Contacts', 'GTD', 'React Hook Form', 'Geolocation', 'Firebase'],
    },
    isPublished: true,
    publishedAt: admin.firestore.Timestamp.now(),
    createdAt: admin.firestore.Timestamp.now(),
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
