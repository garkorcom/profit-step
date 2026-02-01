# 🛒 Модуль закупок (Shopping)

## Обзор

Модуль закупок позволяет:
- Создавать списки покупок для клиентов
- Управлять закупками через Telegram бот
- Загружать чеки с OCR-распознаванием
- Контролировать расходы с двойным подтверждением

---

## 📱 Веб-интерфейс

### Страница закупок
**URL:** `/crm/shopping`

### Вкладки

| Вкладка | Описание |
|---------|----------|
| **📋 Списки** | Списки покупок по клиентам |
| **🛒 Активные** | Товары в процессе закупки |
| **✅ Купленные** | История покупок |
| **💰 Чеки** | Финансовая отчётность |

---

## 🤖 Telegram Bot Flow

### Основной процесс

```
1. 🛒 Закупки (главное меню)
       │
       ├─► Выбрать товары
       │         │
       │         └─► [✓] Товар 1
       │             [✓] Товар 2
       │             [Готово]
       │
       ├─► После покупки загрузить чек
       │         │
       │         └─► 📷 Фото чека
       │             AI распознаёт сумму
       │             [Подтвердить: $123.45]
       │
       └─► Double Proof (фото товаров)
                 │
                 └─► 📷 Фото купленного
                     ✅ Закупка завершена
```

### Double Proof (Двойное подтверждение)

Система требует два фото:
1. **Чек** — подтверждение оплаты
2. **Товары** — подтверждение покупки

Это защищает от злоупотреблений.

---

## 📊 Статусы товаров

| Статус | Описание |
|--------|----------|
| `pending` | Ожидает покупки |
| `selected` | Выбран к покупке |
| `purchased` | Куплен |
| `delivered` | Доставлен |

---

## 📊 Статусы чеков

| Статус | Описание |
|--------|----------|
| `awaiting_goods_photo` | Ожидает фото товаров |
| `pending` | На проверке |
| `confirmed` | Подтверждён |
| `rejected` | Отклонён |

---

## 💾 Структура данных

### ShoppingItem (Товар)
```typescript
{
  id: string;
  listId: string;         // ID списка
  clientId: string;       // Клиент
  name: string;           // Название
  quantity?: number;      // Количество
  unit?: string;          // Ед. измерения
  estimatedPrice?: number;// Ожидаемая цена
  actualPrice?: number;   // Фактическая цена
  status: 'pending' | 'selected' | 'purchased' | 'delivered';
  purchasedBy?: string;   // Кто купил
  purchasedAt?: Timestamp;
}
```

### ShoppingList (Список)
```typescript
{
  id: string;
  clientId: string;
  name: string;
  status: 'active' | 'completed';
  itemCount: number;
  createdAt: Timestamp;
}
```

### Receipt (Чек)
```typescript
{
  id: string;
  userId: string;
  userName: string;
  clientId: string;
  clientName: string;
  
  // Суммы
  amount: number;
  ocrAmount?: number;      // Распознанная сумма
  
  // Фото
  receiptPhotoUrl: string; // Чек
  goodsPhotoUrl?: string;  // Товары (Double Proof)
  
  // Статус
  status: 'awaiting_goods_photo' | 'pending' | 'confirmed' | 'rejected';
  
  // Финансы
  paymentSource?: 'cash' | 'card' | 'transfer';
  costCenter?: string;
  reimbursementStatus?: 'pending' | 'approved' | 'paid';
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 🔧 OCR Распознавание

Система использует Google Cloud Vision API для:
- Извлечения суммы из фото чека
- Распознавания позиций (в разработке)

### Поддерживаемые форматы чеков
- Стандартные кассовые чеки
- Товарные накладные
- Квитанции

---

## 📈 Отчёты

### Вкладка "Чеки"
- **По клиенту** — расходы по клиентам
- **По сотруднику** — кто сколько потратил
- **Аудит** — полный список всех чеков

### Фильтры
- Период (дата от-до)
- Статус (все/подтверждённые/ожидающие)

---

*Обновлено: Январь 2026*
