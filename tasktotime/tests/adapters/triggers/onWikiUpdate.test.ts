/**
 * Tests for `onWikiUpdate` trigger handler.
 *
 * Pins:
 *   - Fires only when wiki.contentMd or wiki.attachments actually changed.
 *   - Idempotency guard.
 *   - BigQuery audit row with version + length deltas.
 */

import { onWikiUpdate } from '../../../adapters/triggers/onWikiUpdate';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { asTaskId, asUserId } from '../../../domain/identifiers';
import type { Task, TaskWiki, WikiVersion } from '../../../domain/Task';

const T0 = 1_700_000_000_000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  const deps = {
    taskRepo: ports.taskRepo,
    wikiHistory: ports.wikiHistory,
    idempotency: ports.idempotency,
    bigQueryAudit: ports.bigQueryAudit,
    clock: ports.clock,
  };
  return { ports, deps };
}

function withWiki(task: Task, wiki: TaskWiki | undefined): Task {
  return { ...task, wiki };
}

const userRef = { id: asUserId('user_w'), name: 'Writer' };

const wikiV1: TaskWiki = {
  contentMd: '# v1',
  updatedAt: T0,
  updatedBy: userRef,
  version: 1,
};
const wikiV2: TaskWiki = {
  ...wikiV1,
  contentMd: '# v2 longer body',
  version: 2,
};

