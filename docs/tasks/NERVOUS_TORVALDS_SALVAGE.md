# ТЗ — вытащить ценное из ветки `claude/nervous-torvalds`

## Metadata

- **PM:** Denis
- **Дата:** 2026-04-17
- **Priority:** P2 (ничто не горит, но Python SDK + TZ-fix — реальная ценность)
- **Estimated effort:** M (2 задачи, ~3-4ч суммарно)
- **Status:** TODO
- **Source branch:** `claude/nervous-torvalds` (tip `36459f6`, 54 ahead / 44 behind main на 2026-04-12)

## Context

Ветка `nervous-torvalds` форкнулась 2026-04-12 и пошла параллельно — 238 файлов diff vs main, +33k/-18k строк. Большинство либо уже в main (AGENT_SETUP_GUIDE, agent-feedback endpoint), либо устарело после refactor'ов 15 апреля (ReconciliationPage split, Vite migration). **Но два куска уникальны и нужны.**

## Находка 1 — Python SDK (`sdk/python/profit_step_agent/`)

### Что есть в ветке

Полноценный установочный Python package:

```
sdk/python/
├── pyproject.toml              # httpx + pydantic + click deps
├── profit_step_agent/
│   ├── __init__.py
│   ├── client.py               # HTTP client (Bearer token + impersonation)
│   ├── cli.py                  # `psa` CLI tool
│   ├── domains/                # 9 модулей: time, tasks, events, payroll,
│   │                           # clients, costs, webhooks, projects + __init__
│   └── models/                 # pydantic models для каждого домена
└── tests/
```

CLI entry point: `psa = "profit_step_agent.cli:main"` (после `pip install`).

### Зачем (business case)

Если планируется растить экосистему внешних AI-агентов (OpenClaw, OpenAI function-calling боты, кастомные интеграции партнёров) — у них должна быть Python-клиентская библиотека с типизированными моделями. Сейчас внешние разработчики пишут клиенты руками против OpenAPI — это тормозит. SDK даёт "import and go".

### Что нужно для merge в main

- [ ] **Rebase SDK на current main.** Ветка старая, API изменился:
  - `agentFeedback.ts` → `feedback.ts` (rename)
  - Новые endpoints: `/teams` (`27b8741`), `/webhooks` (`106a080`), `/users/migrate-multi-user` (`70b9824`)
  - RLS изменения (`ceb8464`) — impersonation поведение могло измениться
- [ ] **Проверить что domains/ покрывают актуальный API.** 9 доменов в SDK должны матчить endpoints в main. Возможно добавить `teams.py`.
- [ ] **Обновить тесты.** Моки против устаревшего API-контракта могут падать.
- [ ] **Решить вопрос packaging и распространения.** Публиковать на PyPI как `profit-step-agent` или держать private (`pip install git+ssh://...`)? Первый — для внешних агентов, второй — для внутренних.
- [ ] **CI.** Добавить `sdk/python/` в `.github/workflows/` — pytest на PR + optional publish-on-tag job.
- [ ] **README.md.** В ветке SDK без top-level README — работает только через pytest/build. Написать quickstart: установка, auth, 3 примера (smoke, daily report, webhook subscribe).

### Acceptance

- [ ] SDK собирается: `cd sdk/python && python -m build`
- [ ] SDK устанавливается: `pip install ./sdk/python`
- [ ] Smoke-test против прода: `psa health-check --token=$AGENT_API_KEY` возвращает список endpoints без ошибок
- [ ] pytest на моках проходит
- [ ] Decision на PyPI/private зафиксирован в README

### Effort estimate

~2-3 часа. Rebase + smoke — час. README + CI — час. Packaging decision — 30 минут обсуждение + 30 минут setup.

## Находка 2 — Timezone-aware date handling в admin dialogs

### Что есть в ветке

В `src/utils/dateFormatters.ts` добавлены две функции (+70 строк):

