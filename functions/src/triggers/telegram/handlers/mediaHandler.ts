/**
 * Media Handler for Telegram Worker Bot
 *
 * Extracted from onWorkerBotMessage.ts for modularity.
 * Handles: photo/video/document uploads, voice messages, skip media, file save.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import axios from 'axios';
import * as crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sendMessage, getActiveSession, sendMainMenu, findPlatformUser } from '../telegramUtils';
import { finalizeSession } from './sessionManager';
import { sendAdminNotification } from './profileHandlers';
import { verifyEmployeeFace } from '../../../services/faceVerificationService';
import * as GtdHandler from './gtdHandler';
import * as InboxHandler from './inboxHandler';
import { WORKER_BOT_TOKEN, GEMINI_API_KEY } from '../../../config';

const db = admin.firestore();

export async function handleSkipMedia(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        // BUG-3 fix: Session already finalized (double-tap) — silently ignore
        return;
    }

    const sessionData = activeSession.data();

    if (sessionData.awaitingEndLocation) {
        // Skip End Location → go to photo
        await activeSession.ref.update({
            awaitingEndLocation: false,
            awaitingEndPhoto: true,
            skippedEndLocation: true,
            needsAdjustment: true,
            locationMismatch: true,
            locationMismatchReason: "Location skipped at finish"
        });
        // F-6: mirror the new end-photo prompt wording.
        await sendMessage(chatId,
            "⏩ Локация пропущена. ⚠️ Отметка о пропуске сохранена.\n\n" +
            "📸 *Финальное фото объекта / результата работы.*\n" +
            "Это нужно для подтверждения выполнения — пришли 1–2 фото.",
            { keyboard: [[{ text: "⏩ Пропустить фото" }]], resize_keyboard: true }
        );
    } else if (sessionData.awaitingEndPhoto) {
        // F-7: worker refused to send the final photo. We used to silently
        // drop into the voice step (skippedEndPhoto was written but admin
        // never learned). Now: explicit audit trail + admin push so Denis
        // can spot patterns (same worker always skipping, specific project
        // always empty).
        const skippedAt = admin.firestore.Timestamp.now();
        await activeSession.ref.update({
            awaitingEndPhoto: false,
            awaitingEndVoice: true,
            skippedEndPhoto: true,
            endPhotoSkipped: true,
            endPhotoSkipReason: 'worker_skipped_on_finish',
            endPhotoSkippedAt: skippedAt
        });
        await sendMessage(chatId,
            "⏩ Фото пропущено. Админ уведомлён.\n\n🎙 Запиши голосовое: Что успел сделать?",
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
        );
        await sendAdminNotification(
            `⚠️ *Final photo skipped*\n` +
            `👤 ${sessionData.employeeName || 'Unknown worker'}\n` +
            `📍 ${sessionData.clientName || 'Unknown project'}`
        );
        // N-4: observability — mirror into activity_logs so project timeline
        // shows the gap, same way we log "Медиа окончания смены" on success.
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            await db.collection('activity_logs').add({
                companyId: sessionData.companyId || 'system',
                projectId: sessionData.clientId,
                type: 'note',
                content: 'Финальное фото пропущено работником',
                performedBy: sessionData.employeeName || 'Сотрудник',
                performedAt: admin.firestore.FieldValue.serverTimestamp(),
                isInternalOnly: false
            });
        }
    } else if (sessionData.awaitingEndVoice) {
        // Skip End Voice → IMMEDIATE FINALIZE
        await finalizeSession(chatId, userId, activeSession, "Описание не указано");

    } else if (sessionData.awaitingDescription) {
        // Skip Description → Finalize
        await finalizeSession(chatId, userId, activeSession, "Описание не указано");

    } else if (sessionData.awaitingStartPhoto) {
        // F-3: worker can't/won't send the start selfie. Keep the shift
        // active + write audit trail + push admin in real time. Then move
        // to the plan step (awaitingStartVoice), NOT straight to main menu —
        // the "Смена начата!" announcement comes after plan is resolved.
        const skippedAt = admin.firestore.Timestamp.now();
        await activeSession.ref.update({
            awaitingStartPhoto: false,
            awaitingStartVoice: true,
            skippedStartPhoto: true,
            startPhotoSkipped: true,
            startPhotoSkipReason: 'worker_refused_no_camera',
            startPhotoSkippedAt: skippedAt
        });
        await sendMessage(chatId,
            "⚠️ Ок, без фото. Админ уведомлён."
        );
        await sendMessage(chatId,
            `📝 *Что планируешь сделать сегодня?*\n\n` +
            `Запиши голосовое или напиши текстом. Если не сейчас — жми *Пропустить*.`,
            {
                keyboard: [[{ text: '⏩ Пропустить' }]],
                resize_keyboard: true
            }
        );
        await sendAdminNotification(
            `⚠️ *Start selfie skipped*\n` +
            `👤 ${sessionData.employeeName || 'Unknown worker'}\n` +
            `📍 ${sessionData.clientName || 'Unknown project'}`
        );
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            await db.collection('activity_logs').add({
                companyId: sessionData.companyId || 'system',
                projectId: sessionData.clientId,
                type: 'note',
                content: 'Селфи старта пропущено работником',
                performedBy: sessionData.employeeName || 'Сотрудник',
                performedAt: admin.firestore.FieldValue.serverTimestamp(),
                isInternalOnly: false
            });
        }
    } else if (sessionData.awaitingStartVoice) {
        // Skip plan (voice or text) → this is the moment the shift is
        // announced to the worker (selfie + plan flow complete).
        await activeSession.ref.update({
            awaitingStartVoice: false,
            skippedStartVoice: true
        });
        await sendMessage(chatId,
            `✅ *Смена начата!*\n\n` +
            `🏢 Объект: *${sessionData.clientName}*\n` +
            `⏱ Таймер запущен. Удачной работы!`,
            { remove_keyboard: true }
        );
        await sendMainMenu(chatId, userId);
    } else {
        await sendMessage(chatId, "⚠️ Нечего пропускать.");
    }
}

export async function handleMediaUpload(chatId: number, userId: number, message: any) {
    // Determine file_id and extension
    let fileId: string | undefined;
    let extension = 'jpg'; // Default

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
        extension = 'jpg';
    } else if (message.document) {
        fileId = message.document.file_id;
        // Try to get extension from filename or mimetype
        if (message.document.file_name) {
            const parts = message.document.file_name.split('.');
            if (parts.length > 1) extension = parts.pop()!;
        } else if (message.document.mime_type) {
            extension = message.document.mime_type.split('/')[1];
        }
    } else if (message.video) {
        fileId = message.video.file_id;
        extension = 'mp4';
    }

    if (!fileId) return;

    // Fix 6 (Wave 2): Block dangerous file extensions
    const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'msi', 'ps1', 'sh', 'dll', 'scr', 'vbs', 'js'];
    if (BLOCKED_EXTENSIONS.includes(extension.toLowerCase())) {
        await sendMessage(chatId, "⚠️ Этот тип файла не поддерживается. Отправь фото или видео.");
        return;
    }

    // Check active session
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ No active session to attach media to.");
        return;
    }

    const sessionData = activeSession.data();

    if (sessionData.awaitingStartPhoto) {
        // Save Start Media
        const url = await saveTelegramFile(fileId, `work_photos/${activeSession.id}/start_${Date.now()}.${extension}`);

        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

        await sendMessage(chatId, `✅ Фото принято! Объект *${sessionData.clientName}* время старта *${timeStr}*.`);

        // Fix 7: Write main update FIRST, then fire face verification AFTER.
        // 2026-04-17: chain the plan voice/text step after the selfie. The
        // shift is announced as "Смена начата!" only after plan is captured
        // (or skipped) — see voice handler START_SHIFT branch, and
        // textFallbacks.awaitingStartVoice / handleSkipMedia.awaitingStartVoice.
        await activeSession.ref.update({
            startPhotoId: fileId,
            startPhotoUrl: url,
            startMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingStartPhoto: false,
            awaitingStartVoice: true
        });

        await sendMessage(chatId,
            `📝 *Что планируешь сделать сегодня?*\n\n` +
            `Запиши голосовое или напиши текстом. Если не сейчас — жми *Пропустить*.`,
            {
                keyboard: [[{ text: '⏩ Пропустить' }]],
                resize_keyboard: true
            }
        );

        // --- FACE VERIFICATION (Asynchronous, AFTER main update) ---
        // F-4: on mismatch, additionally send an immediate Telegram push to
        // admin so the warning is actionable, not just a row-level chip.
        const platformUserUrl = (await findPlatformUser(userId))?.referenceFacePhotoUrl;
        if (platformUserUrl && url) {
            verifyEmployeeFace(platformUserUrl, url).then(async (matchResult) => {
                await activeSession.ref.update({
                    faceMatch: matchResult.match,
                    faceConfidence: matchResult.confidence,
                    faceMismatchReason: matchResult.reason
                });
                if (!matchResult.match) {
                    const confPct = Math.round(matchResult.confidence);
                    await sendMessage(chatId, `⚠️ *ПРЕДУПРЕЖДЕНИЕ:*\nСистема не смогла сопоставить ваше лицо с профилем (${confPct}%).\nСмена продолжена, но админ уведомлен.`);

                    // F-4: synchronous admin push so Denis can react in real
                    // time, not only when opening the dashboard.
                    await sendAdminNotification(
                        `⚠️ *Face mismatch*\n` +
                        `👤 ${sessionData.employeeName || 'Unknown worker'}\n` +
                        `📍 ${sessionData.clientName || 'Unknown project'}\n` +
                        `🎯 Confidence: ${confPct}%\n` +
                        (matchResult.reason ? `ℹ️ ${matchResult.reason}` : '')
                    );
                }
            }).catch(e => console.error("Face verification background task failed", e));
        }

        // --- NEW: Time-Lapse Activity Log (Start Photo/Video) ---
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            await db.collection('activity_logs').add({
                companyId: sessionData.companyId || 'system',
                projectId: sessionData.clientId,
                type: message.video ? 'video' : (message.document ? 'document' : 'photo'),
                content: 'Медиа начала смены',
                mediaUrl: url,
                performedBy: sessionData.employeeName || 'Сотрудник',
                performedAt: admin.firestore.FieldValue.serverTimestamp(),
                isInternalOnly: false
            });
        }

        // F-2: hand the worker back the main menu — no voice step.
        await sendMainMenu(chatId, userId);

    } else if (sessionData.awaitingEndPhoto) {
        // Save End Media
        const url = await saveTelegramFile(fileId, `work_photos/${activeSession.id}/end_${Date.now()}.${extension}`);

        // Move to voice step instead of text description
        await activeSession.ref.update({
            endPhotoId: fileId,
            endPhotoUrl: url,
            endMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingEndPhoto: false,
            awaitingEndVoice: true  // NEW: Ask for voice about results
        });

        // --- NEW: Time-Lapse Activity Log (End Photo/Video) ---
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            await db.collection('activity_logs').add({
                companyId: sessionData.companyId || 'system',
                projectId: sessionData.clientId,
                type: message.video ? 'video' : (message.document ? 'document' : 'photo'),
                content: 'Медиа окончания смены',
                mediaUrl: url,
                performedBy: sessionData.employeeName || 'Сотрудник',
                performedAt: admin.firestore.FieldValue.serverTimestamp(),
                isInternalOnly: false
            });
        }

        await sendMessage(chatId,
            "📸 Фото принято!\n\n🎙 Запиши голосовое: Что успел сделать?",
            {
                keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]],
                resize_keyboard: true
            }
        );

    } else {
        // Fix 3: Handle media group (album) spam silently
        if (message.media_group_id) {
            return;
        }

        // Task 2: Mid-session photo — save to Firebase Storage
        if (message.photo && sessionData.clientId) {
            const largestPhoto = message.photo[message.photo.length - 1];
            const photoFileId = largestPhoto.file_id;
            const storagePath = `clients/${sessionData.clientId}/photos/${activeSession.id}/${Date.now()}.jpg`;
            const url = await saveTelegramFile(photoFileId, storagePath);

            if (url) {
                const currentPhotos: string[] = sessionData.photoUrls || [];
                currentPhotos.push(url);
                await activeSession.ref.update({ photoUrls: currentPhotos });

                // Also log in activity_logs for time-lapse
                if (sessionData.clientId !== 'no_project') {
                    await db.collection('activity_logs').add({
                        companyId: sessionData.companyId || 'system',
                        projectId: sessionData.clientId,
                        type: 'photo',
                        content: 'Фото с объекта (mid-session)',
                        mediaUrl: url,
                        performedBy: sessionData.employeeName || 'Сотрудник',
                        performedAt: admin.firestore.FieldValue.serverTimestamp(),
                        isInternalOnly: false
                    });
                }

                await sendMessage(chatId, "📸 Фото сохранено");
            } else {
                await sendMessage(chatId, "⚠️ Не удалось сохранить фото. Попробуй ещё раз.");
            }
        } else {
            await sendMessage(chatId, "I'm not expecting media right now.");
        }
    }
}

/**
 * Helper to call Google AI (Generative Language API) with model fallback.
 * Uses the already-enabled Generative Language API instead of Vertex AI.
 */
