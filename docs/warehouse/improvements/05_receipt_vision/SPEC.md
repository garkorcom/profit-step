# Improvement 05 — Receipt Vision (UC2)

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 3)
> **Scope:** фото чека → автоматический приход в van через Gemini Vision.

---

## 1. User flow

```
1. Денис выходит из Home Depot в 14:22
2. Шлёт фото чека в Telegram worker bot
3. Бот: "🤖 Обрабатываю..."
4. [Gemini Vision parse: vendor + items + total]
5. Бот:
   "📋 Home Depot #8502 — $142.50 (14:17)
    
    Распознал:
    • Wire 12-2 NM-B: 1 roll_250ft → 250 ft @ $0.36/ft
    • Outlet 15A × 10
    • Wire nut yellow: 1 pack_100
    • Box 1-gang × 10
    
    Оприходовать в van Денис?
    [✅ Оприходовать] [🏗️ На объект] [✏️ Изменить]"
6. Денис: ✅ → draft receipt posted
7. Бот: "Готово. Привязать к клиенту? Напиши имя."
8. Денис: "к Dvorkin"
9. Бот: обновляет все 4 ledger entries projectId
```

---

## 2. Gemini Vision prompt

Находится в `warehouse/ai_agent/prompts/receiptVision.ts`.

**Extract schema:**
```json
{
  "vendor": "Home Depot #8502 Miami",
  "vendorNormalizedId": "vendor_home_depot",
  "total": 142.50,
  "tax": 10.50,
  "subtotal": 132.00,
  "date": "2026-04-18",
  "time": "14:17",
  "items": [
    {
      "rawText": "WIRE 12-2 WG NM-B 250",
      "quantity": 1,
      "unitPrice": 89.00,
      "totalPrice": 89.00,
      "confidence": 0.95
    },
    ...
  ]
}
```

На ошибке: `{ "error": "receipt_unreadable" | "not_a_receipt" }`.

---

## 3. Processing pipeline

```typescript
async function parseReceipt(input) {
  // 1. Preprocessing
  const image = await downloadImage(input.photoUrl);
  const processed = await preprocess(image);  // HEIC→JPEG, rotate, crop if border detected
  
  // 2. Photo hash для idempotency
  const photoHash = sha256(processed);
  const existing = await findReceiptByPhotoHash(photoHash);
  if (existing) {
    return { duplicate: true, existingDocId: existing.id };
  }
  
  // 3. Gemini Vision parse
  const parsed = await callGemini({
    systemPrompt: RECEIPT_VISION_PROMPT,
    userContent: [{ type: 'image', data: processed }],
    responseFormat: 'json',
  });
  
  if (parsed.error) return { ok: false, reason: parsed.error };
  
  // 4. Fuzzy match к catalog
  const matchedLines = [];
  const unmatchedLines = [];
  for (const item of parsed.items) {
    const match = fuzzyMatchItem({ name: item.rawText }, catalog);
    if (match[0]?.confidence > 0.85) {
      matchedLines.push({
        itemId: match[0].itemId,
        uom: inferPurchaseUOM(item, match[0].item),
        qty: item.quantity,
        unitCost: item.unitPrice,
        rawText: item.rawText,
        matchConfidence: match[0].confidence,
      });
    } else {
      unmatchedLines.push({ rawText: item.rawText, candidates: match, ... });
    }
  }
  
  // 5. Определить target location
  const targetLoc = resolveTargetLocation(input.userId, input.currentLocationId, activeTrip);
  
  // 6. Create draft receipt
  const doc = await createDraftReceipt({
    toLocationId: targetLoc,
    vendorId: resolveVendor(parsed.vendor),
    lines: matchedLines,
    totals: { subtotal, tax, total },
    attachmentUrls: [input.photoUrl],
    idempotencyKey: photoHash,
    source: 'ai',
  });
  
  return { 
    ok: true, 
    draftId: doc.id, 
    matched: matchedLines, 
    unmatched: unmatchedLines,  // пользователь создаёт items manually или skip
  };
}
```

---

## 4. Preprocessing

- HEIC → JPEG (convert через sharp)
- Orientation fix (EXIF)
- Auto-crop если чек меньше 80% фото
- Enhance contrast если тёмно
- Max size 2048px (quality vs API cost)

---

## 5. Idempotency по photo hash

SHA-256 of preprocessed image → сохраняется в `wh_idempotency_keys` с ключом `receipt:${hash}`. TTL 24h.

При повторной загрузке того же фото — return existing draft без recreate.

---

## 6. Vendor detection

- Match "Home Depot #XXXX" regex → `vendor_home_depot`
- "LOWE'S #XXXX" → `vendor_lowes`
- Unknown vendor → prompt user create `wh_vendors` entry

---

## 7. Unmatched items flow

Если fuzzy match confidence < 0.85:

Бот:
```
Не распознал 2 позиции:
1. "DECORA BLANK WH" — создать item?
   [➕ Создать] [🔍 Поиск] [⏩ Пропустить]
2. "14-2 NM-B 50FT" — похоже на:
   a) Wire 14-2 NM-B (есть в catalog)
   b) Wire 14-2 NM-B 50ft roll (создать new)
   [a] [b] [⏩]
```

При Create → UC sub-capability для создания нового catalog item с minimal info (name + baseUOM default 'each' + SKU auto).

---

## 8. Project attribution

Если у пользователя есть `activeTripId` в session:
→ auto-link: все lines получают `projectId` и `phaseCode` из trip context

Иначе:
→ спрашиваем после confirm: "Привязать к клиенту? Напиши имя."

---

## 9. Attachment storage

Фото чека → Firebase Storage `gs://profit-step/receipts/{userId}/{docId}.jpg`
→ URL в `doc.attachmentUrls`
→ доступно admin для audit

Retention: forever (financial record, §25 из Core Spec).

---

## 10. Acceptance

- [ ] 15+ real receipts (HD, Lowe's, local supply) парсятся с accuracy ≥ 90%
- [ ] Idempotency: same photo 2× → 1 draft
- [ ] HEIC support работает
- [ ] Vendor auto-match для 3 main vendors
- [ ] Unmatched items могут быть created через clarification
- [ ] Auto project attribution при active trip context

---

## 11. Open questions

1. **Ценовая variance** — чек $0.36/ft, average cost $0.34/ft. Обновлять lastPurchasePrice?
2. **Tax handling** — включать в cost allocation или отдельный entry?
3. **Multi-receipt merge** — если за одну поездку 2 чека, объединять или 2 documents?

## 12. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 13. История
- **2026-04-18** — v1.0.
