---
name: preflight_scanner
description: >
  Детерминированный (бесплатный) сканер PDF-чертежей.
  За доли секунды пробегает по всем страницам, читает текстовый слой
  и оценивает плотность ключевых слов. Классифицирует страницы по корзинам
  (Legend, Schedule, Drawing) и сохраняет Карту Проекта (manifest.json).
  ВСЕГДА вызывай ПЕРВЫМ при получении нового PDF.
---

# Preflight Scanner Skill

Мгновенный детерминированный сканер PDF-чертежей. Создаёт «Карту Проекта»
(`manifest.json`) — маршрутную карту для всех последующих навыков.

## Когда использовать

**ВСЕГДА первым** при получении нового PDF. Без манифеста ни один навык
не знает, какие страницы сканировать. Порядок:

```
1. preflight_scanner  → manifest.json  (бесплатно, <2 сек)
2. text_takeoff       → devices[]      (бесплатно, <1 сек)
3. vision_takeoff     → devices[]      (Vision API, ~5 мин)
```

## Как запустить

```bash
cd /Users/denysharbuzov/.openclaw/agents/profit_step/estimator
.venv/bin/python3 skills/preflight_scanner/scanner.py "/path/to/blueprint.pdf"
```

## Входные данные

| Параметр | Тип | Описание |
|----------|-----|----------|
| `pdf_path` | string | Абсолютный путь к PDF файлу проекта |

## Выходные данные

### stdout (JSON)
```json
{
  "status": "success",
  "manifest_path": "/path/to/manifest.json",
  "summary": {
    "total_pages": 90,
    "legends": 1,
    "schedules": 3,
    "drawings": 8,
    "scans_detected": 0
  }
}
```

### manifest.json (сохраняется рядом с PDF)
Полная карта проекта со скорами каждой страницы. Содержит:
- `project_identity` — имя файла, дата инъекции
- `qc_metrics` — общее кол-во страниц, сканы без текста
- `routing_buckets` — списки индексов страниц по типу
- `pages[]` — детальные метрики каждой страницы

## Routing Buckets

| Bucket | Описание | Критерий |
|--------|----------|----------|
| `legend_pages` | Легенда символов | ≥2 legend keywords |
| `schedule_pages` | Таблицы/спецификации | ≥2 schedule keywords |
| `drawing_pages` | Рабочие чертежи | combined_score ≥4, есть текст |
| `general_pages` | Прочее (титулы, ноты) | Всё остальное |

## Discipline Tags

Каждая drawing-страница получает теги:
- `ELEC` — электрика (power, lighting, receptacle)
- `FIRE_ALARM` — пожарная сигнализация
- `MECH` — механика (HVAC)
- `LOW_VOLT` — низковольтные системы
- `PLUMB` — сантехника

## QC Alerts

| Условие | Предупреждение |
|---------|----------------|
| `legends == 0` | Легенда не обнаружена → точность Vision снижена |
| `scans > 30%` | Много сканов без OCR → потребуется OCR-прогон |
| `drawings == 0` | Нет чертежей → возможно неэлектрический PDF |
