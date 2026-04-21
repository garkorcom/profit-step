# ТЗ: Pipeline follow-ups — сводный индекс

> **Цель:** свести все pending работы из AI-pipeline (2026-04-05 … 2026-04-18) в единый документ с проверенным актуальным статусом (pipeline-логи часто устарели — main ушёл на 40+ PR вперёд).
> **Статус:** TODO
> **Создано:** 2026-04-20
> **Источники:**
> - `~/projects/pipeline/{date}/` — 50 файлов (task-, nikita-log, stepa-, summary-)
> - `docs/tasks/*.md` — 15+ существующих specs
> - `git log main` — фактическое состояние
> **Parent plan:** [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md)

---

## 0. TL;DR

Из 26 pipeline-задач:
- **18 уже shipped** в main (pipeline-логи устарели — последующие PR их закрыли).
- **5 реально pending** с собственными существующими TZ — нужно просто отпинать.
- **3 cross-cutting tech-debt** — лезут в несколько задач, требуют отдельного спринта.

Итого **~1 недели работы** чтобы закрыть всё критичное из pipeline.

---

## 1. Pipeline tasks vs реальность в main

Таблица проверена **против `git log main` на 2026-04-20**, не против pipeline-логов.

### ✅ Уже в main (закрыто последующими PR)

| Pipeline task | Дата | Что было pending | Закрыто в main через |
|---|---|---|---|
| night-autostop-audit | 05-04 | Audit only | Audit доставлен как ожидалось |
| night-audit-trail | 05-04 | Session audit logs | ✅ shipped |
| night-timetracking-refactor | 05-04 | TimeTrackingService extraction | [5fab3c9] + частично ([nikita-p2]) |
| night-functions-config-migrate | 05-04 | `.config()` → `.env` | `b54b0be` + **полностью закрыто PR #55** (Secret Manager) |
| night-session-restart | 05-04 | Session restart endpoint | ✅ shipped в P2 (nikita-p2-log) |
| client-dashboard-v2 | 06-04 | Dashboard + components | PR #7 `11f041b` MERGED |
| admin-dashboard-v2 | 06-04 | Admin views | ✅ shipped |
| session-restart-v2 | 06-04 | Restart endpoint polish | ✅ shipped |
| autostop-cleanup | 06-04 | Cleanup cron | ✅ shipped |
| timetracking-refactor-v2 | 06-04 | Service refactor v2 | ✅ shipped (partial — см. §4.2) |
| portal-refactor | 06-04 | Portal architecture | ✅ shipped (57745a8 + 81f7cf9) |
| inventory-crud | 06-04 | Items/Warehouses CRUD | ✅ shipped (`inventory*.ts` в main) |
| site-checklist | 06-04 | Checklist flow | ✅ shipped |
| photo-telegram | 06-04 | Photo upload | ✅ shipped |
| blueprint | 06-04 | Blueprint AI Phase 1 | ✅ shipped (PR `6deb425` V3 Phase 20) |
| client-dashboard-v2.1 | 07-04 | 4 endpoints + 6 components | PR #7 MERGED |
| selfie-check-in | 16-04 | Restore shift-start selfie | PR #14 `b7441d9` + PR #18 `608f169` MERGED |
| payroll-balance-fix | 13-04 | 3 формулы → одна | PR #50 `70c15ab` + PR #47 + PR #52 MERGED |

### ⚠ Реально pending (PR не merged либо spec есть, код частично)

