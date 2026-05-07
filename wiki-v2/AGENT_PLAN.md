# AGENT_PLAN — wiki-v2 phased delivery

**Версия:** 1.0
**Дата:** 2026-04-30
**Цель:** довести wiki-v2 от текущего scaffold-only состояния до production
ready, при этом не ломая `tasktotime/` v1 wiki до cutover окна.

---

## Принцип работы

Тот же hexagonal pipeline что для `tasktotime/`:
- `backend-architect` — design ports + applicationservices.
- `backend-developer` — adapters + REST handlers + Firestore impl.
- `frontend-developer` — UI components + view modes.
- `test-generator` + `test-runner` — coverage on each layer.
- Денис ревьюит PR'ы, мерджит, деплоит.

Source of truth:
- [spec/](spec/) — детали полей, lifecycle, API, AI prompts.
- v1 wiki под `tasktotime/` — текущая прод-реализация для миграции.

---

## Phase 0 — TZ (текущая фаза)

**Длительность:** 1-2 дня (документы)
**Deploy:** не нужен.

- Этот scaffold
- 25 spec файлов
- Decisions pending от Дениса (см. [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md))

**Exit:** Денис закрыл 12 open questions; AGENT_PLAN обновлён под их решения.

---

## Phase A — Foundation (3 дня)

**Цель:** `wiki-v2/{domain,ports,application,shared,tests}/` skeleton.

**Что делаем:**
- Domain types: `WikiLevel`, `Wiki`, `Section`, `SectionSchema`, validators.
- ESLint rule «`domain/` не импортирует Firebase / MUI / React».
- 12 ports со стабильными интерфейсами (см.
  [spec/08-portability/host-contract.md](spec/08-portability/host-contract.md)).
- Application services skeleton (5 use cases): `CreateWiki`,
  `PatchSection`, `EnhanceSectionWithAI`, `CaptureFromVoice`, `RollupWiki`.
- Unit tests для domain validators + section schema.

**Deploy:** не нужен — pure types.

**Exit:** `npm run build` green, тесты зелёные, ESLint rule не падает.

---

## Phase B — AI Helper «Дополни секцию» (1 неделя)

**Самая ценная фича** — кнопка `✨ Дополни` в каждой секции.

**Что делаем:**
- `adapters/anthropic/EnhanceSectionAnthropic.ts` — Anthropic SDK call с
  structured output.
- `adapters/firestore/AuditLogAdapter.ts` — каждый AI write в audit.
- REST `POST /api/wiki-v2/sections/:id/enhance` — preview + apply.
- UI: `<EnhanceSectionDialog>` — preview diff, apply / discard.
- Rate limit per user (mirror `tasktotime` pattern).
- Undo за 24h через audit log replay.

**Зависимости:** `ANTHROPIC_API_KEY` уже есть в проде, но 3 callable сейчас в
overlap-bug — желательно сначала почистить.

**Deploy:** functions + hosting в non-peak часы.

**Exit:** Денис написал 5 enhance'ов, доволен; rate limit стоит; undo
работает.

---

## Phase C — Telegram capture (2 недели)

**Цель:** бригадир в подвале не открывает редактор.

**Что делаем:**
- `adapters/telegram-capture/VoiceIntakeAdapter.ts` — слушает существующий
  worker bot (`onWorkerBotMessage`), парсит voice notes через Whisper +
  Anthropic structuring.
- `adapters/vision/PhotoTaggingAdapter.ts` — Vision API + AI suggested
  section.
- `adapters/ocr/ReceiptOcrAdapter.ts` — Google Vision OCR → Materials entry.
- Trigger handler в `functions/src/triggers/telegram/handlers/wikiCapture.ts`
  (новый, без unit-тестов модулей mediaHandler — отдельная задача).
- UI confirmation flow в боте: «save as section X? [Yes/No]».

**HIGH RISK по CLAUDE.md §2.2** — onWorkerBotMessage trigger без полного test
coverage.

**Deploy:** functions с 48h monitoring + опрос 2-3 бригадиров.

**Exit:** 50+ wiki entries созданы через бот за неделю; нет дублей; foreman
feedback positive.

---

## Phase D — Project KB (L1) UI + миграция (1 неделя)

**Цель:** вынести scattered project info (адрес, gate, контакты, permits) в
L1 wiki.

**Что делаем:**
- UI: `<ProjectKbPage>` для каждого проекта с pre-filled L1 sections.
- Migration script: парсит существующие estimates / projects / contacts →
  заполняет L1 wiki.
- Telegram bot teach: «show project KB» команда для бригадиров.

**Deploy:** hosting + backfill scripts.

**Exit:** Денис открывает любой свой проект, видит KB заполненный auto.

