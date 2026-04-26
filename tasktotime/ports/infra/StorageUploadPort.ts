/**
 * StorageUploadPort — generic blob upload (Firebase Storage / S3).
 *
 * Used for acceptance act PDFs, wiki attachments, photo evidence.
 */

export interface StorageUploadInput {
  /** Default per adapter. */
  bucket?: string;
  /** e.g. 'tasktotime/{companyId}/{taskId}/...'. */
  path: string;
  contentType: string;
  /** Adapter normalizes (Uint8Array preferred for Node, Blob for web). */
  data: Uint8Array | Blob | string;
  metadata?: Record<string, string>;
}

export interface StorageUploadResult {
  url: string;
  pathRef: string;
  sizeBytes: number;
}

export interface StorageUploadPort {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  signedUrl(pathRef: string, ttlSeconds: number): Promise<string>;
  delete(pathRef: string): Promise<void>;
}
