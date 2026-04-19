# Improvement 10 — Vendor Email RFQ (UC4 sub)

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 5)
> **Scope:** автоматическая отправка Request-for-Quote email поставщикам + parsing ответов.

---

## 1. Flow

```
1. UC4 buckets.needsQuote populated (special-order items)
2. Group by vendor (если preferredForCategories задано)
3. Compose email per vendor
4. Send via SendGrid / Gmail SMTP
5. Vendor replies → Inbound email webhook
6. Gemini parses reply → extract prices + availability
7. Update estimate line + procurement plan
```

---

## 2. Email template

**Subject:** `RFQ: ${itemCount} items for ${projectName} — ${companyName}`

**Body:**
```
Hi ${vendorContactName},

Requesting quote for the following items for project "${projectName}":

1. Lutron Diva Dimmer DV-600P White × 4 ea
2. Leviton Decora Wall Plate 1-Gang Ivory × 10 ea
3. ...

Please reply with:
- Price per unit
- Availability / lead time
- Payment terms

Project ref: ${projectId}
Warehouse AI: rfq@profit-step.com

Thanks,
${requesterName}
${companyName}
```

Templated в `warehouse/ai_agent/prompts/rfqEmailTemplate.ts`.

---

## 3. Sending

### 3.1. Provider options

- **SendGrid** — $15/mo free 100/day, transactional
- **Gmail SMTP** — через Google Workspace с app password

Recommendation: SendGrid для MVP (easier tracking, no rate limits).

### 3.2. Send

```typescript
async function sendRFQ(payload: {
  vendorId: string;
  items: Array<{ name, qty, specs }>;
  projectId: string;
  requester: User;
}): Promise<RFQRecord> {
  const vendor = await getVendor(payload.vendorId);
  const emailBody = renderRFQTemplate(payload);
  
  const result = await sendGrid.send({
    from: 'rfq@profit-step.com',
    to: vendor.contactEmail,
    subject: `RFQ: ${payload.items.length} items for ${project.name}`,
    html: emailBody,
    replyTo: 'rfq@profit-step.com',
    customArgs: {
      rfqId: generateRFQId(),
      projectId: payload.projectId,
      vendorId: payload.vendorId,
    },
  });
  
  // Save RFQ record
  await db.collection('wh_rfq_records').add({
    rfqId: result.customArgs.rfqId,
    vendorId, projectId, items,
    sentAt: serverTimestamp(),
    status: 'pending',
  });
  
  return result;
}
```

### 3.3. Rate limiting

- Max 5 RFQ/day per vendor (anti-spam)
- Dedupe: same vendor + same items within 48h → skip

---

## 4. Inbound parsing

### 4.1. Inbound webhook

SendGrid Inbound Parse: emails to `rfq@profit-step.com` → POST к `/api/warehouse/agent/rfq-inbound`.

### 4.2. Parsing

```typescript
async function parseRFQResponse(email) {
  // Find original RFQ via In-Reply-To header или subject match
  const originalRFQ = findRFQByContext(email);
  if (!originalRFQ) return { error: 'unmatched_reply' };
  
  // Gemini parses prices + availability
  const parsed = await callGemini({
    systemPrompt: RFQ_RESPONSE_PARSER_PROMPT,
    userContent: [{ type: 'text', data: email.body }],
    responseFormat: 'json',
  });
  
  // Expected: [ { itemHint, unitCost, leadTimeDays, availability, note } ]
  
  // Save quote
  await db.collection('wh_vendor_quotes').add({
    rfqId: originalRFQ.rfqId,
    vendorId: originalRFQ.vendorId,
    projectId: originalRFQ.projectId,
    items: parsed.items,
    receivedAt: serverTimestamp(),
  });
  
  // Publish event
  publishEvent('warehouse.vendor_quote_received', { rfqId, items: parsed.items });
}
```

### 4.3. Gemini prompt для parsing

```
Parse this email reply from a construction vendor. Extract pricing info for each item.

Expected JSON schema:
{
  "items": [
    { "itemHint": "Lutron Diva Dimmer", "unitCost": 18.50, "qty": 4, "leadTimeDays": 3, "availability": "in_stock", "note": "free shipping over $200" }
  ],
  "overall": { "paymentTerms": "Net 30", "validUntil": "2026-04-25" }
}

Email body: ${emailText}

If not a valid quote response: {"error": "not_a_quote"}
```

---

## 5. Update estimate

Event `warehouse.vendor_quote_received` → Estimate agent listener:
```typescript
for (const quoteItem of quote.items) {
  const estimateLine = findEstimateLine(estimateId, quoteItem.itemHint);
  if (estimateLine) {
    await updateEstimateLine(estimateLine.id, {
      realCostFromVendor: quoteItem.unitCost,
      leadTimeDays: quoteItem.leadTimeDays,
      vendorSource: quoteItem.vendorId,
    });
  }
}
```

---

## 6. RFQ lifecycle

```
pending → quoted (response received) → accepted (PO sent) → fulfilled (receipt) → closed
       ↘ expired (no response in 7d) → closed_expired
       ↘ declined (vendor said no) → closed_declined
```

---

## 7. Acceptance

- [ ] Send RFQ email via SendGrid успешно
- [ ] Inbound webhook парсит reply с accuracy > 80%
- [ ] Gemini extracts line items correctly
- [ ] Vendor quote → estimate update event
- [ ] Rate limit 5/day/vendor работает
- [ ] RFQ expires after 7d без response

## 8. Edge cases

- Vendor replies с attachment (PDF quote) → parse attachment too
- Multi-reply thread → keep latest
- Reply says "out of stock" → mark items unavailable, suggest alternatives
- Spam-y reply from unknown sender → reject inbound

## 9. Open questions

1. **Inbound email address** — `rfq@profit-step.com` нужен MX record + SendGrid Inbound Parse setup
2. **Attachment handling** — PDF parsing через Gemini или OCR сервис?
3. **Multi-vendor chained RFQ** — если first vendor не ответил, автоматически spawn RFQ к alt vendor?

## 10. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 11. История
- **2026-04-18** — v1.0.
