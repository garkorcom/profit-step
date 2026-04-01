# 🔧 Как посчитать Electrical Estimate

## Быстрый старт (2 команды)

```bash
cd ~/.openclaw/agents/profit_step/estimator

# 1. Text Takeoff — FREE, ~8 сек
.venv/bin/python3 skills/text_takeoff/text_takeoff.py "ПУТЬ_К_PDF" > /tmp/extract.json

# 2. Vision Scan (Ollama) — FREE, ~7 мин
# Сначала убедись что Ollama запущен:
brew services start ollama
```

---

## Полный пошаговый процесс

### Шаг 1: Preflight (узнать что в PDF)
```bash
.venv/bin/python3 skills/preflight_scanner/scanner.py "ПУТЬ_К_PDF"
# → manifest.json: какие страницы план, schedule, legend
```

### Шаг 2: Text Takeoff (5 парсеров, $0)
```bash
.venv/bin/python3 skills/text_takeoff/text_takeoff.py "ПУТЬ_К_PDF" > /tmp/extract.json
```
Что делает:
- **Parser 1:** Panel Schedule → circuits, HVAC
- **Parser 2:** Keynotes → device types (LV, receptacles)  
- **Parser 3:** Equipment Schedule → HVAC tags (WSHP-1, DH-1)
- **Parser 4:** Fixture Counter → точные qty ламп из RCP
- **Parser 5:** Power/Switch marks → DG, GFCI, CT, SF, OS, VS, SD

### Шаг 3: Vector Extractor ($0)
```bash
.venv/bin/python3 skills/vector_extractor/vector_extractor.py \
  --pdf_path "ПУТЬ_К_PDF" --page_num НОМЕР_СТРАНИЦЫ
# → vector vs raster, CAD blocks если есть
```

### Шаг 4: Vision Scan — Qwen2.5-VL LOCAL ($0)
```python
# Скрипт: skills/vision_9grid_scanner/scanner.py
# Пока не подключен к Ollama — запускать вручную:

import fitz, base64, requests, json

doc = fitz.open("ПУТЬ_К_PDF")
page = doc.load_page(НОМЕР_СТРАНИЦЫ)  # Power Plan

# 5x5 grid, zoom 8x
GRID, ZOOM = 5, 8.0
w, h = page.rect.width, page.rect.height

for row in range(GRID):
    for col in range(GRID):
        clip = fitz.Rect(col*w/GRID, row*h/GRID, (col+1)*w/GRID, (row+1)*h/GRID)
        pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=clip)
        img_b64 = base64.b64encode(pix.tobytes('png')).decode()
        
        resp = requests.post('http://localhost:11434/api/chat', json={
            'model': 'qwen2.5vl:7b',
            'messages': [{'role':'user','content':'Count electrical devices...','images':[img_b64]}],
            'stream': False
        })
        print(resp.json()['message']['content'])
```

### Шаг 5: Auditor ($0)
```bash
.venv/bin/python3 skills/auditor/auditor.py \
  --extract /tmp/extract.json \
  --count /tmp/vision_count.json
# → audit_report: confirmed, contradictions, blind spots
```

### Шаг 6: Результат
```bash
cat /tmp/extract.json | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(f'Devices: {d[\"total_extracted\"]}')
for dev in d['devices']:
    print(f'  {dev[\"symbol_on_drawing\"]:12s} x{dev[\"quantity\"]:3d}  {dev[\"device_type\"][:40]}  [{dev.get(\"source_type\",\"?\")}]')
"
```

---

## Тестовый PDF (Lululemon)
```bash
cd ~/.openclaw/agents/profit_step/estimator
PDF="test_blueprints/LLL 10870 Bal Harbour Shops - IFB Set - 03.12.26.pdf"

# Быстрый тест:
.venv/bin/python3 skills/text_takeoff/text_takeoff.py "$PDF" | python3 -m json.tool | head -50
```

---

## Требования
- Python 3.11+ с PyMuPDF (`pip install pymupdf`)
- Ollama (`brew install ollama && brew services start ollama`)
- Модель: `ollama pull qwen2.5vl:7b` (5GB)
- OpenAI API key (только для Schedule Parser и Legend Extractor)
