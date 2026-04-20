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
