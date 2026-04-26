/**
 * FirestoreNote — `notes/{id}` adapter.
 *
 * Implements {@link NotePort}. Read-only — notes are immutable after AI
 * processing. Used as AI source for task generation
 * (`Task.sourceNoteId`).
 *
 * See spec/04-storage/adapter-mapping.md §10 NotePort and
 * spec/04-storage/data-dependencies.md §notes/{noteId}.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type { NotePort, NoteSnapshot } from '../../ports/lookups/NotePort';
import {
  asClientId,
  asCompanyId,
  asNoteId,
  asProjectId,
  type NoteId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger, toEpochMs } from './_shared';

const COLLECTION = 'notes';

export class FirestoreNote implements NotePort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single note by id.
   *
   * Adapter mapping: §10 row 1 — `get notes/{id}`. Read-only port.
   */
  async findById(id: NoteId): Promise<NoteSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreNote.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'Note.findById', id });
    }
  }
}

// ─── Internal: Firestore data → NoteSnapshot ───────────────────────────

function mapToSnapshot(id: string, data: FirebaseFirestore.DocumentData): NoteSnapshot {
  const result: NoteSnapshot = {
    id: asNoteId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    createdAt: toEpochMs(data.createdAt) ?? 0,
  };

  if (typeof data.transcript === 'string') {
    result.transcript = data.transcript;
  }
  if (typeof data.audioUrl === 'string') {
    result.audioUrl = data.audioUrl;
  } else if (typeof data.sourceAudioUrl === 'string') {
    // Legacy field name (see data-dependencies.md §notes).
    result.audioUrl = data.sourceAudioUrl;
  }

  if (Array.isArray(data.attachments)) {
    const attachments = data.attachments
      .map((raw: unknown) => {
        if (!raw || typeof raw !== 'object') return null;
        const r = raw as { url?: unknown; mime?: unknown };
        if (typeof r.url !== 'string' || typeof r.mime !== 'string') return null;
        return { url: r.url, mime: r.mime };
      })
      .filter((x): x is { url: string; mime: string } => x !== null);
    if (attachments.length > 0) result.attachments = attachments;
  }

  if (typeof data.clientId === 'string' && data.clientId.length > 0) {
    result.clientId = asClientId(data.clientId);
  }
  if (typeof data.projectId === 'string' && data.projectId.length > 0) {
    result.projectId = asProjectId(data.projectId);
  }

  const ai = data.aiAnalysis as
    | {
        suggestedTitle?: unknown;
        suggestedDescription?: unknown;
        checklist?: unknown;
      }
    | undefined;
  if (ai && typeof ai === 'object') {
    const aiOut: NoteSnapshot['aiAnalysis'] = {};
    if (typeof ai.suggestedTitle === 'string') {
      aiOut.suggestedTitle = ai.suggestedTitle;
    }
    if (typeof ai.suggestedDescription === 'string') {
      aiOut.suggestedDescription = ai.suggestedDescription;
    }
    if (Array.isArray(ai.checklist)) {
      const checklist = ai.checklist
        .map((raw: unknown) => {
          if (!raw || typeof raw !== 'object') return null;
          const r = raw as { text?: unknown };
          if (typeof r.text !== 'string') return null;
          return { text: r.text };
        })
        .filter((x): x is { text: string } => x !== null);
      if (checklist.length > 0) aiOut.checklist = checklist;
    }
    if (Object.keys(aiOut).length > 0) {
      result.aiAnalysis = aiOut;
    }
  }

  return result;
}
