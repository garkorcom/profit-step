/**
 * @fileoverview Tasktotime — wiki attachment upload to Firebase Storage.
 *
 * Backs the MDXEditor's `imageUploadHandler` for both `TaskDetailPage` (Wiki
 * tab in the drawer) and the standalone `WikiPage` view. Uploads land at
 *
 *   companies/{companyId}/tasks/{taskId}/wiki/{timestamp}_{sanitizedName}
 *
 * The path mirrors the convention from `storage.rules` (`isValidSize` ≤ 5MB,
 * `isImage` content-type prefix). Both rules need to be deployed (`firebase
 * deploy --only storage`) before this works in production — see PR #114
 * description.
 *
 * Why a separate module: TaskDetailPage and WikiPage both host the editor and
 * both want the same companyId+taskId-scoped closure. Pulling the helper out
 * keeps the validation / path scheme / error-shape identical between them
 * (and isolated for unit tests).
 */

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { storage } from '../firebase/firebase';

/** Mirrors `storage.rules:isValidSize()` — 5 MiB. Don't drift. */
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Mirrors `storage.rules:isImage()` — `image/*` only. Wiki accepts inline
 * images; non-image attachments go through the regular task `materials` path
 * (a separate flow not yet wired into the editor).
 */
const ALLOWED_TYPE_PREFIX = 'image/';

export type WikiAttachmentErrorCode =
    | 'SIZE_LIMIT'
    | 'TYPE_NOT_ALLOWED'
    | 'UPLOAD_FAILED';

/**
 * Typed error so call sites can show a precise toast (size vs MIME vs network)
 * instead of a generic "upload failed". Keep `code` literal-typed — the
 * `TaskDetailPage` toast switch reads it directly.
 */
export class WikiAttachmentError extends Error {
    readonly code: WikiAttachmentErrorCode;
    constructor(code: WikiAttachmentErrorCode, message: string) {
        super(message);
        this.name = 'WikiAttachmentError';
        this.code = code;
    }
}

/**
 * Strip path separators, control chars, and other Storage-unfriendly chars
 * from the user-supplied filename. We keep the original extension because the
 * download URL leans on it for the `Content-Type` sniff fallback when the
 * upload metadata gets lost (rare, but observed when a Storage bucket is
 * mirrored across regions).
 */
function sanitizeFileName(raw: string): string {
    return raw.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'attachment';
}

/**
 * Upload one wiki attachment and return its public download URL. Throws
 * {@link WikiAttachmentError} on validation failures or Storage rejection so
 * the caller can branch on `err.code`.
 */
export async function uploadWikiAttachment(
    file: File,
    companyId: string,
    taskId: string,
): Promise<string> {
    if (file.size > MAX_SIZE_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        throw new WikiAttachmentError(
            'SIZE_LIMIT',
            `File "${file.name}" is ${mb} MB — max 5 MB per attachment.`,
        );
    }
    if (!file.type.startsWith(ALLOWED_TYPE_PREFIX)) {
        throw new WikiAttachmentError(
            'TYPE_NOT_ALLOWED',
            `Only images are supported here (got ${file.type || 'unknown'}).`,
        );
    }

    const path = `companies/${encodeURIComponent(companyId)}/tasks/${encodeURIComponent(
        taskId,
    )}/wiki/${Date.now()}_${sanitizeFileName(file.name)}`;
    const fileRef = ref(storage, path);

    try {
        await uploadBytes(fileRef, file, { contentType: file.type });
        return await getDownloadURL(fileRef);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new WikiAttachmentError(
            'UPLOAD_FAILED',
            `Failed to upload "${file.name}": ${reason}`,
        );
    }
}
