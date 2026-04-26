---
title: "08.wiki-rollup.2 Algorithm (buildRolledUpWiki)"
section: "08-modules/wiki-rollup"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Algorithm — `buildRolledUpWiki(parentTaskId)`

> Псевдокод функции, которая собирает wiki parent + all subtasks в один markdown документ. Включает header parent'а, contextual wiki, секцию subtasks с their wikis, aggregated stats.

ТЗ §14.2.

## Полный псевдокод

```typescript
async function buildRolledUpWiki(parentTaskId: string): Promise<string> {
  const parent = await getTask(parentTaskId);
  const subtasks = await getSubtasks(parentTaskId, { orderBy: 'order' });

  let result = '';

  // 1. Header parent'а
  result += `# ${parent.taskNumber} — ${parent.title}\n\n`;
  result += `**Client:** ${parent.clientName}\n`;
  result += `**Project:** ${parent.projectName}\n`;
  result += `**Status:** ${parent.lifecycle}\n`;
  result += `**Period:** ${formatDate(parent.actualStartAt)} → ${formatDate(parent.completedAt)}\n\n`;

  // 2. Parent wiki
  if (parent.wiki?.contentMd) {
    result += `## Контекст проекта\n\n${parent.wiki.contentMd}\n\n`;
  }

  // 3. Subtasks секция
  result += `## Подзадачи (${subtasks.length})\n\n`;

  for (const [i, sub] of subtasks.entries()) {
    result += `### ${i + 1}. ${sub.title}\n\n`;
    result += `**Status:** ${sub.lifecycle} · **Assignee:** ${sub.assignedTo.name} · `;
    result += `**Hours:** ${formatMinutes(sub.actualDurationMinutes)} · `;
    result += `**Cost:** $${sub.costInternal.amount}\n\n`;

    if (sub.wiki?.contentMd) {
      result += `${sub.wiki.contentMd}\n\n`;
    }

    if (sub.acceptance) {
      result += `**Акт подписан:** ${sub.acceptance.signedByName} · ${formatDate(sub.acceptance.signedAt)}\n\n`;
    }

    result += `---\n\n`;
  }

  // 4. Aggregated stats
  const stats = parent.subtaskRollup!;
  result += `## Итого\n\n`;
  result += `- Подзадач: ${subtasks.length}, выполнено: ${stats.countByLifecycle.accepted}\n`;
  result += `- Общая себестоимость: $${stats.totalCostInternal}\n`;
  result += `- Продано клиенту: $${stats.totalPriceClient}\n`;
  result += `- Время план: ${formatMinutes(stats.totalEstimatedMinutes)}\n`;
  result += `- Время факт: ${formatMinutes(stats.totalActualMinutes)}\n`;

  return result;
}
```

## Структура output document

```markdown
# T-2026-0042 — Bathroom remodel

**Client:** Jim Dvorkin
**Project:** Renovation Jim Dvorkin
**Status:** accepted
**Period:** Apr 1, 2026 → Apr 30, 2026

## Контекст проекта

[parent.wiki.contentMd]

## Подзадачи (5)

### 1. Demo bathroom

**Status:** accepted · **Assignee:** Sergey · **Hours:** 8h · **Cost:** $400

[subtask 1.wiki.contentMd]

**Акт подписан:** Jim Dvorkin · Apr 5, 2026

---

### 2. Plumbing rough-in

**Status:** accepted · **Assignee:** Marcus · **Hours:** 12h · **Cost:** $800

[subtask 2.wiki.contentMd]

**Акт подписан:** Jim Dvorkin · Apr 10, 2026

---

### 3. Electrical rough-in

[...]

---

### 4. Drywall hang

[...]

---

### 5. Final cleanup

[...]

---

## Итого

- Подзадач: 5, выполнено: 5
- Общая себестоимость: $4,200
- Продано клиенту: $7,800
- Время план: 60h
- Время факт: 67h
```

## Implementation

```typescript
// tasktotime/backend/services/WikiRollupService.ts

export class WikiRollupService {
  async buildRolledUpWiki(parentTaskId: string): Promise<string> {
    const parent = await this.taskRepo.getTask(parentTaskId);
    if (!parent) throw new Error('Parent not found');

    // RLS check
    if (parent.companyId !== this.auth.companyId) throw new Error('RLS');

    const subtasks = await this.taskRepo.getSubtasks(parentTaskId);

    let result = '';
    result += this.renderHeader(parent);
    result += this.renderParentContext(parent);
    result += this.renderSubtasks(subtasks);
    result += this.renderAggregatedStats(parent);

    return result;
  }

