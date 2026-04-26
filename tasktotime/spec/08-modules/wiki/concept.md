---
title: "08.wiki.1 Wiki concept (память задачи)"
section: "08-modules/wiki"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Task Wiki — концепция «память задачи»

> Каждая Task имеет привязанную markdown-страницу `wiki.contentMd`. Это **долгосрочная память задачи**: контекст, decisions, gotchas, photos, диаграммы, ссылки на permits, специфика клиента, что-делать-если-X.

ТЗ §13.1.

## Зачем

В существующем `gtd_tasks` есть только `description` (короткое поле) + attachments — этого недостаточно для:
- Накопления knowledge о клиенте/площадке
- Onboarding нового workера на проект
- Hand-off между бригадами
- Templates для повторных проектов

Wiki — **persistent memory** по задаче. Bonded к task, но эволюционирует со временем.

## Use cases

### 1. Бригадир приходит на новый объект

> Бригадир пришёл на новый объект. Открыл task «Bathroom remodel — Jim Dvorkin». Прочитал wiki:
> - Где ключи (под ковриком у back door)
> - Какие квартиры тихие vs шумные (avoid working before 9am Sat-Sun)
> - Контакт привратника (Marcus, 813-555-1234)
> - Как припарковаться (front of house OK, side street alley NOT)
> - Какие материалы уже завезены (drywall — yes, tile — no)

Worker не звонит PM, не угадывает. Сразу продуктивен.

### 2. AI-генерация

При creating task через AI flow → AI создаёт wiki-skeleton:

```markdown
## Scope
[from estimate item description]

## Materials
- Drywall: 5 sheets
- Tile: 80 sqft

## Permits
[если требуется]

## Risks
- Existing plumbing might need replacement
- Neighbor below might complain about noise

## Acceptance criteria
- [ ] All wallpaper smooth
- [ ] No visible nail holes
- [ ] Cleanup complete
```

См.: [`ai-helper.md`](ai-helper.md)

### 3. Repeat client — copy wiki

При повторном клиенте — copy wiki со старого проекта как template:

```
Old task: "Bathroom remodel — Jim Dvorkin (2025)"
   ↓ "Save as template"
   ↓
New task: "Bathroom remodel — Jim Dvorkin (2026)"
   ↓ "Apply template + auto-fill clientName"
```

См.: [`templates.md`](templates.md)

### 4. Handoff между бригадами

Бригада A закончила demo, передаёт бригаде B:

В wiki «Bathroom remodel» появляется секция от бригады A:
```markdown
## Status as of Apr 30 (handoff from Demo crew)

- Demo complete, all debris removed
- Found rotted joist под bathtub — replaced (1 hour extra)
- Old plumbing cast iron still solid, didn't replace
- New tub arrived but not installed (waiting plumber)

## Next crew notes
- Be careful: floor tile in shower зона есть один loose
- Subfloor repaired but not painted/sealed (bring sealer)
```

Бригада B читает, продолжает без потери контекста.

### 5. Lessons learned

После acceptance — wiki содержит финальные observations:
```markdown
## Lessons learned
- Estimating drywall: 1.3x quantity from now on (cuts > expected)
- Don't trust building HVAC schedule — verify with super
- Marcus prefers text not call
```

Используется как knowledge base для следующих проектов с same client/building.

## Принцип «toggle, не silent»

См. [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #3:

**НЕ делаем silent auto-rollup wiki.** Парент wiki всегда — то что юзер написал. Если хочет агрегацию из subtasks — кликает «Show aggregated wiki» toggle (см. [`../wiki-rollup/concept.md`](../wiki-rollup/concept.md)).

## Что НЕ в scope wiki

- ❌ Real-time collaboration (a-la Notion multi-cursor) — слишком сложно для Phase 3, версионирование достаточно
- ❌ Math equations / diagrams (Mermaid?) — markdown базовый, advanced features — Phase 4+
- ❌ Comments / threads — отдельная подсистема (если будет нужна)
- ❌ Permissions per-section — wiki edit permissions — на уровне задачи (см. open question #11)

## Open questions

- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #11 — кто может редактировать wiki?
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #12 — wiki rollup vs PDF export priority
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #13 — кто куратор templates?

---

**См. также:**
- [Storage](storage.md) — хранение TaskWiki
- [Editor UI](editor-ui.md) — markdown editor
- [AI helper](ai-helper.md) — AI assistance
- [Templates](templates.md) — wikiTemplates
- [Inheritance](inheritance.md) — subtask inherits parent wiki
- [Acceptance criteria](acceptance-criteria.md)
- [`../wiki-rollup/concept.md`](../wiki-rollup/concept.md) — on-demand агрегация
