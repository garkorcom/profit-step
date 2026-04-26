/**
 * FilePort — metadata for `files/{id}` collection.
 *
 * Distinct from `StorageUploadPort` (raw blob upload). FilePort tracks
 * Firestore-side metadata records that link uploads to tasks/clients/projects.
 */

import type { TaskId, ClientId, ProjectId, FileId } from '../../domain/identifiers';

export interface FileMetadata {
  id: FileId;
  url: string;
  name: string;
  mime: string;
  category?: string;
  linkedTo?: { taskId?: TaskId; clientId?: ClientId; projectId?: ProjectId };
  uploadedAt: number;
  uploadedBy?: string;
}

export interface FilePort {
  findByTask(taskId: TaskId): Promise<FileMetadata[]>;
  findById(id: FileId): Promise<FileMetadata | null>;
  registerUpload(meta: Omit<FileMetadata, 'id'>): Promise<{ id: FileId }>;
}
