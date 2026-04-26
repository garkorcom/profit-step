# `tasktotime` — автономный модуль задач

**Статус:** Phase 0 завершена (документы + mockup) — ждёт GO на Phase 1
**Создан:** 2026-04-25
**Обновлён:** 2026-04-26 (декомпозиция в spec/, NEXT_STEPS.md)
**Текущая версия ТЗ:** v0.2 (декомпозирована в [spec/](spec/) — 71 модульный файл)

**Заменяет:** `gtd_tasks` коллекция, `src/components/gtd/`, `src/components/tasks*/`, `src/components/cockpit/`, `src/pages/crm/Unified*Page.tsx`, `functions/src/agent/routes/tasks.ts`, `functions/src/callable/{ai,gtd}/*` и ~50 других файлов с hardcoded `'gtd_tasks'`.

---

## ⚡ Быстрый старт

**Если первый раз заходишь:**
1. Прочитай [NEXT_STEPS.md](NEXT_STEPS.md) — что нужно решить и что я могу делать дальше
2. Открой [mockup/index.html](mockup/index.html) — `open` в Finder, посмотри 10 views
3. Просмотри [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) — 16 вопросов с опциями для решения
4. Reply: какой вариант по каждому вопросу + GO на Phase 1

**Если уже в курсе и хочешь дальше:**
- См. [NEXT_STEPS.md](NEXT_STEPS.md) §1 для блокирующих решений
- См. [NEXT_STEPS.md](NEXT_STEPS.md) §3 для параллельных задач без блокировки

---

## 📂 Структура папки

```
tasktotime/
├── README.md                  ← entry point (этот файл)
├── NEXT_STEPS.md              ← план «что дальше» + decision tree
├── TZ_TASKTOTIME.md           ← navigation index в spec/
├── AUDIT_SUMMARY.md           ← что нашли в текущем gtd_tasks коде
├── MIGRATION_PLAN.md          ← 7-фазный план миграции
│
├── docs/
│   └── RESEARCH_2026-04-25.md ← research best practices конкурентов
│
├── mockup/
│   └── index.html             ← 3603-строчный интерактивный prototype, 10 views
│
└── spec/                      ← 71 модульный spec файл
    ├── README.md              ← навигация по spec/
    ├── 01-overview/           ← context, goals, anti-patterns, glossary
    ├── 02-data-model/         ← Task interface, sub-types, что меняем/оставляем
    ├── 03-state-machine/      ← lifecycle, transitions, derived states, bucket
    ├── 04-storage/            ← Firestore collections, indexes, rules, migration
    ├── 05-api/                ← REST, callables, triggers, backwards-compat
    ├── 06-ui-ux/              ← 5 принципов, 10 views, mobile, mockup notes
    ├── 07-ai/                 ← AI integration, auto-fill, anomaly detection
    ├── 08-modules/            ← крупные модули (33 файла в 5 подпапках):
    │   ├── hierarchy/         ← Task → Subtask 2-level model
    │   ├── graph-dependencies/← DAG, FS/SS/FF/SF, critical path
    │   ├── wiki/              ← markdown editor, templates, AI helper
    │   ├── wiki-rollup/       ← агрегация wiki из subtasks
    │   └── construction-gantt/← Procore-style Gantt patterns
    ├── 09-folder-structure.md ← дерево {frontend,backend,shared,tests}
    ├── 10-decisions/          ← open questions, anti-patterns, decision log
    └── 11-success-metrics.md  ← acceptance criteria
```

---

## 📖 Что читать (порядок)

| Шаг | Файл | Время | Когда читать |
|---|---|---|---|
| 1 | [NEXT_STEPS.md](NEXT_STEPS.md) | 5 мин | **Начни отсюда** |
| 2 | [mockup/index.html](mockup/index.html) | 10 мин | Открой в браузере, потыкай |
| 3 | [spec/README.md](spec/README.md) | 3 мин | Навигация по 71 файлу spec/ |
| 4 | [spec/01-overview/context.md](spec/01-overview/context.md) | 5 мин | Зачем модуль |
| 5 | [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) | 15 мин | **16 вопросов с опциями для решения** |
| 6 | [spec/02-data-model/task-interface.md](spec/02-data-model/task-interface.md) | 10 мин | Полный Task interface |
| 7 | [MIGRATION_PLAN.md](MIGRATION_PLAN.md) | 20 мин | 7-фазный план |
| 8 | [AUDIT_SUMMARY.md](AUDIT_SUMMARY.md) | 15 мин | Что было найдено в существующем коде |

