---
title: "08.hierarchy.1 Model — Task → Subtask (2 уровня max)"
section: "08-modules/hierarchy"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Hierarchy: модель Task → Subtask (2 уровня max)

> Двухуровневая иерархия задач: Task (parent) → Subtask. **Не глубже.** Если нужно глубже — это уже отдельный проект. Это сознательное архитектурное ограничение, основанное на research конкурентов: ClickUp с 7 уровнями — анти-паттерн.

ТЗ §11.1.

## ASCII

```
Task (parent)
├─ Subtask 1
├─ Subtask 2
└─ Subtask 3
```

## Семантика

- **Parent Task** — самостоятельная задача с собственным lifecycle / cost / acceptance / wiki.
- **Subtask** — `Task { isSubtask: true, parentTaskId: 'parent-id' }`. **НЕ может иметь свои sub-subtasks.** Если нужно глубже — это уже отдельная задача с `linkedTaskIds`.
- Поле `subtaskIds: string[]` на parent — computed reverse index (обновляется триггером `onTaskCreate/onTaskUpdate`), для tree-view queries без N+1.

## Почему не глубже

ClickUp с 7 уровнями (Workspace > Space > Folder > List > Task > Subtask > Checklist) — анти-паттерн. **Юзеры не понимают где они в дереве.**

Linear, Notion sub-items, Asana — все ограничивают 1 уровень.

Если задача требует декомпозиции глубже — это сигнал что parent должен быть **проектом** (`projects/{id}`), а его «sub-subtasks» — task'ами 1-го уровня под этим project.

## Поля Task для иерархии

```typescript
interface Task {
  parentTaskId?: string;            // если задача — subtask
  isSubtask: boolean;
  subtaskIds: string[];             // computed reverse index
  subtaskRollup?: SubtaskRollup;    // computed aggregates
  // ...
}
```

## Validation

API `POST /api/tasktotime/tasks` отклоняет:
- Создание subtask у существующего subtask:
  ```typescript
  if (parentTask.isSubtask) {
    throw new HttpsError('failed-precondition',
      'Cannot create subtask under a subtask. Convert parent to project or use linkedTaskIds for cross-reference.'
    );
  }
  ```

UI блокирует action «+ Add subtask» если current task — already subtask.

## Альтернативы для глубокой декомпозиции

Если PM нужно «3-й уровень» — есть варианты:

### 1. `linkedTaskIds[]` — cross-reference

```typescript
linkedTaskIds: ['related-task-id-1', 'related-task-id-2']
```

Не блокирующая связь, просто «see also». Видна в Detail page как «Related tasks».

См.: [`../graph-dependencies/three-link-types.md`](../graph-dependencies/three-link-types.md)

### 2. Promote parent to project

Если у root task много subtasks (>10) и появляется потребность в глубине — конвертировать parent в `project`:
- `POST /api/projects/from-task { taskId }` — создаёт project, перевешивает subtasks как root tasks

### 3. Use `category` / `phase` для группировки

Subtasks одного parent можно тегировать `phase` (demo/rough/finish/closeout) или `category` (work/punch/inspection/permit) — для group-by в UI без иерархии.

## Use cases

### Bathroom remodel (типичный root + subtasks)

```
Task: "Bathroom remodel — Jim Dvorkin"
├─ Subtask: Demo bathroom
├─ Subtask: Plumbing rough-in
├─ Subtask: Electrical rough-in
├─ Subtask: Drywall hang
├─ Subtask: Tile install
├─ Subtask: Plumbing finish
├─ Subtask: Trim install
└─ Subtask: Final walkthrough
```

8 subtasks — comfortable depth.

### Что если нужен «Plumbing rough-in» → 4 sub-stages?

Варианты:

- **Option A:** в parent task «Plumbing rough-in» использовать `checklistItems[]` для micro-tasks
- **Option B:** конвертировать «Bathroom remodel» в project, делать «Plumbing rough-in» root task с своими subtasks

## Open question (для Дениса)

§ Open question #9 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md):

«Денис прав что в реальной стройке бывает 3+ уровней? Если да — позволяем 3 уровня, или предлагаем оформить как **проект**?»

---

**См. также:**
- [Auto-rollup](auto-rollup.md) — что происходит с parent.lifecycle когда subtask меняется
- [Subtask rollup aggregate](subtask-rollup-aggregate.md) — computed данные на parent
- [Tree view UI](tree-view-ui.md) — как рендерится в UI
- [Tree DnD](tree-dnd.md) — drag subtask между parents
- [Acceptance criteria](acceptance-criteria.md)
- [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) — общий принцип «не делаем 7 уровней»
