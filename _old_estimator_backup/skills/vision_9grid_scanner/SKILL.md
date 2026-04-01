---
name: vision_9grid_scanner
description: >
  Тяжёлый визуальный сканер рабочих чертежей (Drawing pages).
  Нарезает страницу на 9 секторов (сетка 3×3), применяет зум 3.0x
  и использует Vision AI (gpt-4o) для точного подсчёта мелких символов.
  Автоматически пропускает пустые зоны. Возвращает строго структурированный
  JSON. Использовать ТОЛЬКО для страниц с тегом DRAWING из manifest.
---

# Vision 9-Grid Scanner Skill

Визуальный сканер чертежей на базе GPT-4o Vision. Нарезает каждую
страницу на 9 секторов (3×3) при зуме 3.0x для точного подсчёта
мелких символов: розеток, выключателей, детекторов.

## Когда использовать

**ШАГ 4** в SOP Chief Estimator — **после** preflight, text_takeoff и schedules.
Использовать **ТОЛЬКО** для страниц из `manifest["drawing_pages"]`.

## Как запустить

```bash
cd /Users/denysharbuzov/.openclaw/agents/profit_step/estimator
OPENAI_API_KEY="sk-..." .venv/bin/python3 skills/vision_9grid_scanner/scanner.py \
  --pdf_path "/path/to/blueprint.pdf" \
  --page_num 55 \
  --legend_context "RX=Recessed Downlight, S=Switch, GFCI=Ground Fault"
```

## Параметры

| Параметр | Тип | Обязательный | Описание |
|----------|-----|:------------:|----------|
| `pdf_path` | string | ✅ | Путь к PDF |
| `page_num` | int | ✅ | Индекс страницы (0-based) |
| `legend_context` | string | ❌ | Текст символов из легенды |

## Вывод

- **stdout** → строгий JSON для Chief Estimator (единственный `print()`)
- **stderr** → технические логи прогресса (невидимы агенту)

```json
{
  "status": "success",
  "page_index": 55,
  "summary": {
    "total_devices_found": 25,
    "zones_detected": ["Sales Floor", "Cashwrap", "BOH"]
  },
  "devices": [
    {
      "section": "5_receptacles",
      "device_type": "Duplex Receptacle",
      "symbol_on_drawing": "circle-with-lines",
      "zone": "Sales Floor",
      "quantity": 3,
      "confidence": "certain"
    }
  ],
  "needs_verification": []
}
```

## Техническая архитектура

```
PDF page → fitz.get_pixmap(clip, zoom=3.0) → 9 JPEG cells
  → skip if <50KB (blank)
  → GPT-4o Vision (structured output via Pydantic)
  → merge all cells → JSON to stdout
```

### Защита от Rate Limits
- 0.5s throttle между каждым Vision call
- 3-attempt retry с exponential backoff (2s, 4s)
- Ошибки записываются в `needs_verification`

### Scan Method: Walls → Ceiling → Floor
Промпт заставляет модель сканировать в строгом порядке:
1. **Стены** — розетки, выключатели, панели
2. **Потолок** — светильники, детекторы, спикеры
3. **Пол** — floor boxes, poke-thru

## Стоимость

~9 Vision calls на страницу × ~$0.03 = **~$0.27/стр**
При 8 чертежах: **~$2.20 total**
