---
title: "11 Метрики успеха"
section: "11-success-metrics"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Метрики успеха модуля `tasktotime`

> После миграции должно выполняться. 4 группы критериев: code quality / hierarchy & graph / wiki / construction-specific. Каждый chunk acceptance criteria собран в отдельных модулях, здесь — общая сводка.

ТЗ §16.

## Code quality (как в v0.1)

- ✅ Один `useTasks()` хук, одна `<TaskCard>`, один STATUS_OPTIONS source
- ✅ 100% required Денисом полей в типе и в UI
- ✅ Lifecycle state machine с тестами на все transitions
- ✅ Все 4 dead-code paths удалены (`task.types.ts`, `taskApi.ts`, 2 unused rules)
- ✅ Status drift в коде = 0 (один enum)
- ✅ Test coverage критичных модулей ≥ 80%: triggers, callables, transitions
- ✅ Cross-tenant RLS test PASSES (был не запускался регулярно — см. CLAUDE.md §4)
- ✅ Vite build green; tsc --noEmit green; oxlint без новых ошибок (13 pre-existing OK)
- ✅ Production cutover без data loss и без downtime > 5 min
- ✅ Dashboard «Tasks → Time» с метриками: avg estimate accuracy, on-time delivery rate, overdue alerts по сотрудникам

См. подробно:
- [`02-data-model/`](02-data-model/) — type unification
- [`03-state-machine/`](03-state-machine/) — lifecycle tests
- [`04-storage/rules.md`](04-storage/rules.md) — RLS tests
- [`04-storage/migration-mapping.md`](04-storage/migration-mapping.md) — production cutover

## Hierarchy & Graph (NEW v0.2)

- ✅ 2-level hierarchy: subtask нельзя создать у subtask (валидация API + UI)
- ✅ Cycle detection в dependencies blocks invalid links
- ✅ Tree view рендерит 1000 узлов с virtualization без лагов
- ✅ DAG view (xyflow) рендерит 200 узлов < 200ms, 1000 < 2s
- ✅ Critical path подсвечивается реактивно при изменении длительности
- ✅ Auto-shift cascade тестируется на цепочке 5 задач
- ✅ Single graph viz lib в bundle (xyflow + dagre, не Cytoscape/D3/GoJS)

См. подробно:
- [`08-modules/hierarchy/acceptance-criteria.md`](08-modules/hierarchy/acceptance-criteria.md)
- [`08-modules/graph-dependencies/acceptance-criteria.md`](08-modules/graph-dependencies/acceptance-criteria.md)

## Wiki & Rollup (NEW v0.2)

- ✅ Markdown editor загружается < 200ms
- ✅ Auto-save через 2s после keystroke
- ✅ Conflict resolution UI при параллельной правке
- ✅ Wiki rollup для 20 subtasks < 1s
- ✅ Экспорт rolled-up wiki в PDF работает на проде
- ✅ Templates с placeholders (`{{clientName}}` и т.п.)
- ✅ AI-помощник «Дополни wiki» интегрирован

См. подробно:
- [`08-modules/wiki/acceptance-criteria.md`](08-modules/wiki/acceptance-criteria.md)
- [`08-modules/wiki-rollup/acceptance-criteria.md`](08-modules/wiki-rollup/acceptance-criteria.md)

## Construction-specific (NEW v0.2)

- ✅ Plan vs Actual overlay в Gantt
- ✅ Critical Path toggle (CPM пересчёт < 200ms для 100 задач)
- ✅ Group-by dropdown с 6 опциями (none/project/room/crew/phase/category)
- ✅ Milestone diamonds для inspection/permit
- ✅ Weather day marker ☂ (mock в dev, NOAA в prod)
- ✅ Punch list compact row внизу проекта
- ✅ Daily Log dot integration с work_sessions

См. подробно:
- [`08-modules/construction-gantt/acceptance-criteria.md`](08-modules/construction-gantt/acceptance-criteria.md)

## Performance benchmarks (всё вместе)

| Operation | Target | Measure |
|---|---|---|
| Task list (50 tasks) load | < 200ms | initial render |
| Detail page open | < 200ms | drawer animation start |
| Lifecycle transition | < 100ms | server roundtrip |
| AI estimate | < 5s | Gemini latency |
| AI generate task | < 10s | Claude latency |
| AI decompose estimate (5 root tasks) | < 30s | full decompose |
| Tree view render 1000 nodes | < 200ms | initial render |
| DAG view render 200 nodes | < 200ms | initial render |
| DAG view render 1000 nodes | < 2s | initial render |
| Wiki editor load | < 200ms | initial render |
| Wiki rollup 20 subtasks | < 1s | server roundtrip |
| CPM recompute 100 tasks | < 200ms | trigger execution |
| CPM recompute 1000 tasks | < 2s | trigger execution |
| Auto-shift cascade 3 levels | < 1s | transaction |
| PDF export (20 subtasks) | < 3s | server-side render |
| Group-by switch in Gantt | < 100ms | in-memory regroup |
| Drag task across day in Calendar | < 50ms | optimistic update |

## QA gates

Перед production deploy:

1. **All tests green** — Jest (unit), security rules, integration, E2E
2. **TypeScript no new errors** — `tsc --noEmit` clean (13 pre-existing OK)
3. **oxlint no new warnings** — `oxlint` clean
4. **Vite build success** — `npm run build`
5. **Cross-tenant RLS test passes** — `npm run test:security`
6. **Performance benchmarks meet targets** (see above)
7. **Demo to Денис** — он одобрил UX

## Post-cutover monitoring

Первые 48 часов после deploy особенно внимательно:
- Firebase Console → Functions → Logs (errors)
- `firebase functions:log` for live tail
- `scripts/monitor-production.sh` если существует
- Особенно: cascade auto-shift loops, CPM hangs, wiki conflict rate

**Rollback condition:** если error rate > 1% или critical bug в payroll calculations — immediate rollback к старой коллекции.

## Long-term metrics (Phase 4+)

- **Estimate accuracy** — `actualDurationMinutes / estimatedDurationMinutes` should approach 1.0 over time
- **On-time delivery rate** — % tasks с `completedAt ≤ dueAt`
- **Overdue rate** — % tasks с `is_overdue` at any point
- **AI accuracy** — % AI-generated tasks accepted без edits
- **Wiki coverage** — % active tasks с non-empty wiki
- **Bottlenecks** — какие subjects на critical path чаще всего

Эти метрики — для long-term project health, не Phase 3 acceptance.

---

**См. также:**
- [`README.md`](README.md) — навигация
- [`08-modules/hierarchy/acceptance-criteria.md`](08-modules/hierarchy/acceptance-criteria.md)
- [`08-modules/graph-dependencies/acceptance-criteria.md`](08-modules/graph-dependencies/acceptance-criteria.md)
- [`08-modules/wiki/acceptance-criteria.md`](08-modules/wiki/acceptance-criteria.md)
- [`08-modules/wiki-rollup/acceptance-criteria.md`](08-modules/wiki-rollup/acceptance-criteria.md)
- [`08-modules/construction-gantt/acceptance-criteria.md`](08-modules/construction-gantt/acceptance-criteria.md)
- [`../MIGRATION_PLAN.md`](../MIGRATION_PLAN.md) — phased migration plan
