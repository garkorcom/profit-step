---
title: 8.2 Extract wiki-v2 to an npm package
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# Extract wiki-v2 to an npm package

Recipe for the day a "second customer" wants to ship wiki-v2 standalone.

## When to extract

Triggered by:
- Second project (real or simulated) starts integrating wiki-v2.
- Profit-step itself wants to bump wiki-v2 deps independently of the
  monorepo.
- Open-source / commercial publishing decision.

Until any of those, wiki-v2 lives in-tree at `wiki-v2/`. Extraction is a
1-2 day operation if portability invariants have been respected.

## Pre-flight checklist

Before extracting, verify (the portability acceptance criteria from
[architecture-decision.md](../01-overview/architecture-decision.md)):

- [ ] `domain/` and `ports/` have zero imports from `firebase`,
      `firebase-admin`, `@mui`, `react`, `tasktotime/`, profit-step paths.
- [ ] ESLint `no-restricted-imports` rule still in place.
- [ ] AST test `tests/portability.test.ts` passes.
- [ ] All adapters have contract tests in `tests/adapters/`.
- [ ] No spec doc references "profit-step" specifics in wire types or
      domain — only adapters do.
- [ ] No `console.log("[profit-step]")` style branding in
      `domain/`/`ports/`/`application/`/`ui/`.

## Extract steps

1. **Copy the folder** to a new repo `wiki-v2-package/`.
   ```bash
   git subtree split --prefix=wiki-v2 -b wiki-v2-extract
   git push -o ${NEW_REPO}.git wiki-v2-extract:main
   ```
   `git subtree split` preserves history.

2. **Add package.json:**
   ```json
   {
     "name": "@profit-step/wiki-v2",
     "version": "0.1.0",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "exports": {
       ".": "./dist/index.js",
       "./domain": "./dist/domain/index.js",
       "./ports": "./dist/ports/index.js",
       "./application": "./dist/application/index.js",
       "./ui": "./dist/ui/index.js"
     },
     "peerDependencies": {
       "react": ">=19",
       "@mui/material": ">=7"
     },
     "dependencies": { /* only domain-pure deps: zod, etc. */ }
   }
   ```
   Adapters are NOT exported by default. They become a separate
   reference-only export `@profit-step/wiki-v2/adapters-firestore` etc.,
   which hosts may copy or import explicitly.

3. **TypeScript config:** ship `dist/` with declarations. `tsc -d` in
   build step.

4. **Delete profit-step adapters from the package** (or move them to
   `examples/profit-step/`).
   Hosts implement their own adapters; the published package contains
   pure ports + domain + application + UI.

5. **Update profit-step** to import from the package instead of the
   in-tree folder:
   ```ts
   - import { CreateWiki } from '../../wiki-v2/application';
   + import { CreateWiki } from '@profit-step/wiki-v2/application';
   ```

6. **Move profit-step adapters** to profit-step source tree (e.g.
   `src/wiki-v2-adapters/`).

7. **Verify** in profit-step that everything still works after the swap.

## Versioning post-extract

- `0.x` until first second-customer ship — breaking changes allowed.
- `1.0.0` when API stabilises — semver from then on.
- Major = breaking port changes. Hosts pin major version.

## What to publish vs keep private

| Artifact | Publish? |
|---|---|
| `domain/`, `ports/`, `application/`, `shared/` | Yes (the core) |
| `ui/` | Yes (React components) |
| `adapters/` | No — reference only, hosts implement their own |
| `tests/` | Optionally — contract tests are useful for hosts |
| `spec/` | Yes — this is documentation; ship as `docs/` |

## Migration cost estimate

| Task | Time |
|---|---|
| `git subtree split` + new repo init | 30 min |
| package.json + tsc setup | 1 hour |
| Verify ESLint rules + portability tests | 30 min |
| Update profit-step imports | 1 hour |
| Move profit-step adapters out | 2 hours |
| Smoke test profit-step against published package | 2 hours |
| Documentation update | 1 hour |

**Total: 1 working day** if portability invariants were respected. If
they weren't, allow 2-3 days for cleanup.

## After extraction — host integration cost

For a NEW host project that wants to consume `@profit-step/wiki-v2`:

| Task | Time |
|---|---|
| Implement 12 adapters | 2-3 days |
| Wire composition root | 2 hours |
| UI integration in their app shell | 2-4 hours |
| Run contract tests, fix any issues | 1 day |

**Total: ~1 week** for a new host. Compares favourably to "build a
wiki module from scratch" (4-6 weeks).