| # | Pipeline task | Существующий TZ | Реальный статус | Приоритет |
|---|---|---|---|---|
| 1 | **bot-session-flow-fix** (5 багов) | [`bot-fix-plan-v2.md`](./bot-fix-plan-v2.md) — Status: PLAN (review needed) | PLAN не utilized. Часть багов решена PR #14/#18, но race condition в `getActiveSession()` и resume-break flow — не верифицированы. | **P0** |
| 2 | **warehouse-v3 migration script** | [`WAREHOUSE_V3_PHASE1_FOLLOWUPS.md`](./WAREHOUSE_V3_PHASE1_FOLLOWUPS.md) — Status: TODO | Script `migrate-inventory-simple-to-v3.ts` **не существует** в `functions/scripts/`. V1 и V3 коллекции параллельно — риск дрифта. | **P1** |
| 3 | **crm-api-v2 Wave 1** (phone normalize + duplicate + warnings) | [`task-crm-api-v2.md`](https://github.com/garkorcom/profit-step/blob/main/docs/tasks/) | Phone normalize уже в `src/utils/phone.ts` + `functions/src/agent/utils/phone.ts`. **Duplicate check endpoint и warnings — не найдены.** | **P1** |
| 4 | **crm-ui-sync** | (нет отдельного spec) | `src/api/crmApi.ts` всё ещё пишет в Firestore напрямую минуя Agent API. Надо проверить каждый метод. | **P2** |
| 5 | **agent-refactor-followups** (3 рефакторинга от 15 апр) | [`AGENT_REFACTOR_FOLLOWUPS.md`](./AGENT_REFACTOR_FOLLOWUPS.md) — Status: TODO | Technical debt от 3-х parallel agent worktree-refactors. Не блокирует прод, но тормозит следующие фичи. | **P2** |

### 🧠 Cross-cutting tech debt (не в pipeline, но всплывает в несколько задач)

| # | Проблема | Откуда известно | Effort |
|---|---|---|---|
| A | **Race condition** в `getActiveSession()` — `orderBy('startTime')` после `FieldValue.serverTimestamp()` может не найти только что созданный doc | [`bot-fix-plan-v2.md §Баг 3`](./bot-fix-plan-v2.md), [`nikita-p2-log`](/Users/denysharbuzov/projects/pipeline/2026-04-06/nikita-p2-log.md) | M (1 день) |
| B | **TimeTracking логика дублируется** в 20+ файлах (scheduled, triggers, telegram) — `closeSessionInTx()` не везде | [`nikita-log.md 05-04 §P3`](/Users/denysharbuzov/projects/pipeline/2026-04-05/nikita-log.md) | L (2-3 дня) |
| C | **Mock data в prod UI** — Jim Dvorkin hardcoded в portal SPEC (`src/pages/dashbord-for-client/SPEC.md:278`) — проверить не осталось ли в tsx | [`nikita-portal-log`](/Users/denysharbuzov/projects/pipeline/2026-04-06/nikita-portal-log.md) | S (2-4ч) |

### 📌 Известные open issues из моей работы (PR #55, 20 апреля)

| # | Что | Status |
|---|---|---|
| D | `modifyAiTask` (europe-west1) + `generateAiTask` (us-east1) deploy failed — Cloud Run image version mismatch после добавления `secrets: [...]` bindings | Pending — нужно `firebase functions:delete <name> --region=<region>` + redeploy |
| E | Phase 6 Admin UI `/admin/secrets` — просмотр metadata секретов, rotate, audit log (обсуждалось при миграции Secret Manager) | Deferred to follow-up |

---

## 2. Рекомендованный порядок работ

### Week 1 — Критичное (P0-P1)
1. **`bot-session-flow-fix`** (2 дня): взять [`bot-fix-plan-v2.md`](./bot-fix-plan-v2.md) → верифицировать какие из 5 багов ещё реально живут → починить оставшиеся → добавить regression тесты.
2. **`warehouse-v3 migration`** (1 день): написать `functions/scripts/migrate-inventory-simple-to-v3.ts` с dry-run + commit режимами → прогнать на staging → запустить в prod.
3. **Cross-cut A** (1 день): race condition в `getActiveSession()` — либо добавить retry, либо кэшировать active session в Redis/Firestore doc.

### Week 2 — Feature polish (P1-P2)
4. **`crm-api-v2 Wave 1`** (0.5 дня): duplicate-check endpoint + required-field warnings.
5. **`crm-ui-sync`** (1 день): пройти по `src/api/crmApi.ts` → заменить direct Firestore писатели на вызовы Agent API.
6. **`agent-refactor-followups`** (0.5 дня): закрыть 3 follow-up'а из TZ (1-2ч каждый по тексту spec'а).
7. **Issues D+E**: `modifyAiTask/generateAiTask` recreate + Admin Secrets UI.

### Week 3 — Tech debt (P2)
8. **Cross-cut B** (2-3 дня): полный TimeTracking refactor по оставшимся 20 файлам.
9. **Cross-cut C** (половина дня): grep + удалить mock data из prod UI.

---

## 3. Что НЕ включаем

- **CRM Overhaul Spec V1** — [`CRM_OVERHAUL_SPEC_V1.md`](./CRM_OVERHAUL_SPEC_V1.md) 11 модулей, 6-месячный roadmap. Это отдельный стратегический план, не pipeline follow-up.
- **Client Card V2 + Client Journey** — уже в main (PR #44, #45, #46). Tweaks — не наша задача.
- **Warehouse-rewrite AI capabilities** — уже покрыто [`WAREHOUSE_AI_INTEGRATION_TZ.md`](./WAREHOUSE_AI_INTEGRATION_TZ.md).
- **Reconciliation audits** — [`RECONCILIATION_AUDIT_V2.md`](./RECONCILIATION_AUDIT_V2.md) / [`RECONCILIATION_IMPROVEMENTS.md`](./RECONCILIATION_IMPROVEMENTS.md) — уже shipped, не pipeline.
- **Python SDK** — [`PYTHON_SDK_SPEC.md`](./PYTHON_SDK_SPEC.md) отдельный модуль, не касается pipeline.

---

## 4. Acceptance criteria для объединённого ТЗ

- [ ] Все 5 реально pending tasks (§1 ⚠ таблица) имеют shipped-статус в main.
- [ ] 3 cross-cutting проблемы (§1 🧠) либо решены, либо явно decline'ед в отдельном TZ с обоснованием.
- [ ] Issue D (`modifyAiTask`/`generateAiTask`) — deploy проходит без image-mismatch errors.
- [ ] Issue E (Admin Secrets UI) — доступен по `/admin/secrets` для admin роли.
- [ ] Все pipeline date-folders 2026-04-05 ... 2026-04-18 можно архивировать (переместить в `~/projects/pipeline-archive/`) — больше не нужны для текущей работы.

---

## 5. Архивирование pipeline files после закрытия

После завершения всех §2 задач — переместить:

```bash
mkdir -p ~/projects/pipeline-archive/2026-04
mv ~/projects/pipeline/2026-04-{05,06,07,08,10,11,13,16,18} ~/projects/pipeline-archive/2026-04/
```

Оставить в `~/projects/pipeline/`:
- `TASK_TEMPLATE.md` (канонический шаблон)
- Актуальные task-specs если Маша запустит новый сприт

---

## 6. Кто делает

Подходит для `/pickup` workflow (CLAUDE.md §3.1). Рекомендованный формат:
- Одна задача = один PR = одна `claude/<slug>` ветка
- Ветка удаляется авто после merge (GitHub setting `delete_branch_on_merge: true` — уже включён 2026-04-20)
- Status обновляется в соответствующем `docs/tasks/<SPEC>.md`: `TODO → IN_REVIEW → SHIPPED`
