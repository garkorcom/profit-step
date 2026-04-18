# Warehouse — Main Test Plan

> **Scope:** стратегия тестирования всего warehouse домена на уровне продукта
> **Детали тестов модулей:** см. `core/*/TESTS.md`
> **Детали тестов улучшений:** см. `improvements/*/TESTS.md`

---

## 1. Уровни тестирования

| Уровень | Инструмент | Покрытие | Когда |
|---|---|---|---|
| **Unit** | Jest + FakeDb | Pure functions, sync logic | Every PR |
| **Integration** | Jest + Firestore emulator | End-to-end flows, concurrency | Every PR |
| **Smoke** | Emulator + curl/Postman | API handshake | Phase gates |
| **E2E** | Cypress | UI flows | Pre-release |
| **Manual dogfood** | Денис + реальные работы | UC1-UC4 real-world | 2 weeks post-release |
| **Load** | Artillery | 1000 concurrent posts | Pre-production |

---

## 2. Целевое покрытие

- **Unit:** ≥ 80% по всем modules (enforced в jest.config.js)
- **Integration:** все 4 UC end-to-end (минимум 2 сценария каждый)
- **Concurrency:** 10+ сценариев (parallel posts, race conditions)
- **Regression:** 50+ scenarios из [`WAREHOUSE_USE_CASES.md`](../tasks/WAREHOUSE_USE_CASES.md)

---

## 3. Phase gates (чек-лист для каждой фазы)

### Phase 0 — Clean slate + bootstrap
- [ ] Legacy collections дропнуты (confirmation report)
- [ ] Новая structure создана (folder check)
- [ ] Seeds: 20 норм + 50 items + 1 warehouse + 3 van
- [ ] 5 smoke tests проходят на empty state

### Phase 1 — Core engine
- [ ] Unit tests: 60+ кейсов, 80%+ coverage (core/01 + core/02)
- [ ] Integration: receipt/issue/transfer/count/adjustment/reversal — все flows
- [ ] Concurrency: 10 parallel posts → 0 ledger дубликатов, balances корректны
- [ ] Idempotency: same doc posted 2× → 1 ledger set
- [ ] Negative stock policy: warehouse blocked, van allowed+event
- [ ] Reversal: posted→void → compensating entries, sum(ledger) = 0

### Phase 2 — UC1 On-site voice
- [ ] Parse accuracy ≥ 85% на 20 тестовых фразах (RU + EN)
- [ ] Fuzzy match > 85% к catalog
- [ ] Site location создаётся on-the-fly
- [ ] 5 реальных голосовых сессий у Дениса

### Phase 3 — UC2 Receipt Eyes
- [ ] Parse 5 чеков разных vendors (HD, Lowe's, local) с accuracy > 90%
- [ ] Idempotency по photo hash
- [ ] Auto-link к active trip context
- [ ] Новые items создаются через clarification loop

### Phase 4 — UC3 Task writeoff + Tasks sync
- [ ] Task start → draft issue за < 3 сек
- [ ] Norm lookup accuracy 100% (жёсткая связь templateType → norm)
- [ ] Reconciliation работает на task complete
- [ ] Anomaly detection > 25% overrun

### Phase 5 — UC4 Procurement
- [ ] Estimate 50 lines → plan за < 30 сек
- [ ] Reservations создаются на available items
- [ ] Draft PO email-ready
- [ ] RFQ email отправлен → vendor response trackable
- [ ] Web search возвращает top-3 candidates

### Phase 6 — Observability
- [ ] All metrics endpoints работают
- [ ] Dashboards в Cloud Monitoring настроены
- [ ] Alerts доставляются в Telegram channel
- [ ] Audit trail доступен admin'у через API

### Phase 7 — Python SDK
- [ ] 25 tools покрыты тестами
- [ ] Docs + examples
- [ ] 1 test partner integration

---

## 4. Regression suite

Постоянно прогоняемый набор scenarios (после любых изменений core):

1. **Basic posting** — receipt → balance updates
2. **Idempotent post** — same doc + same idempotency key → 1 ledger entry
3. **Transfer atomicity** — fail mid-transaction → rollback, no ledger
4. **Reservation lifecycle** — create draft → available reduced → confirm → onHand reduced
5. **Expired reservation** — TTL 48h → draft expires → available restored
6. **Reversal** — post → void → net sum = 0
7. **Negative stock warehouse** — hard stop
8. **Negative stock van** — allowed + event + reconciliation flag
9. **UOM conversion** — roll → ft, pack → each
10. **Drift check** — sum(ledger) vs balance.onHand — always equal

---

## 5. Ручной dogfood checklist (Phase 2+)

**Денис использует в течение 2 недель:**
- [ ] ≥ 5 trips планируются через UC1
- [ ] ≥ 10 чеков фотографируются (UC2)
- [ ] ≥ 10 задач закрываются через UC3
- [ ] ≥ 1 estimate прогоняется через UC4
- [ ] 0 критических багов (blockers)
- [ ] ≤ 3 minor bugs (workarounds exist)

После dogfood — отчёт в [`improvements/BACKLOG.md`](./improvements/BACKLOG.md) с найденными pain points.

---

## 6. Continuous integration

**GitHub Actions:**
- Every PR: `npm --prefix functions run test` + `npx tsc --noEmit`
- Main branch merge: smoke tests + deploy to staging
- Tag push: deploy to prod (manual confirmation)

**Pre-deploy hooks:**
- Firebase firestore rules test
- Migration dry-run на staging export

---

## 7. Связанные документы

- Unit + integration tests per module: `core/*/TESTS.md`
- Tests per improvement: `improvements/*/TESTS.md`
- Legacy tests: `functions/test/warehouseAI.test.ts`, `functions/test/warehouseSchemas.test.ts`

---

## 8. История

- **2026-04-18** — v1.0. Test strategy документ. Связан с MAIN_SPEC через phase gates.
