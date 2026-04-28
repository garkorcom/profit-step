/**
 * @fileoverview Shared tasktotime UI surface (dialogs, palettes, helpers).
 *
 * Pages under `src/pages/crm/tasktotime/*` import from here so the dialogs
 * + visual tokens stay byte-for-byte identical across List / Detail / Board
 * views. Phase 4.4 introduced the barrel when the BoardPage needed to reuse
 * `BlockDialog` / `AcceptDialog` previously inlined in `TaskDetailPage`.
 */

export { default as BlockDialog } from './BlockDialog';
export type { BlockDialogProps } from './BlockDialog';
export { default as AcceptDialog } from './AcceptDialog';
export type { AcceptDialogProps, AcceptDialogPayload } from './AcceptDialog';
export { default as WikiEditor } from './WikiEditor';
export {
    LIFECYCLE_COLORS,
    PRIORITY_COLORS,
    FALLBACK_CHIP,
    PRIORITY_INT_TO_STRING,
    resolvePriorityKey,
    newIdempotencyKey,
} from './visualTokens';
export type { ChipPalette } from './visualTokens';
