# DNS / Domain Handover Plan (P-1.7)

## Metadata

- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Цель:** план миграции доменов при переезде на новый Firebase-проект
- **Scope:** только paper-work — что делать когда будет решение о домене

---

## 1. Текущее состояние

| Тип | Домен | Где настроено | Назначение |
|---|---|---|---|
| Firebase default | `profit-step.web.app` | Auto-генерация Firebase | Основной prod hosting |
| Firebase default | `profit-step.firebaseapp.com` | Auto-генерация Firebase | Alias, используется для Auth redirect |
| Custom domain | **не настроен** (на 2026-04-19) | — | — |

**Проверить:** `firebase hosting:sites:list --project=profit-step` и Firebase Console → Hosting → Custom domains.

**Cloud Functions endpoints:**
- `https://us-central1-profit-step.cloudfunctions.net/agentApi` — основной API
- `https://us-central1-profit-step.cloudfunctions.net/onWorkerBotMessage` — worker bot
- `https://us-central1-profit-step.cloudfunctions.net/onCostsBotMessage` — costs bot
- `https://us-central1-profit-step.cloudfunctions.net/telegramWebhook` — AI bot

Они меняются автоматически при смене projectId на `us-central1-<new-project>.cloudfunctions.net/...`.

**Зарегистрированные domains где URL-ы встречаются:**
- См. [`HARDCODED_INVENTORY.md §3`](./HARDCODED_INVENTORY.md) — URL'ы в docs, SDK, landings, CLAUDE.md

---

## 2. Сценарии переезда

### Сценарий A — остаёмся на Firebase default domain

**Когда:** нет custom domain → нечего переключать кроме URL-ов.

**Что делать:**
1. Новый проект даёт свой `{new-project}.web.app`
2. Просто уведомить пользователей про смену URL (e.g. email / in-app banner)
3. Оставить старый проект живым 2 недели как shadow — входящий трафик можно перенаправить через middleware `redirect`:
   ```js
   // firebase.json в старом проекте
   "redirects": [
     { "source": "/**", "destination": "https://{new-project}.web.app/:1", "type": 301 }
   ]
   ```

**Downtime:** ноль, если всё подготовлено.

### Сценарий B — переезжаем на custom domain

**Когда:** хотим `profitstep.com` или свой brand domain.

**Pre-cutover:**

1. **Купить/выбрать домен.** Provider: Cloudflare / Namecheap / Google Domains.
2. **Добавить в Firebase:** Console → Hosting → Add custom domain → `profitstep.com` + `www.profitstep.com`.
3. **Firebase выдаст 2 verification records:** TXT для владения, A/AAAA для routing. Добавить в DNS provider.
4. **Дождаться проверки** (от 15 минут до 24 часов). Firebase автоматически выпустит TLS через Let's Encrypt.
5. **Добавить custom domain в Firebase Auth** authorized domains list.
6. **Обновить SDK `base_url`** и все отсылки в docs / handoffs → на новый custom domain.

**Cutover (low-traffic окно):**

1. В DNS provider переключить A-записи `profitstep.com` с старого hosting IP на новый (если уже был custom domain на старом).
2. TTL рекомендую понизить до 60-300 секунд за 24ч **до** cutover (чтобы быстро откатиться если что).
3. После cutover — мониторинг 30 минут. Если ошибки DNS — вернуть старые A-записи.
4. Через 48ч после успеха — вернуть TTL обратно на 3600 или больше.

**Downtime:** 2-15 минут (DNS propagation).

### Сценарий C — dual domains одновременно

**Когда:** бизнес не готов к cutover сразу, хочет тестировать на новом pojекте параллельно.

**Setup:**
- `staging.profitstep.com` → новый проект
- `profitstep.com` → старый проект
- Оба работают до полной валидации
- Potential data drift — **разные Firebase projects = разные БД** — нельзя одновременно писать в оба, иначе inconsistency

**Не рекомендую** если нет clear migration story — слишком шумно.

---

## 3. Что точно нужно обновить (independent от scenario)

