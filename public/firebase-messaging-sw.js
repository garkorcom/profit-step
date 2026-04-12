/**
 * Firebase Messaging Service Worker — Phase 10c
 *
 * Handles background push notifications from FCM.
 * This runs independently from the main service-worker.js.
 *
 * IMPORTANT: This file MUST be at the root of the public directory
 * for Firebase Messaging to find it automatically.
 */

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Minimal config — only needs projectId, apiKey, and messagingSenderId
// These are NOT secrets — they're public identifiers
firebase.initializeApp({
  apiKey: 'AIzaSyD_placeholder',  // Will be replaced during build or from env
  projectId: 'profit-step',
  messagingSenderId: '1234567890',  // Will be replaced during build
  appId: '1:1234567890:web:placeholder',
});

const messaging = firebase.messaging();

// Handle background messages (when app is not in focus)
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Background message:', payload);

  const title = payload.notification?.title || payload.data?.title || 'Profit Step';
  const body = payload.notification?.body || payload.data?.body || 'New notification';
  const icon = '/icon-192.png';
  const badge = '/icon-192.png';

  // Event type info from data payload
  const eventType = payload.data?.eventType || '';
  const eventAction = payload.data?.eventAction || '';
  const entityId = payload.data?.entityId || '';

  const options = {
    body,
    icon,
    badge,
    tag: entityId || `ps-${Date.now()}`, // Group by entity to avoid spam
    renotify: true,
    data: {
      url: payload.data?.url || '/crm/gtd',
      eventType,
      eventAction,
      entityId,
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  return self.registration.showNotification(title, options);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  // Open the relevant page
  const url = event.notification.data?.url || '/crm/gtd';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open new window
      return clients.openWindow(url);
    })
  );
});
