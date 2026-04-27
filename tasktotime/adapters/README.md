# `tasktotime/adapters/` — port implementations

This directory holds the runtime implementations of every port declared in
`tasktotime/ports/`. The split is hexagonal:

- `domain/` and `ports/` are **pure** — no Firebase, BigQuery, FCM, or HTTP
  imports. They describe behaviour and contracts.
- `adapters/` translates those contracts into Firestore writes, REST calls,
  Cloud Storage uploads, etc.

Composition is the responsibility of the **composition root** (typically
`functions/src/agent/...`). The root constructs a `CreateAdaptersDeps`
bundle, calls `createAdapters(deps)` from this barrel, and hands the
resulting `Adapters` object to application services / REST handlers.

## Layout

```
adapters/
├── README.md                ← this file
├── index.ts                 ← root barrel + createAdapters() factory
├── errors.ts                ← AdapterError + codes (MISSING_INDEX, STALE_VERSION, …)
├── firestore/               ← 20 adapters that touch Firestore
│   ├── _shared.ts           ← Timestamp ↔ EpochMs, getAllChunked, stripUndefined, …
│   ├── index.ts             ← sub-barrel
│   ├── FirestoreTaskRepository.ts
│   ├── FirestoreTransitionLog.ts
│   ├── FirestoreClientLookup.ts
│   ├── FirestoreProjectLookup.ts
│   ├── FirestoreUserLookup.ts
│   ├── FirestoreEmployeeLookup.ts
│   ├── FirestoreContactLookup.ts
│   ├── FirestoreSiteLookup.ts
│   ├── FirestoreEstimate.ts
│   ├── FirestoreNote.ts
│   ├── FirestoreWorkSession.ts
│   ├── FirestorePayroll.ts
│   ├── FirestoreInventoryCatalog.ts
│   ├── FirestoreInventoryTx.ts
│   ├── FirestoreAIAudit.ts
│   ├── FirestoreAICache.ts
│   ├── FirestoreIdempotency.ts
│   ├── FirestoreFile.ts
│   ├── FirestoreIdGenerator.ts
│   └── RealClock.ts
└── external/                ← 6 adapters that talk to non-Firestore services
    ├── index.ts
    ├── TelegramNotifyAdapter.ts        — Telegram Bot API (sendMessage)
    ├── BrevoEmailNotifyAdapter.ts      — Brevo /v3/smtp/email
    ├── FCMPushNotifyAdapter.ts         — admin.messaging().sendEachForMulticast
    ├── BigQueryAuditAdapter.ts         — bigquery.dataset().table().insert
    ├── FirebaseStorageUploadAdapter.ts — bucket.file().save / getSignedUrl / delete
    └── MockWeatherForecastAdapter.ts   — placeholder (NOAA in PR-B)
```

## Mapping → ports

Each port has exactly one adapter. The numbers below correspond to the rows
in `spec/04-storage/adapter-mapping.md`.

| #   | Port                       | Adapter                        |
|----:|----------------------------|--------------------------------|
| §1  | `TaskRepository`           | `FirestoreTaskRepository`      |
| §2  | `TransitionLogPort`        | `FirestoreTransitionLog`       |
| §3  | `ClientLookupPort`         | `FirestoreClientLookup`        |
| §4  | `ProjectLookupPort`        | `FirestoreProjectLookup`       |
| §5  | `UserLookupPort`           | `FirestoreUserLookup`          |
| §6  | `EmployeeLookupPort`       | `FirestoreEmployeeLookup`      |
| §7  | `ContactLookupPort`        | `FirestoreContactLookup`       |
| §8  | `SiteLookupPort`           | `FirestoreSiteLookup`          |
| §9  | (reserved)                 | —                              |
| §10 | `EstimatePort`             | `FirestoreEstimate`            |
| §11 | `NotePort`                 | `FirestoreNote`                |
| §12 | `WorkSessionPort`          | `FirestoreWorkSession`         |
| §13 | `PayrollPort`              | `FirestorePayroll`             |
| §14 | `InventoryCatalogPort`     | `FirestoreInventoryCatalog`    |
| §14 | `InventoryTxPort`          | `FirestoreInventoryTx`         |
| §15 | `AIAuditPort`              | `FirestoreAIAudit`             |
| §16 | `AICachePort`              | `FirestoreAICache`             |
| §17 | `IdempotencyPort`          | `FirestoreIdempotency`         |
| §18 | `TelegramNotifyPort`       | `TelegramNotifyAdapter`        |
| §19 | `EmailNotifyPort`          | `BrevoEmailNotifyAdapter`      |
| §20 | `PushNotifyPort`           | `FCMPushNotifyAdapter`         |
| §21 | `BigQueryAuditPort`        | `BigQueryAuditAdapter`         |
| §22 | `StorageUploadPort`        | `FirebaseStorageUploadAdapter` |
| §23 | `WeatherForecastPort`      | `MockWeatherForecastAdapter` (placeholder — PR-B replaces with NOAA) |
| §24 | `FilePort`                 | `FirestoreFile`                |
| §25 | `ClockPort`                | `RealClock`                    |
| §26 | `IdGeneratorPort`          | `FirestoreIdGenerator`         |

