# CI/CD Setup for New Firebase Project (P-1.6)

## Metadata

- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Цель:** что нужно настроить в GitHub Actions чтобы CI/CD работал на новом Firebase-проекте
- **Status:** docs-only. Workflows сейчас hardcoded на `profit-step` — параметризация включена отдельным PR когда будет целевой projectId.

---

## 1. Текущее состояние

После PR #35 все workflow'ы зелёные. Файлы:

- `.github/workflows/ci.yml` — lint, build, агент API тесты
- `.github/workflows/firebase-deploy-gate.yml` — anti-loop pre-deploy gate
- `.github/workflows/qa-pipeline.yml` — unit / security / integration / E2E / build / lint
- `.github/workflows/python-sdk.yml` — SDK pytest + package build

**Hardcoded референсы на `profit-step`:**

| Файл | Место | Что |
|---|---|---|
| `ci.yml:103` | `firebase emulators:exec --project=profit-step` | test project id — можно заменить на `profit-step-test` или env |
| `qa-pipeline.yml:67` | `firebase emulators:start --project=profit-step-test` | уже OK (test project) |
| `qa-pipeline.yml:100` | `firebase emulators:exec --project=profit-step-test` | OK |
| `firebase-deploy-gate.yml:71` | `firebase emulators:start --project=profit-step-test` | OK |
| `firebase-deploy-gate.yml:180` | `console.firebase.google.com/project/profit-step/functions/logs` | echo-only, косметика |

**Deploy story:** на текущий момент `deploy: 🚀 Deploy to Firebase` в `firebase-deploy-gate.yml:144` использует `FIREBASE_TOKEN` secret + дефолтный project из `.firebaserc`. Работает, но привязан к prod.

---

## 2. Что нужно на новом проекте

### 2.1. GitHub Actions Secrets (repo level)

Settings → Secrets and variables → Actions → New repository secret.

| Secret | Откуда | Назначение |
|---|---|---|
| `FIREBASE_TOKEN` | `firebase login:ci` на новом проекте | Используется `w9jds/firebase-action` для deploy |
| `FIREBASE_PROJECT_ID` | Имя нового проекта (e.g. `profit-step-v2`) | Заменит hardcode `profit-step` в workflow'ах (после параметризации) |
| `FIREBASE_SERVICE_ACCOUNT` | JSON-дамп service account key | Альтернатива FIREBASE_TOKEN; безопаснее для CI |
| `GEMINI_API_KEY`, `AGENT_API_KEY` | Тест-значения | Уже есть в `ci.yml:108-109` (hardcoded как `test-key`) |
| `CODECOV_TOKEN` | Codecov.io | Опционально, для coverage upload в qa-pipeline |

### 2.2. Обновить workflow'ы (когда новый projectId известен)

Замену проще всего сделать одним sed'ом:

```bash
OLD="profit-step"
NEW="profit-step-v2"  # ← твой новый id

sed -i '' "s/$OLD/$NEW/g" \
  .github/workflows/ci.yml \
  .github/workflows/firebase-deploy-gate.yml
```

Или лучше — **параметризовать**:

```yaml
# Добавить в начало каждого workflow'а
env:
  FIREBASE_PROJECT: ${{ secrets.FIREBASE_PROJECT_ID || 'profit-step' }}

# Заменить литералы:
run: firebase emulators:exec --project=$FIREBASE_PROJECT ...
```

После параметризации секрет `FIREBASE_PROJECT_ID` достаточно прописать в Actions Secrets — код трогать не нужно при смене проекта.

### 2.3. Deploy permissions

Service account для CI deploy нуждается в ролях:
- `Firebase Admin` (roles/firebase.admin) — для deploy всех ресурсов
- `Cloud Build Service Agent` (roles/cloudbuild.builds.builder) — для functions deploy
- `Service Account User` (roles/iam.serviceAccountUser) — для Cloud Run deploy

Эквивалент одной командой:

```bash
SA_EMAIL="github-actions@$NEW_PROJECT.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $NEW_PROJECT \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/firebase.admin"
gcloud projects add-iam-policy-binding $NEW_PROJECT \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudbuild.builds.builder"
gcloud projects add-iam-policy-binding $NEW_PROJECT \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountUser"
```

---

## 3. Тест-проект для integration tests

CI сейчас использует **`profit-step-test`** (не prod!) для emulator-based integration тестов. Это отдельный Firebase-проект, его **не нужно** переносить — emulators работают off-the-shelf без деплоя.

Но если хочется пересоздать и его:

```bash
firebase use new-test-project-id
firebase deploy --only firestore:rules,firestore:indexes --project=new-test-project-id
# Functions на тест-проект не деплоятся — только rules/indexes
```

Обновить `functions/test/setup.ts` и `firestore.rules.test.ts` если решишь переименовать.

---

## 4. Чек-лист (когда будет новый projectId)

- [ ] Создан `FIREBASE_TOKEN` через `firebase login:ci`
- [ ] Прописаны GitHub Secrets: `FIREBASE_TOKEN`, `FIREBASE_PROJECT_ID`
- [ ] Параметризованы workflow'ы (или хотя бы sed-заменены)
- [ ] IAM роли выданы service account'у
- [ ] Первый `main` коммит после параметризации → CI должен пройти зелёным и (если main) задеплоить в новый проект

---

## References

- Parent plan: [`MASTER_PLAN_2026-04-19.md`](../tasks/MASTER_PLAN_2026-04-19.md) §P-1.6
- Data migration: [`DATA_MIGRATION_RUNBOOK.md`](./DATA_MIGRATION_RUNBOOK.md)
- DNS plan: [`DNS_DOMAINS.md`](./DNS_DOMAINS.md)
- Secrets: [`SECRETS.md`](./SECRETS.md)
- [Firebase Actions docs](https://github.com/marketplace/actions/github-action-for-firebase)
