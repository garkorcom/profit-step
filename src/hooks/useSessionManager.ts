import { useState, useMemo } from 'react';
import { doc, updateDoc, addDoc, collection, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useActiveSession, WorkSessionData } from './useActiveSession';
import { GTDTask } from '../types/gtd.types';

export interface UseSessionManagerReturn {
    activeSession: WorkSessionData | null;
    loading: boolean;
    startSession: (task: GTDTask) => Promise<void>;
    stopSession: () => Promise<void>;
    sessionSnackbarOpen: boolean;
    sessionStartMessage: string;
    setSessionSnackbarOpen: (open: boolean) => void;
}

export const useSessionManager = (userId?: string, userDisplayName?: string, userTelegramId?: string): UseSessionManagerReturn => {

    /**
     * Effective User ID for Time Tracking
     * Priority: telegramId (if exists and numeric) -> Firebase UID
     * This logic is central to linking Bot sessions with Web sessions
     */
    const effectiveUserId = useMemo(() => {
        if (userTelegramId && !isNaN(Number(userTelegramId))) {
            return Number(userTelegramId);
        }
        return userId;
    }, [userId, userTelegramId]);

    const { activeSession, loading } = useActiveSession(effectiveUserId);

    const [sessionSnackbarOpen, setSessionSnackbarOpen] = useState(false);
    const [sessionStartMessage, setSessionStartMessage] = useState('');

    const stopSession = async () => {
        if (!activeSession) return;

        try {
            const sessionRef = doc(db, 'work_sessions', activeSession.id);
            const endTime = Timestamp.now();

            const startTime = activeSession.startTime;
            let diffArr = 0;
            if (startTime) {
                diffArr = endTime.toMillis() - startTime.toMillis();
            }
            const durationMinutes = Math.round(diffArr / 1000 / 60);

            const rate = activeSession.hourlyRate || 0;
            const hours = durationMinutes / 60;
            const earnings = parseFloat((hours * rate).toFixed(2));

            // 1. Update work_session
            await updateDoc(sessionRef, {
                status: 'completed',
                endTime: endTime,
                durationMinutes: durationMinutes,
                sessionEarnings: earnings
            });

            // 2. Aggregate stats on the related task
            if (activeSession.relatedTaskId) {
                try {
                    const { increment } = await import('firebase/firestore');
                    const taskRef = doc(db, 'gtd_tasks', activeSession.relatedTaskId);
                    await updateDoc(taskRef, {
                        totalTimeSpentMinutes: increment(durationMinutes),
                        totalEarnings: increment(earnings),
                        actualDurationMinutes: increment(durationMinutes),
                        updatedAt: Timestamp.now()
                    });
                } catch (e) {
                    console.warn('Could not update task aggregates:', e);
                }
            }

            setSessionStartMessage(`⏹️ Session stopped (${durationMinutes}min, $${earnings})`);
            setSessionSnackbarOpen(true);
        } catch (error) {
            console.error("Error stopping session:", error);
            throw error;
        }
    };

    const startSession = async (task: GTDTask) => {
        if (!userId) return;
        try {
            // 1. Check/Close existing active session
            // We do this manually here because we want to capture the "Auto-switch" event msg
            // leveraging the same query logic as original code

            const sessionsRef = collection(db, 'work_sessions');
            const q = query(
                sessionsRef,
                where('employeeId', '==', effectiveUserId),
                where('status', '==', 'active')
            );
            const snapshot = await getDocs(q);

            let closedSessionMsg = '';

            if (!snapshot.empty) {
                const activeSessionDoc = snapshot.docs[0];
                const activeData = activeSessionDoc.data();

                // Calculate stats for closing
                const endTime = Timestamp.now();
                const startTime = activeData.startTime;

                let diffArr = 0;
                if (startTime) {
                    diffArr = endTime.toMillis() - startTime.toMillis();
                }
                const durationMinutes = Math.round(diffArr / 1000 / 60);

                const rate = activeData.hourlyRate || 0;
                const hours = durationMinutes / 60;
                const earnings = parseFloat((hours * rate).toFixed(2));

                await updateDoc(activeSessionDoc.ref, {
                    status: 'completed',
                    endTime: endTime,
                    durationMinutes: durationMinutes,
                    sessionEarnings: earnings,
                });
                closedSessionMsg = 'Previous session closed. ';
            }

            // 2. Determine hourlyRate: task.hourlyRate → user.hourlyRate → employee.hourlyRate → 0
            // Priority 1: Task-specific rate (for special projects/clients)
            // Priority 2: User's default rate from profile (users collection)
            // Priority 3: Employee's default rate (employees collection - set in Admin UI)
            let hourlyRate = task.hourlyRate || 0;

            if (!hourlyRate) {
                try {
                    const { getDoc } = await import('firebase/firestore');
                    // Try users collection first
                    const userDoc = await getDoc(doc(db, 'users', userId));
                    if (userDoc.exists()) {
                        hourlyRate = userDoc.data()?.hourlyRate || 0;
                    }

                    // Fallback to employees collection (Admin-set rate)
                    if (!hourlyRate) {
                        const employeeDoc = await getDoc(doc(db, 'employees', userId));
                        if (employeeDoc.exists()) {
                            hourlyRate = employeeDoc.data()?.hourlyRate || 0;
                        }
                    }
                } catch (e) {
                    console.warn('Could not fetch hourlyRate:', e);
                }
            }

            // 3. Create new active session with hourlyRate
            await addDoc(collection(db, 'work_sessions'), {
                employeeId: effectiveUserId,
                employeeName: userDisplayName || 'Unknown',
                startTime: Timestamp.now(),
                status: 'active',
                description: task.title,
                clientId: task.clientId || '',
                clientName: task.clientName || '',
                type: 'regular',
                relatedTaskId: task.id,
                relatedTaskTitle: task.title,
                hourlyRate: hourlyRate // Task rate or user fallback
            });

            setSessionStartMessage(`${closedSessionMsg}⏱️ Session started: ${task.title}`);
            setSessionSnackbarOpen(true);
        } catch (error) {
            console.error("Error starting session:", error);
            throw error;
        }
    };

    return {
        activeSession,
        loading,
        startSession,
        stopSession,
        sessionSnackbarOpen,
        sessionStartMessage,
        setSessionSnackbarOpen
    };
};
