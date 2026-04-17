# ТЗ — Python SDK для внешних AI-агентов (`profit-step-agent`)

## Metadata

- **PM:** Denis
- **Requested by:** Denis (2026-04-17, в рамках стратегии роста внешних AI-партнёров)
- **Priority:** P1 (разблокирует партнёрскую экосистему — без SDK каждый новый агент пишет клиента руками против OpenAPI, тормозит onboarding)
- **Estimated effort:** Phase 1 = **M+ (1 неделя)**, Phase 2 = L (ещё 1 неделя), Phase 3 = M (опционально)
- **Status:** TODO
- **Source material:** ветка `claude/nervous-torvalds` (tip `36459f6`), папка `sdk/python/profit_step_agent/` — существующий каркас на 9 доменов

---

## Бизнес-контекст

### Зачем нужно

Денис растит экосистему **внешних AI-агентов**, работающих с profit-step CRM:
- OpenClaw-интеграции (`docs/OPENCLAW_AGENT_INTEGRATION_GUIDE.md`)
- Сторонние AI-боты (Telegram, Slack, Discord) партнёров/клиентов
- Кастомные Python-скрипты (bookkeeping, reporting, alerts)

**Текущая ситуация:** разработчики агентов пишут клиентов вручную против `GET /api/docs/spec.json` (OpenAPI). Это:
- Тормозит onboarding (часы-дни на каждого нового)
- Создаёт drift (один фиксит типы как ему удобно, другой иначе — нет единой схемы)
- Нет типизации — pydantic models + auto-completion в IDE
- Ошибки в rate limit, auth-режимах, retry — каждый пишет свои

SDK = **"pip install и поехали"**. Один источник правды, pydantic-модели, правильный retry/rate-limit handling, готовые примеры.

### Метрика успеха

После Phase 1:
- Внешний разработчик (не из нашей команды) за **<30 минут** от нуля запускает первый smoke-test против прода
- Минимум 1 partner использует SDK в production в течение месяца после релиза

---

## Phase 1 — MVP (1 неделя, ~20-30ч)

Цель: достать существующий каркас из ветки, обновить под актуальный API, запаблишить в PyPI как `0.1.0`, написать README с 3 рабочими примерами.

### 1.1. Extract code from `nervous-torvalds` branch

**Что брать:**
```
sdk/python/
├── pyproject.toml              # httpx + pydantic + click deps
├── profit_step_agent/
│   ├── __init__.py             # CRMAgent, CRMClient, exceptions exports
│   ├── agent.py                # высокоуровневый facade
│   ├── client.py               # httpx-based HTTP client + retry
│   ├── cli.py                  # `psa` CLI tool
│   ├── exceptions.py           # CRMError, ValidationError, ScopeError, RateLimitError, NotFoundError
│   ├── domains/                # 9 модулей
│   └── models/                 # pydantic models
└── tests/                      # test_client, test_domains, test_webhooks
```

**Как:**
1. Создать новую ветку `feature/python-sdk-phase1` от текущего main
2. `git checkout claude/nervous-torvalds -- sdk/python/`
3. Review / очистка build-artifacts (`.egg-info/`, `__pycache__/`)
4. Commit "feat: import Python SDK skeleton from nervous-torvalds"

### 1.2. Rebase SDK против current API

Ветка была до 15 апреля, API изменился. Нужно сверить каждый домен с текущим `functions/src/agent/routes/`:

**Renames/changes (обязательные):**
| SDK domain | Старый endpoint | Текущий endpoint (main) | Действие |
|---|---|---|---|
| (новые) feedback | agentFeedback.ts | feedback.ts | переименовать, если SDK ссылается |
| (добавились) teams | — | /api/teams (CRUD) | пока пропустить в Phase 1, добавить в Phase 2 |
| webhooks | /api/webhooks | /api/webhooks (обновлена) | сверить schemas, возможно поля прибавились |
| (RLS изменения) | | | impersonation header `X-Impersonate-User` остался, но поведение для `worker`/`driver` стало строже — см. `ceb8464` |

