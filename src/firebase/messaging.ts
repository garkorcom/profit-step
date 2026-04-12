/**
 * Firebase Cloud Messaging (FCM) — Phase 10c
 *
 * Push notifications for PWA agents and browser sessions.
 * - Requests notification permission from user
 * - Registers FCM token in Firestore (users/{uid}/fcmTokens)
 * - Listens for foreground messages and shows toast
 * - Background messages handled by firebase-messaging-sw.js
 */

import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import app from './firebase';
import { db, auth } from './firebase';

let messaging: Messaging | null = null;

/**
 * Check if FCM is supported in this browser.
 * Returns false in Firefox private mode, SSR, etc.
 */
export async function isFCMSupported(): Promise<boolean> {
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * Initialize FCM messaging instance (lazy).
 */
async function getMessagingInstance(): Promise<Messaging | null> {
  if (messaging) return messaging;

  const supported = await isFCMSupported();
  if (!supported) {
    console.warn('[FCM] Messaging not supported in this browser');
    return null;
  }

  messaging = getMessaging(app);
  return messaging;
}

/**
 * Request notification permission and register FCM token.
 * Call this when user clicks "Enable notifications" or on login.
 *
 * Returns the FCM token string, or null if denied/unsupported.
 */
export async function requestNotificationPermission(): Promise<string | null> {
  const msg = await getMessagingInstance();
  if (!msg) return null;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.warn('[FCM] No authenticated user');
    return null;
  }

  try {
    // Request browser notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.info('[FCM] Notification permission denied');
      return null;
    }

    // Get FCM token (uses VAPID key from env)
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    const token = await getToken(msg, {
      vapidKey,
      serviceWorkerRegistration: await navigator.serviceWorker.getRegistration(),
    });

    if (!token) {
      console.warn('[FCM] Failed to get FCM token');
      return null;
    }

    // Store token in Firestore for backend to use
    await saveFCMToken(uid, token);

    console.info('[FCM] Token registered successfully');
    return token;
  } catch (err) {
    console.error('[FCM] Error registering token:', err);
    return null;
  }
}

/**
 * Save FCM token to Firestore.
 * Stored as subcollection: users/{uid}/fcmTokens/{tokenHash}
 */
async function saveFCMToken(uid: string, token: string): Promise<void> {
  // Use a hash of the token as doc ID to avoid duplicates
  const tokenHash = await hashToken(token);
  const ref = doc(db, 'users', uid, 'fcmTokens', tokenHash);

  await setDoc(ref, {
    token,
    createdAt: serverTimestamp(),
    lastRefreshed: serverTimestamp(),
    userAgent: navigator.userAgent,
    platform: navigator.platform || 'unknown',
  });
}

/**
 * Remove FCM token from Firestore (on logout or disable).
 */
export async function removeFCMToken(token: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const tokenHash = await hashToken(token);
  const ref = doc(db, 'users', uid, 'fcmTokens', tokenHash);
  await deleteDoc(ref);
}

/**
 * Listen for foreground messages.
 * Call this once on app init to handle notifications when app is in foreground.
 *
 * @param onNotification — callback with notification title and body
 */
export function onForegroundMessage(
  onNotification: (payload: { title: string; body: string; data?: Record<string, string> }) => void,
): (() => void) | null {
  if (!messaging) return null;

  const unsubscribe = onMessage(messaging, (payload) => {
    console.info('[FCM] Foreground message:', payload);

    const title = payload.notification?.title || payload.data?.title || 'Profit Step';
    const body = payload.notification?.body || payload.data?.body || '';
    const data = payload.data as Record<string, string> | undefined;

    onNotification({ title, body, data });
  });

  return unsubscribe;
}

/**
 * Simple hash for token deduplication (not crypto-sensitive).
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 20);
}
