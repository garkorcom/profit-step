/**
 * WikiInheritancePolicy — decides effective wiki for a subtask.
 *
 * Rules:
 *   - Root task: use own wiki (or empty).
 *   - Subtask with `wikiInheritsFromParent === true` AND own wiki present:
 *     concatenate parent + own (parent first, separator, then own).
 *   - Subtask with `wikiInheritsFromParent === true` AND no own wiki:
 *     return parent wiki only.
 *   - Subtask with `wikiInheritsFromParent === false`: return own wiki only.
 *
 * Pure function — caller (WikiRollupService) fetches parent via
 * `TaskRepository.findById` and passes both here.
 */

import type { Task } from '../Task';

const DEFAULT_DELIMITER = '\n\n---\n\n';

export interface WikiResolutionInput {
  task: Task;
  parent: Task | null;
}

export interface WikiResolutionOptions {
  delimiter?: string;
  includeParentTitle?: boolean;
}

/**
 * Resolve effective markdown for a task (taking inheritance into account).
 */
export function resolveEffectiveWiki(
  input: WikiResolutionInput,
  options: WikiResolutionOptions = {},
): string {
  const { task, parent } = input;
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER;

  const ownMd = task.wiki?.contentMd?.trim() ?? '';

  // Root task or no inheritance → own only
  if (!task.isSubtask || !task.wikiInheritsFromParent) {
    return ownMd;
  }

  // No parent loaded → fall back to own
  if (!parent) return ownMd;

  const parentMd = parent.wiki?.contentMd?.trim() ?? '';
  if (!parentMd && !ownMd) return '';
  if (!parentMd) return ownMd;
  if (!ownMd) {
    return options.includeParentTitle
      ? `# ${parent.title}\n\n${parentMd}`
      : parentMd;
  }

  const head = options.includeParentTitle
    ? `# ${parent.title}\n\n${parentMd}`
    : parentMd;
  return `${head}${delimiter}${ownMd}`;
}