export async function transcribeAudioWithRetry(audioBase64: string, systemPrompt: string): Promise<string> {
    // Get API key from Firebase config or environment
    const apiKey = GEMINI_API_KEY.value();

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured. Set it via: firebase functions:config:set gemini.api_key="YOUR_KEY"');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Fallback Strategy (Updated for current availability):
    // 1. gemini-2.0-flash (Latest)
    // 2. gemini-1.5-flash-latest
    // 3. gemini-1.5-pro-latest
    // 4. gemini-pro (Legacy alias)
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-pro'];

    const errors: string[] = [];

    for (const modelName of models) {
        console.log(`🤖 Trying ${modelName} via Google AI...`);

        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: 'application/json' }
        });
        logger.info(`🤖 Trying ${modelName} via Google AI...`);

        try {
            const result = await model.generateContent([
                { text: systemPrompt },
                {
                    inlineData: {
                        mimeType: 'audio/ogg',
                        data: audioBase64
                    }
                }
            ]);
            const response = await result.response;
            const text = response.text();

            if (text) {
                logger.info(`✅ Success with ${modelName}`);
                return text;
            }
        } catch (error: any) {
            const errMsg = `⚠️ Error with ${modelName}: ${error.message}`;
            logger.warn(errMsg);
            errors.push(errMsg);
            // Continue to next model
        }
    }

    logger.error('❌ All Gemini attempts failed', { errors });
    throw new Error(`All models failed. Last error: ${errors[errors.length - 1]}`);
}

