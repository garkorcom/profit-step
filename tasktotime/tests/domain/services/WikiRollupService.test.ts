/**
 * Tests for WikiRollupService — assemble parent + subtask wikis.
 */

import { WikiRollupService } from '../../../domain/services/WikiRollupService';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { TaskNotFound } from '../../../domain/errors';
import { parentWithFiveSubtasks } from '../../../shared/fixtures/subtasks.fixture';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { asTaskId } from '../../../domain/identifiers';

const T0 = 1_700_000_000_000;

function buildService() {
  const ports = makeAllPorts(T0);
  const service = new WikiRollupService({
    taskRepo: ports.taskRepo,
    clock: ports.clock,
  });
  return { ports, service };
}

describe('WikiRollupService.buildRolledUpWiki', () => {
  test('parent + 1 subtask: combines both wikis', async () => {
    const { ports, service } = buildService();

    const parent = makeTask({
      id: asTaskId('parent'),
      title: 'Bathroom Remodel',
      isSubtask: false,
      wiki: {
        contentMd: 'Parent scope: full remodel of master bath',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });

    const sub = makeTask({
      id: asTaskId('sub'),
      title: 'Tile work',
      isSubtask: true,
      parentTaskId: asTaskId('parent'),
      wikiInheritsFromParent: true,
      wiki: {
        contentMd: 'Use 12x24 marble tiles',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });

    ports.taskRepo.seed([parent, sub]);

    const result = await service.buildRolledUpWiki(asTaskId('parent'));

    expect(result.parentId).toBe(asTaskId('parent'));
    expect(result.contentMd).toContain('Parent scope');
    expect(result.contentMd).toContain('Use 12x24 marble tiles');
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    expect(result.generatedAt).toBe(T0);
  });

  test('throws TaskNotFound when parent missing', async () => {
    const { service } = buildService();
    await expect(service.buildRolledUpWiki(asTaskId('missing'))).rejects.toBeInstanceOf(
      TaskNotFound,
    );
  });

  test('5-subtask fixture: rolled wiki includes all subtask titles', async () => {
    const { ports, service } = buildService();
    const { parent, subtasks } = parentWithFiveSubtasks();

    parent.wiki = {
      contentMd: 'Master scope',
      updatedAt: T0 as never,
      updatedBy: { id: 'u' as never, name: 'U' },
      version: 1,
    };

    // Give each subtask a wiki body
    subtasks.forEach((s, i) => {
      s.wiki = {
        contentMd: `Subtask ${i} note`,
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      };
    });

    ports.taskRepo.seed([parent, ...subtasks]);

    const result = await service.buildRolledUpWiki(parent.id);

    expect(result.contentMd).toContain('Master scope');
    for (const sub of subtasks) {
      expect(result.contentMd).toContain(sub.title);
    }
  });

  test('excludes archived subtasks by default', async () => {
    const { ports, service } = buildService();
    const parent = makeTask({
      id: asTaskId('parent'),
      title: 'P',
      wiki: {
        contentMd: 'P',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });
    const live = makeTask({
      id: asTaskId('sub_live'),
      title: 'Live',
      isSubtask: true,
      parentTaskId: asTaskId('parent'),
      wikiInheritsFromParent: false,
      wiki: {
        contentMd: 'live note',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });
    const archived = makeTask({
      id: asTaskId('sub_archived'),
      title: 'Archived',
      isSubtask: true,
      parentTaskId: asTaskId('parent'),
      archivedAt: T0 as never,
      wikiInheritsFromParent: false,
      wiki: {
        contentMd: 'archived note',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });

    ports.taskRepo.seed([parent, live, archived]);

    const result = await service.buildRolledUpWiki(asTaskId('parent'));
    expect(result.contentMd).toContain('live note');
    expect(result.contentMd).not.toContain('archived note');

    // With option set, archived included
    const resultWithArchived = await service.buildRolledUpWiki(
      asTaskId('parent'),
      { includeArchivedSubtasks: true },
    );
    expect(resultWithArchived.contentMd).toContain('archived note');
  });
});

describe('WikiRollupService.exportRolledUpAsMarkdown', () => {
  test('returns the contentMd string', async () => {
    const { ports, service } = buildService();
    const parent = makeTask({
      id: asTaskId('parent'),
      title: 'P',
      wiki: {
        contentMd: 'Parent body',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });
    ports.taskRepo.seed([parent]);
    const md = await service.exportRolledUpAsMarkdown(asTaskId('parent'));
    expect(md).toContain('Parent body');
  });
});

describe('WikiRollupService.resolveEffectiveWiki', () => {
  test('subtask with inheritance returns parent + own', async () => {
    const { ports, service } = buildService();
    const parent = makeTask({
      id: asTaskId('parent'),
      title: 'Parent',
      isSubtask: false,
      wiki: {
        contentMd: 'parent text',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });
    const sub = makeTask({
      id: asTaskId('sub'),
      title: 'Sub',
      isSubtask: true,
      parentTaskId: asTaskId('parent'),
      wikiInheritsFromParent: true,
      wiki: {
        contentMd: 'sub text',
        updatedAt: T0 as never,
        updatedBy: { id: 'u' as never, name: 'U' },
        version: 1,
      },
    });

    ports.taskRepo.seed([parent, sub]);

    const result = await service.resolveEffectiveWiki(asTaskId('sub'));
    expect(result).toContain('parent text');
    expect(result).toContain('sub text');
  });
});