**Как проверить:**
```bash
# запустить SDK-тесты против локального эмулятора
firebase emulators:start --only functions
cd sdk/python && pytest tests/ -v
```

Тесты на моках должны пройти сразу. Если не проходят — значит schema изменилась, фиксить модели.

### 1.3. Coverage gap — Phase 1 minimum

Текущий SDK покрывает 9 доменов. Main имеет 21 API-route. **В Phase 1 оставить 9 — этого хватит для MVP**. Phase 2 расширит:

**В Phase 1 (как есть):** time, tasks, events, payroll, clients, costs, webhooks, projects + (unofficial) health-check.

**Явно задокументировать "out of SDK в Phase 1"** в README:
- activity logs
- dashboard widget data
- ERP (change orders, purchase orders)
- estimates
- files (upload/download)
- finance (reconciliation)
- inventory
- portal (client-facing)
- sharing
- sites
- teams (multi-user)
- users / contacts

Для них — партнёр может использовать raw `CRMClient.get()/post()` как escape hatch:
```python
from profit_step_agent import CRMAgent
agent = CRMAgent(token="...")
# Domains covered
tasks = agent.tasks.list()
# Escape hatch for not-yet-covered domain
raw = agent.client.get("/api/inventory/warehouses")
```

### 1.4. Auth modes (критично)

API поддерживает 3 режима auth (см. `functions/src/agent/agentMiddleware.ts`). SDK должен работать со всеми:

1. **Master Token (static AGENT_API_KEY)** — server-to-server, видит всё как admin
2. **Master Token + `X-Impersonate-User` header** — действует как конкретный сотрудник
3. **Firebase JWT** — для browser-side агентов

**В SDK:**
```python
# Mode 1
agent = CRMAgent(token="<AGENT_API_KEY>")

# Mode 2 — impersonation
agent = CRMAgent(token="<AGENT_API_KEY>", impersonate_uid="worker-abc-123")
# или
agent.impersonate("worker-abc-123")  # context manager
with agent.impersonate("worker-abc-123"):
    tasks = agent.tasks.list()  # scoped to that worker via RLS

# Mode 3 — Firebase JWT
agent = CRMAgent(token=firebase_id_token)  # auto-detected
```

### 1.5. Packaging & distribution — DECISION TIME

**Решить сейчас:**

**Option A — PyPI public (`pip install profit-step-agent`)**
- ✅ Внешние разработчики ставят одной командой
- ✅ Стандартная экосистема Python
- ❌ Любой может увидеть имя endpoint'ов (хотя OpenAPI и так публичный)
- ❌ Надо следить за semver promises

**Option B — GitHub private repo + `pip install git+ssh://...`**
- ✅ Контроль доступа (только доверенные партнёры)
- ❌ Партнёру нужен доступ к нашему GitHub (SSH key, token)
- ❌ Нет простого semver (надо таги поддерживать руками)

**Option C — оба**
- PyPI для публичных партнёров (e.g., OpenClaw marketplace)
- GitHub private для premium клиентов с кастомизациями

**Рекомендация:** **Option A (PyPI public)**. OpenAPI spec и так на `profit-step.web.app/api/docs/spec.json` — секретность тут уже не опция. PyPI даёт легитимность: "есть официальный SDK, не самопал". Phase 1 = `0.1.0-beta`, после 1 месяца в проде без багов → `1.0.0`.

**Setup:**
- Создать аккаунт `garkor` на PyPI (если нет)
- Настроить API token в GitHub Actions secret `PYPI_TOKEN`
- Workflow `.github/workflows/publish-python-sdk.yml` — публикует при push'е тега `sdk-v*.*.*`

### 1.6. CI/CD

Добавить `.github/workflows/python-sdk.yml`:

```yaml
name: Python SDK
on:
  push:
    paths: ['sdk/python/**']
  pull_request:
    paths: ['sdk/python/**']

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python: ['3.10', '3.11', '3.12']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - run: pip install -e ./sdk/python[dev]
      - run: cd sdk/python && pytest --cov
      - run: cd sdk/python && ruff check .
```

