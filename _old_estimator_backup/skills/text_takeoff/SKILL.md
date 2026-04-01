---
name: text_takeoff
description: >
  Извлекает 100% точные данные о количестве оборудования, выделенных линиях
  и панелях напрямую из текстового слоя PDF (БЕЗ Vision API).
  Это БЕСПЛАТНО и мгновенно.
  ВСЕГДА используй этот навык ПЕРЕД запуском визуального сканирования чертежей.
---

# Text Takeoff Skill

Извлекает структурированные данные об электрическом оборудовании из текстового
слоя PDF-чертежей. Работает мгновенно и бесплатно (без API-вызовов).

## Когда использовать

**ВСЕГДА** перед визуальным сканированием (9-grid Vision). Этот навык даёт
«бесплатную базу» — точные данные из текста, которые Vision API часто пропускает:
- Панельные расписания (все circuit descriptions)
- Keynotes (типы оборудования: розетки, HVAC, LV)
- Equipment Connection Schedule (HVAC tags)

## Как запустить

```bash
cd /Users/denysharbuzov/.openclaw/agents/profit_step/estimator
.venv/bin/python3 skills/text_takeoff/text_takeoff.py "/path/to/blueprint.pdf"
```

## Входные данные

| Параметр | Тип | Описание |
|----------|-----|----------|
| `pdf_path` | string | Абсолютный путь к PDF файлу проекта |

## Выходные данные (JSON → stdout)

```json
{
  "status": "success",
  "total_extracted": 64,
  "sources": {
    "panel_schedule": 32,
    "keynotes": 26,
    "equipment_connections": 6
  },
  "devices": [
    {
      "section": "5_receptacles",
      "device_type": "Receptacle: NON-SALES LTG",
      "symbol_on_drawing": "Panel Schedule",
      "zone": "Per Panel Schedule",
      "quantity": 1,
      "notes": "from panel text p.54",
      "confidence": "certain"
    }
  ]
}
```

## Секции устройств

| Код | Название |
|-----|----------|
| `1_distribution` | Panel, Transformer, Disconnect |
| `2_hvac_connections` | WSHP, DH, EF, RTU, Water Heater |
| `3_lighting` | Circuit descriptions для LTG |
| `4_lighting_controls` | Contactor, Lighting Control |
| `5_receptacles` | Duplex, GFCI, Dedicated, Cash Register |
| `6_low_voltage` | Data, EAS, Speaker, Camera, WAP |
| `7_fire_alarm` | FACP, FA circuits |
| `8_rough_in` | Junction Box, Network Ladder |

## 3 парсера внутри

### 1. Panel Schedule Text Parser
Ищет страницы с `panelboard` + `load description`, классифицирует каждую
строку circuit description по категориям (receptacle, lighting, HVAC, FA, LV).

### 2. Keynotes Counter
Находит страницы с `KEYNOTES:` в тексте и матчит 30+ ключевых слов
(STOREFRONT RECEPTACLE, CASH REGISTER, EAS, WAP, SPEAKER и т.д.)

### 3. Equipment Connection Schedule
Находит текст `EQUIPMENT CONNECTION SCHEDULE` и извлекает HVAC-теги
(WSHP-1, DH-1, EF-1, RTU-1) через regex.

## Интеграция с Chief Estimator

Результат этого навыка передаётся в контекст Главного Сметчика как
«бесплатная база». Затем Vision-сканирование добавляет визуально найденные
устройства, а агрегатор выполняет dedup (schedule-first для lighting).
