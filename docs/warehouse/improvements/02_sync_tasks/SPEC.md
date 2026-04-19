# Improvement 02 — Sync с Tasks Agent

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 4)
> **Scope:** Tasks ↔ Warehouse bidirectional. Task start triggers writeoff proposal (UC3). Task complete reconciliation.

---

## 1. Зачем

Чтобы:
- При старте задачи работник сразу получал предложение списать материалы по норме (UC3)
- После закрытия задачи — факт сверялся с планом (actual vs planned)
- Tasks знали доступность материалов до start ("block task until stock")

---

## 2. Direction

Bidirectional:
- **Tasks → Warehouse:** task lifecycle events
- **Warehouse → Tasks:** materials availability, writeoff proposals, anomaly reconciliation

---

## 3. Events Tasks → Warehouse

### 3.1. `tasks.task.started`

**Payload:**
```json
{
  "taskId": "task_...",
  "workerId": "user_denis",
  "templateType": "install_outlet",
  "qty": 3,
  "projectId": "proj_dvorkin",
  "locationId": "loc_van_denis",
  "startedAt": "2026-04-18T09:30:00Z"
}
```

**Warehouse action:**
1. Вызвать `proposeTaskWriteoff(taskId)` capability
2. Если норма найдена → создать draft issue с lines
3. Отправить worker в Telegram: _"Списать по норме?"_

### 3.2. `tasks.task.completed`

**Payload:**
```json
{
  "taskId": "task_...",
  "completedAt": "2026-04-18T11:30:00Z",
  "outcomes": { ... }
}
```

**Warehouse action:**
1. Lookup draft issue attached к taskId
2. Если status = draft (worker забыл confirm) → prompt _"Посvarded задача. Спишем материалы сейчас?"_
3. Если status = posted → reconciliation: сравнить actual consumption vs plan, детектировать anomaly

### 3.3. `tasks.task.cancelled`

**Warehouse action:** void draft issue если existed.

---

## 4. Events Warehouse → Tasks

### 4.1. `warehouse.materials_allocated`

**Trigger:** draft procurement создал reservation для taskId.

**Payload:**
```json
{
  "taskId": "...",
  "allocatedItems": [...],
  "readyToStart": true
}
```

**Tasks action:** update task status `materials_ready`, unblock start.

### 4.2. `warehouse.insufficient_stock`

**Trigger:** worker пытается start task, но availableQty < required.

**Tasks action:** задача остаётся в status `blocked_waiting_materials`. UI показывает: "нужно закупить X".

### 4.3. `warehouse.anomaly.detected` (при task complete)

**Tasks action:** push alert в task view, admin может investigate.

---

## 5. API Tasks → Warehouse (synchronous)

### `POST /api/warehouse/agent/propose-writeoff`

Вызывается когда task agent знает templateType + qty + locationId. Return draft issue preview для confirm UI.

### `POST /api/warehouse/agent/reconcile-task`

После task complete. Body: `{ taskId, actualConsumption?: { itemId, baseQty }[] }`. Сравнивает с draft issue, создаёт adjustment на разницу.

---

## 6. Data model additions

В `wh_documents`:
- `relatedTaskId?: string` — ссылка на task (для draft issues от UC3)

В `wh_events`:
- events `warehouse.task_writeoff_proposed`, `warehouse.task_writeoff_completed`, `warehouse.task_materials_insufficient`

---

## 7. Contract file

`functions/src/shared/agentContracts/warehouseToTasks.ts`:
```typescript
export const TaskStartedSchema = z.object({
  eventType: z.literal('tasks.task.started'),
  taskId: z.string(),
  workerId: z.string(),
  templateType: z.string(),
  qty: z.number().positive(),
  projectId: z.string().optional(),
  locationId: z.string(),
  startedAt: z.string(),
});

export const WarehouseWriteoffProposedSchema = z.object({ /* ... */ });
```

---

## 8. Acceptance criteria

- [ ] Task start → draft issue создаётся за < 3 сек
- [ ] Worker подтверждает через Telegram → post
- [ ] Task complete → reconciliation работает
- [ ] Anomaly > 25% + $50 → alert admin
- [ ] Task cancel → draft voided
- [ ] Insufficient stock → task blocked с правильным message

---

## 9. Edge cases

- Task без templateType → skip UC3 (только manual writeoff)
- Template без norm → prompt admin создать норму
- Norm из 0 items → skip, warning в audit
- Worker не в Telegram → draft остаётся 48h (TTL), потом expires
- Multiple tasks started одновременно (different templates) → separate drafts

---

## 10. Open questions

1. **Reconciliation on complete** — автоматическое adjustment или через confirm?
2. **Block start при insufficient stock** — hard block или soft warning?

---

## 11. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 12. История
- **2026-04-18** — v1.0.
