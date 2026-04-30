---
title: 10.3 What NOT to do — hard rules
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# What NOT to do — hard rules for ALL agents

Cross-cutting rules. Violating any of these breaks core invariants.

## 1. NEVER touch `tasktotime/` v1 wiki code

The migration is one-way: read v1, write v2. Do not edit
`tasktotime/spec/08-modules/wiki/`, do not modify `tasktotime/wiki*`
adapter files, do not refactor `WikiPage.tsx` in `tasktotime/`.

Once v2 cutover ships and v1 wiki is read-only legacy, eventual cleanup
is a separate PR after a 90-day soak window.

## 2. NEVER touch finance / time-tracking modules

Per `feedback_no_touch_time_finance` memory + CLAUDE.md §2.2. wiki-v2
does not import, read from, or write to finance / time-tracking. Receipt
OCR (Phase H) might one day link a wiki Materials entry to an expense
record, but only behind explicit Денис approval and a clear
`ExpenseLinkPort` boundary.

## 3. NEVER auto-apply AI writes without confirmation in v1 of capture

Capture flows (voice / photo / receipt) MUST have a confirmation step in
v1 (Phase C). Auto-apply with confidence gating is a v2 of capture and
requires calibration data.

## 4. NEVER bypass the audit log

Every write — human, AI, capture flow — emits an audit event via
`AuditLogPort`. No exceptions. The audit log is the basis for undo,
compliance, and debugging.

## 5. NEVER write across tenants

`companyId` filter is enforced at the application layer AND the adapter
layer AND the storage rule layer (defense in depth). A bug at any one
layer must not allow cross-tenant data leak.

## 6. NEVER store secrets in wiki content

If a user pastes an API key / password into a wiki, we don't strip it
(out of scope for v1) but we do not facilitate it either. Future Phase:
detect secrets via regex + warning banner. Until then, document this in
foreman onboarding.

## 7. NEVER skip the open-questions doc

When you (agent) hit an unresolved decision point not in
`decision-log.md`:
1. Add a question to `open-questions.md`.
2. Stop. Ask Денис.
3. Do NOT invent a default.

This is critical because portable architecture defaults compound across
future hosts.

## 8. NEVER deploy without Денис's explicit OK

Per CLAUDE.md §5. Even Phase A pure-types-only PRs need Денис's merge
+ the deploy command from him. No autonomous `firebase deploy`.

## 9. NEVER push to `main`

Branch + PR + review + merge + Денис deploys. Same workflow as
`tasktotime/`. Do not `git push origin main` directly.

## 10. NEVER `git push --force` to shared branches

If you need to rewrite history on your feature branch — only OK before
PR is opened. After PR is opened, no force-push.

## 11. NEVER add a port without contract test

Every port in `wiki-v2/ports/` has a corresponding contract test in
`tests/adapters/<adapter>.test.ts`. Adding a port without the test
shape leaves hosts unable to verify their adapter swap.

## 12. NEVER hardcode profit-step in `domain/` / `ports/` / `application/`

See [../08-portability/what-not-to-couple.md](../08-portability/what-not-to-couple.md)
for the full list. ESLint enforces; pre-commit hook fails CI.

## 13. NEVER ship a PR that breaks the portability invariants

Even if the feature is urgent. Portability is the whole point. If a port
needs to evolve to support a feature, evolve the port (with semver bump)
— don't smuggle a Firebase import into `domain/`.

## 14. NEVER promote half-baked content to L3

Per Q10, L3 promotion is review-gated. Even when it auto-promotes, the
AI summarisation step is required — never copy raw L2 content to L3.
L3 is institutional memory; junk poisoning compounds for years.

## 15. NEVER block on a single failing test in unrelated code

Pre-existing TS errors / failing CI checks (anti-loop tests, etc.) are
documented in CLAUDE.md §4 and don't block wiki-v2 work. But also do
not introduce NEW failures. Net change in test failure count must be
≤ 0 per PR.

---

When in doubt, ask Денис. The cost of asking is a 5-minute pause; the
cost of breaking these rules in a portable shared module is months of
cleanup.
