/**
 * WikiRollupService — assemble rolled-up wiki for a parent task.
 *
 * Materialize-on-demand only — does NOT auto-persist (anti-pattern §1.3
 * "silent rollup"). Caller invokes when user clicks "Show aggregated wiki"
 * in the UI.
 *
 * See blueprint §3.3.
 */

import type { Task } from '../Task';
import type { TaskId } from '../identifiers';
import { resolveEffectiveWiki } from '../policies/WikiInheritancePolicy';
import { TaskNotFound } from '../errors';

import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { ClockPort } from '../../ports/infra/ClockPort';

export interface RolledUpWikiSection {
  /** The task whose wiki contributed this section (parent OR a subtask). */
  sourceTaskId: TaskId;
  title: string;
  body: string;
}

export interface RolledUpWiki {
  parentId: TaskId;
  /** Final markdown — concatenated `parent + each subtask`. */
  contentMd: string;
  sections: RolledUpWikiSection[];
  generatedAt: number;
}

export interface WikiRollupOptions {
  includeArchivedSubtasks?: boolean;
  /** Default `\n\n---\n\n`. */
  sectionDelimiter?: string;
  /** Override per-task `wikiInheritsFromParent`. */
  inheritFromParent?: boolean;
}

export interface WikiRollupServiceDeps {
  taskRepo: TaskRepository;
  clock: ClockPort;
}

const DEFAULT_DELIMITER = '\n\n---\n\n';

export class WikiRollupService {
  constructor(private readonly deps: WikiRollupServiceDeps) {}

  /**
   * Build rolled-up wiki for a parent task by concatenating own wiki + each
   * subtask's wiki (where wikiInheritsFromParent === true).
   * Pure read — does NOT persist.
   */
  async buildRolledUpWiki(
    parentId: TaskId,
    options: WikiRollupOptions = {},
  ): Promise<RolledUpWiki> {
    const parent = await this.deps.taskRepo.findById(parentId);
    if (!parent) throw new TaskNotFound(parentId);

    const subtasks = await this.deps.taskRepo.findSubtasks(parentId);
    const filtered = options.includeArchivedSubtasks
      ? subtasks
      : subtasks.filter((s) => !s.archivedAt);

    // Stable order: by createdAt asc
    filtered.sort((a, b) => a.createdAt - b.createdAt);

    const sections: RolledUpWikiSection[] = [];

    // Parent section
    const parentBody = parent.wiki?.contentMd?.trim() ?? '';
    if (parentBody) {
      sections.push({
        sourceTaskId: parent.id,
        title: parent.title,
        body: parentBody,
      });
    }

    // Subtask sections
    for (const sub of filtered) {
      const inherits =
        options.inheritFromParent !== undefined
          ? options.inheritFromParent
          : sub.wikiInheritsFromParent;
      const body = inherits
        ? resolveEffectiveWiki({ task: sub, parent }).trim()
        : (sub.wiki?.contentMd?.trim() ?? '');
      if (body) {
        sections.push({ sourceTaskId: sub.id, title: sub.title, body });
      }
    }

    const delimiter = options.sectionDelimiter ?? DEFAULT_DELIMITER;
    const contentMd = sections
      .map((s) => `## ${s.title}\n\n${s.body}`)
      .join(delimiter);

    return {
      parentId,
      contentMd,
      sections,
      generatedAt: this.deps.clock.now(),
    };
  }

  /**
   * Materialize-on-demand: caller invokes when user clicks
   * "Show aggregated wiki" — returns just the markdown string.
   */
  async exportRolledUpAsMarkdown(
    parentId: TaskId,
    options?: WikiRollupOptions,
  ): Promise<string> {
    const result = await this.buildRolledUpWiki(parentId, options);
    return result.contentMd;
  }

  /**
   * Resolve effective wiki for a single task (own + parent if inherits).
   */
  async resolveEffectiveWiki(taskId: TaskId): Promise<string> {
    const task = await this.deps.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFound(taskId);
    let parent: Task | null = null;
    if (task.parentTaskId) {
      parent = await this.deps.taskRepo.findById(task.parentTaskId);
    }
    return resolveEffectiveWiki({ task, parent });
  }
}
