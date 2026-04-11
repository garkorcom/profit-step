# Warehouse API Guide — New Endpoints (Phase B)

Base URL: `https://us-central1-profit-step.cloudfunctions.net/agentApi`

All endpoints require `Authorization: Bearer <API_KEY>` header.

---

## 1. Fuzzy Search Inventory Items

**Purpose:** Find inventory items by natural language query. Uses Fuse.js fuzzy matching on item name, barcode, category, and notes fields. Designed for AI agent integration where the agent needs to locate items by description rather than exact ID.

**URL:** `GET /api/inventory/items/search`

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | — | Search query (e.g. "drywall", "14/2 wire") |
| `warehouseId` | string | No | — | Filter to a specific warehouse |
| `limit` | number | No | 20 | Max results (1-100) |

**Example Request:**
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "https://us-central1-profit-step.cloudfunctions.net/agentApi/api/inventory/items/search?q=drywall&limit=5"
```

**Example Response:**
```json
{
  "items": [
    {
      "id": "abc123",
      "warehouseId": "wh001",
      "name": "Drywall Sheet 4x8",
      "quantity": 45,
      "unit": "pcs",
      "category": "hardware",
      "minStock": 10,
      "barcode": null,
      "notes": "Standard 1/2 inch",
      "createdAt": "2026-04-01T10:00:00.000Z",
      "score": 0.05
    }
  ],
  "query": "drywall",
  "total": 1
}
```

**Notes:**
- Lower `score` = better match (0.0 = exact, 1.0 = no match)
- Threshold is 0.4 — items scoring above this are excluded
- Searches across: `name`, `barcode`, `category`, `notes`

---

## 2. Inventory Dashboard

**Purpose:** Single aggregated overview of inventory state across all (or one specific) warehouse. Returns warehouse counts by type, total stock value, low-stock item count, and recent transactions. Designed as a one-call summary for AI agents and dashboard UIs.

**URL:** `GET /api/inventory/dashboard`

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `warehouseId` | string | No | — | Scope to a single warehouse (items & transactions only) |

**Example Request:**
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "https://us-central1-profit-step.cloudfunctions.net/agentApi/api/inventory/dashboard"
```

**Example Response:**
```json
{
  "warehouses": {
    "total": 5,
    "physical": 3,
    "vehicle": 2
  },
  "items": {
    "uniqueCount": 127,
    "totalStockValue": 24350.75,
    "lowStockCount": 8
  },
  "lowStockItems": [
    {
      "id": "item456",
      "name": "14/2 Romex Wire",
      "warehouseId": "wh001",
      "currentStock": 2,
      "minStock": 10,
      "unit": "roll",
      "category": "electrical"
    }
  ],
  "recentTransactions": [
    {
      "id": "tx789",
      "itemName": "Drywall Screws",
      "type": "out",
      "quantity": 5,
      "warehouseId": "wh001",
      "createdAt": "2026-04-11T08:30:00.000Z"
    }
  ]
}
```

**Notes:**
- `totalStockValue` is computed as `sum(quantity * unitPrice)` — only items with `unitPrice` set contribute
- `lowStockItems` includes all items where `currentStock < minStock`
- `recentTransactions` returns the last 10 movements

---

## 3. Low-Stock Alerts

**Purpose:** Returns all inventory items below their minimum stock threshold, sorted by urgency (largest deficit first). Includes a suggested reorder quantity. Used by AI agents to proactively flag materials that need replenishment.

**URL:** `GET /api/inventory/alerts`

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `warehouseId` | string | No | — | Filter to a specific warehouse |
| `limit` | number | No | 50 | Max alerts returned (1-200) |

**Example Request:**
```bash
curl -X GET \
  -H "Authorization: Bearer YOUR_API_KEY" \
  "https://us-central1-profit-step.cloudfunctions.net/agentApi/api/inventory/alerts?warehouseId=wh001"
```

**Example Response:**
```json
{
  "alerts": [
    {
      "id": "item456",
      "name": "14/2 Romex Wire",
      "sku": "ROM-142-250",
      "warehouseId": "wh001",
      "currentStock": 2,
      "minStock": 10,
      "unit": "roll",
      "category": "electrical",
      "suggestedOrderQuantity": 8
    },
    {
      "id": "item789",
      "name": "Drywall Screws #6",
      "sku": null,
      "warehouseId": "wh001",
      "currentStock": 3,
      "minStock": 5,
      "unit": "box",
      "category": "hardware",
      "suggestedOrderQuantity": 2
    }
  ],
  "total": 2,
  "hasMore": false
}
```

**Notes:**
- Only items with `minStock > 0` and `currentStock < minStock` appear
- `suggestedOrderQuantity` = `minStock - currentStock`
- Sorted by `suggestedOrderQuantity` descending (most urgent first)
- `sku` maps to the item's `barcode` field
