/**
 * @fileoverview Tasktotime — drawer open/close state with localStorage persistence.
 *
 * PR #86 (Phase 4.0) shipped a mobile drawer whose `open` state lived in
 * component memory only. On reload the drawer always closed — fine for desktop
 * but jarring on mobile where users routinely background the tab and come back
 * to find their nav reset.
 *
 * This hook persists the boolean under a single localStorage key
 * (`tasktotime.drawer.open`) and falls back to in-memory state when storage is
 * unavailable (private mode, quota exceeded, SSR). Both reads and writes are
 * defensive — a failure here must never crash the layout.
 *
 * Lazy initializer pattern is used in `useState(() => …)` so we hit
 * localStorage exactly once per mount, not on every render.
 */

import { useCallback, useState } from 'react';

const STORAGE_KEY = 'tasktotime.drawer.open';

/**
 * Read the persisted drawer flag. Defensive — wraps localStorage access in
 * try/catch because Safari private mode and SSR both throw on access.
 */
const readPersisted = (): boolean => {
    try {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

/**
 * Write the persisted drawer flag. Best-effort — failures are swallowed so the
 * drawer continues to behave from in-memory state.
 */
const writePersisted = (value: boolean): void => {
    try {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    } catch {
        /* noop — quota / private mode / SSR */
    }
};

export interface DrawerOpenState {
    open: boolean;
    handleOpen: () => void;
    handleClose: () => void;
    setOpen: (next: boolean) => void;
}

/**
 * Hook owning the mobile drawer open/close state for `TasktotimeLayout`.
 *
 * Backwards-compat: drops in for the old `useState(false)` pair without
 * changing the public surface — callers still get `open`, `handleOpen`,
 * `handleClose`. The only addition is `setOpen` which `<SwipeableDrawer>`'s
 * `onOpen`/`onClose` handlers call directly.
 */
export const useDrawerOpenState = (): DrawerOpenState => {
    const [open, setOpenState] = useState<boolean>(readPersisted);

    const setOpen = useCallback((next: boolean) => {
        setOpenState(next);
        writePersisted(next);
    }, []);

    const handleOpen = useCallback(() => setOpen(true), [setOpen]);
    const handleClose = useCallback(() => setOpen(false), [setOpen]);

    return { open, handleOpen, handleClose, setOpen };
};

export default useDrawerOpenState;
