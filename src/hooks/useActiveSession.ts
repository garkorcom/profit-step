/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 🚨 PROD-CRITICAL — time-tracking / finance module                        ║
 * ║                                                                          ║
 * ║ DO NOT MODIFY without explicit approval from Denis in chat.              ║
 * ║                                                                          ║
 * ║ This file participates in real workers' hours and money calculation.   ║
 * ║ A one-line firestore.rules tightening without code/index/backfill        ║
 * ║ companions caused the 6-hour outage of incident 2026-04-28.              ║
 * ║                                                                          ║
 * ║ Before touching this file:                                               ║
 * ║   1. Read ~/.claude/projects/-Users-denysharbuzov-Projects-profit-step/  ║
 * ║      memory/feedback_no_touch_time_finance.md                            ║
 * ║   2. Get explicit "ok" from Denis IN THE CURRENT SESSION.                ║
 * ║   3. If RLS-related: plan backfill + code-audit + indexes + deploy order ║
 * ║      together (see feedback_rls_three_part_change.md).                   ║
 * ║   4. Run functions/scripts/backup-finance-and-time.js BEFORE any write.  ║
 * ║                                                                          ║
 * ║ "Just refactoring / cleaning up / adding types" is NOT a reason to       ║
 * ║ skip step 2. Stop and ask first.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../auth/AuthContext';
import { WorkSession } from '../types/timeTracking.types'; // Assuming types exist, or I can define here

export interface WorkSessionData extends WorkSession {
    id: string;
}

export function useActiveSession(userId?: string | number) {
    const [activeSession, setActiveSession] = useState<WorkSessionData | null>(null);
    const [loading, setLoading] = useState(true);
    const { userProfile } = useAuth();
    const companyId = userProfile?.companyId;

    useEffect(() => {
        if (!userId || !companyId) {
            setActiveSession(null);
            setLoading(false);
            return;
        }

        const sessionsRef = collection(db, 'work_sessions');
        // companyId filter REQUIRED — RLS read rule (PR #95) demands
        // resource.data.companyId == getUserCompany() OR Firestore rejects
        // the entire query as permission-denied.
        const q = query(
            sessionsRef,
            where('companyId', '==', companyId),
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
    }, [userId, companyId]);

    return { activeSession, loading };
}
