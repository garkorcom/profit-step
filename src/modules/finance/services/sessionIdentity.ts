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
/**
 * Pure helpers for normalising session identity (employeeId + employeeName)
 * against the canonical users-directory mapping.
 *
 * Kept in services/ rather than api/ so the unit tests don't transitively
 * import Firebase SDK (`db` side-effect init fails in jsdom jest env).
 */

import { WorkSession } from '../../../types/timeTracking.types';

export interface IdentityDirectory {
    /** Maps Telegram chat id (string) → user document UID. */
    telegramIdToUid: Map<string, string>;
    /** Maps user doc UID → canonical display name. */
    uidToName: Map<string, string>;
}

/**
 * Normalise session identity against the directory. If the session's
 * `employeeId` is a legacy Telegram chat id, map it onto the canonical
 * user UID. Whether it's a UID or a chat id, refresh `employeeName` to
 * the directory's current value so renamed users show up consistently.
 */
export function normalizeSessionIdentities(
    sessions: WorkSession[],
    directory: IdentityDirectory
): WorkSession[] {
    return sessions.map(session => {
        const rawId = String(session.employeeId);
        const mappedUid = directory.telegramIdToUid.get(rawId);
        if (mappedUid) {
            return {
                ...session,
                employeeId: mappedUid,
                employeeName:
                    directory.uidToName.get(mappedUid) || session.employeeName,
            };
        }
        if (directory.uidToName.has(rawId)) {
            return {
                ...session,
                employeeName:
                    directory.uidToName.get(rawId) || session.employeeName,
            };
        }
        return session;
    });
}
