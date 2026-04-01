---
name: schedule_parser
description: >
  Парсер таблиц (Schedules) с чертежей методом Vision API.
  Извлекает Lighting Fixture Schedule, Equipment Connection Schedule,
  Panel Schedule из визуальных таблиц. Возвращает структурированный JSON
  с типами оборудования, марками, количеством и спецификациями.
  Использовать ТОЛЬКО для страниц с тегом SCHEDULE из manifest.
---

# Schedule Parser Skill

Vision-парсер таблиц (Fixture Schedule, Panel Schedule, Equipment Schedule).
Извлекает авторитетные количества для Section 3 (Lighting).

## Когда использовать

**ШАГ 3** в SOP Chief Estimator — после preflight и text_takeoff.
Только для страниц из `manifest["schedule_pages"]`.

## Как запустить

```bash
OPENAI_API_KEY="sk-..." .venv/bin/python3 skills/schedule_parser/parser.py \
  --pdf_path "/path/to/blueprint.pdf" \
  --pages 52,53,58
```

## Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|:------------:|----------|
| `pdf_path` | string | ✅ | Путь к PDF |
| `pages` | string | ✅ | Запятая-разделённые индексы (0-based) |

## Выходные данные (stdout JSON)

```json
{
  "status": "success",
  "total_entries": 26,
  "schedules": [
    {
      "page": 58,
      "title": "Lighting Fixture Schedule",
      "entries": [
        {
          "mark": "RX-1",
          "device_type": "4\" LED Recessed Downlight",
          "section": "3_lighting",
          "quantity": 45,
          "specs": "Lutron, 120V, 12W"
        }
      ]
    }
  ]
}
```

## Авторитетность

Данные Schedule = **АВТОРИТЕТНЫЙ ИСТОЧНИК КОЛИЧЕСТВА** для:
- Lighting Fixtures (qty из Fixture Schedule)
- HVAC Equipment (connections из Equipment Schedule)

Chief Estimator применяет **Schedule-First Dedup**: если Schedule = 40,
а Drawing нашёл 45 → в отчёт идёт **40**.
