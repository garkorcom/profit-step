/**
 * Checklist Flow Handler for Telegram Worker Bot
 *
 * Extracted from onWorkerBotMessage.ts for modularity.
 * Handles site arrival checklist (materials, tools, access).
 */

import { sendMessage, getActiveSession } from '../telegramUtils';
import { sendAdminNotification } from './profileHandlers';

// Site Checklist Questions
export const CHECKLIST_QUESTIONS = [
    { key: 'materials', text: '✅ Материалы на объекте?' },
    { key: 'tools', text: '✅ Инструменты взял?' },
    { key: 'access', text: '✅ Пропуск/доступ есть?' },
];

export async function sendChecklistQuestion(chatId: number, step: number) {
    if (step >= CHECKLIST_QUESTIONS.length) return;
    const question = CHECKLIST_QUESTIONS[step];
    await sendMessage(chatId, question.text, {
        inline_keyboard: [
            [
                { text: '✅ Да', callback_data: `checklist_yes_${step}` },
                { text: '❌ Нет', callback_data: `checklist_no_${step}` },
            ]
        ]
    });
}

export async function handleChecklistCallback(chatId: number, userId: number, data: string) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены.");
        return;
    }

    const sessionData = activeSession.data();
    if (!sessionData.awaitingChecklist) {
        return;
    }

    // Parse: checklist_yes_0 or checklist_no_1
    const parts = data.split('_');
    const answer = parts[1] === 'yes';
    const step = parseInt(parts[2]);

    if (step !== sessionData.checklistStep) {
        // Ignore clicks on already-answered questions
        return;
    }

    const questionKey = CHECKLIST_QUESTIONS[step].key;
    const answers = sessionData.checklistAnswers || {};
    answers[questionKey] = answer;

    const nextStep = step + 1;

    if (nextStep < CHECKLIST_QUESTIONS.length) {
        // More questions to ask
        await activeSession.ref.update({
            checklistStep: nextStep,
            checklistAnswers: answers,
        });
        await sendChecklistQuestion(chatId, nextStep);
    } else {
        // All questions answered — proceed to photo step
        await activeSession.ref.update({
            checklistStep: nextStep,
            checklistAnswers: answers,
            awaitingChecklist: false,
            awaitingStartPhoto: true,
        });

        const allYes = Object.values(answers).every((v: any) => v === true);
        const summary = CHECKLIST_QUESTIONS.map((q, i) => {
            const val = answers[q.key];
            return `${val ? '✅' : '❌'} ${q.text.replace('✅ ', '')}`;
        }).join('\n');

        await sendMessage(chatId,
            `📋 *Чеклист завершён:*\n${summary}\n\n` +
            (allYes ? '👍 Всё готово!\n\n' : '⚠️ Есть нерешённые вопросы. Админ уведомлён.\n\n') +
            `📸 Теперь отправь **фото** начала работ.`,
            {
                keyboard: [[{ text: '⏩ Пропустить фото' }]],
                resize_keyboard: true
            }
        );

        // Notify admin if something is missing
        if (!allYes) {
            const employeeName = sessionData.employeeName || 'Сотрудник';
            const clientName = sessionData.clientName || 'Объект';
            await sendAdminNotification(
                `⚠️ *Чеклист:* ${employeeName}\n📍 ${clientName}\n${summary}`
            );
        }
    }
}
