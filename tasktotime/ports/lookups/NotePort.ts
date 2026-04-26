/**
 * NotePort — read-only access to `notes/{id}`.
 *
 * Used as AI source for task generation (`Task.sourceNoteId`). Notes contain
 * voice transcripts + photos that AI flow turns into draft tasks.
 *
 * See spec/04-storage/data-dependencies.md §notes/{noteId}.
 */

import type { CompanyId, NoteId, ClientId, ProjectId } from '../../domain/identifiers';

export interface NoteSnapshot {
  id: NoteId;
  companyId: CompanyId;
  transcript?: string;
  audioUrl?: string;
  attachments?: Array<{ url: string; mime: string }>;
  clientId?: ClientId;
  projectId?: ProjectId;
  aiAnalysis?: {
    suggestedTitle?: string;
    suggestedDescription?: string;
    checklist?: Array<{ text: string }>;
  };
  createdAt: number;
}

export interface NotePort {
  findById(id: NoteId): Promise<NoteSnapshot | null>;
}
