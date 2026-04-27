/**
 * Tests for the legacy ↔ tasktotime translation helpers.
 *
 * Coverage:
 *   - `legacyCreateToTasktotime` — flat legacy POST body → tasktotime
 *     CreateTaskCommand wire shape; defaults applied.
 *   - `legacyPatchToTasktotime`  — split into patch fields + lifecycle
 *     transition target; unknown statuses raise error.
 *   - `legacyListQueryToTasktotime` — comma-separated legacy statuses →
 *     tasktotime lifecycle filter.
 *   - `tasktotimeTaskToLegacy`   — outbound shape preserves all
 *     bot-relevant fields; computed fields are dropped.
 *   - `lifecycleToTransitionAction` — inverse lookup is correct.
 */

import {
  legacyCreateToTasktotime,
  legacyPatchToTasktotime,
  legacyListQueryToTasktotime,
  lifecycleToTransitionAction,
  tasktotimeTaskToLegacy,
} from '../../../../adapters/http/handlers/legacyGtdProxy/translate';
import { makeTask } from '../../../../shared/test-helpers/makeTask';
import { asTaskId, asCompanyId } from '../../../../domain/identifiers';

const CALLER = { id: 'user_pm', name: 'PM' };
const COMPANY_ID = 'company_acme';
const NOW = 1_700_000_000_000;

