/**
 * Seed script: создаёт тестовую родительскую задачу + 25 подзадач
 * из сметы "Работы основной контракт Garkor" (фото).
 *
 * Запуск: node functions/seed_garkor_project.js
 */

const admin = require('firebase-admin');
const { execSync } = require('child_process');

// Get Firebase access token from CLI
const token = execSync('firebase login:ci --no-localhost 2>/dev/null || echo ""').toString().trim();

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'profit-step'
});

const db = admin.firestore();

// ═══════════════════════════════════════
// CONFIGURATION — укажи свой UID при необходимости
// ═══════════════════════════════════════
const OWNER_ID = 'mxtAppmSHNgDAVWVBNAfHKZ2e172'; // Denys Harbuzov
const OWNER_NAME = 'Denys Harbuzov';

// ═══════════════════════════════════════
// ESTIMATE DATA from photo (Garkor Contract)
// ═══════════════════════════════════════
const SUBTASKS = [
    { title: '1. Подготовка и управление проектом (GC coordination)', budget: 8500, progress: 90 },
    { title: '2. Резка и восстановление бетонной плиты', budget: 19000, progress: 25 },
    { title: '3. Металлоконструкция (Structural Steel)', budget: 2250, progress: 100 },
    { title: '4. Изготовление и монтаж каркаса (Metal Framing)', budget: 19000, progress: 100 },
    { title: '5. Обшивка гипсокартоном (Drywall Installation)', budget: 17000, progress: 100 },
    { title: '6. Сантехника – Final (Plumbing Final)', budget: 57000, progress: 0 },
    { title: '7. Электрика – Rough-In', budget: 12450, progress: 100 },
    { title: '8. Электрика – Final', budget: 7410, progress: 0 },
    { title: '9. Кровельные работы', budget: 3500, progress: 0 },
    { title: '10. Потолочные системы (Armstrong)', budget: 4200, progress: 0 },
    { title: '11. Установка дверей и фурнитуры + распашные двери 2 шт', budget: 5600, progress: 0 },
    { title: '12. Отделка стен и покраска', budget: 8500, progress: 15 },
    { title: '13. Столярные работы (только установка)', budget: 12670, progress: 0 },
    { title: '14. Специальные элементы (Div.10)', budget: 1900, progress: 0 },
    { title: '15. Доп Электрика новые линии (Эст 213)', budget: 3200, progress: 100 },
    { title: '16. Доп планировка (+1 точка су финал) Эст 216', budget: 5550, progress: 100 },
    { title: '17. Заделка отверстий коммуникаций Эст 302', budget: 2100, progress: 100 },
    { title: '18. Покраска потолка всего помещения Эст 303', budget: 3800, progress: 0 },
    { title: '19. Центральная лестра (примерный расчёт)', budget: 2500, progress: 0 },
    { title: '20. Устройство центр. фальшивы 2 шт Эст 304', budget: 1800, progress: 0 },
    { title: '21. Монтаж нового трансформатора Эст 305', budget: 3200, progress: 100 },
    { title: '22. Укладка мозаичной плитки во входной зоне Эст 309', budget: 2250, progress: 0 },
    { title: '23. Уст. дисконектора по требованию инспектора Эст 310', budget: 2400, progress: 0 },
];

async function seed() {
    const ownerId = OWNER_ID;
    const now = admin.firestore.Timestamp.now();

    // 1. Create parent task
    console.log('\n📦 Creating parent task: "Работы основной контракт Garkor"...');
    const parentRef = await db.collection('gtd_tasks').add({
        title: 'Работы основной контракт Garkor',
        description: 'Основной контракт на строительные работы. Смета: $194,981. Оплачено: $147,000. Дебет: $47,995.\n\nHVAC (Mechanical) — субподрядчик: $42,285 (61% оплачено).\n\nВсего по проекту: $311,072 (оплачено $241,620, дебет $69,452).',
        status: 'next_action',
        priority: 'high',
        context: 'Garkor',
        createdAt: now,
        updatedAt: now,
        ownerId: ownerId,
        ownerName: OWNER_NAME,
        // Financial summary
        budgetAmount: 194981,
        progressPercentage: 0, // Will be calculated from subtasks
        totalTimeSpentMinutes: 0,
        totalEarnings: 0,
    });

    const parentId = parentRef.id;
    console.log(`   ✅ Parent created: ${parentId}`);

    // 2. Create subtasks
    console.log(`\n📋 Creating ${SUBTASKS.length} subtasks...\n`);

    let totalBudget = 0;
    let totalCompleted = 0;

    for (const st of SUBTASKS) {
        const completedAmount = st.budget * (st.progress / 100);
        totalBudget += st.budget;
        totalCompleted += completedAmount;

        const ref = await db.collection('gtd_tasks').add({
            title: st.title,
            description: '',
            status: st.progress >= 100 ? 'done' : 'next_action',
            priority: 'none',
            context: 'Garkor',
            createdAt: now,
            updatedAt: now,
            ...(st.progress >= 100 && { completedAt: now }),
            ownerId: ownerId,
            ownerName: OWNER_NAME,
            // Subtask fields
            parentTaskId: parentId,
            isSubtask: true,
            budgetAmount: st.budget,
            progressPercentage: st.progress,
            totalTimeSpentMinutes: 0,
            totalEarnings: 0,
        });

        const bar = '█'.repeat(Math.floor(st.progress / 5)) + '░'.repeat(20 - Math.floor(st.progress / 5));
        console.log(`   ${st.progress >= 100 ? '✅' : st.progress > 0 ? '🔶' : '⬜'} ${st.title}`);
        console.log(`      Budget: $${st.budget.toLocaleString()} | Progress: [${bar}] ${st.progress}% | Completed: $${completedAmount.toLocaleString()}`);
    }

    // 3. Update parent with aggregated progress
    const overallPct = totalBudget > 0 ? Math.round((totalCompleted / totalBudget) * 100) : 0;
    await parentRef.update({ progressPercentage: overallPct });

    console.log('\n' + '═'.repeat(60));
    console.log(`📊 ИТОГО:`);
    console.log(`   Бюджет:   $${totalBudget.toLocaleString()}`);
    console.log(`   Выполн.:  $${Math.round(totalCompleted).toLocaleString()}`);
    console.log(`   Прогресс: ${overallPct}%`);
    console.log(`   Подзадач: ${SUBTASKS.length}`);
    console.log(`   Parent ID: ${parentId}`);
    console.log('═'.repeat(60));
    console.log('\n🎉 Тестовый проект создан! Открой GTD Board чтобы увидеть.');
}

seed()
    .then(() => process.exit(0))
    .catch(e => { console.error('❌ Error:', e); process.exit(1); });
