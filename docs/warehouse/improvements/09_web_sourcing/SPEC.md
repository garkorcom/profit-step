# Improvement 09 — Web Sourcing (UC4 sub)

> **Parent:** [`../../MAIN_SPEC.md`](../../MAIN_SPEC.md)
> **Status:** 🔵 planned (Phase 5)
> **Scope:** web search для items не в catalog. Результат → candidates с ценой → user approval → add to catalog.
> **Зависит от:** [`08_estimate_procurement/`](../08_estimate_procurement/) (caller).

---

## 1. Providers

### Priority (MVP):
1. **SerpAPI** — Google Shopping results для US
2. **Home Depot search** — через scraping (если API недоступен)
3. **Lowe's search** — через scraping
4. **Amazon Business** — через API (future)
5. **Local vendor catalogs** — если vendor loaded данные в Warehouse

---

## 2. Algorithm

```typescript
async function webSearchItem(query: { name: string; specs?: string[]; maxResults?: number }): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  // 1. SerpAPI Google Shopping
  const serpResults = await serpApi.search({
    engine: 'google_shopping',
    q: query.name,
    location: 'Miami, FL',
    gl: 'us',
  });
  
  // 2. Parse top 10 results
  for (const item of serpResults.shopping_results.slice(0, 10)) {
    results.push({
      source: 'google_shopping',
      title: item.title,
      vendor: item.source,
      price: parsePrice(item.price),
      url: item.link,
      thumbnail: item.thumbnail,
      rating: item.rating,
      confidence: scoreMatch(query.name, item.title),
    });
  }
  
  // 3. Direct vendor search (HD + Lowe's)
  // .. скрапинг или API если доступно ..
  
  // 4. Rank by confidence × price (cheapest first among high-confidence)
  results.sort((a, b) => (b.confidence - a.confidence) || (a.price - b.price));
  
  // 5. Cache results
  await cacheWebSearchResults(query, results);
  
  return results.slice(0, query.maxResults || 3);
}
```

---

## 3. Response to user

```
🔍 Нашёл для "Декоративный LED профиль 3м warm white":

1. ⭐ Home Depot — 10ft LED Strip Under Cabinet
   $29.98 ea (Home Depot Pro в stock)
   https://homedepot.com/...
   [📌 Добавить в catalog + корзину]

2. Amazon — 3M Warm White LED Strip 2700K
   $24.99 ea (Prime 2-day)
   https://amazon.com/...
   [📌 Добавить]

3. Lowe's — LED Profile 3m Warm (3000K)
   $32.50 ea (Pickup in store)
   https://lowes.com/...
   [📌 Добавить]

[🔍 Искать ещё] [⏩ Пропустить]
```

User выбирает → item создаётся в `wh_items` с SKU auto-generated, vendor ссылка, price.

---

## 4. Caching

`wh_web_search_cache` collection:
```typescript
{
  id: string,                       // sha256(query_normalized)
  query: string,
  results: SearchResult[],
  createdAt: Timestamp,
  expiresAt: Timestamp,             // TTL 7d (prices change)
}
```

При том же query в течение TTL → cached response (cheap).

---

## 5. Auto-match workflow

После user add → link catalog item к vendor + URL + price. При следующем estimate с similar item → instant match, no web search.

---

## 6. API endpoint

```
POST /api/warehouse/agent/web-search
Body: { query: "LED profile 3m warm white", specs?: ["WARM_WHITE", "3M"], maxResults?: 3 }

Response:
{
  results: [ ... ],
  cached: false,
  searchedAt: "..."
}
```

---

## 7. Secrets

- `SERPAPI_API_KEY` → Firebase Secret Manager
- Home Depot / Lowe's API keys (if granted)

---

## 8. Acceptance

- [ ] SerpAPI returns 10 results for typical construction items
- [ ] Results ranked by confidence × price
- [ ] Cache hit в 2-м запросе с тем же query
- [ ] User click "Add" → catalog item created + link to vendor
- [ ] Match confidence > 0.7 на 20 test queries

## 9. Edge cases

- No results → "не нашли, попробуй уточнить"
- All results low confidence (< 0.5) → show with warning "похоже не то, уточни query"
- Price not parseable → skip item

## 10. Open questions

1. **SerpAPI cost** — $50/mo, 5000 queries. Достаточно для MVP?
2. **Scraping HD/Lowe's** — legal? Используем API (paid) или обходимся SerpAPI?
3. **Thumbnail storage** — сохранять в Firebase Storage или ссылаться на external URL (expiring)?

## 11. CHANGELOG
См. [`CHANGELOG.md`](./CHANGELOG.md)

## 12. История
- **2026-04-18** — v1.0.
