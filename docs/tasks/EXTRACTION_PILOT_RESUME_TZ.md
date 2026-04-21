# ТЗ: Resume 2-day extraction pilot

> **Статус:** IN_PROGRESS (Day 1 50% готово)
> **Дата paused:** 2026-04-20 (из-за context limit)
> **Parent plan:** [`MODULE_EXTRACTION_PLAN.md`](./MODULE_EXTRACTION_PLAN.md) §13
> **Для:** resume через `/pickup` или новую Claude Code сессию с чистым контекстом

---

## 0. Что это

2-day pilot тестирует подход extraction 4 модулей (USER/TIME/CLIENT/MONEY) из монорепо. Первый шаг — создать `packages/shared/` + `packages/contracts/`, перенести phone util в shared, заменить **один** direct Firestore cross-read в `timeTracking.ts` на адаптер через UserService interface.

**Если pilot проходит за 2 дня без major surprise — можно коммитить на полный Phase 0 (2-3 недели).**

---

## 1. Текущее состояние (что уже сделано)

### ✅ Done (Day 1, 50%)

**Git:**
- Worktree: `/Users/denysharbuzov/Projects/profit-step/.claude/worktrees/extraction-pilot`
- Branch: `claude/extraction-pilot` (tracks `origin/main`)
- Baseline commit: `dc5bd86` (origin/main 2026-04-20)
- Backup tag: `archive/pre-extraction-pilot-2026-04-20` (pushed to origin)
- Local backups: `backups/pre-extraction-pilot-2026-04-20/` (gitignored, local-only)

**Files created:**
- `packages/shared/src/utils/phone.ts` — combined `normalizePhone` + `formatPhoneDisplay` + `looksLikePhone`
- `packages/shared/src/index.ts` — barrel export
- `packages/shared/package.json` — name `@profit-step/shared`, v0.1.0, private, main points to `src/index.ts`
- `packages/shared/tsconfig.json` — standalone TS config

**Files modified:**
- `tsconfig.json` (root) — added `baseUrl: "."`, `paths: { "@profit-step/shared": ["packages/shared/src"], "@profit-step/shared/*": ["packages/shared/src/*"] }`, `include` расширен `packages/shared/src`
- `vite.config.ts` — alias `'@profit-step/shared': path.resolve(__dirname, './packages/shared/src')`
- `functions/tsconfig.json` — те же paths + rootDirs + include `../packages/shared/src`
- `src/utils/phone.ts` — теперь re-export `export { normalizePhone, formatPhoneDisplay, looksLikePhone } from '@profit-step/shared';`
- `functions/src/agent/utils/phone.ts` — re-export `export { normalizePhone, looksLikePhone } from '@profit-step/shared';`

**Deps installed:**
- `cd functions && npm install` завершён успешно (49 vulnerabilities warning, безопасно игнорировать — не в scope pilot)

### ⏳ Blocked / not verified
- `cd functions && npm run build` — **не запущен** после npm install. Нужно убедиться что TS path aliases резолвятся и build проходит.
- Vite build — **не запущен**. Нужен `npm install` в root worktree (~несколько минут + несколько ГБ).
- Tests — не запущены.

---

## 2. Что нужно сделать (Day 1 оставшееся + Day 2)

### Day 1 finish (~30 мин)

1. **Build functions** — критически важно. В worktree:
   ```bash
   cd /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/extraction-pilot/functions
   npm run build 2>&1 | tail -30
   ```
   **Ожидаемо:** `tsc` проходит без ошибок. Shared path alias должен резолвиться.
   **Если упадёт:** скорее всего проблема с `rootDirs` или `include` в `functions/tsconfig.json`. Поправить пока `tsc --traceResolution` не покажет что `@profit-step/shared` находится.

2. **Vite install + build frontend** (опционально, для полноты pilot):
   ```bash
   cd /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/extraction-pilot
   npm install   # ~5-10 мин
   npm run build 2>&1 | tail -10
   ```
   Альтернатива чтобы не ставить полные node_modules: symlink из main repo:
   ```bash
   ln -s /Users/denysharbuzov/Projects/profit-step/node_modules node_modules
   npm run build 2>&1 | tail -10
   ```

3. **Убедиться что phone re-export работает** — grep использований:
   ```bash
   grep -rn "import.*from.*['\"].*utils/phone['\"]" src/ functions/src/ | head
   ```
   Существующие импорты (например `from '../utils/phone'`) должны работать через re-export shim.

### Day 2 (4-6h по плану)

#### Task D2.1 — Create `packages/contracts/` с UserService interface

Создать новый package по образцу shared:
```
packages/contracts/
├── src/
│   ├── UserService.ts       ← interface + User type + UserIdSchema
│   ├── index.ts             (barrel)
├── package.json             (name: @profit-step/contracts, v0.1.0, private)
└── tsconfig.json            (standalone, references shared)
```