describe('onWikiUpdate', () => {
  test('audit fires on contentMd change', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_1') });
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, wikiV2);

    const result = await onWikiUpdate(
      { before, after, docId: base.id as string, eventId: 'evt_w1' },
      deps,
    );

    expect(result).toMatchObject({ applied: true });
    expect(ports.bigQueryAudit.events).toHaveLength(1);
    expect(ports.bigQueryAudit.events[0]).toMatchObject({
      eventType: 'task.wiki.updated',
      taskId: base.id,
      payload: {
        versionFrom: 1,
        versionTo: 2,
        contentLengthFrom: '# v1'.length,
        contentLengthTo: '# v2 longer body'.length,
      },
    });
  });

  test('skips when contentMd + attachments unchanged', async () => {
    const { deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_noop') });
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, wikiV1);

    const result = await onWikiUpdate(
      { before, after, docId: base.id as string, eventId: 'evt_noop' },
      deps,
    );

    expect(result).toEqual({ skipped: 'wiki_unchanged' });
  });

  test('fires on attachments change even when contentMd unchanged', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_attach') });
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, {
      ...wikiV1,
      attachments: [
        {
          id: 'a1',
          url: 'gs://bucket/a',
          type: 'photo',
          uploadedAt: T0,
          uploadedBy: userRef,
        },
      ],
    });

    const r = await onWikiUpdate(
      { before, after, docId: base.id as string, eventId: 'evt_attach' },
      deps,
    );

    expect(r).toMatchObject({ applied: true });
    expect(ports.bigQueryAudit.events[0].payload).toMatchObject({
      attachmentsFrom: 0,
      attachmentsTo: 1,
    });
  });

  test('idempotency guard blocks the second fire of the same event', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_dedup') });
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, wikiV2);
    const change = { before, after, docId: base.id as string, eventId: 'evt_dup' };

    const a = await onWikiUpdate(change, deps);
    const b = await onWikiUpdate(change, deps);

    expect(a).toMatchObject({ applied: true });
    expect(b).toEqual({ skipped: 'idempotency' });
    expect(ports.bigQueryAudit.events).toHaveLength(1);
  });

  test('skips when before/after missing', async () => {
    const { deps } = buildDeps();
    const r = await onWikiUpdate(
      { before: null, after: null, docId: 'x', eventId: 'evt' },
      deps,
    );
    expect(r).toEqual({ skipped: 'missing_change_sides' });
  });

  // ─── Archive overflow (PR-B6: WikiHistoryPort) ────────────────────────
  //
  // The application handler caps the inline `versionHistory[]` at 10 via
  // `slice(-9) + new`, so overflow doesn't happen on the happy path. The
  // trigger's archive branch is the safety net for legacy data or callers
  // that bypass the handler.
  //
  // Boundary cases checked here:
  //   - exactly 10  → no archive write (boundary)
  //   - 11          → 1 oldest moved, parent kept at 10
  //   - 13          → 3 oldest moved, parent kept at 10 (oldest-first order)

  function makeWikiVersion(version: number): WikiVersion {
    return {
      version,
      contentMd: `# v${version}`,
      updatedAt: T0 - (100 - version) * 1000,
      updatedBy: { id: asUserId('user_h'), name: 'Historian' },
      changeSummary: `change v${version}`,
    };
  }

  test('versionHistory exactly 10 → no archive write (boundary)', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_at_cap') });

    // Build a wiki with exactly 10 inline versions (1..10).
    const history10: WikiVersion[] = Array.from({ length: 10 }, (_, i) =>
      makeWikiVersion(i + 1),
    );
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, {
      ...wikiV2,
      versionHistory: history10,
    });

    const r = await onWikiUpdate(
      { before, after, docId: base.id as string, eventId: 'evt_at_cap' },
      deps,
    );

    expect(r).toMatchObject({ applied: true });
    // No archive entries written.
    expect(ports.wikiHistory.count()).toBe(0);
    // Audit still fires on contentMd change.
    expect(ports.bigQueryAudit.events).toHaveLength(1);
  });

  test('versionHistory > 10 → oldest moves to subcollection, parent shrinks to 10', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_overflow') });

    // 13 inline versions → 3 should overflow (1, 2, 3); parent kept (4..13).
    const history13: WikiVersion[] = Array.from({ length: 13 }, (_, i) =>
      makeWikiVersion(i + 1),
    );
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, {
      ...wikiV2,
      versionHistory: history13,
    });

    // Spy patch so we can pin the cropped versionHistory payload.
    const patchSpy = jest.spyOn(ports.taskRepo, 'patch');

    const r = await onWikiUpdate(
      { before, after, docId: base.id as string, eventId: 'evt_overflow' },
      deps,
    );

    expect(r).toMatchObject({ applied: true });
    if ('applied' in r) {
      expect(r.effects).toContain('wikiHistory.append.x3');
      expect(r.effects).toContain('taskRepo.patch.versionHistory');
    }

    // Three oldest entries archived, oldest version first.
    const archived = ports.wikiHistory.forTask(base.id);
    expect(archived).toHaveLength(3);
    expect(archived.map((e) => e.version)).toEqual([1, 2, 3]);
    expect(archived[0]).toMatchObject({
      version: 1,
      contentMd: '# v1',
      changeSummary: 'change v1',
    });

    // Parent doc patched once with the cropped 10-entry buffer.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    const [patchedId, patchedPartial] = patchSpy.mock.calls[0];
    expect(patchedId).toBe(base.id);
    const patchedHistory = (patchedPartial as Record<string, unknown>)[
      'wiki.versionHistory'
    ] as WikiVersion[];
    expect(patchedHistory).toHaveLength(10);
    // The kept slice is the **latest** 10 → versions 4..13.
    expect(patchedHistory.map((v) => v.version)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  test('versionHistory length 11 → exactly one entry moves out', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_overflow_one') });

    const history11: WikiVersion[] = Array.from({ length: 11 }, (_, i) =>
      makeWikiVersion(i + 1),
    );
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, {
      ...wikiV2,
      versionHistory: history11,
    });

    const r = await onWikiUpdate(
      {
        before,
        after,
        docId: base.id as string,
        eventId: 'evt_overflow_one',
      },
      deps,
    );

    expect(r).toMatchObject({ applied: true });
    expect(ports.wikiHistory.count()).toBe(1);
    expect(ports.wikiHistory.forTask(base.id).map((e) => e.version)).toEqual([
      1,
    ]);
  });

  test('archive write is idempotent — same (taskId, version) overwrites', async () => {
    const { ports, deps } = buildDeps();
    const base = makeTask({ id: asTaskId('task_wiki_idempotent_archive') });

    const history11: WikiVersion[] = Array.from({ length: 11 }, (_, i) =>
      makeWikiVersion(i + 1),
    );
    const before = withWiki(base, wikiV1);
    const after = withWiki(base, {
      ...wikiV2,
      versionHistory: history11,
    });

    // First fire archives v1 + patches.
    await onWikiUpdate(
      {
        before,
        after,
        docId: base.id as string,
        eventId: 'evt_archive_a',
      },
      deps,
    );

    // Second fire (same shape, fresh eventId so the trigger-level idempotency
    // doesn't block) → re-archive v1; mock `set` semantics overwrite, count
    // stays at 1.
    await onWikiUpdate(
      {
        before,
        after,
        docId: base.id as string,
        eventId: 'evt_archive_b',
      },
      deps,
    );

    expect(ports.wikiHistory.count()).toBe(1);
    expect(ports.wikiHistory.forTask(base.id).map((e) => e.version)).toEqual([
      1,
    ]);
  });
});
