import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { WorkSession } from '../types/timeTracking.types'; // Assuming types exist, or I can define here

export interface WorkSessionData extends WorkSession {
    id: string;
}

export function useActiveSession(userId?: string | number) {
    const [activeSession, setActiveSession] = useState<WorkSessionData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!userId) {
            setActiveSession(null);
            setLoading(false);
            return;
        }

        const sessionsRef = collection(db, 'work_sessions');
        const q = query(
            sessionsRef,
            where('employeeId', '==', userId),
            where('status', 'in', ['active', 'paused'])
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                setActiveSession({ id: doc.id, ...doc.data() } as WorkSessionData);
            } else {
                setActiveSession(null);
            }
            setLoading(false);
        }, (error) => {
            // QA 2026-04-27 P1-4: work_sessions Firestore Rules were tightened
            // (PR #95/#100 cross-tenant scoping). Users without read scope
            // for the current employeeId/companyId hit `permission-denied`.
            // Treat that as "no active session" and stay quiet — the widget
            // already shows an empty state. Console-error other failures.
            if ((error as { code?: string })?.code === 'permission-denied') {
                setActiveSession(null);
                setLoading(false);
                return;
            }
            console.error("Error listening to active session:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [userId]);

    return { activeSession, loading };
}