```typescript
export function toETDatetimeLocal(date: Date): string;
// Конвертирует JS Date → "YYYY-MM-DDTHH:mm" в America/New_York
// для отображения в <input type="datetime-local">.

export function fromETDatetimeLocal(dtLocal: string): Date;
// Парсит "YYYY-MM-DDTHH:mm" (предполагая ET) → JS Date (UTC).
// Использует итеративный подход для корректного DST spring-forward.
```

И 4 админских диалога адаптированы их использовать:
- `CreateSessionDialog.tsx`
- `EditSessionDialog.tsx`
- `AdminStartSessionDialog.tsx`
- `AdminStopSessionDialog.tsx`

### Проблема, которую решает

`<input type="datetime-local">` timezone-unaware. Сейчас в main:

```typescript
setCustomEndTime(new Date().toISOString().slice(0, 16));
// ↑ даёт UTC, но input показывает "как локальное время"
// → admin в другом TZ видит -5 часов от своего now
```

После фикса:

```typescript
setCustomEndTime(toETDatetimeLocal(new Date()));
// ↑ всегда ET, независимо от браузера админа
```

**Важно**: бизнес-таймзона всегда ET (CLAUDE.md не пишет, но все работники во Флориде). Админ может сидеть в Киеве (тебя) — без этого фикса `AdminStartSessionDialog` покажет ему время своего TZ, он проставит "сейчас", но сессия сохранится в 5 часов от реального старта. **Payroll-фин-риск.**

### Acceptance

- [ ] `src/utils/dateFormatters.ts` получает `toETDatetimeLocal` + `fromETDatetimeLocal` + экспорт константы `TIMEZONE` (уже неявно есть, сделать `export`)
- [ ] 4 диалога импортируют и используют новые функции вместо `toISOString().slice(0, 16)` и `new Date(dtStr)`
- [ ] Unit-тест на DST spring-forward (2-е воскресенье марта, 2am → 3am skip) и fall-back (1-е воскресенье ноября)
- [ ] Manual smoke: в Chrome dev tools выставить timezone="Europe/Kiev", открыть `AdminStartSessionDialog`, убедиться что дефолт показывает "текущее ET время, не киевское"

### Effort estimate

~1 час. Код уже написан в ветке — надо cherry-pick + написать DST тесты + smoke.

## Out of scope (посмотрел и отбросил)

- `clients.ts` / `users.ts` модификации в ветке — **main имеет больше функций**, ветка наоборот откатывала duplicates-scan, merge, telegram-link. Не кочевать.
- `agentImprovements.test.ts` — тесты на `ListTasksQuerySchema` / `ListCostsQuerySchema` edge cases (clientId "" rejection). Возможно полезно, но low-prio — проверить что соответствующие Zod схемы в main уже это валидируют.
- Альтернативный `ReconciliationPage.tsx` (1053 строки diff) — форк до refactor'а 15 апреля. Переписанная версия в main лучше. Не трогать.
- Альтернативный `dashboard/client/[id].tsx` (+379 строк) — работа по client portal до Phase 3+4 в main. Устарело.
- Альтернативные типы `advanceAccount.types.ts`, `clientDashboard.types.ts` — не видно связанных фичей в main. Либо параллельная попытка, либо dead end. Не трогать.

## Как сохранить ветку до того как разгребём

```bash
git -C /Users/denysharbuzov/Projects/profit-step archive claude/nervous-torvalds -o ~/Desktop/nervous-torvalds-snapshot-2026-04-17.tar.gz
```

Архив — страховка. После успешного merge Находки 1 + 2 в main, ветку + worktree можно удалить.

## Implementation notes

### Порядок

Находка 2 (timezone fix) — **first**. Маленькая, законченная, исправляет реальный money-risk в admin UX. Один PR, ~1 час.

Находка 1 (Python SDK) — **second**. Больше работы, нужно rebase + packaging decision. Может быть отдельным PR в `feature/python-sdk` ветке.

### Deploy note

Находка 2 — hosting deploy (frontend change).
Находка 1 — нет deploy (SDK живёт отдельно). Только `pip install` / optional PyPI publish.