/**
 * Handles voice messages from workers.
 * Uses Gemini 1.5 Flash to transcribe and extract structured data.
 */
export async function handleVoiceMessage(chatId: number, userId: number, message: any) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной сессии для голосового сообщения.");
        return;
    }

    const sessionData = activeSession.data();
    const fileId = message.voice.file_id;

    // Determine context: start, end or mid shift
    let context = 'MID_SHIFT';
    if (sessionData.awaitingEndVoice) {
        context = 'END_SHIFT';
    } else if (sessionData.awaitingStartVoice) {
        context = 'START_SHIFT';
    }

    await sendMessage(chatId, "🎙 Принял, расшифровываю...");

    try {
        // 1. Download voice file from Telegram
        const fileRes = await axios.get(`https://api.telegram.org/bot${WORKER_BOT_TOKEN.value()}/getFile?file_id=${fileId}`);
        const filePath = fileRes.data.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN.value()}/${filePath}`;

        const audioResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const audioBase64 = Buffer.from(audioResponse.data).toString('base64');
        logger.info(`🎙 Audio downloaded`, { size: audioResponse.data.length, base64Length: audioBase64.length });

        // 2. Save voice to Storage (optional, for history)
        const voiceStoragePath = `work_voices/${activeSession.id}/${context.toLowerCase()}_${Date.now()}.ogg`;
        const bucket = admin.storage().bucket();
        const file = bucket.file(voiceStoragePath);
        await file.save(Buffer.from(audioResponse.data), { contentType: 'audio/ogg' });
        const voiceUrl = `gs://${bucket.name}/${voiceStoragePath}`;



        const empDoc = await db.collection('employees').doc(String(userId)).get();
        const userTimezone = empDoc.data()?.timezone || 'America/New_York';
        const currentDate = new Date().toLocaleDateString('ru-RU', { timeZone: userTimezone });

        // --- FETCH ACTIVE TASKS FOR CONTEXT ---
        let activeTasksContext = 'Нет активных задач для загрузки.';
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            const tasksSnap = await db.collection('gtd_tasks')
                .where('projectId', '==', sessionData.clientId)
                .where('status', 'in', ['todo', 'in_progress'])
                .get();

            if (!tasksSnap.empty) {
                const tasksList = tasksSnap.docs.map(doc => {
                    const data = doc.data();
                    return `- [ID: ${doc.id}] ${data.title} (Текущий прогресс: ${data.progressPercentage || 0}%)`;
                });
                activeTasksContext = tasksList.join('\n');
            }
        }

        const systemPrompt = `
Ты — опытный прораб-секретарь на стройке. Слушай голосовые сообщения рабочих и превращай их в структурированный отчет JSON.

Контекст: "${context}"
Язык: Русский
Текущая дата: ${currentDate} (Часовой пояс: ${userTimezone})

Активные задачи проекта (ID, Название, Прогресс):
${activeTasksContext}

ИНСТРУКЦИИ:
1. Убери слова-паразиты.
2. Сформулируй четкое описание.
3. Если START_SHIFT: извлеки planned_task и location.
4. Если END_SHIFT: извлеки сделанное (summary, description), проблемы (issues).
5. Если MID_SHIFT: Если рабочий ПРОСИТ ЗАКРЫТЬ СМЕНУ ("я закончил", "вырубай", "закрывай сессию") -> верни intent: "CLOSE_SESSION".
   Если он ПРОСТО Диктует рабочую заметку или задачу -> верни intent: "NOTE", summary и description.
6. ВАЖНО: Если слышишь намерения на будущее ("надо купить", "завтра сделаю", "нужно"), ОБЯЗАТЕЛЬНО извлеки это в массив tasks.
7. ВАЖНО: Если рабочий сообщает о прогрессе выполнения конкретной работы (например, "половина стяжки готова" или "закончил плитку"), найди наиболее подходящую задачу из списка "Активные задачи проекта".
   В ответе JSON добавь массив "taskUpdates":
   [{ "taskId": "ID_задачи", "progressPercentage": 100 }] (в процентах от 1 до 100).

ФОРМАТ JSON:
{
  "intent": "CLOSE_SESSION" | "NOTE" | null,
  "summary": "Краткое описание (3-5 слов)",
  "description": "Полное описание работ",
  "issues": "Текст проблемы или null",
  "location_detected": "Локация или null",
  "tasks": [
    {
      "title": "Название задачи",
      "dueDate": "YYYY-MM-DD" (или null),
      "priority": "high" | "medium" | "low",
      "estimatedDurationMinutes": "number (минуты)"
    }
  ],
  "taskUpdates": [
    {
      "taskId": "ID",
      "progressPercentage": 100
    }
  ]
}`;

        // 3. Send to Gemini 1.5 Flash for transcription (with Region Fallback)
        logger.info(`🎙 Sending audio to Gemini. Project: ${process.env.GCLOUD_PROJECT || 'profit-step'}`);

        let aiData;
        try {
            const responseText = await transcribeAudioWithRetry(audioBase64, systemPrompt);
            // Cleanup markdown code blocks if present
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiData = JSON.parse(cleanText);
            logger.info('🤖 AI Data', aiData);
        } catch (err: any) {
            logger.error('❌ Transcription completely failed', err);
            await sendMessage(chatId, "⚠️ Ошибка сервиса AI. Попробуйте еще раз или напишите текстом.");
            return;
        }



        // 4. Update session with AI data
        const updates: Record<string, any> = {
            aiTranscribedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // --- PROCESS TASK UPDATES (Phase 2) ---
        let updatedTasksCount = 0;
        if (aiData.taskUpdates && Array.isArray(aiData.taskUpdates)) {
            for (const upd of aiData.taskUpdates) {
                if (upd.taskId && typeof upd.progressPercentage === 'number') {
                    await db.collection('gtd_tasks').doc(upd.taskId).update({
                        progressPercentage: upd.progressPercentage,
                        status: upd.progressPercentage === 100 ? 'done' : 'in_progress',
                        ...(upd.progressPercentage === 100 ? { actualEndDate: admin.firestore.FieldValue.serverTimestamp() } : {})
                    });

                    if (sessionData.clientId && sessionData.clientId !== 'no_project') {
                        await db.collection('activity_logs').add({
                            companyId: sessionData.companyId || 'system',
                            projectId: sessionData.clientId,
                            type: 'ai_action',
                            content: `🤖 ИИ обновил статус задачи на ${upd.progressPercentage}% на основе аудио-отчета.`,
                            taskId: upd.taskId,
                            performedBy: 'AI Assistant',
                            performedAt: admin.firestore.FieldValue.serverTimestamp(),
                            isInternalOnly: false
                        });
                    }
                    updatedTasksCount++;
                }
            }
        }

        if (context === 'START_SHIFT') {
            updates.plannedTaskSummary = aiData.summary;
            updates.plannedTaskDescription = aiData.description;
            updates.locationDetected = aiData.location_detected;
            updates.voiceStartUrl = voiceUrl;
            updates.awaitingStartVoice = false;

            // Continue to normal flow
            await activeSession.ref.update(updates);
            await sendMessage(chatId, `📝 Записал задачу: *${aiData.summary}*\n\n_${aiData.description}_`);
            // 2026-04-17: plan captured → announce shift start + show menu.
            await sendMessage(chatId,
                `✅ *Смена начата!*\n\n` +
                `🏢 Объект: *${sessionData.clientName}*\n` +
                `⏱ Таймер запущен. Работаем!`,
                { remove_keyboard: true }
            );
            await sendMainMenu(chatId, userId);
        } else if (context === 'END_SHIFT') {
            updates.resultSummary = aiData.summary;
            updates.resultDescription = aiData.description;
            updates.issuesReported = aiData.issues;
            updates.voiceEndUrl = voiceUrl;
            updates.awaitingEndVoice = false;
            updates.description = aiData.description; // Use AI description as main description

            // --- PROCESS TASKS ---
            let newTasksCount = 0;
            if (aiData.tasks && Array.isArray(aiData.tasks) && aiData.tasks.length > 0) {
                newTasksCount = await GtdHandler.createTasksFromVoiceReport({
                    userId,
                    sessionId: activeSession.ref.id,
                    sessionData: {
                        clientId: sessionData.clientId,
                        clientName: sessionData.clientName
                    },
                    aiTasks: aiData.tasks,
                    voiceUrl,
                    summary: aiData.summary
                });
            }

            // Notify admin if issues detected
            if (aiData.issues) {
                await sendAdminNotification(`👤 *${sessionData.employeeName}:*\n⚠️ *Проблема от рабочего*\n📍 ${sessionData.clientName}\n🔴 ${aiData.issues}`);
            }

            let responseMsg = `✅ Записал: *${aiData.summary}*`;
            if (newTasksCount > 0) {
                responseMsg += `\n📥 Создано задач: ${newTasksCount}`;
            }
            if (updatedTasksCount > 0) {
                responseMsg += `\n🤖 Обновлен прогресс у ${updatedTasksCount} задач.`;
            }
            if (aiData.issues) {
                responseMsg += `\n⚠️ Проблема: ${aiData.issues}`;
            }

            // Now finalize the session (move to description step or complete)
            updates.awaitingDescription = true;

            // IMPORTANT: Persist updates BEFORE sending prompts to avoid race condition
            await activeSession.ref.update(updates);

            // --- NEW: Time-Lapse Activity Log (End Voice) ---
            if (sessionData.clientId && sessionData.clientId !== 'no_project') {
                await db.collection('activity_logs').add({
                    companyId: sessionData.companyId || 'system',
                    projectId: sessionData.clientId,
                    type: 'audio',
                    content: `Голосовой отчет: ${aiData.summary}\n${aiData.description}`,
                    mediaUrl: voiceUrl,
                    performedBy: sessionData.employeeName || 'Сотрудник',
                    performedAt: admin.firestore.FieldValue.serverTimestamp(),
                    isInternalOnly: false
                });
            }

            await sendMessage(chatId, responseMsg);
            await sendMessage(chatId, "📝 Хочешь добавить текстовое описание? (Или напиши 'Skip')");
        } else if (context === 'MID_SHIFT') {
            if (aiData.intent === 'CLOSE_SESSION') {
                const summaryText = aiData.summary || aiData.description || "Завершение смены";
                await sendMessage(chatId, `⏹️ Ты хочешь завершить текущую смену?\n\n_«${summaryText}»_`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Да, завершить", callback_data: `force_finish_work` }],
                            [{ text: "❌ Нет, продолжить", callback_data: `cancel_close_session` }]
                        ]
                    }
                });
            } else {
                // intent === NOTE or null
                const platformUser = await findPlatformUser(userId);
                const descriptionWithTasks = [aiData.description];

                if (aiData.tasks && aiData.tasks.length > 0) {
                    descriptionWithTasks.push(`\n**Задачи/Покупки:**`);
                    aiData.tasks.forEach((t: any) => descriptionWithTasks.push(`- ${t.title}`));
                }

                await InboxHandler.createNote({
                    ctx: {
                        chatId,
                        userId,
                        userName: message.from?.first_name || 'Worker',
                        messageId: message.message_id,
                        platformUserId: platformUser?.id
                    },
                    title: aiData.summary || 'Голосовая заметка',
                    description: descriptionWithTasks.filter(Boolean).join('\n'),
                    aiStatus: 'none',
                    originalAudioUrl: voiceUrl
                });

                await sendMessage(chatId, `📝 Заметка сохранена во входящие:\n*${aiData.summary || 'Без названия'}*`);
            }
        }

    } catch (error: any) {
        logger.error('Error transcribing voice:', error);
        await sendMessage(chatId, `⚠️ Ошибка расшифровки: ${error.message}. Попробуй ещё раз или напиши текстом.`);
    }
}

