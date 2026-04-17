/**
 * Location Flow Handler for Telegram Worker Bot
 *
 * Extracted from onWorkerBotMessage.ts for modularity.
 * Handles: location-based session start, finish, pick-other, cancel flows.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { findNearbyProject, saveProjectLocation, updateLocationLastUsed } from '../../../utils/geoUtils';
import { sendMessage, getActiveSession, sendMainMenu, calculateDistanceMeters } from '../telegramUtils';
import { resolveHourlyRate } from '../rateUtils';
import { sendAdminNotification } from './profileHandlers';

const db = admin.firestore();

export async function handleLocation(chatId: number, userId: number, location: any) {
    // Fix 4 (Deep Testing): Ignore Live Location broadcasts to prevent spam
    // Telegram sends repeated location updates when user shares "Live Location"
    if (location.live_period) {
        logger.info(`🔇 Ignoring Live Location from user ${userId} (live_period: ${location.live_period}s)`);
        return;
    }

    const activeSession = await getActiveSession(userId);
    const { latitude, longitude } = location;

    if (!activeSession) {
        // --- NO ACTIVE SESSION: IT'S A START TRIGGER ---
        const matchedProject = await findNearbyProject(latitude, longitude);
        const pendingStartRef = db.collection('pending_starts').doc(String(userId));

        if (matchedProject) {
            // Found a match! Ask for confirmation
            await updateLocationLastUsed(matchedProject.id);

            await pendingStartRef.set({
                matchedProjectId: matchedProject.id,
                matchedClientId: matchedProject.clientId,
                matchedClientName: matchedProject.clientName,
                matchedServiceName: matchedProject.serviceName || null,
                location: location,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const serviceSuffix = matchedProject.serviceName ? ` - ${matchedProject.serviceName}` : '';
            await sendMessage(chatId,
                `📍 *Локация определена!*\n\n` +
                `🏢 Объект: *${matchedProject.clientName}${serviceSuffix}*\n\n` +
                `Это старт работы?`,
                {
                    inline_keyboard: [
                        [{ text: '✅ Да, начать', callback_data: 'location_confirm_start' }],
                        [{ text: '🔄 Другой объект', callback_data: 'location_pick_other' }],
                        [{ text: '❌ Отмена', callback_data: 'location_cancel' }]
                    ]
                }
            );
        } else {
            // No match - ask to select client
            await pendingStartRef.set({ location: location, createdAt: admin.firestore.FieldValue.serverTimestamp() });

            await sendMessage(chatId,
                `📍 *Локация получена!*\n\nОбъект поблизости не найден.\nВыбери объект из списка или напиши текстом в чат (если это новый клиент):`,
                { remove_keyboard: true }
            );

            const snapshot = await db.collection('clients').orderBy('name', 'asc').limit(500).get();
            if (!snapshot.empty) {
                const inlineKeyboard: any[][] = [];
                snapshot.docs.forEach(doc => {
                    const client = doc.data();
                    if (client.status === 'done') return;
                    inlineKeyboard.push([{ text: client.name, callback_data: `location_new_client_${doc.id}` }]);
                });
                if (inlineKeyboard.length > 0) {
                    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);
                    await sendMessage(chatId, '🏢 Доступные объекты:', { inline_keyboard: inlineKeyboard });
                }
            }
        }
        return;
    }

    // --- ACTIVE SESSION EXISTS ---
    const sessionData = activeSession.data();

    // Fix 2/5: Prevent location looping and live location spam if already awaiting media
    if (sessionData.awaitingStartPhoto || sessionData.awaitingStartVoice || sessionData.awaitingEndPhoto || sessionData.awaitingEndVoice) {
        await sendMessage(chatId, "⚠️ Заверши текущий шаг (отправь фото/аудио или нажми Пропустить), а не локацию.");
        return;
    }

    // Handle Finish Location (Anti-Fraud Step)
    if (sessionData.awaitingEndLocation) {
        const targetLat = sessionData.startLocation?.latitude;
        const targetLng = sessionData.startLocation?.longitude;

        let distanceInfo = "";
        let locationMismatch = false;
        let locationDistanceMeters = null;

        if (targetLat && targetLng) {
            locationDistanceMeters = calculateDistanceMeters(latitude, longitude, targetLat, targetLng);
            if (locationDistanceMeters > 500) {
                locationMismatch = true;
                distanceInfo = `\n⚠️ Сильное отклонение от старта (${locationDistanceMeters}м).`;
            } else {
                distanceInfo = `\n✅ Локация подтверждена.`;
            }
        }

        const updatePayload: any = {
            endLocation: location,
            awaitingEndLocation: false,
            awaitingEndPhoto: true
        };

        if (locationMismatch) {
            updatePayload.locationMismatch = true;
            updatePayload.needsAdjustment = true;
            updatePayload.locationMismatchReason = `Закрытие смены в ${locationDistanceMeters}м от старта`;
        }
        if (locationDistanceMeters !== null) {
            updatePayload.endLocationDistanceMeters = locationDistanceMeters;
        }

        await activeSession.ref.update(updatePayload);

        // F-6: clearer prompt. Admin needs visual proof of the finished work,
        // not just a timestamp — be explicit so workers don't send a random
        // selfie of the ceiling.
        await sendMessage(chatId,
            `📍 *Геопозиция получена.*${distanceInfo}\n\n` +
            `📸 *Финальное фото объекта / результата работы.*\n` +
            `Это нужно для подтверждения выполнения — пришли 1–2 фото.`,
            { keyboard: [[{ text: "⏩ Пропустить фото" }]], resize_keyboard: true }
        );
        return;
    }

    // Backwards Compatibility for old awaitingLocation state
    if (sessionData.awaitingLocation) {
        const clientId = sessionData.clientId;
        if (clientId !== 'no_project') {
            let locationMismatch = false;
            let locationDistanceMeters = null;

            const clientDoc = await db.collection('clients').doc(clientId).get();
            if (clientDoc.exists) {
                const clientData = clientDoc.data();
                if (clientData?.workLocation?.latitude && clientData?.workLocation?.longitude) {
                    const targetLat = clientData.workLocation.latitude;
                    const targetLng = clientData.workLocation.longitude;
                    const radiusRadius = clientData.workLocation.radius || 150; // Changed default from 500m to 150m for tighter audit

                    locationDistanceMeters = calculateDistanceMeters(latitude, longitude, targetLat, targetLng);
                    if (locationDistanceMeters > radiusRadius) {
                        locationMismatch = true;
                        // Soft Geofencing: Do not notify user about error, just log it internally
                        await db.collection('activity_logs').add({
                            companyId: sessionData.companyId || 'system',
                            projectId: clientId,
                            type: 'note',
                            content: `🔴 Аудит Локации: Смена начата вне объекта (отклонение ${Math.round(locationDistanceMeters)}м от гео-зоны).`,
                            performedBy: 'Система Контроля',
                            performedAt: admin.firestore.FieldValue.serverTimestamp(),
                            isInternalOnly: true
                        });
                    } else {
                        await sendMessage(chatId, `✅ Локация подтверждена.`);
                    }
                }
            }

            const updatePayload: any = {
                startLocation: location,
                awaitingLocation: false,
                awaitingStartPhoto: true
            };
            if (locationMismatch) {
                updatePayload.locationMismatch = true;
                updatePayload.outOfBounds = true; // Phase 2: Soft geofencing flag
            }
            if (locationDistanceMeters !== null) updatePayload.locationDistanceMeters = locationDistanceMeters;

            await activeSession.ref.update(updatePayload);
            await sendMessage(chatId, "📸 Теперь отправь **фото** начала работ.", {
                keyboard: [[{ text: "⏩ Пропустить фото" }]],
                resize_keyboard: true
            });
        }
        return;
    }

    // IT'S A FINISH TRIGGER (Sent location while working)
    // Fix 4: Ask for confirmation before closing the shift
    if (sessionData.status === 'active' || sessionData.status === 'paused') {
        const targetLat = sessionData.startLocation?.latitude;
        const targetLng = sessionData.startLocation?.longitude;

        let distanceInfo = "";
        if (targetLat && targetLng) {
            const dist = calculateDistanceMeters(latitude, longitude, targetLat, targetLng);
            if (dist > 500) {
                distanceInfo = `\n⚠️ Финиш в ${dist}м от точки старта.`;
            }
        }

        // Store end location temporarily but DON'T set awaitingEndPhoto yet
        await activeSession.ref.update({ endLocation: location });

        await sendMessage(chatId,
            `📍 *Геопозиция получена.*${distanceInfo}\n\nЭто завершение работы?`,
            {
                inline_keyboard: [
                    [{ text: '✅ Да, завершить', callback_data: 'location_confirm_finish' }],
                    [{ text: '❌ Нет, работаю', callback_data: 'location_cancel_finish' }]
                ]
            }
        );
    }
}

/**
 * User confirmed auto-detected project from pending_starts.
 */