Плюс отдельный job для publish (manual trigger или on-tag):

```yaml
  publish:
    if: startsWith(github.ref, 'refs/tags/sdk-v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install build twine
      - run: cd sdk/python && python -m build
      - run: cd sdk/python && twine upload dist/* -u __token__ -p ${{ secrets.PYPI_TOKEN }}
```

### 1.7. README + 3 рабочих примера (критично)

**README.md** в `sdk/python/`:

```markdown
# profit-step-agent

Python SDK для CRM Agent API (profit-step.web.app).

## Install

    pip install profit-step-agent

## Quickstart

    from profit_step_agent import CRMAgent
    agent = CRMAgent(token="<your-token>")
    tasks = agent.tasks.list(status="next_action")
    for t in tasks:
        print(t.title)

## Получить токен

- **Для server-to-server** (daily report бот, reconciliation скрипт):
  спросить у админа profit-step — master token
- **Для agent-per-employee** (Telegram-бот от имени конкретного работника):
  сгенерировать per-employee token через админ-панель

## Примеры

См. `examples/`:
- `01_smoke_check.py` — проверка доступа
- `02_daily_report.py` — выгрузка дневной сводки
- `03_webhook_subscriber.py` — подписка на task.created

## Auth modes
[... 3 mode block с кодом ...]

## Rate limits
[...]

## Errors
[...]

## Versioning
Semver. Minor = backwards-compatible addition.
```

**3 working examples в `sdk/python/examples/`:**

1. **`01_smoke_check.py`** (5 строк, цель — "я получил токен, работает ли") — вызов `/api/status`, печатает whoami.
2. **`02_daily_report.py`** (~50 строк) — за вчерашний день: часы по работникам + сумма earned + топ-5 проектов. Такой скрипт реальный партнёр может за 10 минут адаптировать под свой Slack/Discord notifier.
3. **`03_webhook_subscriber.py`** (~80 строк) — Flask/FastAPI endpoint принимает webhooks от CRM, валидирует HMAC, логирует `task.created`. Готовый boilerplate для интеграционных ботов.

### 1.8. Acceptance — Phase 1

- [ ] SDK собирается: `cd sdk/python && python -m build` → `.whl` + `.tar.gz` в `dist/`
- [ ] SDK устанавливается: `pip install ./sdk/python/dist/*.whl` в чистом venv
- [ ] 3 примера из `examples/` запускаются против прода без ошибок
- [ ] pytest покрывает ≥80% `client.py` + все 9 domains
- [ ] ruff clean, mypy опционально
- [ ] README с quickstart + auth + rate limits + errors + versioning
- [ ] CI workflow зелёный на PR и main
- [ ] Version `0.1.0-beta` зарелизен на PyPI (testpypi сперва, потом prod)
- [ ] Decision на PyPI public зафиксирован (или обоснован переход на private)

---

## Phase 2 — Extend coverage (+1 неделя, ~15-20ч)

Покрыть остальные 12 доменов main API. Пo приоритету для партнёров:

| Приоритет | Домен | Для чего обычно нужен |
|---|---|---|
| P1 | `inventory` | Stock-check боты, low-stock алерты |
| P1 | `finance` / `reconciliation` | Bookkeeping интеграции (QuickBooks, Xero) |
| P1 | `files` | Upload receipts / blueprints / contracts |
| P2 | `dashboard` | At-a-glance виджеты для партнёрских UI |
| P2 | `users` / `contacts` | CRM sync (HubSpot, Salesforce) |
| P2 | `teams` | Multi-tenant партнёрские деплойменты |
| P2 | `activity` | Audit/compliance экспорт |
| P3 | `estimates` / `erp` | Продвинутые финансовые агенты |
| P3 | `portal` | Embed client portal в сторонний сайт |
| P3 | `sharing` | ACL management |
| P3 | `sites` | Geo/location analytics |

