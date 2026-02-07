import { useRef, useCallback, useEffect } from 'react';

interface SwipeConfig {
    onSwipeLeft?: () => void;
    onSwipeRight?: () => void;
    onSwipeUp?: () => void;
    onSwipeDown?: () => void;
    threshold?: number;  // Minimum distance to trigger swipe (default: 50)
    maxTime?: number;    // Max time for swipe gesture in ms (default: 500)
}

interface TouchState {
    startX: number;
    startY: number;
    startTime: number;
}

/**
 * Custom hook for detecting swipe gestures
 * 
 * Usage:
 * const containerRef = useSwipeGesture({
 *   onSwipeLeft: () => setTab(tab + 1),
 *   onSwipeRight: () => setTab(tab - 1),
 * });
 * 
 * <Box ref={containerRef}>...</Box>
 */
export function useSwipeGesture<T extends HTMLElement = HTMLDivElement>(config: SwipeConfig) {
    const ref = useRef<T>(null);
    const touchState = useRef<TouchState | null>(null);

    const {
        onSwipeLeft,
        onSwipeRight,
        onSwipeUp,
        onSwipeDown,
        threshold = 50,
        maxTime = 500
    } = config;

    const handleTouchStart = useCallback((e: TouchEvent) => {
        const touch = e.touches[0];
        touchState.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            startTime: Date.now()
        };
    }, []);

    const handleTouchEnd = useCallback((e: TouchEvent) => {
        if (!touchState.current) return;

        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchState.current.startX;
        const deltaY = touch.clientY - touchState.current.startY;
        const deltaTime = Date.now() - touchState.current.startTime;

        // Check if it's a quick enough swipe
        if (deltaTime > maxTime) {
            touchState.current = null;
            return;
        }

        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Determine swipe direction (prioritize horizontal)
        if (absX > absY && absX > threshold) {
            if (deltaX > 0) {
                onSwipeRight?.();
            } else {
                onSwipeLeft?.();
            }
        } else if (absY > absX && absY > threshold) {
            if (deltaY > 0) {
                onSwipeDown?.();
            } else {
                onSwipeUp?.();
            }
        }

        touchState.current = null;
    }, [onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, maxTime]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!touchState.current) return;

        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - touchState.current.startX);
        const deltaY = Math.abs(touch.clientY - touchState.current.startY);

        // If horizontal swipe is detected, prevent vertical scroll
        if (deltaX > deltaY && deltaX > 10) {
            // Only prevent if we have horizontal handlers
            if (onSwipeLeft || onSwipeRight) {
                // Don't prevent default here as it may interfere with scroll
                // e.preventDefault();
            }
        }
    }, [onSwipeLeft, onSwipeRight]);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        element.addEventListener('touchstart', handleTouchStart, { passive: true });
        element.addEventListener('touchend', handleTouchEnd, { passive: true });
        element.addEventListener('touchmove', handleTouchMove, { passive: true });

        return () => {
            element.removeEventListener('touchstart', handleTouchStart);
            element.removeEventListener('touchend', handleTouchEnd);
            element.removeEventListener('touchmove', handleTouchMove);
        };
    }, [handleTouchStart, handleTouchEnd, handleTouchMove]);

    return ref;
}

/**
 * Haptic feedback for supported devices
 */
export function triggerHaptic(type: 'light' | 'medium' | 'heavy' = 'light') {
    if ('vibrate' in navigator) {
        const duration = type === 'light' ? 10 : type === 'medium' ? 25 : 50;
        navigator.vibrate(duration);
    }
}