export async function saveTelegramFile(fileId: string, destinationPath: string): Promise<string | null> {
    if (!WORKER_BOT_TOKEN.value()) {
        logger.error("Missing WORKER_BOT_TOKEN");
        return null;
    }
    try {
        // 1. Get File Path from Telegram
        const fileRes = await axios.get(`https://api.telegram.org/bot${WORKER_BOT_TOKEN.value()}/getFile?file_id=${fileId}`);
        const filePath = fileRes.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN.value()}/${filePath}`;

        // 2. Download File
        const response = await axios({
            url: fileUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(response.data, 'binary');

        // 3. Determine Content Type
        const ext = destinationPath.split('.').pop()?.toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
        if (ext === 'png') contentType = 'image/png';
        if (ext === 'mp4') contentType = 'video/mp4';
        if (ext === 'pdf') contentType = 'application/pdf';

        // 4. Upload to Firebase Storage with Download Token
        const bucket = admin.storage().bucket();
        const file = bucket.file(destinationPath);
        const token = crypto.randomUUID();

        await file.save(buffer, {
            contentType: contentType,
            metadata: {
                metadata: {
                    firebaseStorageDownloadTokens: token
                }
            }
        });

        // 5. Construct Public Download URL
        const bucketName = bucket.name;
        const encodedName = encodeURIComponent(destinationPath);
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedName}?alt=media&token=${token}`;

        return publicUrl;

    } catch (error) {
        logger.error('Error saving Telegram file', error);
        return null;
    }
}
