/**
 * updateWikiHandler — patches `task.wiki` with optimistic concurrency.
 *
 * Note: this handler bypasses the lifecycle state machine (wiki edits are
 * orthogonal to lifecycle). Optimistic version check enforces that two
 * concurrent edits cannot silently overwrite each other.
 */

import type { Task, TaskWiki, EpochMs } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { ClockPort } from '../../ports/infra/ClockPort';
import { asTaskId } from '../../domain/identifiers';
import { TaskNotFound, WikiStaleVersion } from '../../domain/errors';
import type { UpdateWikiCommand } from '../commands/UpdateWikiCommand';

export interface UpdateWikiHandlerDeps {
  taskRepo: TaskRepository;
  clock: ClockPort;
}

export class UpdateWikiHandler {
  constructor(private readonly deps: UpdateWikiHandlerDeps) {}

  async execute(command: UpdateWikiCommand): Promise<Task> {
    const taskId = asTaskId(command.taskId);
    const task = await this.deps.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFound(taskId);

    const currentVersion = task.wiki?.version ?? 0;
    if (currentVersion !== command.expectedVersion) {
      // Concurrency conflict, not a draft / precondition error — surface as
      // 409 (StaleVersion) so frontend retry/resync logic catches it the
      // same way it already catches the document-level StaleVersion case.
      // Was `PreconditionFailed` (→ 400) until QA 2026-04-27 found the
      // status-code mismatch.
      throw new WikiStaleVersion(taskId, command.expectedVersion, currentVersion);
    }

    const now = this.deps.clock.now() as EpochMs;
    const newVersion = currentVersion + 1;

    const newHistory = [
      ...(task.wiki?.versionHistory ?? []).slice(-9),
      ...(task.wiki
        ? [
            {
              version: currentVersion,
              contentMd: task.wiki.contentMd,
              updatedAt: task.wiki.updatedAt,
              updatedBy: task.wiki.updatedBy,
              changeSummary: command.changeSummary,
            },
          ]
        : []),
    ];

    const wiki: TaskWiki = {
      contentMd: command.contentMd,
      updatedAt: now,
      updatedBy: command.by,
      version: newVersion,
      versionHistory: newHistory,
      attachments: task.wiki?.attachments,
      templateId: task.wiki?.templateId,
    };

    const updated: Task = {
      ...task,
      wiki,
      updatedAt: now,
      history: [
        ...(task.history ?? []),
        {
          type: 'wiki_update',
          at: now,
          by: command.by,
          meta: { version: newVersion, changeSummary: command.changeSummary },
        },
      ],
    };

    await this.deps.taskRepo.saveIfUnchanged(updated, task.updatedAt);
    return updated;
  }
}