**Полный onboarding:** ~90 минут.
**Минимальный для старта:** шаги 1-2-5 = ~30 минут.

---

## 🎯 Текущий статус по фазам

```
[x] Phase 0: Audit + TZ v0.2 + 71-file spec + 3603-line mockup        ← готово
[ ] ──── BLOCKER: 6 решений Дениса (см. NEXT_STEPS.md §1) ────
[ ] Phase 1: Foundation (types + skeletons + rules)            — 2 дня
[ ] Phase 2: Backend (REST + triggers + AI)                    — 3-4 дня
[ ] Phase 3: Frontend (10 views + drawer)                      — 5-7 дней
[ ] Phase 4: Telegram bot migration                            — 3 дня
[ ] Phase 5: Data migration + cutover (sunday night EST)       — 1 день
[ ] Phase 6: Frontend cutover (внутри Phase 5)
[ ] Phase 7: Cleanup (через 2 недели после Phase 5)            — 2 дня
```

**Реалистичный timeline:** 5-6 недель active work + 3 месяца до полного cleanup gtd_tasks backup.

---

## 🚦 Что нужно от Дениса

См. [NEXT_STEPS.md](NEXT_STEPS.md) §1. Кратко — 6 блокирующих решений:

1. **Глубина иерархии** — 2 уровня (рекомендую) или 3?
2. **Cutover окно** — какие выходные (17-18 / 24-25 / 31 мая - 1 июня)?
3. **Один Claude или pipeline** (Никита/Стёпа)?
4. **External AI bot URL** — proxy навсегда / 1-2 месяца grace / hard cutover?
5. **Status drift в `mediaHandler.ts`** — translate / переписать / migrate later?
6. **Wiki rollup primary** — Markdown viewer / PDF export / оба?

Полный список 16 вопросов с опциями: [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md)

---

## 🔗 Ссылки на ключевые артефакты

| Файл | Назначение |
|---|---|
| [NEXT_STEPS.md](NEXT_STEPS.md) | План что дальше + decision tree |
| [AGENT_PLAN.md](AGENT_PLAN.md) | **План работы агентов** (Маша/Никита/Стёпа/Claude Opus/Денис) по 7 фазам |
| [TZ_TASKTOTIME.md](TZ_TASKTOTIME.md) | Navigation index в spec/ (не сам ТЗ) |
| [AUDIT_SUMMARY.md](AUDIT_SUMMARY.md) | Аудит текущего gtd_tasks модуля |
| [MIGRATION_PLAN.md](MIGRATION_PLAN.md) | 7-фазный план миграции |
| [docs/RESEARCH_2026-04-25.md](docs/RESEARCH_2026-04-25.md) | Research конкурентов |
| [mockup/index.html](mockup/index.html) | Интерактивный prototype |
| [spec/](spec/) | 71 модульный spec файл |
| [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) | **Сюда вписываешь решения** |
| [spec/06-ui-ux/mockup-notes.md](spec/06-ui-ux/mockup-notes.md) | **Сюда вписываешь feedback по mockup** |

---

## 🧭 Связь с остальной документацией проекта

- **[CLAUDE.md](../CLAUDE.md)** — общие правила работы, deploy процедура, безопасность Cloud Functions. Этот модуль НЕ переопределяет CLAUDE.md, а конкретизирует его на свой scope.
- **[docs/PROJECT_WORKFLOW_SPEC_V1.md](../docs/PROJECT_WORKFLOW_SPEC_V1.md)** — центральное продуктовое ТЗ всего проекта. `tasktotime` — реализация Этапа 2 (AI-Powered Планирование) + Этапа 3 (Исполнение и контроль) для блока tasks.
- **[PROJECT_MAP.md](../PROJECT_MAP.md)** — карта проекта. После Phase 7 нужно обновить (`tasks/` → `tasktotime/`).
- **[tasks/INSTRUCTION.md](../tasks/INSTRUCTION.md)** — текущий описатель модуля для AI. Останется до Phase 7, потом удалить или redirect.

---

## 💬 Куда писать вопросы / комментарии

- **Открытые продуктовые вопросы** — [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md), обновлять после решений
- **Технические замечания при реализации** — issue в GitHub репо profit-step с тегом `tasktotime`
- **Pipeline координация** (если Никита/Стёпа подключены) — `~/projects/pipeline/{date}/task-tasktotime-phase-N.md`
- **UI feedback** — [spec/06-ui-ux/mockup-notes.md](spec/06-ui-ux/mockup-notes.md)