`UserService.ts` содержит минимум:
```typescript
export type UserId = string & { __brand: 'UserId' };

export interface User {
  id: UserId;
  email: string;
  displayName: string;
  role: 'admin' | 'manager' | 'foreman' | 'worker' | 'driver' | 'guest';
  companyId: string;
  hourlyRate?: number;
  telegramId?: string;
}

export interface UserService {
  getUser(id: UserId): Promise<User | null>;
  getHourlyRate(id: UserId): Promise<number | null>;
  resolveFromTelegramId(telegramId: string): Promise<User | null>;
}
```

Обновить `tsconfig.json` + `vite.config.ts` + `functions/tsconfig.json` — добавить paths для `@profit-step/contracts` (по аналогии с shared).

#### Task D2.2 — UserFirestoreAdapter

В `functions/src/agent/services/userFirestoreAdapter.ts`:
```typescript
import type { UserService, User, UserId } from '@profit-step/contracts';
import * as admin from 'firebase-admin';

function toUser(doc: admin.firestore.DocumentSnapshot): User {
  const data = doc.data() || {};
  return {
    id: doc.id as UserId,
    email: data.email || '',
    displayName: data.displayName || '',
    role: data.role || 'guest',
    companyId: data.companyId || '',
    hourlyRate: data.hourlyRate,
    telegramId: data.telegramId ? String(data.telegramId) : undefined,
  };
}

export class UserFirestoreAdapter implements UserService {
  private db = admin.firestore();

  async getUser(id: UserId): Promise<User | null> {
    const doc = await this.db.collection('users').doc(id).get();
    return doc.exists ? toUser(doc) : null;
  }

  async getHourlyRate(id: UserId): Promise<number | null> {
    const user = await this.getUser(id);
    return user?.hourlyRate ?? null;
  }

  async resolveFromTelegramId(telegramId: string): Promise<User | null> {
    const snap = await this.db.collection('users')
      .where('telegramId', '==', telegramId)
      .limit(1).get();
    if (snap.empty) {
      // fallback to number
      const snap2 = await this.db.collection('users')
        .where('telegramId', '==', Number(telegramId))
        .limit(1).get();
      if (snap2.empty) return null;
      return toUser(snap2.docs[0]);
    }
    return toUser(snap.docs[0]);
  }
}
```

#### Task D2.3 — Replace ONE cross-read in timeTracking.ts

Цель: найти **один** `db.collection('users').doc(...).get()` в `functions/src/agent/routes/timeTracking.ts` и заменить на `userService.getUser(id)`.

**Strategy:**
1. `grep -n "db.collection('users')" functions/src/agent/routes/timeTracking.ts` — найти все 8 мест
2. Выбрать самое простое (hourlyRate lookup, например)
3. В начале routes файла инициализировать адаптер:
   ```typescript
   import { UserFirestoreAdapter } from '../services/userFirestoreAdapter';
   import type { UserId } from '@profit-step/contracts';
   const userService = new UserFirestoreAdapter();
   ```
4. Заменить один call на `userService.getHourlyRate(userId as UserId)`
5. Не ломать сигнатуры других routes (остальные 7 оставить как есть — они в scope Phase 0, не pilot)

#### Task D2.4 — Build + tests

```bash
cd functions
npm run build             # tsc должен пройти
npm test -- --testPathPattern=timeTracking 2>&1 | tail -20   # не должно регрессий
```

---

## 3. Merge + deploy

### Pre-flight checklist
- [ ] Phone re-export работает — старые импорты не сломаны
- [ ] functions build проходит без ошибок
- [ ] timeTracking tests passing
- [ ] Vite build проходит (если ставили root deps)
- [ ] Git diff показывает только pilot scope (~15 files touched)

### Commit + PR + merge

```bash
cd /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/extraction-pilot

# Проверка что нет случайных файлов
git status --short

git add -A
git commit -m "feat(architecture): extraction pilot — @profit-step/shared + UserService contract + first adapter call

Day 1: created packages/shared/ with phone utility, path aliases in root +
functions tsconfig + vite config. src/utils/phone.ts and
functions/src/agent/utils/phone.ts are now re-exports from shared.

Day 2: created packages/contracts/ with UserService interface,
UserFirestoreAdapter implementation in functions/src/agent/services/,
and replaced one direct db.collection('users') read in timeTracking.ts
with userService call.

Validates the extraction approach works for this codebase. See
docs/tasks/MODULE_EXTRACTION_PLAN.md §13 for pilot context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git push -u origin claude/extraction-pilot

# Create PR
gh pr create --title "Extraction pilot — @profit-step/shared + UserService contract" \
  --body "$(cat <<'EOF'
## Summary

2-day extraction pilot per [MODULE_EXTRACTION_PLAN.md §13](docs/tasks/MODULE_EXTRACTION_PLAN.md).

- Created `packages/shared/` — canonical location for cross-module utils (phone for now, more per Phase 0)
- Created `packages/contracts/` — interface-first for service boundaries
- One `db.collection('users')` call in `timeTracking.ts` replaced with `UserService` adapter — proof of concept

## Why

Before committing to 3-month Phase 0, validate the mechanics work: TS path aliases, re-export shims for backwards compat, Firestore adapter pattern.

## Test plan

- [x] functions build passes
- [x] phone re-export backwards-compatible with existing imports
- [x] timeTracking tests pass after adapter change

## Rollback

Tag \`archive/pre-extraction-pilot-2026-04-20\` + local backups in \`backups/pre-extraction-pilot-2026-04-20/\`.
EOF
)"

# Merge squash
gh pr merge --squash --auto
```

