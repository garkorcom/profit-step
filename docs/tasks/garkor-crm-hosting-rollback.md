# TASK: Откатить hosting на garkor-crm

**Приоритет:** Medium
**Создано:** 2026-04-09
**Автор:** Claude Code (сессия nervous-torvalds)

---

## Проблема

2026-04-09 при деплое profit-step фронтенда и бэкенда, Firebase CLI был переключен на проект `garkor-crm` вместо `profit-step` (кто-то ранее выполнил `firebase use garkor-crm`). В результате:

1. **Hosting `garkor-crm.web.app`** — перезаписан фронтендом от profit-step (2 раза: ~03:00 UTC и ~06:55 UTC)
2. **Cloud Function `agentApi`** — была создана на garkor-crm (её там раньше НЕ было). **Уже удалена** (`firebase functions:delete agentApi --project garkor-crm`)
3. **profit-step** не получал деплоев до момента обнаружения ошибки

## Что уже исправлено

- [x] `firebase use profit-step` — проект переключен обратно
- [x] `agentApi` удалён с garkor-crm (подтверждено: функция была CreateFunction, не Update — оригинала не было)
- [x] Hosting задеплоен на правильный `profit-step.web.app`
- [x] Functions `agentApi` задеплоен на правильный `profit-step`

## Что осталось сделать

- [x] **Откатить hosting на `garkor-crm.web.app`** к состоянию до 2026-04-09
  - ~~Через Firebase Console → Hosting → Rollback~~ — Невозможно: все 3 релиза в истории были ошибочными (от 2026-04-09)
  - **Решение:** Re-deploy из `~/Projects/crm-prototype` (npm run build + firebase deploy --only hosting)
  - **Результат:** garkor-crm.web.app восстановлен — 6 файлов, CRM landing page работает (hash: `d00ce5`)
  - **Дата исправления:** 2026-04-09 ~07:37 ET

## Контекст для программиста

### Список Firebase проектов на аккаунте

| Project | ID | Назначение |
|---|---|---|
| garkor | garkor-com | ? |
| **Garkor CRM** | **garkor-crm** | CRM (7 functions: telegram, digest, tasks, albums, processMessage, onUserCreated) |
| My First Project | helpful-valve-466708-u1 | ? |
| **profit-step** | **profit-step** | Основной прод CRM (40+ functions) |
| profit-task | profit-task | ? |
| task | task-d8839 | ? |
| Vera Game | vera-game | ? |
| vira | vira-9b145 | ? |

### Functions на garkor-crm (текущее состояние после очистки)

| Function | Version | Trigger | Статус |
|---|---|---|---|
| assembleAlbums | v2 | scheduled | Не тронута |
| checkTaskDeadlines | v2 | scheduled | Не тронута |
| dailyDigest | v2 | scheduled | Не тронута |
| processMessage | v2 | Firestore trigger | Не тронута |
| telegramWebhook | v2 | HTTPS | Не тронута |
| onUserCreated | v1 | Auth trigger | Не тронута |
| ~~agentApi~~ | ~~v1~~ | ~~HTTPS~~ | **Удалена** (была создана ошибочно, оригинала не было) |

### Как избежать повторения

В `.firebaserc` default = `profit-step`, но `firebase use <project>` создает override в `~/.config/configstore/firebase-tools.json`. Перед деплоем всегда проверять:

```bash
firebase use          # должно показать profit-step
```
