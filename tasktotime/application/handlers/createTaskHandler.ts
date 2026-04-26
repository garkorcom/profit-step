/**
 * createTaskHandler — orchestrates a create-task use case.
 *
 * Maps `CreateTaskCommand` (wire DTO with plain string ids) to
 * `TaskService.createTask` input (branded ids, full draft). Performs
 * lookups (project default-resolution, client name denorm) before delegating.
 */

import type { Task, EpochMs } from '../../domain/Task';
import type { TaskDraft } from '../../domain/services/TaskService';
import { TaskService } from '../../domain/services/TaskService';
import {
  asCompanyId,
  asProjectId,
  asClientId,
  asContactId,
  asEstimateId,
  asEstimateItemId,
  asNoteId,
  asTaskId,
} from '../../domain/identifiers';
import type { CreateTaskCommand } from '../commands/CreateTaskCommand';

export interface CreateTaskHandlerDeps {
  taskService: TaskService;
}

export class CreateTaskHandler {
  constructor(private readonly deps: CreateTaskHandlerDeps) {}

  async execute(command: CreateTaskCommand): Promise<Task> {
    const draft: TaskDraft = {
      companyId: asCompanyId(command.companyId),
      title: command.title,
      description: command.description,
      memo: command.memo,
      bucket: command.bucket,
      priority: command.priority,
      blockedReason: undefined,
      createdBy: command.by,
      assignedTo: command.assignedTo,
      reviewedBy: command.reviewedBy,
      coAssignees: command.coAssignees,
      requiredHeadcount: command.requiredHeadcount,
      linkedContactIds: (command.linkedContactIds ?? []).map(asContactId),
      plannedStartAt: command.plannedStartAt as EpochMs | undefined,
      actualStartAt: undefined,
      dueAt: command.dueAt as EpochMs,
      completedAt: undefined,
      acceptedAt: undefined,
      estimatedDurationMinutes: command.estimatedDurationMinutes,
      actualDurationMinutes: 0,
      dependsOn: undefined,
      blocksTaskIds: undefined,
      autoShiftEnabled: false,
      isCriticalPath: false,
      slackMinutes: 0,
      parentTaskId: command.parentTaskId
        ? asTaskId(command.parentTaskId)
        : undefined,
      isSubtask: !!command.parentTaskId,
      subtaskIds: [],
      subtaskRollup: undefined,
      category: command.category,
      phase: command.phase,
      wiki: undefined,
      wikiInheritsFromParent: !!command.parentTaskId,
      costInternal: command.costInternal,
      priceClient: command.priceClient,
      bonusOnTime: undefined,
      penaltyOverdue: undefined,
      hourlyRate: undefined,
      totalEarnings: 0,
      payments: undefined,
      materials: undefined,
      materialsCostPlanned: 0,
      materialsCostActual: 0,
      requiredTools: undefined,
      location: undefined,
      acceptance: undefined,
      clientId: command.clientId ? asClientId(command.clientId) : undefined,
      clientName: command.clientName,
      projectId: command.projectId ? asProjectId(command.projectId) : undefined,
      projectName: command.projectName,
      sourceEstimateId: command.sourceEstimateId
        ? asEstimateId(command.sourceEstimateId)
        : undefined,
      sourceEstimateItemId: command.sourceEstimateItemId
        ? asEstimateItemId(command.sourceEstimateItemId)
        : undefined,
      sourceNoteId: command.sourceNoteId ? asNoteId(command.sourceNoteId) : undefined,
      linkedTaskIds: undefined,
      source: command.source,
      sourceAudioUrl: undefined,
      aiAuditLogId: undefined,
      aiEstimateUsed: false,
      lastReminderSentAt: undefined,
      clientVisible: command.clientVisible ?? false,
      internalOnly: command.internalOnly ?? false,
      archivedAt: undefined,
      archivedBy: undefined,
    };

    return this.deps.taskService.createTask({
      companyId: command.companyId,
      draft,
      initialLifecycle: command.initialLifecycle ?? 'draft',
      by: command.by,
      idempotencyKey: command.idempotencyKey,
    });
  }
}
