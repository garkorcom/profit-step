/**
 * FirebaseStorageUploadAdapter — `StorageUploadPort` implementation backed
 * by Firebase Storage (GCS).
 *
 * Adapter mapping: spec/04-storage/adapter-mapping.md §22.
 *
 * Conventions:
 *   - `pathRef` form is `gs://{bucket}/{path}`. `signedUrl` and `delete`
 *     parse this back into bucket+path; malformed inputs throw
 *     `INVALID_INPUT`.
 *   - `upload` returns the canonical public URL (`bucket.file(path).publicUrl()`)
 *     — callers that need a time-limited URL should call `signedUrl` instead.
 *   - All SDK errors wrap into `EXTERNAL_FAILURE` to match the
 *     adapter-error contract. Network/SDK details preserved on `cause`.
 *   - `data: Uint8Array | Blob | string` normalized to a Node `Buffer` before
 *     `file.save`.
 *   - Storage SDK is passed in via constructor; no top-level SDK init.
 */

import type { Storage } from 'firebase-admin/storage';

import type {
  StorageUploadPort,
  StorageUploadInput,
  StorageUploadResult,
} from '../../ports/infra/StorageUploadPort';
import { AdapterError } from '../errors';
import { type AdapterLogger, noopLogger } from '../firestore/_shared';

export class FirebaseStorageUploadAdapter implements StorageUploadPort {
  constructor(
    private readonly storage: Storage,
    private readonly defaultBucket: string,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const bucketName = input.bucket ?? this.defaultBucket;
    const buffer = await normalizeData(input.data);
    try {
      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(input.path);
      await file.save(buffer, {
        contentType: input.contentType,
        metadata: input.metadata ? { metadata: input.metadata } : undefined,
        resumable: false,
      });
      return {
        url: file.publicUrl(),
        pathRef: `gs://${bucketName}/${input.path}`,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      this.logger.error?.('FirebaseStorageUploadAdapter.upload failed', {
        bucket: bucketName,
        path: input.path,
        err,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Storage upload failed: ${(err as Error)?.message ?? String(err)}`,
        { op: 'StorageUpload.upload', bucket: bucketName, path: input.path },
        err,
      );
    }
  }

  async signedUrl(pathRef: string, ttlSeconds: number): Promise<string> {
    const { bucket: bucketName, path } = parsePathRef(pathRef);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new AdapterError(
        'INVALID_INPUT',
        `ttlSeconds must be a positive number, got ${ttlSeconds}`,
        { op: 'StorageUpload.signedUrl', pathRef, ttlSeconds },
      );
    }
    try {
      const [url] = await this.storage
        .bucket(bucketName)
        .file(path)
        .getSignedUrl({
          action: 'read',
          expires: Date.now() + ttlSeconds * 1000,
        });
      return url;
    } catch (err) {
      this.logger.error?.('FirebaseStorageUploadAdapter.signedUrl failed', {
        pathRef,
        err,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Signed URL generation failed: ${(err as Error)?.message ?? String(err)}`,
        { op: 'StorageUpload.signedUrl', pathRef },
        err,
      );
    }
  }

  async delete(pathRef: string): Promise<void> {
    const { bucket: bucketName, path } = parsePathRef(pathRef);
    try {
      await this.storage.bucket(bucketName).file(path).delete({ ignoreNotFound: true });
    } catch (err) {
      this.logger.error?.('FirebaseStorageUploadAdapter.delete failed', {
        pathRef,
        err,
      });
      throw new AdapterError(
        'EXTERNAL_FAILURE',
        `Storage delete failed: ${(err as Error)?.message ?? String(err)}`,
        { op: 'StorageUpload.delete', pathRef },
        err,
      );
    }
  }
}

/** Parse `gs://bucket/path/to/file` into its parts. */
function parsePathRef(pathRef: string): { bucket: string; path: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(pathRef);
  if (!match) {
    throw new AdapterError(
      'INVALID_INPUT',
      `pathRef must look like 'gs://bucket/path', got '${pathRef}'`,
      { op: 'StorageUpload.parsePathRef', pathRef },
    );
  }
  return { bucket: match[1], path: match[2] };
}

async function normalizeData(
  data: StorageUploadInput['data'],
): Promise<Buffer> {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf-8');
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data);
  }
  // Blob — Node 18+ has a global Blob; fall back to arrayBuffer().
  if (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function'
  ) {
    const ab = await (data as Blob).arrayBuffer();
    return Buffer.from(ab);
  }
  throw new AdapterError(
    'INVALID_INPUT',
    `StorageUpload.data must be Uint8Array | Blob | string, got ${typeof data}`,
    { op: 'StorageUpload.normalizeData' },
  );
}
