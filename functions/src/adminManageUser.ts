/**
 * Cloud Function: admin_manageUser
 *
 * Multi-action callable for admin user management:
 * - resetPassword: Set new password via Admin SDK
 * - forceLogout: Revoke all refresh tokens
 * - changeEmail: Update email in Auth + Firestore
 * - sendPasswordViaTelegram: Send password to user's Telegram
 *
 * Security:
 * - Auth guard (must be authenticated)
 * - Role guard (admin / company_admin only)
 * - Company guard (same company)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { WORKER_BOT_TOKEN } from './config';
const db = admin.firestore();

type Action = 'resetPassword' | 'forceLogout' | 'changeEmail' | 'sendPasswordViaTelegram';

interface ManageUserData {
    action: Action;
    targetUserId: string;
    newPassword?: string;
    newEmail?: string;
}

interface ManageUserResponse {
    success: boolean;
    message: string;
}

export const admin_manageUser = functions
    .runWith({ secrets: [WORKER_BOT_TOKEN] })
    .https.onCall(
    async (data: ManageUserData, context): Promise<ManageUserResponse> => {
        // ============================================
        // 1️⃣ SECURITY: Auth Guard
        // ============================================
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Требуется аутентификация');
        }

        const callerUid = context.auth.uid;
        const { action, targetUserId, newPassword, newEmail } = data;

        if (!action || !targetUserId) {
            throw new functions.https.HttpsError('invalid-argument', 'action и targetUserId обязательны');
        }

        // ============================================
        // 2️⃣ SECURITY: Role & Company Guard
        // ============================================
        const callerDoc = await db.collection('users').doc(callerUid).get();
        if (!callerDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Профиль администратора не найден');
        }

        const callerData = callerDoc.data()!;
        const callerRole = callerData.role;

        if (callerRole !== 'admin' && callerRole !== 'company_admin' && callerRole !== 'super_admin') {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Только администраторы могут управлять пользователями'
            );
        }

        // Get target user profile
        const targetDoc = await db.collection('users').doc(targetUserId).get();
        if (!targetDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Пользователь не найден');
        }

        const targetData = targetDoc.data()!;

        // Company guard
        if (callerData.companyId !== targetData.companyId) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Вы можете управлять только пользователями своей компании'
            );
        }

        // Cannot manage yourself (for destructive actions)
        if (callerUid === targetUserId && (action === 'forceLogout' || action === 'resetPassword')) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Вы не можете выполнить это действие для своего аккаунта'
            );
        }

        console.log(`🔧 Admin ${callerUid} performing "${action}" on user ${targetUserId}`);

        // ============================================
        // 3️⃣ ACTION: Execute based on action type
        // ============================================
        switch (action) {
            // ------------------------------------------
            // Reset Password
            // ------------------------------------------
            case 'resetPassword': {
                if (!newPassword || newPassword.length < 6) {
                    throw new functions.https.HttpsError(
                        'invalid-argument',
                        'Пароль должен содержать минимум 6 символов'
                    );
                }

                await admin.auth().updateUser(targetUserId, { password: newPassword });
                console.log(`✅ Password reset for user ${targetUserId}`);

                return {
                    success: true,
                    message: `Пароль пользователя ${targetData.displayName || targetData.email} успешно изменён`,
                };
            }

            // ------------------------------------------
            // Force Logout (Revoke Refresh Tokens)
            // ------------------------------------------
            case 'forceLogout': {
                await admin.auth().revokeRefreshTokens(targetUserId);
                console.log(`✅ Refresh tokens revoked for user ${targetUserId}`);

                return {
                    success: true,
                    message: `Все сессии пользователя ${targetData.displayName || targetData.email} завершены`,
                };
            }

            // ------------------------------------------
            // Change Email
            // ------------------------------------------
            case 'changeEmail': {
                if (!newEmail) {
                    throw new functions.https.HttpsError('invalid-argument', 'Новый email обязателен');
                }

                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(newEmail)) {
                    throw new functions.https.HttpsError('invalid-argument', 'Некорректный email адрес');
                }

                // Update in Firebase Auth
                await admin.auth().updateUser(targetUserId, { email: newEmail.toLowerCase() });

                // Update in Firestore
                await db.collection('users').doc(targetUserId).update({
                    email: newEmail.toLowerCase(),
                });

                console.log(`✅ Email changed for user ${targetUserId} to ${newEmail}`);

                return {
                    success: true,
                    message: `Email пользователя изменён на ${newEmail}`,
                };
            }

            // ------------------------------------------
            // Send Password via Telegram
            // ------------------------------------------
            case 'sendPasswordViaTelegram': {
                if (!newPassword) {
                    throw new functions.https.HttpsError('invalid-argument', 'Пароль для отправки обязателен');
                }

                const telegramId = targetData.telegramId;
                if (!telegramId) {
                    throw new functions.https.HttpsError(
                        'failed-precondition',
                        'У пользователя не привязан Telegram'
                    );
                }

                if (!WORKER_BOT_TOKEN.value()) {
                    throw new functions.https.HttpsError(
                        'failed-precondition',
                        'WORKER_BOT_TOKEN не настроен'
                    );
                }

                const message =
                    `🔐 *Новый пароль для Profit Step*\n\n` +
                    `Email: \`${targetData.email}\`\n` +
                    `Пароль: \`${newPassword}\`\n\n` +
                    `Ссылка: https://profit-step.firebaseapp.com/login`;

                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN.value()}/sendMessage`, {
                    chat_id: telegramId,
                    text: message,
                    parse_mode: 'Markdown',
                });

                console.log(`✅ Password sent via Telegram to user ${targetUserId} (chatId: ${telegramId})`);

                return {
                    success: true,
                    message: `Пароль отправлен в Telegram пользователя ${targetData.displayName}`,
                };
            }

            default:
                throw new functions.https.HttpsError('invalid-argument', `Неизвестное действие: ${action}`);
        }
    }
);
