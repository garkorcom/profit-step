# Inventory of WIP commit `e4278e8`

**Full hash:** `e4278e8a889110927b8a7f8aebfd648aff1f2e1e`
**Author:** garkorcom <garkor.com@gmail.com>
**Date:** 2026-04-07 10:06 EDT
**Message:** `chore: WIP snapshot of feature/project-hierarchy-fix`
**Branch:** `feature/project-hierarchy-fix`

## TL;DR

290 files changed, +28,391 / −152,192 (most of the minus is deleted
`_old_estimator_backup/` binary assets).

This commit is a **catch-all snapshot** of uncommitted work that was
sitting in the working tree when Claude (this session) took over on
2026-04-07. It was NOT made atomically — it's a bundle of work from
a previous AI agent session.

**Author signature analysis:** the commit was made by `garkor.com@gmail.com`
(Денис's account), but based on the volume, style, and scattered
`IMPROVEMENTS.md` files, the actual work was almost certainly done by
an AI agent session that Денис ran. The commit was finalized as a
single snapshot by Claude (this session) to preserve the work before
continuing development.

The work is **well-structured** — it's a systematic modernization pass,
not random chaos. Themes are clearly separated and can be understood
from the file paths.

## Categorization (7 themes)

| # | Theme | Files | Impact | Status in branch after Claude's work |
|---|---|---|---|---|
| 1 | **Vite migration** | 8 | Build system swap | ✅ Applied, used by `npm run build` |
| 2 | **Generated audit docs** | 16 | Documentation only | ✅ Kept, non-functional |
| 3 | **Cleanup / reorganization** | 142 ops | Repo hygiene | ✅ Applied (overlaps with claude/confident-lewin's cleanup in worktree) |
| 4 | **Component extractions** (4 modules) | ~30 | Refactoring | ⚠️ Applied but has 13 tsc errors (now fixed in `fcda19e`) |
| 5 | **Client portal scaffold** | 9 | New feature | ✅ Built on in `84c408f` + `6089c0f` |
| 6 | **Backend service + route work** | ~20 | Backend changes | ⚠️ NOT deployed to Firebase Functions — still sitting in code |
| 7 | **Other UI modifications** | ~40 | Mixed | ⚠️ Not audited line-by-line; assumed safe, built on top |

Total: 290 distinct file operations.

---

## Theme 1: Vite Migration (8 files)

The project was migrated from Create React App (`react-scripts`) to
Vite. This is a build-system swap that affects every build/dev command.

### Added
- `vite.config.ts` (23 lines) — Vite config: React plugin, port 3000, output to `build/`, `@` path alias
- `src/vite-env.d.ts` (17 lines) — Vite env type declarations
- `index.html` (root) — Vite needs `index.html` at root (CRA used `public/index.html`)

### Modified
- `package.json` — scripts changed: `vite`, `vite build && node scripts/stamp-sw.js`, `vite preview`. Dependencies updated.
- `package-lock.json` — regenerated
- `tsconfig.json` — +13/-1 lines (likely `moduleResolution`, `jsx`, `types` for Vite)
- `src/react-app-env.d.ts` — probably updated or reduced (was CRA-specific)
- `jest.config.js` — probably adjusted for Vite's ESM handling
- `jest.setup.js` — same
- `.gitignore` — +3 lines (`.claude/worktrees/` added by this session)

### Status
**Works.** `vite build` runs in ~1.4s, outputs 521 files to `build/`, and
the deploy at `https://profit-step.web.app` is served from that output.

### Dependencies
This theme is **foundational** — everything else depends on Vite being
in place for the project to build. Cannot be removed without reverting
the entire commit.

### Known concerns
- **Env variables:** `.env` files had `REACT_APP_*` keys. Vite expects
  `VITE_*`. The vite.config.ts sets `envPrefix: 'VITE_'`, so existing
  `REACT_APP_*` won't be exposed. If anything in the code reads
  `process.env.REACT_APP_X`, it's broken now. **Not audited**.
- **`public/` folder:** Vite copies `public/` to `build/` automatically,
  so assets should still work.
- **`import.meta.env` vs `process.env`:** in Vite, env is on
  `import.meta.env.VITE_*`. Any code using `process.env.X` for runtime
  config will break. **Not audited**.

---

## Theme 2: Generated Audit Documents (16 files)

The previous agent did a full project audit and dropped 4 root-level
docs plus 12 per-directory `IMPROVEMENTS.md` files.

### Root-level audit docs (4)
- `ARCHITECTURE_DIAGRAM.md` (435 lines) — Mermaid diagram of user types,
  frontend modules, backend, data flow
- `AUDIT_REPORT.md` (221 lines) — Audit findings
- `DEVELOPER_GUIDE.md` (549 lines) — Onboarding guide
- `PROJECT_MAP.md` (644 lines) — File/module map

### Scattered `IMPROVEMENTS.md` (12)
- `docs/IMPROVEMENTS.md`
- `functions/IMPROVEMENTS.md`
- `functions/src/services/IMPROVEMENTS.md`
- `functions/src/triggers/IMPROVEMENTS.md`
- `public/IMPROVEMENTS.md`
- `scripts/IMPROVEMENTS.md`
- `src/IMPROVEMENTS.md`
- `src/api/IMPROVEMENTS.md`
- `src/components/IMPROVEMENTS.md`
- `src/hooks/IMPROVEMENTS.md`
- `src/pages/IMPROVEMENTS.md`
- `src/types/IMPROVEMENTS.md`

**Sample from `src/IMPROVEMENTS.md`:** contains sections like "🔴 Критические
→ Миграция CRA → Vite", "🟡 Среднесрочные → React Query", "Barrel Exports",
"TypeScript 4.9 → 5.x". It's a structured to-do list.

### Status
**Non-functional.** These files don't affect runtime behavior. They are
documentation artifacts.

### Dependencies
None. Can be deleted, kept, or moved to `docs/` without affecting anything.

### Recommendation
Either:
1. Move all 12 `IMPROVEMENTS.md` into a single `docs/improvements/` folder
   with subdirectories — easier to read as a whole
2. Extract the actionable items from each into a single `TODO.md`
3. Delete them — the useful parts can be re-derived from the codebase

**Recommendation:** keep them for now. They represent honest analysis and
point to real improvements (some of which this WIP commit already executed,
like Vite migration and barrel exports).

---

## Theme 3: Cleanup / Reorganization (142 operations)

Large-scale repo hygiene pass.

### Deletions (96)
- **`_old_estimator_backup/`** — 91 files, ~30 MB including:
  - Python source files (`blueprint_parser.py`, `langgraph_orchestrator.py`, etc.)
  - SQLite databases (`checkpoints.sqlite`, `qdrant_data/collection/construction_prices/storage.sqlite`)
  - Test blueprint JPEGs (page54, page67 tiles)
  - Old prompts, SKILL.md files, markdown docs
- `backup_v2_20260102_194903.tar.gz` — 944 KB tarball
- `firestore-debug.log`, `firestore.indexes.json.tmp` — debug artifacts
- `src/api/_deprecated_projectApi.ts` — old Firestore-direct API (this
  session's worktree deleted it too — overlap)
- `functions/src/scheduled/checkLongSessions.ts` — deleted scheduled
  function. **Worth reviewing** — was this a duplicate of something or
  dead code?

### Renames / Moves (43)
- **38 root markdowns** → `docs/legacy-nov2025/`
  - All the old setup guides, QA docs, deployment notes, etc.
  - Includes: `ANTI_LOOP_CI_CD_GUIDE.md`, `AUTH_MODULE_README.md`,
    `BUDGET_ALERTS_SETUP.md`, `CREATE_USER_WITH_HIERARCHY.md`,
    `DEFENSIVE_PROGRAMMING_GUIDE.md`, `DEPLOYMENT_GUIDE.md`,
    `DEPLOYMENT_SUCCESS.md`, `EMULATORS_TESTING.md`,
    `IMPLEMENTATION_SUMMARY.md`, `INFINITE_LOOP_FIX_SUMMARY.md`,
    `MIGRATION_PLAN_V2.md`, `MONITORING_STATUS.md`,
    `PAGINATION_MIGRATION_GUIDE.md`, `POST_DEPLOYMENT_SUMMARY.md`,
    `PRODUCTION_MONITORING_REPORT.md`, `QA_IMPLEMENTATION_COMPLETE.md`,
    `QA_README.md`, `QA_TEST_PLAN.md`, `QUICK_SETUP_GUIDE.md`,
    `SECURITY_IMPROVEMENTS.md`, `SETUP_BUDGET_LIMIT.md`,
    `SETUP_BUDGET_PROTECTION.sh`, `TEAM_MANAGEMENT_MODULE_README.md`,
    `TEST_BREVO_WEBHOOK.md`, `TEST_EMAIL.md`, `TEST_RESULTS_SUCCESS.md`,
    `TEST_V2_GUARDS.md`, `TODO_FUTURE_IMPROVEMENTS.md`,
    `V2_DEPLOYMENT_COMPLETE.md`, `artillery-load-test.yml`,
    `dnd-debug.ts`, `test-client.js`, `test-dnd.ts`, `test-email.html`,
    `test-guards-manual-simple.md`, `test-guards-quick.js`,
    `РЕАЛИЗОВАННЫЙ_ФУНКЦИОНАЛ.md`
- **6 `functions/*.js` debug scripts** → `functions/_debug_scripts/`:
  `check_sessions.js`, `investigate-victor.js`, `test_credentials.js`,
  `test_db.js`, `test_db2.js`, `test_db_final.js`
  - **Note:** `test_credentials.js` despite the name contains only
    Firebase admin SDK init code, no actual credentials. Safe.

### Modified (3 config files for cleanup)
- `.gitignore` — +3 lines (`.claude/worktrees/` — added by this session
  as part of bundling the WIP commit, but lives in this theme)

### Overlap with `claude/confident-lewin` branch
This session's worktree (`claude/confident-lewin`) ALSO did similar
cleanup independently:
- Deleted `_old_estimator_backup/` (same)
- Deleted `_deprecated_projectApi.ts` (same)
- Moved root markdowns → `docs/legacy/` (different folder name than
  the WIP's `docs/legacy-nov2025/`)

**Result:** in `feature/project-hierarchy-fix`, the markdowns are in
`docs/legacy-nov2025/`. In `claude/confident-lewin`, they're in
`docs/legacy/`. If those two branches are ever merged, there will be
rename conflicts to resolve.

### Status
**Applied.** All deletions and moves are live in the branch.

### Dependencies
- `.github/pull_request_template.md` references
  `DEFENSIVE_PROGRAMMING_GUIDE.md` at the old path. After this move,
  the link points to `docs/legacy-nov2025/DEFENSIVE_PROGRAMMING_GUIDE.md`.
  **The PR template was NOT updated to match the new path in this WIP.**
  The `claude/confident-lewin` branch fixed this for its own `docs/legacy/`
  path. In `feature/project-hierarchy-fix` the PR template is broken.

### Action needed
- Update `.github/pull_request_template.md` to reference
  `docs/legacy-nov2025/DEFENSIVE_PROGRAMMING_GUIDE.md` (one line change).

---

## Theme 4: Component Extractions (4 modules, ~30 files)

Four large page components were broken into feature folders with barrel
exports. This is a refactor — extract sub-components, types, and hooks
into per-module directories.

### 4.1. `src/components/cockpit/` (6 files, NEW)
Extracted from `UnifiedCockpitPage.tsx` (which is modified to import
from here).

- `BlueprintsTabContent.tsx` — blueprint tab UI
- `EstimatesTabContent.tsx` — estimates tab UI
- `WorkSessionsList.tsx` — sessions list component
- `cockpit.types.ts` — `CockpitUser`, `CockpitClient`, `CoAssignee`,
  blueprint section enums
- `useCockpitTask.ts` — custom hook
- `index.ts` — barrel

### 4.2. `src/components/bank-statements/` (10 files, NEW)
Extracted from `BankStatementsPage.tsx`.

- `BankAccountingReport.tsx`
- `BankAiPreview.tsx`
- `BankExportUtils.ts` — `exportCSV`, `exportPDF`, `exportDetailedCSV`,
  `exportCategorySummaryCSV`, `exportReportPDF`, `downloadScheduleC`
- `BankReceiptViewer.tsx`
- `BankReportPreview.tsx`
- `BankSplitDialog.tsx`
- `BankSummaryCards.tsx`
- `BankTransactionsTable.tsx`
- `bankStatements.types.ts`
- `useBankStatements.ts`
- `index.ts` — barrel with named exports

### 4.3. `src/components/estimator/` (5 files, NEW)
Extracted from `ElectricalEstimatorPage.tsx`.

- `ItemRow.tsx`
- `estimator.types.ts`
- `estimatorExport.ts` — **the file with the TS2352 URL→string error
  that this session fixed in `fcda19e`**
- `useEstimatorCalc.ts`
- `index.ts` — barrel

### 4.4. `src/components/siteDashboard/` (4 files, NEW)
Extracted from `SiteDashboardPage.tsx`.

- `SiteDashboardTabs.tsx` — **the file with 4 EstimateItem property
  errors that `fcda19e` fixed**
- `siteDashboard.types.ts`
- `useSiteDashboard.ts` — **the file with 5 `Record<string, unknown>[]`
  → typed array errors that `fcda19e` fixed**
- `index.ts` — barrel

### Modified page files that now import these
- `src/pages/crm/UnifiedCockpitPage.tsx` — uses `components/cockpit`
- `src/pages/crm/BankStatementsPage.tsx` — uses `components/bank-statements`
- `src/pages/estimates/ElectricalEstimatorPage.tsx` — uses
  `components/estimator` (has 3 unrelated tsc errors, also fixed in
  `fcda19e`)
- `src/pages/sites/SiteDashboardPage.tsx` — uses `components/siteDashboard`

### Status
**Applied, with type errors that this session fixed.** The extraction
was done but type-checking was never run against it (or the errors were
tolerated). 13 TS errors sat in these files until `fcda19e` resolved
them all via minimal type-only casts.

### Dependencies
- **Independent of each other** — the 4 modules don't cross-import
- **Each module depends on its parent page** — can't remove the
  extraction without also reverting the page's imports
- **Zero runtime changes** — these were pure code moves (with potentially
  minor adjustments to exported interfaces)

### Risk assessment
- **Bank-statements and cockpit modules are untested** by this session.
  The code exists and tsc passes, but no one ran the pages in the
  browser to verify that the extraction didn't break runtime behavior.
- **Estimator and siteDashboard** — same, but at least the tsc errors
  are fixed.
- **Manual QA recommended** before anyone relies on these pages in prod:
  open `/sites/:id`, `/crm/bank-statements`, `/crm/cockpit`, and the
  electrical estimator; verify everything still renders and works.

---

## Theme 5: Client Portal Scaffold (9 files)

The beginning of a client-facing portal at `/portal/:slug`. Loads
real Firestore data (not mocks), renders 5 tabs.

### Added
- `src/hooks/useClientPortal.ts` (198 lines) — hook that finds client
  by slug (O(n) full-collection scan — see SPEC.md §2.2 for risks),
  subscribes via `onSnapshot` to 4 collections (projects, estimates,
  gtd_tasks, project_ledger), loads photos from Storage
  `clients/{id}/photos/` with category parsing from filename prefixes
- `src/utils/slugify.ts` (13 lines) — `"Jim Dvorkin"` → `"jim-dvorkin"`
- `src/pages/portal/components/EstimateView.tsx` (307 lines) — line-item
  estimate with expandable rows, per-section comments + approval,
  **writes back to Firestore directly from the client** (via
  `updateDoc`, `addDoc`)
- `src/pages/portal/components/TimelineSlider.tsx` (121 lines) — slider
  through project phases
- `src/pages/portal/components/PaymentSchedule.tsx` (136 lines) —
  paid/pending/upcoming/overdue table + progress bar
- `src/pages/portal/components/PhotoGallery.tsx` (248 lines) — lightbox,
  render/before/progress category filters
- `src/pages/portal/components/InspectionsView.tsx` (181 lines) —
  upcoming + completed inspections

### Modified
- `src/pages/portal/ClientPortalPage.tsx` (341 lines after mod) — uses
  `useClientPortal`, filters internal estimates, builds project stages
  from tasks, builds payment schedule from ledger, builds inspections
  from tasks, renders 5 tabs

### Status
**Applied AND further refactored by this session in `84c408f` and
`6089c0f`.** All 5 components were moved to
`src/components/client-dashboard/sections/` via `git mv` (history
preserved) and renamed with `*Section` suffix. `ClientPortalPage.tsx`
was rewritten as a thin wrapper around the new `ClientDashboardLayout`.

### Dependencies
- **Required by this session's refactoring.** If any of these 9 files
  were removed from the WIP commit, `84c408f` would fail to apply.
- **Independent of Vite migration** (could theoretically work on CRA
  too), but the branch requires Vite to build.

### Known issues
- **No auth.** Any URL like `/portal/<slug>` is public.
- **No backend endpoint** — portal uses direct Firestore reads from
  the client. See SPEC.md §3 for the plan to move this behind an API.
- **O(n) slug lookup** — full clients collection scan on every portal
  open.
- **`estimateType: 'internal'` filter** relies on a field that may not
  be consistently set. **If not set, internal prices leak to clients.**
  See SPEC.md §6 question #3.
- **EstimateView writes to Firestore** without server-side validation.
  Any client with a portal link can write arbitrary data to the
  estimate's comments/approval fields.

---

## Theme 6: Backend Service + Route Work (~20 files)

### New
- `functions/src/services/TimeTrackingService.ts` — service-layer
  extraction for time tracking. Type, purpose not audited line-by-line.

### Modified (agent routes, 8 files)
All files in `functions/src/agent/routes/`:
- `clients.ts` — modifications (not audited for behavior change)
- `costs.ts`
- `estimates.ts`
- `inventory.ts`
- `projects.ts`
- `sites.ts`
- `tasks.ts`
- `timeTracking.ts` — likely uses the new `TimeTrackingService`

### Modified (agent schemas, 4 files)
All in `functions/src/agent/schemas/`:
- `estimateProjectSchemas.ts`
- `index.ts`
- `inventorySchemas.ts`
- `timeTrackingSchemas.ts`

### Modified (core backend, 3 files)
- `functions/src/index.ts` — function exports
- `functions/src/triggers/crons/autoCloseStaleSessions.ts` — cron
  trigger updated
- `functions/src/triggers/telegram/onWorkerBotMessage.ts` —
  **THE LIVE TELEGRAM BOT.** 1200+ lines of production code that bригадиры
  use daily. **Modifications here require careful review and emulator
  testing.**

### Built artifacts
- `functions/lib/index.js` — compiled JS
- `functions/lib/index.js.map` — source map

### Status
**Code is committed, NOT deployed.** This session deployed only
`firebase deploy --only hosting`. The backend changes in this theme
are sitting in the branch, not in production.

### Dependencies
- **`TimeTrackingService.ts`** is imported by `timeTracking.ts` route
  (assumption, not verified). If that's the case, removing the service
  breaks the route.
- **Schemas** likely shared across routes — removing one will ripple.
- **`onWorkerBotMessage.ts`** is in production. **Any change not tested
  in emulators = potential $10k loop bomb.** See `docs/legacy-nov2025/DEFENSIVE_PROGRAMMING_GUIDE.md`.

### Risk assessment
- **HIGH RISK.** This is the riskiest theme in the entire WIP. Backend
  functions affect billing, payroll, bot behavior, data integrity.
- **Zero backend tests exist in this project** (see CLAUDE.md §4), so
  the changes can't be automatically verified.
- **Recommendation before deploying:**
  1. Review each modified route file line-by-line
  2. Run `firebase emulators:start` and manually test changed endpoints
  3. Especially test `onWorkerBotMessage` flows: client selection,
     session start/stop, daily finish
  4. Check `autoCloseStaleSessions` cron didn't change behavior that
     would affect existing running sessions
  5. Do NOT deploy functions without Денис's explicit sign-off
- **If in doubt, revert backend changes** (theme 6) while keeping the
  rest of the branch.

---

## Theme 7: Other UI Modifications (~40 files)

Scattered modifications across the frontend. Not a clean theme — mix of
Vite compatibility patches, small feature additions, and unknown changes.

### API layer modified (7 files)
- `src/api/aiTaskApi.ts`
- `src/api/crmApi.ts`
- `src/api/erpV4Api.ts`
- `src/api/estimatesApi.ts`
- `src/api/taskApi.ts`
- `src/api/userDetailApi.ts`
- `src/api/userManagementApi.ts`

### Auth / core (3 files)
- `src/auth/AuthContext.tsx`
- `src/firebase/firebase.ts`
- `src/App.tsx` / `src/App.test.tsx`

### Hooks (4 files)
- `src/hooks/dashboard/useDashboardFinance.ts`
- `src/hooks/dashboard/useDashboardTime.ts`
- `src/hooks/useActiveSession.ts`
- `src/hooks/useAiTask.ts`
- `src/hooks/useGeoLocation.ts`
- `src/hooks/useVoiceInput.ts`

### Components (14 files)
Admin:
- `src/components/admin/OrgChartSelect.tsx`
- `src/components/admin/OrgTreeView.tsx`
- `src/components/admin/UserFormDialog.tsx`
- `src/components/admin/UserSlideOver.tsx`

CRM:
- `src/components/crm/BotLogsViewer.tsx`
- `src/components/crm/ClientTasksTab.tsx`
- `src/components/crm/CreateSessionDialog.tsx`
- `src/components/crm/EditSessionDialog.tsx`
- `src/components/crm/EmployeeDetailsDialog.tsx`
- `src/components/crm/LeadDetailsDialog.tsx`
- `src/components/crm/ProjectFilesTab.tsx`

Dashboard:
- `src/components/dashboard/AIReportsSection.tsx`
- `src/components/dashboard/widgets/FinanceWidget.tsx`
- `src/components/dashboard/widgets/TimeTrackingWidget.tsx`

Estimates:
- `src/components/estimates/AiMappingDialog.tsx`
- `src/components/estimates/BlueprintUploadDialog.tsx`
- `src/components/estimates/EstimatorLangGraphUI.tsx`

GTD:
- `src/components/gtd/DynamicFormField.tsx`
- `src/components/gtd/GTDEditDialog.tsx`
- `src/components/gtd/GTDFilterBuilder.tsx`

Layout / other:
- `src/components/common/LocationPicker.tsx`
- `src/components/layout/Header.tsx`
- `src/components/projects/ProjectTimeLapse.tsx`
- `src/components/rbac/PermissionMatrix.tsx`
- `src/components/time-tracking/TimeTrackingAnalytics.tsx`

### Pages (16 files)
- `src/pages/DevIndexPage.tsx`
- `src/pages/InfraMapPage.tsx`
- `src/pages/admin/CompaniesPage.tsx`
- `src/pages/admin/CompanyDashboard.tsx`
- `src/pages/admin/TeamAdminPage.tsx`
- `src/pages/crm/BankStatementsPage.tsx` (uses new bank-statements module)
- `src/pages/crm/ClientsPage.tsx`
- `src/pages/crm/CostsReportPage.tsx`
- `src/pages/crm/DealsPage.tsx`
- `src/pages/crm/FinancePage.tsx`
- `src/pages/crm/GTDCreatePage.tsx`
- `src/pages/crm/InventoryPage.tsx`
- `src/pages/crm/LeadDetailsPage.tsx`
- `src/pages/crm/ReconciliationPage.tsx`
- `src/pages/crm/UnifiedCockpitPage.tsx` (uses new cockpit module)
- `src/pages/dashboard/client/[id].tsx` — **THE INTERNAL CLIENT DASHBOARD.**
  677 lines. Connected to real data via `crmApi`, Firestore subscriptions,
  inventory transactions, photos. This was modified by the previous agent
  to use real data instead of hardcoded mocks.

  **Conflict:** the `claude/confident-lewin` branch has a DIFFERENT
  rewrite of this same file (451 lines, different structure). If these
  branches are merged, manual conflict resolution required. See SPEC.md
  Phase 3 for the plan to convert this file into a wrapper around
  `ClientDashboardLayout`.
- `src/pages/debug/SystemHealthCheck.tsx`
- `src/pages/estimates/ElectricalEstimatorPage.tsx` (uses estimator module; 3 tsc errors fixed in `fcda19e`)
- `src/pages/estimates/EstimateBuilderPage.tsx`
- `src/pages/estimates/EstimateDetailPage.tsx`
- `src/pages/estimates/EstimatesPage.tsx`
- `src/pages/sites/SiteDashboardPage.tsx` (uses siteDashboard module)

### Types (2 files)
- `src/types/estimate.types.ts`
- `src/types/gtd.types.ts`

### Router
- `src/router/AppRouter.tsx` — likely new routes (e.g. InventoryPage)

### Features
- `src/features/inventory/inventoryService.ts`
- `src/features/shopping/services/shoppingService.ts`
- `src/features/shopping/views/ReceiptsTabView.tsx`

### Status
**Applied, NOT audited line-by-line.** This theme is a collection of
changes that were made alongside the other themes. Many are probably
Vite compatibility patches (e.g., `process.env.X` →
`import.meta.env.VITE_X`). Others might be new features.

### Dependencies
- Depends on Vite (theme 1) for the build to work
- Page files that use barrel-exported modules depend on theme 4
- `[id].tsx` conflicts with `claude/confident-lewin`'s version

### Recommendation
- **Before merging to main:** spot-check at least these high-impact files:
  - `src/auth/AuthContext.tsx` (auth state)
  - `src/firebase/firebase.ts` (Firebase init)
  - `src/api/crmApi.ts` (core API)
  - `src/pages/dashboard/client/[id].tsx` (internal dashboard, conflict zone)
  - `src/components/dashboard/widgets/FinanceWidget.tsx` (money-sensitive)
  - `src/components/dashboard/widgets/TimeTrackingWidget.tsx` (payroll-sensitive)

---

## Dependency Graph

```
     Vite migration (1)
          │
          ▼
┌─────────────────────────────────────────────┐
│ Build system — everything depends on it    │
└─────────────────────────────────────────────┘
          │
          ├──► Theme 2 (docs) — independent, non-functional
          │
          ├──► Theme 3 (cleanup) — independent of everything
          │
          ├──► Theme 4 (component extractions)
          │         │
          │         ├──► cockpit/ ──► UnifiedCockpitPage.tsx
          │         ├──► bank-statements/ ──► BankStatementsPage.tsx
          │         ├──► estimator/ ──► ElectricalEstimatorPage.tsx
          │         └──► siteDashboard/ ──► SiteDashboardPage.tsx
          │
          ├──► Theme 5 (client portal)
          │         │
          │         ├──► useClientPortal.ts
          │         ├──► slugify.ts
          │         └──► portal/components/*.tsx ◄── SESSION'S 84c408f, 6089c0f DEPEND ON THIS
          │
          ├──► Theme 6 (backend)
          │         │
          │         ├──► TimeTrackingService.ts ──► timeTracking.ts route
          │         └──► routes/*, schemas/*, bot, cron
          │
          └──► Theme 7 (other UI)
                    │
                    └──► everything imports everything
```

### Session's commits dependencies
- `84c408f` (git mv portal components) **requires** files from theme 5
- `6089c0f` (ClientDashboardLayout) **requires** 84c408f
- `fcda19e` (tsc fixes) **requires** files from theme 4 and theme 7
- `1ec75a1` (docs) — **independent**, touches only `CLAUDE.md` and `SPEC.md`

### Minimum set to preserve session's work
If you wanted to retroactively split `e4278e8` and keep only the parts
needed for subsequent commits to apply, the minimum keep-set is:

**Must keep:**
- Theme 1: Vite migration (all 8 files) — build depends on it
- Theme 5: Client portal (all 9 files) — `84c408f` git mvs them
- Theme 4: Component extractions — cockpit/, bank-statements/, estimator/, siteDashboard/ (all ~30 files) — `fcda19e` fixes errors in them
- Theme 7 subset: `ElectricalEstimatorPage.tsx`, `SiteDashboardPage.tsx` (page files that import the extracted modules)

**Can probably drop (if you want a smaller WIP):**
- Theme 2: all generated docs and IMPROVEMENTS.md (~16 files)
- Theme 3: most cleanup — can be done separately
- Theme 6: backend work — ideally in a separate commit
- Theme 7 remainder: ~30 files of scattered UI changes

**Caveats:**
- Splitting would require interactive rebase with per-file staging
- Intermediate commits need to at least build (risky)
- Not recommended unless there's a specific reason (e.g., separating
  backend changes into their own commit for isolated deploy)

---

## Flagged Concerns

### 🔴 Critical
1. **`functions/src/triggers/telegram/onWorkerBotMessage.ts` modified.**
   Live production bot. No tests. Not verified. Deploying this to
   functions without emulator testing risks breaking daily bot flows
   used by field workers.

2. **`functions/src/index.ts` modified.** Function exports. Changing
   these could unpublish or rename deployed functions, causing 404s
   for callers.

3. **`functions/src/agent/routes/timeTracking.ts` modified.** Payroll-
   sensitive logic. No tests. Changes here could silently produce wrong
   salary calculations.

4. **Client portal has no auth.** Anyone with URL sees client finances.
   `useClientPortal.ts` does direct Firestore reads with no
   authorization layer. **Must be fixed before any real client receives
   a link.**

5. **`estimateType: 'internal'` filter is the ONLY thing preventing
   internal cost columns from leaking to clients.** If this field isn't
   set in Firestore data consistently, the filter is a no-op and
   clients see "наша цена" columns.

### 🟡 Important
6. **PR template still points to old `DEFENSIVE_PROGRAMMING_GUIDE.md`
   path.** One-line fix; affects every new PR description.

7. **`.env` → Vite env migration not audited.** Any
   `process.env.REACT_APP_X` reference in the code is now undefined
   at runtime.

8. **13 TS errors in extracted modules** — this session fixed them via
   `fcda19e`, but the root cause (lack of type-checking in the WIP
   work) means similar errors could reappear in any future extraction.

9. **Two parallel versions of `src/pages/dashboard/client/[id].tsx`**
   exist in different branches. Merging requires manual conflict
   resolution.

### 🟢 Minor
10. **Duplicate directory names for legacy docs.** Main branch has
    `docs/legacy-nov2025/`, worktree has `docs/legacy/`. Decide which
    is canonical before merge.

11. **IMPROVEMENTS.md scattered across 12 directories.** Cosmetic clutter,
    but actionable. Consider consolidating.

12. **`functions/_debug_scripts/` is committed but should probably be
    gitignored.** Debug scripts don't need version control.

---

## Recommendations

### If merging to main as-is (via squash merge)
1. ✅ Fix PR template path (`docs/legacy-nov2025/DEFENSIVE_PROGRAMMING_GUIDE.md`)
2. ✅ Audit `.env` variable migration (grep for `process.env.REACT_APP_` in src/)
3. ⚠️ DO NOT deploy functions (`firebase deploy --only functions`) without:
   - Running `firebase emulators:start` + manual bot test
   - Reviewing `onWorkerBotMessage.ts` diff line-by-line
   - Reviewing `timeTracking.ts` route changes line-by-line
4. ✅ Hosting is already deployed (2026-04-07, current session)
5. ⚠️ Manual smoke test these pages in prod after merge:
   - `/sites/:id` (siteDashboard extraction)
   - `/crm/bank-statements` (bank-statements extraction)
   - `/crm/cockpit` (cockpit extraction)
   - `/estimates/electrical` (estimator extraction)
   - `/portal/:slug` (portal scaffold)
   - `/dashboard/client/:id` (internal dashboard)

### If splitting into thematic commits (NOT recommended)
See §"Minimum set" above. Risk is high and benefit is cosmetic.

### If reverting specific themes
- **To revert backend (theme 6):** `git checkout be3ae59 -- functions/`
  then commit. This is relatively safe — backend work is isolated.
- **To revert component extractions (theme 4):** much harder, because
  the page files (theme 7) import from the extracted modules. Would
  need to revert both.
- **To revert portal scaffold (theme 5):** impossible without reverting
  session's `84c408f` and `6089c0f` too.
- **To revert Vite migration (theme 1):** impossible without reverting
  essentially everything. Vite is now baseline.

---

## Metadata

**Inventory created:** 2026-04-07, current Claude session
**Method:** `git show --name-status e4278e8` + targeted reads of
sample files for theme identification
**Files NOT read in full:** ~250 out of 290 — analysis is path-based,
not line-by-line diff review. Consider this a map, not an audit.
**Confidence:** HIGH for themes 1, 3, 5 (well-understood), MEDIUM for
themes 2, 4 (structure clear, contents skimmed), LOW for themes 6, 7
(file list known, behavior not verified).

**Next update trigger:** when the branch is either merged, split, or
abandoned. Add a section "Resolution: [what happened]".