  private renderHeader(parent: Task): string {
    return [
      `# ${parent.taskNumber} — ${parent.title}`,
      '',
      `**Client:** ${parent.clientName}`,
      `**Project:** ${parent.projectName}`,
      `**Status:** ${this.localizeLifecycle(parent.lifecycle)}`,
      `**Period:** ${formatDate(parent.actualStartAt)} → ${formatDate(parent.completedAt)}`,
      '',
    ].join('\n');
  }

  private renderParentContext(parent: Task): string {
    if (!parent.wiki?.contentMd) return '';
    return `## Контекст проекта\n\n${parent.wiki.contentMd}\n\n`;
  }

  private renderSubtasks(subtasks: Task[]): string {
    if (subtasks.length === 0) return '';

    const ordered = this.sortSubtasks(subtasks);  // by order or by createdAt
    let result = `## Подзадачи (${subtasks.length})\n\n`;

    for (const [i, sub] of ordered.entries()) {
      result += this.renderOneSubtask(i + 1, sub);
    }

    return result;
  }

  private renderOneSubtask(index: number, sub: Task): string {
    let result = `### ${index}. ${sub.title}\n\n`;
    result += `**Status:** ${this.localizeLifecycle(sub.lifecycle)} · `;
    result += `**Assignee:** ${sub.assignedTo.name} · `;
    result += `**Hours:** ${formatMinutes(sub.actualDurationMinutes)} · `;
    result += `**Cost:** $${sub.costInternal.amount}\n\n`;

    // Edge case: subtask без wiki
    if (sub.wiki?.contentMd) {
      // Edge case: inherited wiki - render only own content
      const ownContent = sub.wikiInheritsFromParent
        ? this.extractOwnContent(sub.wiki.contentMd)
        : sub.wiki.contentMd;
      result += `${ownContent}\n\n`;
    }

    // Edge case: cancelled subtask
    if (sub.lifecycle === 'cancelled') {
      result = `~~${result}~~\n\n*(Subtask cancelled)*\n\n`;
    }

    if (sub.acceptance) {
      result += `**Акт подписан:** ${sub.acceptance.signedByName} · ${formatDate(sub.acceptance.signedAt)}\n\n`;
    }

    result += `---\n\n`;
    return result;
  }

  private renderAggregatedStats(parent: Task): string {
    const stats = parent.subtaskRollup;
    if (!stats) return '';

    return [
      '## Итого',
      '',
      `- Подзадач: ${this.totalSubtaskCount(stats)}, выполнено: ${stats.countByLifecycle.accepted}`,
      `- Общая себестоимость: $${stats.totalCostInternal}`,
      `- Продано клиенту: $${stats.totalPriceClient}`,
      `- Время план: ${formatMinutes(stats.totalEstimatedMinutes)}`,
      `- Время факт: ${formatMinutes(stats.totalActualMinutes)}`,
      ''
    ].join('\n');
  }

  private localizeLifecycle(lifecycle: TaskLifecycle): string {
    return {
      draft: 'черновик',
      ready: 'готова',
      started: 'в работе',
      blocked: 'заблокирована',
      completed: 'завершена',
      accepted: 'подписан акт',
      cancelled: 'отменена'
    }[lifecycle];
  }
}
```

## Sort order subtasks

По умолчанию — по `createdAt` (chronological).

Альтернативы (TBD per project preference):
- По `phase` (demo → rough → finish → closeout)
- По `actualStartAt` (real execution order)
- По custom `order` field (если PM ручной reorder поставил)

## Performance

Target: < 1s для 20 subtasks (см. acceptance criteria).

Optimizations:
- Single query для all subtasks
- Cache в memory while user on page
- Server-side через Cloud Function для PDF export

---

**См. также:**
- [Concept](concept.md)
- [UI](ui.md)
- [Edge cases](edge-cases.md) — handling cancelled, no wiki, inherited
- [Acceptance criteria](acceptance-criteria.md)
- [`../hierarchy/subtask-rollup-aggregate.md`](../hierarchy/subtask-rollup-aggregate.md) — SubtaskRollup data
- [`../wiki/inheritance.md`](../wiki/inheritance.md) — inherited wiki handling
