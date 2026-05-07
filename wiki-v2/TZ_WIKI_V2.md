# TZ — wiki-v2 — Navigation Index

**Версия:** 0.1 (initial draft, 2026-04-30)
**Статус:** Phase 0 — TZ in progress. Decisions pending. Zero code shipped.

> **Это файл-индекс**, не сам ТЗ. Полный ТЗ разнесён по файлам в [spec/](spec/)
> по аналогии с `tasktotime/spec/` так чтобы AI-агенты могли подгружать только
> релевантные части и не выжигать context на ненужном.

---

## Навигация

### 📋 Обзор

| Раздел | Файл | Что внутри |
|---|---|---|
| Контекст | [spec/01-overview/context.md](spec/01-overview/context.md) | Зачем модуль (5 бизнес-гэпов v1 wiki) |
| Цели | [spec/01-overview/goals.md](spec/01-overview/goals.md) | Что мы от v2 хотим — список outcomes |
| Архитектурное решение | [spec/01-overview/architecture-decision.md](spec/01-overview/architecture-decision.md) | **Hexagonal portable. Готовится к extract'у в npm с первого дня.** |

### 📦 Доменная модель

| Раздел | Файл | Что внутри |
|---|---|---|
| Три уровня | [spec/02-data-model/three-levels.md](spec/02-data-model/three-levels.md) | L1 Project KB / L2 Task wiki / L3 Company knowledge |
| Секции | [spec/02-data-model/sections.md](spec/02-data-model/sections.md) | Materials, Decisions, Blockers, Photos, Lessons, Notes — schema каждой |
| Wire types | [spec/02-data-model/wire-types.md](spec/02-data-model/wire-types.md) | TypeScript интерфейсы для REST + Firestore |

### 📲 Capture flows

| Раздел | Файл | Что внутри |
|---|---|---|
| Обзор | [spec/03-capture-flows/overview.md](spec/03-capture-flows/overview.md) | 4 пути ввода + общие принципы |
| Voice → Section | [spec/03-capture-flows/voice-to-section.md](spec/03-capture-flows/voice-to-section.md) | Whisper + AI structuring |
| Photo → Section | [spec/03-capture-flows/photo-to-section.md](spec/03-capture-flows/photo-to-section.md) | Vision API tagging + section suggestion |
| Receipt OCR | [spec/03-capture-flows/receipt-ocr.md](spec/03-capture-flows/receipt-ocr.md) | OCR → Materials entry |
| Manual edit | [spec/03-capture-flows/manual-edit.md](spec/03-capture-flows/manual-edit.md) | Web редактор fallback |

### 💾 Хранилище

| Раздел | Файл | Что внутри |
|---|---|---|
| Коллекции | [spec/04-storage/collections.md](spec/04-storage/collections.md) | `wikis_v2`, `wiki_sections`, indexes, rules |
| Миграция с v1 | [spec/04-storage/migration-from-v1.md](spec/04-storage/migration-from-v1.md) | Скрипт + cutover план |

### 🌐 API

| Раздел | Файл | Что внутри |
|---|---|---|
| REST + Callables | [spec/05-api/rest-and-callables.md](spec/05-api/rest-and-callables.md) | `/api/wiki-v2/*` + 4 callable functions |

### 🎨 UI/UX

| Раздел | Файл | Что внутри |
|---|---|---|
| View modes | [spec/06-ui-ux/view-modes.md](spec/06-ui-ux/view-modes.md) | PM / Foreman / Client / Agent — одна data, разный layout |
| Mobile-first capture | [spec/06-ui-ux/mobile-first-capture.md](spec/06-ui-ux/mobile-first-capture.md) | Чтобы бригадиру было удобно |

### 🤖 AI features

| Раздел | Файл | Что внутри |
|---|---|---|
| Enhance section | [spec/07-ai-features/enhance-section.md](spec/07-ai-features/enhance-section.md) | «Дополни wiki» — primary AI helper |
| Rollup | [spec/07-ai-features/rollup.md](spec/07-ai-features/rollup.md) | L2 → L3 при закрытии проекта |
| Cross-wiki search | [spec/07-ai-features/cross-wiki-search.md](spec/07-ai-features/cross-wiki-search.md) | RAG поверх всех wikis |

### 📦 Portability (это то что отличает wiki-v2 от tasktotime/)

| Раздел | Файл | Что внутри |
|---|---|---|
| Host contract | [spec/08-portability/host-contract.md](spec/08-portability/host-contract.md) | **Что host project должен реализовать чтобы юзать wiki-v2** |
| Extract to npm | [spec/08-portability/extract-to-npm.md](spec/08-portability/extract-to-npm.md) | Recipe миграции в отдельный package |
| What NOT to couple | [spec/08-portability/what-not-to-couple.md](spec/08-portability/what-not-to-couple.md) | Anti-patterns которые ломают портативность |

### 📁 Структура папок

[spec/09-folder-structure.md](spec/09-folder-structure.md) — полное дерево
`wiki-v2/{domain,ports,adapters,application,ui,shared,tests}/`.

### 🤔 Решения

| Раздел | Файл | Что внутри |
|---|---|---|
| Open questions | [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) | **Сюда вписываешь решения Дениса** |
| Decision log | [spec/10-decisions/decision-log.md](spec/10-decisions/decision-log.md) | По мере решения вопросов |
| What NOT to do | [spec/10-decisions/what-not-to-do.md](spec/10-decisions/what-not-to-do.md) | Жёсткие анти-паттерны (ALL agents) |

---

## Где править что

| Хочу изменить... | Открой файл |
|---|---|
| Добавить новую секцию | [spec/02-data-model/sections.md](spec/02-data-model/sections.md) |
| Добавить новый capture flow | [spec/03-capture-flows/](spec/03-capture-flows/) (новый файл) |
| Добавить AI helper | [spec/07-ai-features/](spec/07-ai-features/) (новый файл) |
| Понять что host project должен дать | [spec/08-portability/host-contract.md](spec/08-portability/host-contract.md) |
| Ответы на open questions | [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) |

---

## Changelog

- **v0.1 (2026-04-30)** — initial scaffold. 25 files. Decisions pending. Zero
  code. Phase 0 only.
