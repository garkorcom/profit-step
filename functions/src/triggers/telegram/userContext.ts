/**
 * UserContext - Centralized user context management for Telegram bot
 * 
 * Purpose: Reduce Firestore calls by caching user data once per message
 * Before: 5+ getActiveSession() and findPlatformUser() calls per message
 * After: 1 parallel fetch at message start
 */

import * as admin from 'firebase-admin';
import { getActiveSession as getActiveSessionFromUtils } from './telegramUtils';

const db = admin.firestore();

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface PlatformUser {
    id: string;
    telegramId?: string;
    displayName?: string;
    email?: string;
    role?: string;
    hourlyRate?: number;
    [key: string]: any;
}

export interface WorkSession {
    id: string;
    status: 'active' | 'paused' | 'done';
    employeeId: string | number;
    clientId?: string;
    clientName?: string;
    serviceName?: string;
    startTime?: admin.firestore.Timestamp;
    pausedAt?: admin.firestore.Timestamp;
    hourlyRate?: number;
    [key: string]: any;
}

export interface UserSessionState {
    awaitingShoppingAdd?: boolean;
    awaitingShoppingReceipt?: boolean;
    awaitingReceiptAmount?: boolean;
    awaitingGoodsPhoto?: boolean;
    awaitingPaymentSource?: boolean;
    shoppingListId?: string;
    shoppingDraft?: any[];
    shoppingClientName?: string;
    pendingReceiptId?: string;
    [key: string]: any;
}

export interface UserContext {
    chatId: number;
    userId: number;
    userName: string;
    messageId: number;

    // Cached data (fetched once)
    platformUser: PlatformUser | null;
    platformUserId: string | null;
    activeSession: WorkSession | null;
    userState: UserSessionState | null;

    // Helpers
    isAuthenticated: boolean;
    isInSession: boolean;
    isInPausedSession: boolean;
}

// ═══════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════

/**
 * Build user context with all necessary data in parallel
 * 
 * @param message - Telegram message object
 * @returns UserContext with cached platformUser, activeSession, and userState
 */
export async function buildUserContext(message: any): Promise<UserContext> {
    const userId = message.from.id;
    const chatId = message.chat.id;
    const userName = message.from.first_name || 'User';
    const messageId = message.message_id;

    // Parallel fetch - 3 queries instead of 5+ sequential
    const [platformUser, activeSessionDoc, stateDoc] = await Promise.all([
        findPlatformUser(userId),
        getActiveSessionFromUtils(userId),
        db.collection('user_sessions').doc(String(userId)).get()
    ]);

    // Parse active session
    let activeSession: WorkSession | null = null;
    if (activeSessionDoc) {
        activeSession = {
            id: activeSessionDoc.id,
            ...activeSessionDoc.data()
        } as WorkSession;
    }

    // Parse user state
    const userState = stateDoc.exists ? (stateDoc.data() as UserSessionState) : null;

    return {
        chatId,
        userId,
        userName,
        messageId,
        platformUser,
        platformUserId: platformUser?.id || null,
        activeSession,
        userState,
        isAuthenticated: platformUser !== null,
        isInSession: activeSession !== null && activeSession.status === 'active',
        isInPausedSession: activeSession !== null && activeSession.status === 'paused',
    };
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Find platform user by Telegram ID
 */
async function findPlatformUser(telegramId: number): Promise<PlatformUser | null> {
    try {
        const snapshot = await db.collection('users')
            .where('telegramId', '==', String(telegramId))
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() } as PlatformUser;
        }
    } catch (error) {
        console.error("Error finding platform user:", error);
    }
    return null;
}

/**
 * Build context for callback queries (uses message from callback)
 */
export async function buildCallbackContext(query: any): Promise<UserContext> {
    const message = query.message;
    return buildUserContext({
        ...message,
        from: query.from,
        message_id: message.message_id
    });
}

/**
 * Create minimal context for inbox operations
 */
export function toInboxContext(ctx: UserContext): {
    chatId: number;
    userId: number;
    userName: string;
    messageId: number;
    platformUserId?: string;
} {
    return {
        chatId: ctx.chatId,
        userId: ctx.userId,
        userName: ctx.userName,
        messageId: ctx.messageId,
        platformUserId: ctx.platformUserId || undefined
    };
}
