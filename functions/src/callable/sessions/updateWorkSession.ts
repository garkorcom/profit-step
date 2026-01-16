import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay } from 'date-fns';

const db = admin.firestore();

// Constants
const MAX_SESSION_HOURS = 14;
const TIME_ZONE = 'America/New_York'; // Florida timezone

interface UpdateSessionRequest {
    sessionId: string;
    newStartTime: string; // ISO string
    newEndTime: string;   // ISO string
    editNote: string;
    clientId?: string;
    clientName?: string;
    description?: string;
}

/**
 * Callable Cloud Function for updating work sessions with validation.
 * 
 * Validates:
 * - User is authenticated
 * - Session exists and is editable (not processed)
 * - Duration doesn't exceed 14 hours
 * - No overlapping sessions for the same employee
 * 
 * Maintains audit trail with original values.
 */
export const updateWorkSession = functions.https.onCall(async (data: UpdateSessionRequest, context) => {
    // 1. Auth Check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Требуется авторизация');
    }

    const { sessionId, newStartTime, newEndTime, editNote, clientId, clientName, description } = data;
    const editorUid = context.auth.uid;

    // Validate required fields
    if (!sessionId || !newStartTime || !newEndTime) {
        throw new functions.https.HttpsError('invalid-argument', 'Не указаны обязательные поля');
    }

    const start = new Date(newStartTime);
    const end = new Date(newEndTime);

    // 2. Basic Validation
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new functions.https.HttpsError('invalid-argument', 'Некорректный формат даты');
    }

    if (end <= start) {
        throw new functions.https.HttpsError('invalid-argument', 'Время окончания должно быть позже начала');
    }

    if (!editNote || editNote.trim().length < 3) {
        throw new functions.https.HttpsError('invalid-argument', 'Укажите причину изменения (минимум 3 символа)');
    }

    // 3. Duration Check (14 hours max)
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (durationHours > MAX_SESSION_HOURS) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            `Смена не может превышать ${MAX_SESSION_HOURS} часов. Текущая: ${durationHours.toFixed(1)}ч`
        );
    }

    // 4. Transaction for atomic read-update
    return db.runTransaction(async (transaction) => {
        const sessionRef = db.collection('work_sessions').doc(sessionId);
        const sessionDoc = await transaction.get(sessionRef);

        if (!sessionDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Сессия не найдена');
        }

        const sessionData = sessionDoc.data()!;

        // 5. Permission Check - Editor must be session owner OR admin/owner
        const editorDoc = await db.collection('users').doc(editorUid).get();
        const editorData = editorDoc.data();
        const editorRole = editorData?.role || 'worker';
        const isAdmin = editorRole === 'admin' || editorRole === 'owner';
        const isSessionOwner = String(sessionData.employeeId) === editorUid ||
            String(sessionData.employeeId) === String(editorData?.telegramId);

        if (!isAdmin && !isSessionOwner) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Вы можете редактировать только свои сессии. Обратитесь к администратору.'
            );
        }

        // 6. Lifecycle Check
        if (sessionData.finalizationStatus === 'processed') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Нельзя редактировать сессию, которая уже обработана для зарплаты'
            );
        }

        // 7. Overlap Detection (TIMEZONE-AWARE)
        // Convert start time to Florida, find day boundaries, convert back to UTC
        const startInFlorida = toZonedTime(start, TIME_ZONE);
        const floridaDayStart = startOfDay(startInFlorida);
        const floridaDayEnd = endOfDay(startInFlorida);
        const queryStart = fromZonedTime(floridaDayStart, TIME_ZONE);
        const queryEnd = fromZonedTime(floridaDayEnd, TIME_ZONE);

        const conflictQuery = await db.collection('work_sessions')
            .where('employeeId', '==', sessionData.employeeId)
            .where('startTime', '>=', admin.firestore.Timestamp.fromDate(queryStart))
            .where('startTime', '<=', admin.firestore.Timestamp.fromDate(queryEnd))
            .get();

        for (const doc of conflictQuery.docs) {
            if (doc.id === sessionId) continue; // Skip current session

            const existing = doc.data();
            if (existing.type === 'correction') continue; // Skip corrections

            const existingStart = existing.startTime.toDate();
            const existingEnd = existing.endTime?.toDate();

            if (!existingEnd) continue; // Skip active sessions

            // Overlap check: (StartA < EndB) && (EndA > StartB)
            if (start < existingEnd && end > existingStart) {
                throw new functions.https.HttpsError(
                    'aborted',
                    `Пересечение с другой сессией: ${existingStart.toLocaleTimeString('ru-RU')} - ${existingEnd.toLocaleTimeString('ru-RU')}`
                );
            }
        }

        // 7. Calculate Earnings (use snapshotted hourlyRate)
        const hourlyRate = sessionData.hourlyRate || 0;
        const totalBreakMinutes = sessionData.totalBreakMinutes || 0;
        const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000) - totalBreakMinutes;
        const sessionEarnings = parseFloat(((durationMinutes / 60) * hourlyRate).toFixed(2));

        // 8. Build Update Object with Audit Trail
        const updates: Record<string, any> = {
            startTime: admin.firestore.Timestamp.fromDate(start),
            endTime: admin.firestore.Timestamp.fromDate(end),
            durationMinutes: Math.max(0, durationMinutes),
            sessionEarnings: Math.max(0, sessionEarnings),
            status: 'completed',

            // Audit Fields
            isManuallyEdited: true,
            editedAt: admin.firestore.FieldValue.serverTimestamp(),
            editedBy: editorUid,
            editNote: editNote.trim(),

            // Clear review flag if it was set
            requiresAdminReview: false,
        };

        // Store original values only on first edit
        if (!sessionData.originalStartTime) {
            updates.originalStartTime = sessionData.startTime;
            updates.originalEndTime = sessionData.endTime || null;
            updates.originalHourlyRate = sessionData.hourlyRate || null;
            updates.originalClientId = sessionData.clientId || null;
            updates.originalClientName = sessionData.clientName || null;
        }

        // Update client if provided
        if (clientId !== undefined) {
            updates.clientId = clientId;
        }
        if (clientName !== undefined) {
            updates.clientName = clientName;
        }
        if (description !== undefined) {
            updates.description = description;
        }

        transaction.update(sessionRef, updates);

        return {
            success: true,
            message: 'Сессия успешно обновлена',
            durationMinutes,
            sessionEarnings
        };
    });
});