## Conventions

These rules apply to every adapter — the `firestore/_shared.ts` helpers and
`errors.ts` types are the cheapest way to follow them.

1. **One adapter per port.** No multi-port classes. No god-objects.
2. **Constructor injection only.** Adapters never read `process.env`,
   `defineSecret(...).value()`, or call `admin.firestore()` themselves —
   the composition root resolves all that.
3. **Time conversion at the boundary.** Domain holds `EpochMs = number`;
   Firestore stores `Timestamp`. Use `toEpochMs` / `toTimestamp` /
   `epochsToTimestamps` from `_shared.ts`.
4. **Null, not undefined.** Adapters return `null` for not-found. Firestore
   rejects `undefined` on writes — use `stripUndefined`.
5. **Errors map to `AdapterError`.** Wrap try/catch on every external call.
   Use `mapFirestoreError` for Firestore exceptions; throw
   `AdapterError('EXTERNAL_FAILURE', ...)` for outbound HTTP/SDK errors.
   `BigQueryAuditAdapter.log` is the **one** documented exception — it
   swallows errors per port contract.
6. **CompanyId scope on every list query.** `where('companyId','==',X)` is
   non-negotiable for RLS; the only exception is documented legacy lookups
   like `EmployeeLookupPort.findByTelegramId` (see `data-dependencies.md`).
7. **Hexagonal purity check.**

   ```
   grep -rn "firebase-admin\|@google-cloud\|firebase-functions" \
     tasktotime/domain tasktotime/ports
   ```

   Must return only documentation matches. Any actual import is a leak.
8. **`@google-cloud/bigquery` is not a runtime dep of the root workspace.**
   `BigQueryAuditAdapter` accepts a structural `BigQueryLike` interface so
   the `tasktotime/` module compiles without it; the composition root
   passes a real `BigQuery` instance from `functions/`.
9. **No top-level side effects.** No `admin.initializeApp()`, no module-level
   network calls, no `console.log` outside the documented BigQuery fallback.

## Testing

- Pure adapters (e.g. `RealClock`, `MockWeatherForecastAdapter`) get plain
  Jest unit tests under `tasktotime/tests/adapters/`.
- Firestore-touching adapters get **integration** tests against the Firebase
  emulator — see `tasktotime/tests/adapters/firestore/FirestoreTaskRepository.test.ts`
  for the canonical pattern. Run with `npm run emulator:test`.
- External-service adapters (Telegram / Brevo / FCM / Storage / BigQuery)
  use injected `fetchImpl` or SDK doubles to assert request shape without
  hitting the network. See PR-A's adapter integration tests under
  `tasktotime/tests/adapters/external/` (added in step A4).

## Next steps

After PR-A merges:

- **PR-B (HIGHEST RISK):** real Firestore triggers, AI flows, scheduled
  crons. Triggers must be idempotent — see CLAUDE.md §2.1.
- **PR-C:** REST endpoints mounted on `agentApi`, frontend wiring.
- **PR-D:** real NOAA `WeatherForecastAdapter` replacing the mock.

Open design TODOs in `spec/04-storage/adapter-mapping.md`:

1. `PayrollPort` collection name — currently `payroll_ledger`; verify with
   Денис before crossing the production line.
2. `processedEvents` prefix `tt_` — agreed but unwritten anywhere outside
   the spec.
3. `TaskRepository.patch` whitelist — codified in
   `firestore/FirestoreTaskRepository.ts:PATCH_FORBIDDEN_KEYS`.
