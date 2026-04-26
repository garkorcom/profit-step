---
title: "04.3 Firestore rules"
section: "04-storage"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Firestore rules

> Полный код firestore.rules для коллекции `tasktotime_tasks`. Сравнение со старыми rules `gtd_tasks` (где было `read: if true` — security hole). В новой версии: явное company-scoping + reviewer update + admin-only delete.

## Полный код

```
match /tasktotime_tasks/{taskId} {
  allow read: if isSignedIn() &&
    (resource.data.companyId == userCompanyId() ||
     isClientPortalAuth(resource.data.clientId));   // явный portal access вместо public read

  allow create: if isSignedIn() &&
    request.resource.data.companyId == userCompanyId() &&
    request.resource.data.createdBy.id == request.auth.uid;

  allow update: if isSignedIn() &&
    resource.data.companyId == userCompanyId() &&
    (resource.data.createdBy.id == request.auth.uid ||
     resource.data.assignedTo.id == request.auth.uid ||
     resource.data.reviewedBy.id == request.auth.uid ||
     isManagerOf(resource.data.assignedTo.id) ||
     hasRole('admin'));

  allow delete: if hasRole('admin');  // только admin может физически удалить

  // Soft-delete (archivedAt) делается через update.
}
```

## Объяснение каждого правила

### `allow read`

Юзер может читать задачу если:
- (a) Аутентифицирован, **И** companyId задачи = его company (RLS scope), **ИЛИ**
- (b) Это client portal session аутентифицированная для этого `clientId`

**Принцип:** только свой company видит свои задачи. Client portal — отдельный путь со своей аутентификацией (JWT для клиента).

### `allow create`

Юзер может создать задачу если:
- Аутентифицирован,
- `companyId` совпадает с его company (нельзя создать задачу для чужой компании),
- `createdBy.id === request.auth.uid` (нельзя подделать createdBy).

### `allow update`

Юзер может обновить задачу если:
- Аутентифицирован,
- companyId её = его company (RLS), **И** один из условий:
  - Он создатель (`createdBy.id`)
  - Он assignee (`assignedTo.id`)
  - Он reviewer (`reviewedBy.id`) — **NEW в v0.2**
  - Он менеджер assignee'я (`isManagerOf(assignedTo.id)`)
  - У него admin role

**Прим.:** soft-delete (`archivedAt`) делается через update, поэтому управляется этим же правилом.

### `allow delete`

**Только admin** может физически удалить документ. Все остальные используют soft-delete через update `archivedAt = now`.

## Изменения от текущих rules `gtd_tasks`

| Что | Старое поведение | Новое |
|---|---|---|
| Public read | `read: if true` (security hole!) | `read: if isSignedIn() && (companyId match || portal auth)` |
| Company-scoping | Нет (cross-tenant bypass risk — CLAUDE.md §4) | Да, явный `companyId == userCompanyId()` |
| Reviewer update | Не было такой роли | `reviewedBy.id == auth.uid` тоже может update |
| Physical delete | Любой signed-in мог | Только admin |

## Helper functions (предполагаются существующими)

- `isSignedIn()` — `request.auth != null`
- `userCompanyId()` — читает из `users/{uid}.companyId`
- `isClientPortalAuth(clientId)` — проверка JWT для client portal
- `isManagerOf(userId)` — проверка иерархии: текущий юзер — менеджер `userId`
- `hasRole(role)` — проверка `users/{uid}.roles[]` содержит `role`

Эти функции уже есть в `firestore.rules` для других коллекций — переиспользуем.

## Подколлекция wiki_history

```
match /tasktotime_tasks/{taskId}/wiki_history/{versionId} {
  allow read: if exists(/databases/$(database)/documents/tasktotime_tasks/$(taskId)) &&
              get(/databases/$(database)/documents/tasktotime_tasks/$(taskId)).data.companyId == userCompanyId();
  allow write: if false;  // пишет только trigger, не client
}
```

История wiki — read-only для клиента, пишется только server-side из `onWikiUpdate` trigger.

## Audit log: `tasktotime_transitions`

```
match /tasktotime_transitions/{transitionId} {
  allow read: if isSignedIn() && resource.data.companyId == userCompanyId();
  allow write: if false;  // append-only через server, не client direct
}
```

## Cross-tenant RLS test

Обязателен smoke-test после деплоя rules:

```typescript
// functions/test/rlsCrossTenant.test.ts
test('user from companyA cannot read tasktotime_tasks from companyB', async () => {
  const taskInB = await db.collection('tasktotime_tasks').add({ companyId: 'B', ... });
  const userInA = await signIn({ companyId: 'A' });
  await expect(taskInB.get()).rejects.toThrow('PERMISSION_DENIED');
});
```

CLAUDE.md §4 риск #3 — этот тест существует но не запускается регулярно. После миграции — добавить в CI.

---

**См. также:**
- [Collections](collections.md) — какие коллекции защищаем rules
- [Indexes](indexes.md) — индексы используют те же поля
- [Migration mapping](migration-mapping.md) — добавляем `companyId` для существующих docs в Phase 5
- [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md) — open question #3 про client portal auth
