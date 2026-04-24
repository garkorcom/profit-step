# ⚠️ This folder is ARCHIVED

**Moved to standalone repo on 2026-04-24.**

## New location

```
/Users/denysharbuzov/Projects/easytimercost/
```

**GitHub:** https://github.com/garkorcom/easytimercost (private)

## What's in the new repo

| | Location |
|---|---|
| **All planning docs** (PATH, MINI_TZ, USE_CASES, NEXT_SESSION, TIME_TRACKING_IMPORT, USER_CLIENT_AGENT_IDENTITY) | `easytimercost/docs/` |
| **HTML prototype** (23 pages from overnight build) | `easytimercost/prototype/` |
| **Starter-kit** (portable self-docs library) | `easytimercost/starter-kit/` |
| **Firebase config** (firestore rules, indexes, storage, functions config) | root |
| **Cloud Functions backend** — 13 DDD modules, TypeScript, Node 22 | `easytimercost/functions/src/modules/` |
| **README + SETUP guide** (step-by-step Firebase setup for `garkor.com@gmail.com`) | root |

## 13 Domain Modules in new repo

1. `time/`          — Work sessions, timer, 24h finalization
2. `users/`         — Workers, admins + AgentAccount identity for AI agents
3. `client-portal/` — External client-facing surface (NEW, separate)
4. `clients/`       — Clients, projects, geo-fences
5. `finance/`       — Payroll, payments, periods, snapshots
6. `expenses/`      — Submit, approve, categorize
7. `inventory/`     — Journal-based warehouse (ported pattern from profit-step)
8. `vehicles/`      — Fleet: keys, fuel, violations, permits, sunpass, photos, GPS
9. `tasks/`         — Multi-party tasks + Google Calendar 2-way sync
10. `tenants/`      — Multi-tenant config
11. `audit/`        — Immutable log
12. `notifications/` — Channel routing (Telegram Phase 0, WhatsApp Phase 2+)
13. `feedback/`     — Self-docs backend (replaces localStorage)
14. `spec/`         — Mission Control: TZ registry + lint + roadmap
15. `stats/`        — Materialized view helpers

Plus empty `ai/` for Phase 1+.

## Why moved

Per Denis's request 2026-04-24:
- Separate production codebase from profit-step
- Clean git history
- Independent CI/CD
- New Google/Firebase account (`garkor.com@gmail.com`, not `sitemiami.com@gmail.com`)
- Avoids confusion with profit-step domain code

## What's next

See `easytimercost/docs/NEXT_SESSION.md` — Phase 0 Week 1 Day-by-Day implementation plan.

**First step:** Denis runs Firebase setup per `easytimercost/SETUP.md` (~15 min browser work).
Then code portation from profit-step time-tracking + modules wire-up.

---

*If you accidentally opened this folder first — go to the new location.*
*The files here are a historical snapshot, not the active project.*
