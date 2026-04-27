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
import type { Task, TaskWiki } from '../../../domain/Task';

const T0 = 1_700_000_000_000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  const deps = {
    taskRepo: ports.taskRepo,
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
});