**Acceptance Phase 2:**
- [ ] Все 21 домена покрыты в `profit_step_agent.domains`
- [ ] Pydantic models обновлены автоматизированно из OpenAPI (либо supported tooling, либо скрипт `sync-models.py`)
- [ ] Phase 2 = `0.5.0-beta` → после 2 недель без багов → `1.0.0`

---

## Phase 3 — OpenAPI codegen (опционально, 1-2 дня)

Если после Phase 2 растёт drift между SDK и API (запускаем codegen раз в спринт):

- Использовать `openapi-python-client` (или `datamodel-code-generator`) для генерации моделей из `https://profit-step.web.app/api/docs/spec.json`
- Оставить domain facades handwritten (они про UX, не про HTTP), модели — autogen
- Workflow `regenerate-sdk-models.yml` — manual dispatch, делает PR с обновлёнными моделями

Это убирает ручной drift, но увеличивает сложность. **Не делать в Phase 1-2.**

---

## Риски и что может не зайти

| Риск | Вероятность | Mitigation |
|---|---|---|
| API изменится, сломаем совместимость | средняя | Semver + CHANGELOG.md + deprecation warnings за 1 minor до removal |
| Партнёр постит тестовый код с токеном в публичный git | высокая | В README явный warning + `gitleaks` рекомендация + предлагать scoped per-employee tokens вместо master |
| Rate limit 429 заклинит SDK под нагрузкой | низкая | Exponential backoff + jitter уже в `client.py`, плюс `Retry-After` header support |
| Партнёр зависит от домена вне Phase 1, раздражается | средняя | Escape hatch (`agent.client.post(...)`) в README, Phase 2 roadmap видим |

---

## Ресурсы

- Каркас (уже написан): `claude/nervous-torvalds` ветка, `sdk/python/`
- OpenAPI spec: https://profit-step.web.app/api/docs/spec.json
- Auth middleware reference: `functions/src/agent/agentMiddleware.ts`
- Существующий agent guide: `docs/AGENT_SETUP_GUIDE.md`
- OpenClaw integration: `OPENCLAW_AGENT_INTEGRATION_GUIDE.md`

---

## Implementation notes / как начинать

**Порядок для агента/разработчика, берущего ТЗ:**

1. Прочитать весь SPEC (25 минут)
2. Сделать `git checkout -b feature/python-sdk-phase1 origin/main`
3. Extract: `git checkout claude/nervous-torvalds -- sdk/python/` (1.1)
4. Убрать build-artifacts (`find sdk/python -name __pycache__ -exec rm -rf {} +`; `rm -rf sdk/python/*.egg-info`)
5. Пройтись по 1.2 (rebase vs current API) — grep каждый endpoint в `main` против доменов
6. Запустить pytest — дофиксить broken tests
7. Написать/обновить README (1.7) + 3 examples
8. Добавить CI workflow (1.6)
9. Создать PyPI testpypi аккаунт, загрузить `0.1.0-beta`, проверить в чистом venv
10. PR против main → merge → tag `sdk-v0.1.0-beta` → CI публикует на PyPI
11. Phase 1 ✅ → отчёт Денису, обсуждение Phase 2

**Если работу делает агент (Клод / Никита):**
- Step 4 (cleanup) и 6 (pytest fixes) — ключевые, там можно застрять
- Step 9 (PyPI) требует секрет (`PYPI_TOKEN`) — не может сделать агент, Денис добавляет в GitHub Secrets сам
- Step 10 (tag push) — тоже человеческое действие

---

## Связь с другими ТЗ

- `NERVOUS_TORVALDS_SALVAGE.md` (ТЗ от 2026-04-17) — Находка 1 этого документа — это **данный** SPEC, раскрыт в деталях
- `AGENT_REFACTOR_FOLLOWUPS.md` (2026-04-17) — ортогонально, не блокирует
- `AGENT_SETUP_GUIDE.md` (main) — после релиза SDK обновить: в секции "Python SDK setup" заменить "write your client manually" на `pip install profit-step-agent`