### Deploy

```bash
cd /Users/denysharbuzov/Projects/profit-step
git checkout main
git pull
cd functions && npm run build
firebase deploy --only functions:agentApi   # timeTracking routes внутри agentApi
```

### Verify

```bash
# Hit one timeTracking endpoint and confirm it still works
curl -s -H "Authorization: Bearer $(awk -F= '/^AGENT_API_KEY=/ {print $2}' functions/.env | tr -d '"')" \
  https://us-central1-profit-step.cloudfunctions.net/agentApi/api/time-tracking/active-all | head
```

Должно вернуть 200 + JSON с активными сессиями.

---

## 4. Go / No-Go критерии (для решения о Phase 0)

### ✅ GREEN (go ahead Phase 0)
- Все 4 build (functions TS, vite, shared tsc, contracts tsc) проходят
- Phone re-export не ломает existing imports
- UserService adapter call работает идентично direct Firestore read (diff = 0)
- Deploy + smoke test успешны
- **Total effort не превысил 2 дня**

### 🟡 YELLOW (reconsider strategy)
- Build проходит, но потребовалось significant tweaking of tsconfig/vite
- Tests проходят, но медленнее на 20%+
- Pilot занял 3-4 дня вместо 2

В этом случае: документировать tweaks, упростить план Phase 0 (возможно skip branded types или сложные interface validation).

### 🔴 RED (stop, replan)
- Build не проходит даже после нескольких часов debug
- TS path aliases не работают с Vite/Functions одновременно
- Re-export ломает существующие импорты
- Pilot занял 5+ дней

Fallback: переключиться на подход «модуляризация в `src/modules/*` без отдельных packages» (см. `MODULE_EXTRACTION_PLAN.md §9.3`).

---

## 5. Rollback instructions

Если pilot провалился и нужно откатить:

```bash
cd /Users/denysharbuzov/Projects/profit-step

# Close + delete branch
gh pr close <PR_NUMBER> --delete-branch

# Remove worktree
git worktree remove --force .claude/worktrees/extraction-pilot

# Нет нужды что-то в main восстанавливать — он нетронут
# Tag archive/pre-extraction-pilot-2026-04-20 остаётся для ссылок
```

Если merged в main но прод сломался:
```bash
cd /Users/denysharbuzov/Projects/profit-step
git revert <merge_commit_sha>
git push
cd functions && npm run build
firebase deploy --only functions:agentApi
```

Deploy отката = 2 минуты.

---

## 6. Files referenced

- `docs/tasks/MODULE_EXTRACTION_PLAN.md` — полный плана extraction (parent)
- `docs/tasks/MODULE_EXTRACTABILITY_AUDIT.md` — aудит текущего состояния
- `docs/tasks/PIPELINE_FOLLOWUPS_TZ.md` — что в бэклоге pipeline (не pilot scope)
- `docs/ONBOARDING.md` — как поднимать новую машину (secrets via Secret Manager)
- `CLAUDE.md` §3.1 — `/pickup` workflow

---

## 7. Fast-start для new Claude session

```bash
# 1. Войти в worktree
cd /Users/denysharbuzov/Projects/profit-step/.claude/worktrees/extraction-pilot

# 2. Проверить состояние
git status
git log --oneline -3

# 3. Убедиться что deps есть
ls functions/node_modules/@firebase/app 2>&1
# Если пусто: cd functions && npm install

# 4. Запустить build — первый тест
cd functions && npm run build 2>&1 | tail -20

# 5. Если build зелёный — Day 2 по §2.Day 2
#    Если build упал — отдебагать по §2.Day 1 finish

# 6. После Day 2 — §3 merge + deploy
```

**Важно:** все ссылки на файлы в этом ТЗ относительны к `/Users/denysharbuzov/Projects/profit-step/` (корню монорепо). worktree имеет те же пути относительно своего корня.

---

## 8. Acceptance criteria всего pilot

- [ ] `packages/shared/src/utils/phone.ts` — canonical location, combined helpers
- [ ] `packages/contracts/src/UserService.ts` — interface + User type + branded UserId
- [ ] `functions/src/agent/services/userFirestoreAdapter.ts` — implements UserService
- [ ] Один `db.collection('users')` в `timeTracking.ts` заменён на `userService.*` call
- [ ] `cd functions && npm run build` — passes
- [ ] `npm run build` (vite) — passes (если установлены deps)
- [ ] Existing imports через `../utils/phone` работают без изменений
- [ ] PR merged в main
- [ ] `firebase deploy --only functions:agentApi` прошёл
- [ ] `/api/time-tracking/active-all` — 200 OK после deploy
- [ ] Decision written: GO / YELLOW / RED для Phase 0 (см. §4)

---

**End of TZ. New session может начинать с §7 Fast-start.**