---

## Phase E — L3 Company Knowledge + rollup (2 недели)

**Цель:** institutional memory.

**Что делаем:**
- L3 collection `company_knowledge` с теми же sections.
- Trigger: при closeout проекта (lifecycle `accepted` for last task) — auto
  rollup L2 lessons → L3.
- UI: `/wiki-v2/company` страница с поиском по prior projects.
- Compare view: текущий проект vs похожие в L3.

**Deploy:** functions trigger + hosting.

**Exit:** Денис при квоте новой ванной видит свои 5 предыдущих ванных за
секунды.

---

## Phase F — Cross-wiki search (RAG) (1 неделя)

**Что делаем:**
- `adapters/vertex-search/EmbeddingAdapter.ts` — на каждый section save
  пишет embedding.
- Firestore vector field или Vertex AI Search index.
- REST `GET /api/wiki-v2/search?q=...` natural language query.
- UI: один searchbox над CRM, ranking + snippet.

**Deploy:** functions (embedding compute), бэкфилл индекса для existing
wikis.

**Exit:** «permit fee Tampa» возвращает все упоминания за <500ms.

---

## Phase G — Client view + portal integration (1 неделя)

**Что делаем:**
- View mode `client` — рендерит только sections с `clientVisible: true`.
- Portal route `/portal/{clientId}/wiki/{taskId}`.
- Edit perm matrix (см.
  [spec/06-ui-ux/view-modes.md](spec/06-ui-ux/view-modes.md)).
- Notification: client получает push когда decision апдейтится.

**Deploy:** hosting.

**Exit:** Денис шлёт клиенту ссылку, клиент видит decisions + photos, может
комментить.

---

## Phase H — Receipt OCR полный flow (1 неделя)

**Что делаем:**
- Уточнение Phase C OCR — full Materials section auto-fill.
- Линк на task expense (интеграция с finance — **с разрешением Дениса**).
- Verification UI: review OCR'd entry перед commit.

**HIGH RISK по `feedback_no_touch_time_finance`** — finance interaction.

**Deploy:** только с явным OK от Дениса.

**Exit:** Денис фоткает receipt — entry в Materials готов за 5 секунд.

---

## Cutover (Phase 5 в TZ-терминах) — 1 день

**Когда:** после Phase A-D на проде, в воскресенье 02:00-04:00 EST.

**Что делаем:**
1. T-30: announce в Telegram.
2. T-15: deploy hosting (writers переключаются на v2).
3. T-0: migration script — `wiki-v1 (tasktotime/wiki) → wikis_v2`.
4. T+10: verification.
5. T+15: smoke test.
6. T+20: redirect old `/wiki` route → `/wiki-v2`.
7. T+30: done.

**Rollback:** `git revert` + redeploy за 5 минут. v1 wiki collection
сохраняется 3 месяца.

---

## Timeline summary

| Phase | Длительность | Параллельно с |
|---|---|---|
| 0 — TZ | 1-2 дня | — |
| A — Foundation | 3 дня | — |
| B — AI Helper | 1 неделя | C можно стартовать со 2-го дня B |
| C — Telegram capture | 2 недели | После B готова инфра audit log |
| D — L1 Project KB | 1 неделя | C завершается параллельно |
| E — L3 Company Knowledge | 2 недели | После D |
| F — Cross-wiki search | 1 неделя | После A (нужны section embeddings) |
| G — Client view | 1 неделя | После B+D (есть data) |
| H — Receipt OCR | 1 неделя | После C (есть OCR adapter) |
| Cutover | 1 день | После A-D as minimum |

**Active work:** ~10 недель календарных. С 2 недели soak period перед
cleanup v1 — 12 недель до полного завершения.

---

## Что я делаю автономно (агент)

- Запуск sub-agents (один или параллельно).
- Создание / правка spec файлов в [spec/](spec/) — это Phase 0 deliverable.
- Локальные коммиты в feature branch.
- `gh pr create` (не merge).
- Iterate если тесты падают.

## Что только Денис

- Approve / merge PR в `main`.
- `firebase deploy --only firestore` (Phase A indexes + rules).
- `firebase deploy --only functions` (Phase B, C, E, F, H).
- `firebase deploy --only hosting` (Phase D, G, cutover).
- Manual UAT.
- Cutover окно.
- Closing 12 open questions в decisions doc.
- Координация со внешним AI bot dev'ом если меняем URL контракты.

---

## Стартую с Phase A?

Phase A — pure types + ports skeleton, нулевой риск, можно делать пока
открытые вопросы решаются (большинство касается Phase B+).

Если Денис ОК — создам feature branch `feat/wiki-v2-phase-a` и запущу
backend-architect + Explore агентов параллельно.