export async function handleLocationConfirmStart(chatId: number, userId: number) {
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    const pendingDoc = await pendingStartRef.get();

    if (!pendingDoc.exists) {
        await sendMessage(chatId, "⚠️ Данные локации устарели. Отправь локацию заново.", { remove_keyboard: true });
        return;
    }

    const data = pendingDoc.data()!;

    // Fix 2: TTL — reject if pending_starts is older than 30 minutes
    const createdAt = data.createdAt?.toDate?.();
    if (createdAt && (Date.now() - createdAt.getTime() > 30 * 60 * 1000)) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ Данные устарели (>30 мин). Отправь геолокацию заново.", { remove_keyboard: true });
        return;
    }

    // Fix 3: Double-click guard — check if session already exists
    const existingSession = await getActiveSession(userId);
    if (existingSession) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ У тебя уже есть активная смена. Используй ⏹️ Finish Work.");
        return;
    }

    const clientId = data.matchedClientId;
    const clientName = data.matchedClientName;
    const serviceName = data.matchedServiceName;
    const location = data.location;

    const { hourlyRate, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

    // Use Timestamp.now() instead of serverTimestamp() — see comment in handleLocationConfirmStart
    const sessionStartTime = admin.firestore.Timestamp.now();

    const fullClientName = serviceName ? `${clientName} - ${serviceName}` : clientName;

    await db.collection('work_sessions').add({
        employeeId: userId,
        employeeName: employeeName,
        platformUserId: platformUserId,
        companyId: companyId,
        clientId: clientId,
        clientName: fullClientName,
        startTime: sessionStartTime,
        status: 'active',
        service: serviceName || null,
        startLocation: location,
        awaitingLocation: false,
        // F-1: force a selfie check-in right after the shift is created.
        // mediaHandler.handleMediaUpload and handleSkipMedia both branch on
        // this flag. Keep the shift active regardless — the worker can still
        // hit Break/Finish from the main menu even if they haven't sent the
        // selfie yet (see spec Q-1: we don't lock the menu).
        awaitingStartPhoto: true,
        hourlyRate: hourlyRate,
        taskId: null,
        taskTitle: null
    });

    await pendingStartRef.delete();

    // ─── hourlyRate = 0 warning ───
    if (!hourlyRate) {
        await sendMessage(chatId, '⚠️ Внимание! Ваша почасовая ставка не установлена ($0/ч). Пожалуйста, свяжитесь с руководителем для уточнения.');
    }

    // NEW flow (2026-04-17, Denis's verbal spec):
    //   location confirm → selfie request → plan request → "Смена начата!"
    // The "✅ Смена начата!" announcement + main menu are deferred until
    // after the plan voice/text/skip step (see mediaHandler voice path and
    // textFallbacks.awaitingStartVoice path). The session itself is already
    // active in Firestore (status='active'), so the timer is running — we
    // just hold the announcement so the worker sees a coherent flow.
    await sendMessage(chatId,
        `📸 *Сделай селфи на фоне объекта — ${fullClientName}.*\n\n` +
        `Так мы подтверждаем, что ты на месте. Просто сфоткай себя и пришли в чат.`,
        {
            keyboard: [[{ text: '⏩ Пропустить фото' }]],
            resize_keyboard: true
        }
    );

    await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started (Location)*\n📍 ${clientName}`);
}

/**
 * Fix 4: User confirmed they want to finish the shift.
 */
export async function handleLocationConfirmFinish(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены.");
        return;
    }

    // Fix 4: Zombie click protection
    if (!activeSession.data().endLocation) {
        await sendMessage(chatId, "⚠️ Эта кнопка устарела.");
        return;
    }

    await activeSession.ref.update({ awaitingEndPhoto: true });

    // F-6: same wording as the location-based finish so admin sees identical
    // expectations regardless of path.
    await sendMessage(chatId,
        `📸 *Финальное фото объекта / результата работы.*\n` +
        `Это нужно для подтверждения выполнения — пришли 1–2 фото (или нажми Пропустить).`,
        {
            keyboard: [[{ text: "⏩ Пропустить фото" }]],
            resize_keyboard: true
        }
    );
}

/**
 * Fix 4: User said they're still working — false alarm location.
 */
export async function handleLocationCancelFinish(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (activeSession) {
        // Fix 4: Zombie click protection
        if (!activeSession.data().endLocation) {
            await sendMessage(chatId, "⚠️ Эта кнопка устарела.");
            return;
        }
        // Remove the prematurely saved endLocation
        await activeSession.ref.update({
            endLocation: admin.firestore.FieldValue.delete()
        });
    }
    await sendMessage(chatId, "✅ Понял, продолжай работу! 💪");
    await sendMainMenu(chatId, userId);
}

/**
 * User wants to pick a different project than auto-detected.
 */
export async function handleLocationPickOther(chatId: number, userId: number) {
    const snapshot = await db.collection('clients').orderBy('name', 'asc').limit(500).get();

    if (snapshot.empty) {
        await sendMessage(chatId, "Клиенты не найдены.");
        return;
    }

    const inlineKeyboard: any[][] = [];
    snapshot.docs.forEach(doc => {
        const client = doc.data();
        if (client.status === 'done') return;
        inlineKeyboard.push([{ text: client.name, callback_data: `location_new_client_${doc.id}` }]);
    });
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);

    await sendMessage(chatId, '🏢 Доступные объекты:', { inline_keyboard: inlineKeyboard });
}

/**
 * Cancel the location start flow.
 */
export async function handleLocationCancel(chatId: number, userId: number) {
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    await pendingStartRef.delete();

    await sendMessage(chatId, "❌ Старт смены отменен.", { remove_keyboard: true });
    await sendMainMenu(chatId, userId);
}

/**
 * User selected a new client from the list for the pending location start.
 */
export async function handleLocationNewClient(chatId: number, userId: number, clientId: string) {
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    const pendingDoc = await pendingStartRef.get();

    if (!pendingDoc.exists) {
        await sendMessage(chatId, "⚠️ Данные локации устарели. Отправьте геопозицию заново.");
        return;
    }

    // Fix 2: TTL check
    const pendingData = pendingDoc.data()!;
    const createdAt = pendingData.createdAt?.toDate?.();
    if (createdAt && (Date.now() - createdAt.getTime() > 30 * 60 * 1000)) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ Данные устарели (>30 мин). Отправь геолокацию заново.");
        return;
    }

    // Fix 3: Double-click guard
    const existingSession = await getActiveSession(userId);
    if (existingSession) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ У тебя уже есть активная смена.");
        return;
    }

    const location = pendingData.location;

    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
        await sendMessage(chatId, "⚠️ Клиент не найден.");
        return;
    }
    const clientData = clientDoc.data()!;
    const clientName = clientData.name;

    // Save newly associated location
    await saveProjectLocation(
        clientId,
        clientName,
        location.latitude,
        location.longitude,
        userId
    );

    const { hourlyRate, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

    // Use Timestamp.now() instead of serverTimestamp() — see comment in handleLocationConfirmStart
    const sessionStartTime = admin.firestore.Timestamp.now();

    await db.collection('work_sessions').add({
        employeeId: userId,
        employeeName: employeeName,
        platformUserId: platformUserId,
        companyId: companyId,
        clientId: clientId,
        clientName: clientName,
        startTime: sessionStartTime,
        status: 'active',
        startLocation: location,
        awaitingLocation: false,
        // F-1: see handleLocationConfirmStart for rationale.
        awaitingStartPhoto: true,
        hourlyRate: hourlyRate,
        taskId: null,
        taskTitle: null
    });

    await pendingStartRef.delete();

    // ─── hourlyRate = 0 warning ───
    if (!hourlyRate) {
        await sendMessage(chatId, '⚠️ Внимание! Ваша почасовая ставка не установлена ($0/ч). Пожалуйста, свяжитесь с руководителем для уточнения.');
    }

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Объект: *${clientName}*\n` +
        `📍 Координаты объекта сохранены в базу.\n` +
        `⏱ Таймер запущен. Работаем!`
    );

    // Show menu first so Break/Finish stay reachable (see Q-1 in spec).
    await sendMainMenu(chatId, userId);

    // F-1: selfie prompt with skip button.
    await sendMessage(chatId,
        `📸 *Сделай селфи на фоне объекта.*\n\n` +
        `Так мы подтверждаем, что ты на месте. Просто сфоткай себя и пришли в чат.`,
        {
            keyboard: [[{ text: '⏩ Пропустить фото' }]],
            resize_keyboard: true
        }
    );

    await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started (New DB Location)*\n📍 ${clientName}`);
}
