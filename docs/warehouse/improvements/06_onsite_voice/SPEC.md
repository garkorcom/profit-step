# Improvement 06 — On-site Voice (UC1)

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 2)
> **Scope:** голос/текст на объекте → виртуальный site warehouse + transfer van→site.

---

## 1. User flow

```
1. Денис на объекте Dvorkin в 10:15
2. В Telegram worker bot (голосом или текстом):
   "Я на Dvorkin. Тут уже лежат:
    - коробка розеток, штук 20
    - катушка провода, около 200 футов
    - пачка wirenuts"
3. Бот:
   "🤖 Распознал (уверенность 85%):
    • Outlet 15A × 20
    • Wire 12-2 NM-B × 250 ft (катушка 500ft? напиши 500 если да)
    • Wire nut × 1 pack = 100 each
    
    Локация: будет 'Site Dvorkin' (создаётся новая).
    [✅ Подтвердить] [✏️ Поправить] [❌ Отмена]"
4. Денис поправляет wire: "250 ft" → окончательно
5. ✅ Подтвердить
6. Бот: создаёт site location, draft transfer van→site, posts
7. "Готово. Site Dvorkin теперь учтён с 3 items."
```

---

## 2. Voice → Text

Telegram sends voice file (.ogg). Pipeline:
1. Download voice file
2. Gemini 2.0 Flash (audio input) или Google STT
3. Получаем text
4. Feed в text-parse capability

Fallback: если STT fails → ask user send as text.

---

## 3. Intent parsing prompt

В `warehouse/ai_agent/prompts/onSiteInventory.ts`.

**Extract schema:**
```json
{
  "siteHint": { "clientName": "Dvorkin", "addressHint": null },
  "items": [
    { "rawText": "коробка розеток 20шт", "name": "розетки", "qty": 20, "unit": "each", "confidence": 0.95 },
    { "rawText": "катушка провода около 200 футов", "name": "провод катушка", "qty": 200, "unit": "ft", "confidence": 0.7, "needsClarification": true },
    { "rawText": "пачка wirenuts", "name": "wirenuts", "qty": 1, "unit": "pack", "confidence": 0.85 }
  ]
}
```

Errors: `{ "error": "not_on_site" | "too_vague" | "no_items" }`.

---

## 4. Fuzzy match

Каждый parsed item → `fuzzyMatchItem(name, catalog)`:
- Confidence > 0.85 → auto-match
- 0.5-0.85 → ask clarification (show top-3 candidates)
- < 0.5 → prompt "создать новый item?"

---

## 5. Site location creation

Если site уже существует для клиента (создан ранее) — используем existing.

Иначе — создаём:
```typescript
const siteLoc = await db.collection('wh_locations').doc().set({
  name: `Site ${clientName}`,
  locationType: 'site',
  relatedClientId: resolvedClientId,
  relatedProjectId: activeProject?.id,
  isActive: true,
  schemaVersion: 1,
  createdBy: userId,
  createdByType: 'ai_agent',
  createdByAgentId: 'warehouse_ai',
});
```

Permanent until explicitly archived (e.g. когда project closed).

---

## 6. Transfer van → site

Draft transfer создаётся с:
- `sourceLocationId: worker's van`
- `destinationLocationId: site`
- `projectId: resolved project`
- `source: 'ai'`
- lines из parsed items
- `reservationExpiresAt: +48h` (TTL safety)

После confirm → post → ledger entries moves items from van → site.

**Wait** — а если items не были на van? Они физически уже на site (привёз subcontractor / customer). Тогда нужен другой flow:
- Если worker на site без van → создаём draft receipt прямо на site (не transfer)
- Reason: `existing_on_site` / `customer_supplied`

Logic decision в capability:
```typescript
if (worker.currentGPS ≈ siteLocation) {
  docType = 'receipt';  // items already here, just register
  reason = 'existing_on_site';
  toLocationId = site;
} else {
  docType = 'transfer';  // moving from van
  fromLocationId = worker.vanLocation;
  toLocationId = site;
}
```

---

## 7. Clarification loop

Если AI confidence < 0.85 на item, bot:
```
Для "коробка розеток, штук 20" — у меня есть:
1. Outlet 15A Duplex White (код OUTLET-15A-WHT)
2. GFCI Outlet 15A (код GFCI-15A)
3. Outlet 20A Dedicated (код OUTLET-20A)

[1] [2] [3] [➕ Создать новую] [⏩ Пропустить]
```

Денис кликает 1 → match с confidence 1.0, продолжаем.

---

## 8. Acceptance

- [ ] Voice message → транскрибировано → parsed за < 10 сек
- [ ] 20 test фраз parse accuracy ≥ 85%
- [ ] Site location создаётся автоматически
- [ ] Clarification loop работает
- [ ] Draft document confirm → post с правильным docType (receipt vs transfer в зависимости от context)
- [ ] 5 реальных голосовых сессий у Дениса проходят

---

## 9. Edge cases

- Site-less context (Денис просто "тут есть X" без указания client) → спросить client name
- Множественные sites (mongo client) → выбор из списка
- Items не в catalog → batch create flow

---

## 10. Open questions

1. **Audio → text через Gemini vs Google STT** — test both, выбрать быстрее/дешевле
2. **Offline voice** — если van без сети, queue message on device?

## 11. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 12. История
- **2026-04-18** — v1.0.
