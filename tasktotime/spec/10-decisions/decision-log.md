---
title: "10.3 Decision log"
section: "10-decisions"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Decision log

> Лог решений Дениса по open questions. По мере решения вопросов — записываем сюда. Каждая запись имеет фиксированный формат для traceability.

## Format каждой записи

```markdown
### Decision N (YYYY-MM-DD): <short title>

**Question:** [reference к open-questions.md, e.g. #9]

**Decision:** [option a/b/c/... с обоснованием]

**Rationale:** Why Денис chose this option.

**Implementation impact:**
- Changes к [section] in [spec file]
- New work needed в [module]
- Breaking changes for [API / migration]

**Decided by:** Денис
**Date:** YYYY-MM-DD
**Recorded by:** [Claude Opus / Никита / etc.]
```

---

## Решения

### Decision 1 (2026-04-26): Hexagonal Architecture, не микросервис

**Question:** Денис: «давай сделаем задачник как микросервис чтобы легко переносить на другие проекты ?? или не нужно??»

**Decision:** **Hexagonal Architecture inside monorepo** — НЕ полноценный микросервис в Phase 1.

Структура:
```
tasktotime/
├── domain/      ← бизнес-логика, ZERO Firebase зависимостей
├── ports/       ← 21 интерфейс для всех I/O
├── adapters/    ← реализации портов (firestore/, http/, telegram/, etc)
└── ui/          ← React, depends on domain only
```

**Rationale:**
- Полноценный микросервис добавил бы +10-14 дней к Phase 1 (свой auth, event bus, дублирование users/companies, network latency, distributed transactions)
- Для одной компании Дениса overkill — стоимость > выгоды
- Hexagonal даёт future-proofing без операционных издержек: через 6-12 мес если появится 2-й проект — extract domain+ports в `@profit-step/tasktotime-core` npm package за 1-2 дня
- Domain тесты без Firebase emulator → быстрее CI

**Implementation impact:**
- ✓ Phase 1 acceptance criteria: `domain/` импортирует ZERO Firebase/MUI зависимостей (eslint rule + CI check)
- ✓ Phase 1: `ports/` — 21 интерфейс по списку из [data-dependencies.md](../04-storage/data-dependencies.md)
- ✓ `spec/09-folder-structure.md` обновлена под hexagonal layout
- ✓ Все adapters тестируются изолированно с mock'ами других ports
- ✓ TaskService unit-тесты должны выполняться <1s (без emulator)
- ✓ Cost ~10% к Phase 1 timeline (vs +200% за полный микросервис)

**Decided by:** Денис
**Date:** 2026-04-26
**Recorded by:** Claude Opus 4.7

---

### Example: Decision N (2026-04-30): Strict 2-level hierarchy

**Question:** [#9 в open-questions.md](open-questions.md)

**Decision:** Option (a) — Strict 2-level only. Если нужно глубже — конвертировать в project.

**Rationale:** Денис пробовал ClickUp с 7 уровнями — путаница. Better start strict and relax if needed than vice versa.

**Implementation impact:**
- ✓ Validation в API (`POST /api/tasktotime/tasks` rejects subtask under subtask)
- ✓ UI блокирует «+ Add subtask» action на subtask
- ✓ Warning «Convert to project?» когда юзер пытается decompose subtask further
- No breaking changes — new constraint, не affects existing data

**Decided by:** Денис
**Date:** 2026-04-30
**Recorded by:** Claude Opus 4.7

*(Это пример формата — заменить на real decision когда поступит)*

---

## Process для новых записей

1. Денис ответил на open question (в Slack / commit message / verbal)
2. Claude Opus / Никита / любой агент:
   - Создаёт new entry в этом файле по format выше
   - Updates [`open-questions.md`](open-questions.md) — пометить вопрос RESOLVED
   - Updates relevant spec файл (e.g. [`../08-modules/hierarchy/model.md`](../08-modules/hierarchy/model.md)) с финальным решением
3. Commit с message `docs(tasktotime): record decision N — <title>`

## Decision evolution

Если Денис меняет решение — НЕ удалять старое, добавлять new entry со reference:

```markdown
### Decision 5 (2026-06-15): Wiki edit permissions changed to flexible per-task

**Question:** #11

**Decision:** Option (d) — flexible per-task setting

**Supersedes:** Decision 3 (2026-05-01) which was option (b)

**Rationale:** Initial choice (b) — все members edit — caused too many "untracked" wiki changes. PM Денис нужен control.

**Implementation impact:**
- Add field `wiki.editPermission: 'creator_only' | 'members' | 'admins'` к TaskWiki
- Migration: existing wikis default to 'members' (current behavior)
- UI: toggle в Detail page → Wiki settings

**Decided by:** Денис
**Date:** 2026-06-15
**Recorded by:** Никита
```

---

**См. также:**
- [Open questions](open-questions.md) — все вопросы
- [What not to do](what-not-to-do.md) — sometimes decision = «we don't do that»
- [`../README.md`](../README.md) — навигация