describe('legacyCreateToTasktotime', () => {
  test('full payload translates fields and defaults', () => {
    const result = legacyCreateToTasktotime(
      {
        title: 'Frame the wall',
        status: 'inProgress',
        priority: 'high',
        clientId: 'client_x',
        clientName: 'Mr. X',
        projectId: 'project_y',
        description: 'Some context',
      },
      CALLER,
      COMPANY_ID,
      'idem-1',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBeDefined();
    const v = result.value!;
    expect(v.body.title).toBe('Frame the wall');
    expect(v.body.companyId).toBe(COMPANY_ID);
    expect(v.body.idempotencyKey).toBe('idem-1');
    expect(v.body.priority).toBe('high');
    expect(v.body.bucket).toBe('next');
    // 'inProgress' (= started lifecycle) is NOT a valid initial state →
    // proxy demotes to 'ready' and expects the bot to issue a transition
    // separately. See translate.ts comment.
    expect(v.body.initialLifecycle).toBe('ready');
    expect(v.body.source).toBe('api');
    expect(v.body.requiredHeadcount).toBe(1);
    expect(v.body.assignedTo).toEqual({ id: CALLER.id, name: CALLER.name });
    // Default dueAt is now + 7 days
    expect(v.body.dueAt).toBe(NOW + 7 * 24 * 60 * 60 * 1000);
    expect(v.body.estimatedDurationMinutes).toBe(60);
    expect(v.body.costInternal).toEqual({ amount: 0, currency: 'USD' });
    expect(v.body.priceClient).toEqual({ amount: 0, currency: 'USD' });
  });

  test('minimal payload (just title) succeeds with all defaults', () => {
    const result = legacyCreateToTasktotime(
      { title: 'Quick task' },
      CALLER,
      COMPANY_ID,
      'idem-min',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.body.title).toBe('Quick task');
    expect(result.value!.body.priority).toBe('low');
    expect(result.value!.initialLifecycle).toBe('ready'); // 'inbox' default? no status → ready
  });

  test("legacy `status: 'todo'` maps to lifecycle ready", () => {
    const result = legacyCreateToTasktotime(
      { title: 'T', status: 'todo' },
      CALLER,
      COMPANY_ID,
      'idem-todo',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.initialLifecycle).toBe('ready');
  });

  test('legacy `status: archived` infers bucket archive', () => {
    const result = legacyCreateToTasktotime(
      { title: 'T', status: 'archived' },
      CALLER,
      COMPANY_ID,
      'idem-arch',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.bucket).toBe('archive');
  });

  test("legacy `status: 'inbox'` → bucket inbox", () => {
    const result = legacyCreateToTasktotime(
      { title: 'T', status: 'inbox' },
      CALLER,
      COMPANY_ID,
      'idem-inbox',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.bucket).toBe('inbox');
  });

  test('unknown legacy status returns 400-style error', () => {
    const result = legacyCreateToTasktotime(
      { title: 'T', status: 'totally_invented' },
      CALLER,
      COMPANY_ID,
      'idem-bad',
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe('INVALID_LEGACY_STATUS');
    expect(result.error!.field).toBe('status');
    expect(result.error!.message).toContain("Unknown legacy status 'totally_invented'");
  });

  test('missing title returns validation error', () => {
    const result = legacyCreateToTasktotime(
      { status: 'todo' },
      CALLER,
      COMPANY_ID,
      'idem-no-title',
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(result.error!.field).toBe('title');
  });

  test('non-object body returns validation error', () => {
    expect(legacyCreateToTasktotime('foo', CALLER, COMPANY_ID, 'idem', NOW).ok).toBe(false);
    expect(legacyCreateToTasktotime(null, CALLER, COMPANY_ID, 'idem', NOW).ok).toBe(false);
    expect(legacyCreateToTasktotime([], CALLER, COMPANY_ID, 'idem', NOW).ok).toBe(false);
  });

  test('explicit assigneeId overrides caller', () => {
    const result = legacyCreateToTasktotime(
      {
        title: 'T',
        assigneeId: 'user_worker',
        assigneeName: 'Worker Name',
      },
      CALLER,
      COMPANY_ID,
      'idem-assigned',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.body.assignedTo).toEqual({
      id: 'user_worker',
      name: 'Worker Name',
    });
  });

  test('explicit dueDate ISO is converted to epoch ms', () => {
    const iso = '2026-12-25T00:00:00.000Z';
    const result = legacyCreateToTasktotime(
      { title: 'T', dueDate: iso },
      CALLER,
      COMPANY_ID,
      'idem-iso',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.body.dueAt).toBe(Date.parse(iso));
  });

  test('priority none → low', () => {
    const result = legacyCreateToTasktotime(
      { title: 'T', priority: 'none' },
      CALLER,
      COMPANY_ID,
      'idem-none',
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.body.priority).toBe('low');
  });
});

describe('legacyPatchToTasktotime', () => {
  test('title-only patch produces patch fields and no lifecycle target', () => {
    const result = legacyPatchToTasktotime({ title: 'New title' });
    expect(result.ok).toBe(true);
    expect(result.value!.patchBody.title).toBe('New title');
    expect(result.value!.lifecycleTarget).toBeUndefined();
    expect(result.value!.hasPatchFields).toBe(true);
  });

  test('status-only patch produces lifecycle target with empty patch', () => {
    const result = legacyPatchToTasktotime({ status: 'in_progress' });
    expect(result.ok).toBe(true);
    expect(result.value!.lifecycleTarget).toBe('started');
    expect(result.value!.hasPatchFields).toBe(false);
  });

  test('mixed patch produces both', () => {
    const result = legacyPatchToTasktotime({
      title: 'Updated',
      status: 'completed',
      priority: 'high',
    });
    expect(result.ok).toBe(true);
    expect(result.value!.lifecycleTarget).toBe('completed');
    expect(result.value!.patchBody).toEqual({ title: 'Updated', priority: 'high' });
    expect(result.value!.hasPatchFields).toBe(true);
  });

  test('unknown legacy status returns INVALID_LEGACY_STATUS', () => {
    const result = legacyPatchToTasktotime({ status: 'fake' });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe('INVALID_LEGACY_STATUS');
  });

  test('non-object body returns error', () => {
    expect(legacyPatchToTasktotime(null).ok).toBe(false);
    expect(legacyPatchToTasktotime('').ok).toBe(false);
  });

  test('dueDate string converts to dueAt epoch ms', () => {
    const result = legacyPatchToTasktotime({ dueDate: '2026-06-01T00:00:00Z' });
    expect(result.ok).toBe(true);
    expect(result.value!.patchBody.dueAt).toBe(Date.parse('2026-06-01T00:00:00Z'));
  });

  test('null dueDate is silently dropped (cannot clear required field)', () => {
    const result = legacyPatchToTasktotime({ dueDate: null });
    expect(result.ok).toBe(true);
    expect(result.value!.patchBody.dueAt).toBeUndefined();
  });

  test('invalid dueDate format returns 400', () => {
    const result = legacyPatchToTasktotime({ dueDate: 'tomorrow' });
    expect(result.ok).toBe(false);
    expect(result.error!.field).toBe('dueDate');
  });

  test('assigneeId without assigneeName uses id as name fallback', () => {
    const result = legacyPatchToTasktotime({ assigneeId: 'user_a' });
    expect(result.ok).toBe(true);
    expect(result.value!.patchBody.assignedTo).toEqual({
      id: 'user_a',
      name: 'user_a',
    });
  });

  test('legacy fields with no tasktotime equivalent are silently dropped', () => {
    const result = legacyPatchToTasktotime({
      payments: [],
      budgetAmount: 100,
      paidAmount: 50,
      progressPercentage: 75,
      taskType: 'consult',
      siteId: 'site_z',
    });
    expect(result.ok).toBe(true);
    expect(result.value!.patchBody).toEqual({});
    expect(result.value!.hasPatchFields).toBe(false);
  });
});

describe('legacyListQueryToTasktotime', () => {
  test('comma-separated status maps to lifecycle list', () => {
    const result = legacyListQueryToTasktotime(
      { status: 'todo,in_progress' },
      COMPANY_ID,
    );
    expect(result.ok).toBe(true);
    // Set semantics — order may vary
    const lifecycles = (result.value!.lifecycle as string).split(',').sort();
    expect(lifecycles).toEqual(['ready', 'started']);
  });

  test('unknown status in comma list returns error', () => {
    const result = legacyListQueryToTasktotime(
      { status: 'todo,bogus' },
      COMPANY_ID,
    );
    expect(result.ok).toBe(false);
  });

  test('forwards companyId and supported filters', () => {
    const result = legacyListQueryToTasktotime(
      { clientId: 'c1', projectId: 'p1', assigneeId: 'u1', limit: '25' },
      COMPANY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      companyId: COMPANY_ID,
      clientId: 'c1',
      projectId: 'p1',
      assigneeId: 'u1',
      limit: '25',
    });
  });

  test('priority filter is silently dropped (unsupported by tasktotime list)', () => {
    const result = legacyListQueryToTasktotime(
      { priority: 'high' },
      COMPANY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.priority).toBeUndefined();
  });

  test('dueBefore ISO converts to epoch ms string', () => {
    const result = legacyListQueryToTasktotime(
      { dueBefore: '2026-06-01' },
      COMPANY_ID,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.dueBefore).toBe(String(Date.parse('2026-06-01')));
  });
});

describe('lifecycleToTransitionAction', () => {
  test.each([
    ['ready', 'ready'],
    ['started', 'start'],
    ['blocked', 'block'],
    ['completed', 'complete'],
    ['accepted', 'accept'],
    ['cancelled', 'cancel'],
  ] as const)('%s → %s', (lifecycle, expected) => {
    expect(lifecycleToTransitionAction(lifecycle)).toBe(expected);
  });

  test('draft has no inbound transition action', () => {
    expect(lifecycleToTransitionAction('draft')).toBeNull();
  });
});

describe('tasktotimeTaskToLegacy', () => {
  test('renames lifecycle → status using LIFECYCLE_TO_LEGACY', () => {
    const task = makeTask({
      lifecycle: 'started',
      title: 'Active task',
      assignedTo: { id: 'user_w', name: 'Worker' },
    });
    const out = tasktotimeTaskToLegacy(task);
    expect(out.status).toBe('in_progress');
    expect(out.title).toBe('Active task');
    expect(out.assigneeId).toBe('user_w');
    expect(out.assigneeName).toBe('Worker');
  });

  test('exposes lifecycle in `_canonical` envelope for diagnostics', () => {
    const task = makeTask({ lifecycle: 'completed' });
    const out = tasktotimeTaskToLegacy(task);
    expect(out._canonical.lifecycle).toBe('completed');
    expect(out._canonical.bucket).toBe(task.bucket);
    expect(out._canonical.taskNumber).toBe(task.taskNumber);
  });

  test('serialises dueAt epoch → ISO string', () => {
    const dueAt = Date.parse('2027-01-15T12:00:00Z');
    const task = makeTask({ dueAt });
    const out = tasktotimeTaskToLegacy(task);
    expect(out.dueDate).toBe(new Date(dueAt).toISOString());
  });

  test('drops computed fields (no `isCriticalPath` / `slackMinutes` / `subtaskRollup` / `dependsOn`)', () => {
    const task = makeTask({
      isCriticalPath: true,
      slackMinutes: 120,
      blocksTaskIds: [asTaskId('task_other')],
      subtaskIds: [asTaskId('task_sub')],
      dependsOn: [
        {
          taskId: asTaskId('task_x'),
          type: 'finish_to_start',
          isHardBlock: true,
          createdAt: NOW,
          createdBy: { id: 'u', name: 'u' },
        },
      ],
    });
    const out = tasktotimeTaskToLegacy(task);
    expect((out as unknown as Record<string, unknown>).isCriticalPath).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).slackMinutes).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).subtaskRollup).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).dependsOn).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).blocksTaskIds).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).subtaskIds).toBeUndefined();
  });

  test('renames history → taskHistory', () => {
    const event = {
      type: 'create' as const,
      at: NOW,
      by: { id: 'u', name: 'u' },
      action: 'created',
    };
    const task = makeTask({ history: [event] });
    const out = tasktotimeTaskToLegacy(task);
    expect(out.taskHistory).toEqual([event]);
    expect((out as unknown as Record<string, unknown>).history).toBeUndefined();
  });

  test('preserves companyId-bound fields needed by the bot', () => {
    const task = makeTask({
      companyId: asCompanyId('co_z'),
      clientId: undefined, // intentionally absent → null on legacy shape
      projectId: undefined,
      description: 'Long description here',
    });
    const out = tasktotimeTaskToLegacy(task);
    expect(out.clientId).toBeNull();
    expect(out.projectId).toBeNull();
    expect(out.description).toBe('Long description here');
  });
});
