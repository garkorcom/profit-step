---
name: export_to_excel
description: >
  Конвертирует итоговый JSON от Главного Сметчика в Excel (.xlsx).
  Лист 1: Сводка по 8 секциям с subtotals.
  Лист 2: Распределение устройств по зонам.
  Для загрузки в сметные программы (AccuBid, Procore, Excel).
---

# Export to Excel Skill

Конвертирует JSON takeoff → профессиональный Excel отчёт.

## Как запустить

```bash
# Из файла
python skills/export_to_excel/exporter.py --input result.json --output report.xlsx

# Из stdin (от другого навыка)
python text_takeoff.py blueprint.pdf | python exporter.py --input - --output report.xlsx
```

## Параметры

| Параметр | Тип | Описание |
|----------|-----|----------|
| `--input` | string | JSON-файл или `-` для stdin |
| `--output` | string | Путь для .xlsx файла |

## Excel листы

### Sheet 1: Takeoff Summary
- 8 секций с цветными headers
- Subtotal по каждой секции
- Grand Total внизу
- Колонки: Section, Device Type, Symbol, Qty, Zone, Source, Notes

### Sheet 2: Zone Distribution
- Все устройства сгруппированы по зонам (комнатам)
- Для быстрого понимания нагрузки на каждую зону

## Зависимости

```bash
pip install openpyxl
```