| Место | Действие |
|---|---|
| Firebase Auth authorized domains | Добавить новый `{new-project}.web.app` + custom domain если есть |
| Telegram bot webhooks | Re-register через BotFather API (см. [DATA_MIGRATION_RUNBOOK.md §5.1](./DATA_MIGRATION_RUNBOOK.md)) |
| SDK `DEFAULT_BASE_URL` в `sdk/python/profit_step_agent/client.py` | Обновить если не хотим полагаться на `PROFIT_STEP_API_URL` env var |
| Static HTML landings (6 файлов) | `apiKey` + `authDomain` + `projectId` заменить на новые (sed) |
| OpenAPI spec ссылки | В CLAUDE.md, README, handoffs — поменять `profit-step.web.app` на новый host |
| Email templates (если есть noreply@profit-step.*) | Brevo Sender Identity обновить |
| External documentation (https://github.com/garkorcom/profit-step) | Обновить live links в README + sdk/python/README.md |

---

## 4. DNS Records (если уходим на custom domain)

Рекомендуемый набор (для Cloudflare или эквивалент):

```
# Hosting (Firebase выдаст)
A         profitstep.com      151.101.1.195   (или что Firebase даст)
A         profitstep.com      151.101.65.195
AAAA      profitstep.com      2a04:4e42::645
AAAA      profitstep.com      2a04:4e42:200::645
CNAME     www.profitstep.com  profitstep.com

# SPF / DKIM / DMARC (для Brevo email delivery)
TXT       profitstep.com      "v=spf1 include:spf.brevo.com ~all"
TXT       mail._domainkey     "v=DKIM1; k=rsa; p=..."  # из Brevo console
TXT       _dmarc              "v=DMARC1; p=quarantine; rua=mailto:admin@profitstep.com"

# Firebase verification (tempory — Firebase подскажет что добавить)
TXT       profitstep.com      "firebase-domain-verify-..."
```

Cloudflare-specific:
- **Proxy status:** "DNS only" для Firebase A/AAAA (Cloudflare proxy ломает Firebase SSL handshake)
- Universal SSL — disabled для `profitstep.com`, т.к. Firebase выпускает свой

---

## 5. Rollback (если DNS cutover не удался)

**Shortcut:** в DNS провайдере сменить A-записи обратно на старые → 60-300 секунд TTL → старый hosting снова принимает трафик.

**Вот зачем понижать TTL до cutover'а** — без него rollback может занять часы.

---

## 6. Timing (рекомендация)

Если custom domain:
1. **2 недели до cutover:** купить/выбрать domain, добавить в Firebase new project, получить verification
2. **1 неделя до:** smoke-test полный flow на `{new-project}.web.app`
3. **24 часа до:** понизить DNS TTL до 60-300 секунд
4. **Cutover в low-traffic окно:** воскресенье вечер, после 22:00 локального времени
5. **Immediately after:** 30-минутный мониторинг smoke-тестов + functions logs
6. **48 часов после:** всё стабильно → повысить TTL, архивировать старый проект

---

## 7. Open questions (для решения Денисом)

1. **Нужен ли custom domain?** Сейчас `.web.app` работает — Денис пока не жаловался. Custom domain — это +1 уровень сложности (DNS + TLS + Brevo), ROI не ясен.
2. **Если да — какой?** Backlog: `profitstep.com` / `profit-step.com` / `profitstep.app` / нативный? Проверить availability.
3. **Email domain?** Сейчас `info@garkor.com` / `noreply@...` — если меняется, нужны SPF/DKIM обновления.
4. **Cloudflare vs Firebase-native?** Cloudflare даёт CDN, DDoS protection, analytics — но ломает Firebase SSL handshake в proxied режиме. Firebase-native проще, но без extra features.

---

## References

- Parent plan: [`MASTER_PLAN_2026-04-19.md`](../tasks/MASTER_PLAN_2026-04-19.md) §P-1.7
- Full migration runbook: [`DATA_MIGRATION_RUNBOOK.md`](./DATA_MIGRATION_RUNBOOK.md)
- Hardcoded URL inventory: [`HARDCODED_INVENTORY.md §3`](./HARDCODED_INVENTORY.md)
- [Firebase docs — custom domains](https://firebase.google.com/docs/hosting/custom-domain)
