---
title: "08.wiki-rollup.1 Concept (on-demand toggle)"
section: "08-modules/wiki-rollup"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Wiki Rollup — концепция (on-demand)

> Parent task с N subtasks может «собрать» wiki всех своих subtasks в **один документ**. Это **on-demand toggle**, не stored. Не подменяем `parent.wiki.contentMd` молча. Юзер кликает «Show aggregated wiki» → видит concat с разделителями.

ТЗ §14.1.

## Зачем

Use cases (новое требование Дениса):

### 1. Финальный отчёт по проекту/комнате клиенту

«Bathroom remodel» закончен → клиент хочет видеть полный отчёт что было сделано. Rollup wiki содержит:
- Header parent task'а
- Wiki самого parent
- Wiki каждой subtask (Demo, Plumbing, Drywall, etc.)
- Aggregated stats (cost, time)

Можно экспортировать в PDF и отправить клиенту.

### 2. Шаблон акта выполнения (АВР)

Russian-style АВР — все wiki детских задач + summary parent'а. Подготавливается за 1 click.

### 3. Hand-off документ

При передаче проекта от одной бригады другой (или от Дениса subcontractor'у). Один документ со всем контекстом проекта.

### 4. Knowledge base для повторных проектов

Rollup wiki одного проекта — basis для template нового проекта. «Мы делали такой же bathroom год назад — вот полный context».

## Принцип «on-demand toggle»

**КРИТИЧНО:** rollup — НЕ stored. НЕ подменяем `parent.wiki.contentMd` молча.

См.: [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #3

**Юзер кликает** «Show aggregated wiki» toggle → видит concat. Изначально parent wiki = то что юзер написал (только parent context, без subtasks).

## UI flow

```
Detail page → Tab «Wiki» (parent task)
   ↓
Default view: parent.wiki.contentMd (только своё)
   ↓
Toggle [Show with subtasks (5)]  ← кнопка с counter
   ↓
View переключается: rendered rollup
   ↓
Если юзер хочет export — кнопки [PDF] [Markdown] [Word] [Copy]
```

## Что НЕ делаем

- ❌ **Auto-rollup в parent.wiki** — silent override = потеря собственного контекста parent'а
- ❌ **Cache rollup в Firestore** — overhead на updates, простой computed по запросу
- ❌ **Real-time rollup** — для просмотра нужен click, не realtime stream

## Что делаем

- ✅ **Compute on-demand** — при click рассчитывается за <1s
- ✅ **Cache в memory** — пока юзер на page, не пересчитывается каждый rerender
- ✅ **Export to formats** — PDF / Markdown / Word / clipboard
- ✅ **Save as template** — превратить rolled-up в `WikiTemplate`
- ✅ **Прикрепить к акту** — copy в `acceptance.notes` + создать PDF и attach к `acceptance.url`

## Где computer

Server-side через Cloud Function callable (`getRolledUpWiki`):

```typescript
// callable signature
getRolledUpWiki({ parentTaskId }) → { contentMd: string, snapshotAt: Timestamp }
```

Или client-side через subscription если все subtasks already in cache. Для больших rollups (>20 subtasks с фотками) — server-side для efficiency.

## Algorithm

См.: [`algorithm.md`](algorithm.md)

## Edge cases

См.: [`edge-cases.md`](edge-cases.md)

- Subtask без wiki — пропускается
- Cancelled subtasks — strikethrough
- Inherited wiki — рендерится только своя часть
- Большие attachments — не inline
- Параллельные правки — snapshot timestamp

## Acceptance

См.: [`acceptance-criteria.md`](acceptance-criteria.md)

## Open question

§ Open question #12 в [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md):

«Денис чаще хочет rolled-up markdown в UI, или PDF файл для отправки клиенту? Влияет на приоритеты Phase 3 — markdown viewer vs PuppeteerSharp PDF generator.»

Default: markdown viewer first (cheaper to implement), PDF позже (через Cloud Function с puppeteer).

---

**См. также:**
- [Algorithm](algorithm.md) — псевдокод buildRolledUpWiki
- [UI](ui.md) — toggle и export buttons
- [Edge cases](edge-cases.md)
- [Acceptance criteria](acceptance-criteria.md)
- [`../wiki/concept.md`](../wiki/concept.md) — основной wiki концепт
- [`../wiki/inheritance.md`](../wiki/inheritance.md) — противоположное направление
- [`../../01-overview/anti-patterns.md`](../../01-overview/anti-patterns.md) #3 — не silent rollup
- [`../../10-decisions/open-questions.md`](../../10-decisions/open-questions.md) #12
