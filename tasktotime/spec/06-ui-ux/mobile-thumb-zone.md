---
title: "06.4 Mobile thumb zone (детально)"
section: "06-ui-ux"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Mobile thumb zone — детальные требования

> Воркер на стройке держит телефон одной рукой (вторая в перчатке / держит инструмент). Большой палец достаёт только до bottom 1/3 экрана. Это фундаментальное ограничение для mobile UI модуля `tasktotime`.

Связано с принципом #5 в [`principles.md`](principles.md).

## Анатомия thumb zone

Если телефон держат правой рукой:

```
┌───────────────────────┐
│         TOP           │  ← практически недоступно
│      (header)         │     (нужно перехватить вторую руку)
├───────────────────────┤
│        MIDDLE         │  ← reach с трудом, для secondary actions
│      (content)        │
├───────────────────────┤
│        BOTTOM         │  ← natural thumb zone — primary actions
│   (FAB, sticky bar)   │
└───────────────────────┘
```

## Где размещать что

### Bottom 1/3 — primary actions

- **FAB** (floating action button) — primary action для текущего view:
  - Board / MyTasks: «+ Новая задача»
  - Calendar: «+ Создать на сегодня»
  - Detail page: «Старт» / «Пауза» / «Закончить» (зависит от lifecycle)
- **Sticky timer bar** — на active task page, всегда виден:
  - Большая кнопка start/pause
  - Текущий elapsed time
  - Quick log (фото, заметка)

### Middle — content

- Карточки задач в kanban
- Список задач в list view
- Детали задачи в detail page

### Top — secondary

- Header (logo, breadcrumbs)
- Filters dropdown (открыть → bottom sheet появляется снизу)
- Search bar (открыть → keyboard appears, focus на input)
- Notifications icon

## Touch target sizes

**Минимум 44×44 px** (Apple HIG, Google Material 48dp).

| Element | Size |
|---|---|
| FAB | 56×56 px |
| Primary buttons (Start, Complete) | 48×48 min, чаще 56×56 |
| Card в list | 44 px высота min |
| Icon buttons | 44×44 hit area (icon может быть меньше) |
| Tab bar items | 48 px height |
| Switch / checkbox | 32 px visual + 12 px padding = 44 effective |

## Bottom sheet pattern

Для secondary actions (filters, sort, share, options) — **bottom sheet**, не modal в центре экрана.

**Как iOS Stocks:**

```
┌───────────────────────┐
│                       │
│      content          │
│                       │
├───────────────────────┤  ← swipe up to expand
│   ━━━ (drag handle)   │
│  Filters / Options    │
│  Item 1               │
│  Item 2               │
│  ...                  │
└───────────────────────┘
```

**Преимущества:**
- Доступно большим пальцем
- Не блокирует scroll контента
- Можно swipe down to dismiss
- Можно swipe up для expand на full screen

**Реализация:** `react-modal-sheet` или MUI `<Drawer anchor="bottom">`

## Detail page tabs — 3 секции, не 7

Старая ошибка: ставить 7 tabs (`Overview`, `Time`, `Materials`, `Payments`, `History`, `Files`, `Wiki`...) — узкие табы, сложно нажать пальцем.

**Группировка в 3:**

| Tab | Содержимое |
|---|---|
| **Работа** | журнал + таймер + checklist + acceptance form |
| **Деньги** | estimate + материалы + процентовка + payments |
| **Контекст** | история + контакты + чертежи + wiki + dependencies |

Каждая tab внутри использует **accordion sections** для дальнейшей детализации (Materials → list of materials, expandable).

## Swipe gestures

| Gesture | Action |
|---|---|
| Swipe right на карточке | Mark complete (bottom sheet confirmation) |
| Swipe left на карточке | Archive |
| Pull down | Refresh |
| Long-press на карточке | Quick actions menu (assign, change priority) |

## Avoid

- **Hover-only interactions** — на mobile нет hover. Tooltip → tap to show.
- **Top-right action buttons** — недоступны большим пальцем.
- **Tiny "X" close buttons** — min 44×44 hit area, даже если visual icon мал.
- **Modal в центре экрана** — закрывает контент, кнопки часто наверху.
- **Pinch-zoom** — task cards не должны требовать zoom для чтения.

## Тест на устройстве

Phase 3 acceptance:
- [ ] Денис тестирует на своём iPhone в перчатке (или с одной рукой свободной)
- [ ] Бригадир тестирует на site
- [ ] Все primary actions достижимы большим пальцем без перехвата

## Devices

Прицельные devices для testing:
- iPhone 12 / 13 / 14 (iOS Safari)
- Samsung Galaxy S22 (Chrome Android)
- Дешевый Android (Honor / Xiaomi) — самые бюджетные у бригадиров

Min screen width: 360 px (минимум для текущих смартфонов).

---

**См. также:**
- [Principles](principles.md) — правило #5 mobile-first
- [Views](views.md) — Dispatch view особенно mobile-optimized
- [Task card anatomy](task-card-anatomy.md) — sizing для touch
