/**
 * TaskService hierarchy depth guard — QA 2026-04-27 P2-2 regression.
 *
 * Pin: a subtask cannot have its own subtasks. The chain `root → L1 → L2`
 * must throw `MaxHierarchyDepth` at the L2 step. QA found chains down to
 * L7 created unbounded because the check existed in `domain/errors.ts` but
 * was never thrown anywhere on the create path.
 */

import { TaskService } from '../../../domain/services/TaskService';
import { MaxHierarchyDepth } from '../../../domain/errors';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { asUserId } from '../../../domain/identifiers';
import type { TaskDraft } from '../../../domain/services/TaskService';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function buildSvc() {
  const ports = makeAllPorts(T0);
  const taskService = new TaskService({
    taskRepo: ports.taskRepo,
    transitionLog: ports.transitionLog,
    workSessions: ports.workSessions,
    payroll: ports.payroll,
    idempotency: ports.idempotency,
    clock: ports.clock,
    idGenerator: ports.idGenerator,
  });
  return { ports, taskService };
}

const baseDraft = (overrides: Partial<TaskDraft> = {}): TaskDraft => ({
  companyId: 'company_acme' as TaskDraft['companyId'],
  title: 'Hierarchy test',
  bucket: 'next',
  priority: 'medium',
  blockedReason: undefined,
  createdBy: { id: asUserId('user_pm'), name: 'PM' },
  assignedTo: { id: asUserId('user_w'), name: 'Worker' },
  reviewedBy: undefined,
  coAssignees: undefined,
  requiredHeadcount: 1,
  linkedContactIds: [],
  plannedStartAt: undefined,
  actualStartAt: undefined,
  dueAt: (T0 + 24 * HOUR) as TaskDraft['dueAt'],
  completedAt: undefined,
  acceptedAt: undefined,
  estimatedDurationMinutes: 60,
  actualDurationMinutes: 0,
  dependsOn: undefined,
  blocksTaskIds: undefined,
  autoShiftEnabled: false,
  isCriticalPath: false,
  slackMinutes: 0,
  parentTaskId: undefined,
  isSubtask: false,
  subtaskIds: [],
  subtaskRollup: undefined,
  category: undefined,
  phase: undefined,
  wiki: undefined,
  wikiInheritsFromParent: false,
  costInternal: { amount: 0, currency: 'USD' },
  priceClient: { amount: 0, currency: 'USD' },
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
  clientId: undefined,
  clientName: undefined,
  projectId: undefined,
  projectName: undefined,
  sourceEstimateId: undefined,
  sourceEstimateItemId: undefined,
  sourceNoteId: undefined,
  linkedTaskIds: undefined,
  source: 'web',
  sourceAudioUrl: undefined,
  aiAuditLogId: undefined,
  aiEstimateUsed: false,
  lastReminderSentAt: undefined,
  clientVisible: false,
  internalOnly: false,
  archivedAt: undefined,
  archivedBy: undefined,
  ...overrides,
});

describe('TaskService.createTask — hierarchy depth guard (P2-2)', () => {
  test('root task creates fine (no parent)', async () => {
    const { taskService } = buildSvc();
    const t = await taskService.createTask({
      companyId: 'company_acme',
      draft: baseDraft({ title: 'L0 root' }),
      initialLifecycle: 'draft',
      by: { id: asUserId('user_pm'), name: 'PM' },
      idempotencyKey: 'k1',
    });
    expect(t.isSubtask).toBe(false);
    expect(t.parentTaskId).toBeUndefined();
  });

  test('subtask under root creates fine (L1)', async () => {
    const { taskService } = buildSvc();
    const root = await taskService.createTask({
      companyId: 'company_acme',
      draft: baseDraft({ title: 'L0 root' }),
      initialLifecycle: 'draft',
      by: { id: asUserId('user_pm'), name: 'PM' },
      idempotencyKey: 'k-root',
    });
    const sub = await taskService.createTask({
      companyId: 'company_acme',
      draft: baseDraft({
        title: 'L1 sub',
        parentTaskId: root.id,
        isSubtask: true,
      }),
      initialLifecycle: 'draft',
      by: { id: asUserId('user_pm'), name: 'PM' },
      idempotencyKey: 'k-sub',
    });
    expect(sub.isSubtask).toBe(true);
    expect(sub.parentTaskId).toBe(root.id);
  });

  test('grand-subtask (L2) is rejected with MaxHierarchyDepth', async () => {
    const { taskService } = buildSvc();
    const root = await taskService.createTask({
      companyId: 'company_acme',
      draft: baseDraft({ title: 'L0 root' }),
      initialLifecycle: 'draft',
      by: { id: asUserId('user_pm'), name: 'PM' },
      idempotencyKey: 'k-root',
    });
    const sub = await taskService.createTask({
      companyId: 'company_acme',
      draft: baseDraft({
        title: 'L1 sub',
        parentTaskId: root.id,
        isSubtask: true,
      }),
      initialLifecycle: 'draft',
      by: { id: asUserId('user_pm'), name: 'PM' },
      idempotencyKey: 'k-sub',
    });
    // L2 attempt: parent (sub) is itself a subtask → reject.
    await expect(
      taskService.createTask({
        companyId: 'company_acme',
        draft: baseDraft({
          title: 'L2 grand-sub',
          parentTaskId: sub.id,
          isSubtask: true,
        }),
        initialLifecycle: 'draft',
        by: { id: asUserId('user_pm'), name: 'PM' },
        idempotencyKey: 'k-grand',
      }),
    ).rejects.toThrow(MaxHierarchyDepth);
  });
});
