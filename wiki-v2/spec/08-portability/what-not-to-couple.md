---
title: 8.3 What NOT to couple
parent: TZ_WIKI_V2.md
last_updated: 2026-04-30
version: 0.1
---

# What NOT to couple

Specific anti-patterns that destroy portability if not blocked early.

## Imports that must NEVER appear in `domain/`, `ports/`, `application/`, `ui/`

| Forbidden import | Why |
|---|---|
| `firebase` / `firebase-admin` | Storage / DB-specific. Host may use Postgres. |
| `@firebase/*` | Same as above. |
| `@google-cloud/*` | GCP-specific. |
| `@mui/material` (in domain/ports/application — UI may import) | Domain shouldn't know about MUI. |
| `react` / `react-dom` (in domain/ports/application) | Application is framework-agnostic. |
| `tasktotime/...` | Sibling module; coupling kills standalone. |
| `../src/...` (any profit-step source) | Same as above. |
| `axios` / `node-fetch` | Use injected `HttpPort` if HTTP needed. |
| `dotenv` / `process.env` | Config injected via factory at composition root. |

ESLint rule (planned, in `wiki-v2/eslint/`):

```js
// no-restricted-imports for domain/, ports/, application/, ui/
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        "firebase", "firebase-admin", "firebase-admin/*",
        "@firebase/*", "@google-cloud/*",
        "tasktotime/*", "../../src/*", "../../../src/*"
      ]
    }]
  }
}
```

(UI directory has a relaxed version that allows MUI / React — they're
declared peer deps.)

## Anti-patterns in code

### 1. Embedding profit-step IDs in default values

```ts
// BAD
const DEFAULT_COMPANY_ID = '2o5AYClHAnSKL7wISVgz5vG9aS32'; // Денис's tenant

// GOOD
function createWiki(input: { companyId: string }) { ... }
```

### 2. Hardcoded URLs

```ts
// BAD
const API_BASE = 'https://us-central1-profit-step.cloudfunctions.net/agentApi';

// GOOD — host provides via factory:
function createWikiApi({ apiBase }: { apiBase: string }) { ... }
```

### 3. Direct Firestore queries in domain

```ts
// BAD — in domain/
import { Firestore } from 'firebase-admin/firestore';
async function findWiki(db: Firestore, ...) { ... }

// GOOD — port
interface WikiRepositoryPort {
  findOne(key: WikiKey): Promise<Wiki | null>;
}
```

### 4. Stylistic profit-step branding

```tsx
// BAD — in ui/
<Box sx={{ bgcolor: '#007AFF' /* Денис's blue */ }}>

// GOOD — theme tokens injected
<Box sx={{ bgcolor: theme.palette.primary.main }}>
```

### 5. Time / locale assumptions

```ts
// BAD
const TIMEZONE = 'America/New_York';  // Tampa, but other hosts may not be

// GOOD — injected at composition root
function buildDateFormatter({ timezone }: { timezone: string }) { ... }
```

### 6. Hardcoded section keys

```ts
// BAD
const SECTIONS = ['materials', 'decisions', 'blockers', 'photos'];

// GOOD — extensible
type SectionKey = string;
const REGISTERED_KEYS = new Set<SectionKey>([...]);
function registerSectionKind(key: SectionKey, schema: Schema) { ... }
```

### 7. Bot platform assumptions

```ts
// BAD — application/
import { Telegraf } from 'telegraf';

// GOOD — port
interface NotifyPort { push(input: NotifyInput): Promise<void> }
// Telegraf-specific code lives in adapters/telegram-capture/
```

### 8. AI provider in application layer

```ts
// BAD — application/
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GOOD — port + adapter
interface AnthropicEnhancePort { ... }
// AnthropicEnhanceAdapter is in adapters/anthropic/
```

## Enforcement

- ESLint rule blocks restricted imports — fails CI.
- AST test scans `domain/` and `ports/` directories — fails CI.
- Code review checklist (in PR template) includes "No profit-step
  coupling introduced".
- The contract tests in `tests/adapters/` ensure each adapter satisfies
  its port without leaking implementation details up.

## When in doubt

Ask: "If a host implements this with Postgres + S3 + OpenAI instead of
Firebase + GCS + Anthropic, does this code still work without
modification?"

If "yes" → keep as-is.
If "no" → push to an adapter, define a port if missing.
