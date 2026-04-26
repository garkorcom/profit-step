/**
 * Dependency-graph fixtures: linear chain, diamond, cycle attempt.
 */

import type { Task } from '../../domain/Task';
import { graph } from '../test-helpers/buildDependencyGraph';

/** Linear chain: A -> B -> C -> D. */
export function linearChain(): Task[] {
  return graph('A->B, B->C, C->D');
}

/**
 * Diamond shape:
 *
 *         A
 *        / \
 *       B   C
 *        \ /
 *         D
 */
export function diamond(): Task[] {
  return graph('A->B, A->C, B->D, C->D');
}

/**
 * Pre-cycle: A -> B -> C. Tests the canAddDependency check by attempting to
 * add C -> A (would close a 3-cycle).
 */
export function preCycle(): Task[] {
  return graph('A->B, B->C');
}

/**
 * Two-step cycle attempt: A -> B already, attempting B -> A.
 */
export function twoStepCyclePreset(): Task[] {
  return graph('A->B');
}

/** Long chain (100 tasks) for performance smoke test. */
export function longChain(n = 100): Task[] {
  const edges: string[] = [];
  for (let i = 0; i < n - 1; i++) {
    edges.push(`N${i}->N${i + 1}`);
  }
  return graph(edges.join(', '));
}
