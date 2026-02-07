import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAState {
    isInstallable: boolean;
    isInstalled: boolean;
    isIOS: boolean;
    isStandalone: boolean;
}

export function usePWA() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [state, setState] = useState<PWAState>({
        isInstallable: false,
        isInstalled: false,
        isIOS: false,
        isStandalone: false
    });

    useEffect(() => {
        // Check if running as standalone (installed)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
            (window.navigator as any).standalone === true;

        // Check if iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

        // Check if already installed
        const isInstalled = isStandalone || localStorage.getItem('pwa-installed') === 'true';

        setState(prev => ({
            ...prev,
            isIOS,
            isStandalone,
            isInstalled
        }));

        // Listen for beforeinstallprompt (Chrome, Edge, etc.)
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setState(prev => ({ ...prev, isInstallable: true }));
        };

        // Listen for app installed
        const handleAppInstalled = () => {
            setDeferredPrompt(null);
            localStorage.setItem('pwa-installed', 'true');
            setState(prev => ({ ...prev, isInstalled: true, isInstallable: false }));
            console.log('[PWA] App installed successfully');
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    // Trigger install prompt (for Chrome/Edge)
    const install = useCallback(async () => {
        if (!deferredPrompt) return false;

        try {
            await deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;

            if (outcome === 'accepted') {
                console.log('[PWA] User accepted install');
                localStorage.setItem('pwa-installed', 'true');
                setState(prev => ({ ...prev, isInstalled: true }));
                return true;
            } else {
                console.log('[PWA] User dismissed install');
                return false;
            }
        } catch (error) {
            console.error('[PWA] Install error:', error);
            return false;
        } finally {
            setDeferredPrompt(null);
            setState(prev => ({ ...prev, isInstallable: false }));
        }
    }, [deferredPrompt]);

    // Dismiss the install prompt
    const dismiss = useCallback(() => {
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
        setDeferredPrompt(null);
        setState(prev => ({ ...prev, isInstallable: false }));
    }, []);

    // Check if user recently dismissed
    const wasRecentlyDismissed = useCallback(() => {
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        if (!dismissed) return false;
        const dismissedTime = parseInt(dismissed, 10);
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        return Date.now() - dismissedTime < oneWeek;
    }, []);

    return {
        ...state,
        install,
        dismiss,
        wasRecentlyDismissed,
        showInstallPrompt: state.isInstallable && !state.isInstalled && !wasRecentlyDismissed()
    };
}

// Register service worker
export async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('[SW] Service Worker registered:', registration.scope);

            // Check for updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New content is available, show update notification
                            console.log('[SW] New content available, refresh to update');
                        }
                    });
                }
            });

            return registration;
        } catch (error) {
            console.error('[SW] Registration failed:', error);
            return null;
        }
    }
    return null;
}
