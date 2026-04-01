---
name: legend_extractor
description: >
  Извлекает символы и обозначения из легенды электрических чертежей.
  Возвращает текстовую выжимку (symbol → device_type mapping),
  которую vision_9grid_scanner использует как контекст для более
  точного распознавания символов на чертежах.
  Использовать для страниц с тегом LEGEND из manifest.
---

# Legend Extractor Skill

Vision-извлечение символов из Legend/Symbol List страниц.
Генерирует `legend_context` для 9-grid scanner.

## Когда использовать

**ШАГ 3** в SOP Chief Estimator — параллельно с schedule_parser.
Только для страниц из `manifest["legend_pages"]`.

## Как запустить

```bash
OPENAI_API_KEY="sk-..." .venv/bin/python3 skills/legend_extractor/extractor.py \
  --pdf_path "/path/to/blueprint.pdf" \
  --page_num 52
```

## Выходные данные (stdout JSON)

```json
{
  "status": "success",
  "total_symbols": 30,
  "legend_context": "RX-1=4\" Recessed LED Downlight\nTL1=Track Light\nS=Single Pole Switch...",
  "symbols": [
    {
      "symbol": "RX-1",
      "description": "4\" Recessed LED Downlight",
      "category": "Lighting"
    }
  ]
}
```

## Интеграция

`legend_context` передаётся в `vision_9grid_scanner --legend_context "..."`
для значительного улучшения точности распознавания символов.
