# 🏗️ Estimator Department — Developer Guide

## Для кого этот файл
Этот документ — **полная инструкция** для любого разработчика (или AI-агента),
который будет продолжать работу над мультиагентной системой Estimator Department.

---

## 📁 Структура проекта

```
estimator/
│
├── README.md                    ← ТЫ ЗДЕСЬ. Читай первым!
│
├── chief_estimator/             ← МОЗГ системы
│   ├── SOUL.md                     Личность, 6 принципов (не менять без причины!)
│   └── AGENTS.md                   SOP: 6 шагов, HITL checkpoint, Schedule-First Dedup
│                                   MODEL: Claude 3.5 Sonnet
│
├── archivist_v2/                ← Суб-агент разведки
│   └── AGENTS.md                   Preflight workflow, MODEL: gpt-4o-mini
│
├── skills/                      ← 6 изолированных навыков
│   ├── preflight_scanner/          FREE, <1с. Классификация страниц PDF
│   ├── text_takeoff/               FREE, <1с. Текстовый парсинг (PyMuPDF)
│   ├── vision_9grid_scanner/       ~$0.27/стр. 3×3 нарезка + GPT-4o Vision
│   ├── schedule_parser/            ~$0.10/стр. Парсинг таблиц (Vision)
│   ├── legend_extractor/           ~$0.10. Извлечение символов (Vision)
│   └── export_to_excel/            FREE. JSON → .xlsx (2 листа)
│
├── takeoff_agent.py             ← LEGACY монолит v5 (1100 строк)
│                                   НЕ ТРОГАТЬ — используется как reference
│
└── test_blueprints/             ← Golden Dataset
    ├── LLL 10870 Bal Harbour... ← 90-страничный PDF (Lululemon)
    └── manifest.json            ← Результат preflight_scanner
```

---

## 🔑 Золотые правила

### 1. stdout = данные, stderr = логи
```python
# ✅ ПРАВИЛЬНО — агент читает только это
print(json.dumps(result))

# ✅ ПРАВИЛЬНО — разработчик видит, агент нет
print("Прогресс...", file=sys.stderr)

# ❌ НЕПРАВИЛЬНО — сломает JSON для агента
print("Обработано!")
print(json.dumps(result))
```

### 2. Pydantic = контракт
Каждый навык использует Pydantic-схемы для structured output.
**Нельзя** менять поля `DeviceEntry` без обновления ВСЕХ навыков.

```python
class DeviceEntry(BaseModel):
    section: Literal[...]     # 8 секций — финальный список
    device_type: str          # Полное название
    symbol_on_drawing: str    # Символ на чертеже
    zone: str                 # Зона / комната
    quantity: int             # Штук
    confidence: Literal[...]  # certain / likely / uncertain
```

### 3. Schedule-First Dedup
```
Освещение  → qty из SCHEDULE (авторитет), зоны из Drawing
Розетки    → qty из DRAWING (таблиц нет), зоны из Drawing
HVAC/Equip → qty из TEXT (pyMuPDF, 100%)
Low Volt   → qty из DRAWING, типы из Keynotes
Fire Alarm → qty из DRAWING
```

### 4. Native OpenAI, не LangChain
```python
# ✅ ПРАВИЛЬНО
from openai import OpenAI
response = client.beta.chat.completions.parse(
    model="gpt-4o",
    response_format=MyPydanticModel
)

# ❌ НЕПРАВИЛЬНО — тяжёлый, нестабильный
from langchain_openai import ChatOpenAI
```

### 5. Rate Limit Protection
```python
# Обязательно в каждом Vision-навыке:
time.sleep(0.5)               # Throttle между вызовами
for attempt in range(3):       # 3 попытки
    if "429" in err:
        time.sleep((attempt+1) * 2)  # Exponential backoff
```

---

## 🧪 Как тестировать

### Этап 1: Unit (без API, бесплатно)
```bash
cd ~/.openclaw/agents/profit_step/estimator

# Preflight — должен найти 55 draw, 21 sched, 11 legend
.venv/bin/python3 skills/preflight_scanner/scanner.py "test_blueprints/LLL 10870 ..."

# Text — должен найти 64 devices
.venv/bin/python3 skills/text_takeoff/text_takeoff.py "test_blueprints/LLL 10870 ..."

# Excel — должен создать .xlsx
echo '{"devices":[...]}' | .venv/bin/python3 skills/export_to_excel/exporter.py --input - --output /tmp/test.xlsx
```

### Этап 2: Integration (1 страница, ~$0.30)
```bash
# Vision Scanner — одна страница
OPENAI_API_KEY="sk-..." .venv/bin/python3 skills/vision_9grid_scanner/scanner.py \
  --pdf_path "test_blueprints/LLL 10870 ..." --page_num 55

# Schedule Parser — одна таблица
OPENAI_API_KEY="sk-..." .venv/bin/python3 skills/schedule_parser/parser.py \
  --pdf_path "test_blueprints/LLL 10870 ..." --pages 58

# Legend — одна страница
OPENAI_API_KEY="sk-..." .venv/bin/python3 skills/legend_extractor/extractor.py \
  --pdf_path "test_blueprints/LLL 10870 ..." --page_num 52
```

### Этап 3: E2E (полная цепочка)
```bash
# 1. Preflight → manifest
# 2. Text → 64 devices
# 3. Legend → symbols
# 4. Schedule → fixture qty
# 5. Vision → ~120 devices per drawing page
# 6. Chief Estimator → DEDUP → Report
# 7. Export → Excel
```

---

## 🛠 Как добавить новый навык

1. Создай папку: `skills/my_new_skill/`
2. Создай `SKILL.md` с YAML frontmatter:
   ```yaml
   ---
   name: my_new_skill
   description: "Что делает навык..."
   ---
   ```
3. Создай `my_script.py`:
   - `argparse` для CLI
   - `log()` → stderr
   - `print(json.dumps(...))` → stdout
   - Pydantic для structured output (если Vision)
   - Rate limit protection (если API)
4. Добавь навык в `chief_estimator/AGENTS.md` таблицу инструментов
5. Протестируй standalone в терминале

---

## 📊 Model Routing

| Агент/Навык | Модель | Почему |
|-------------|--------|--------|
| J.A.R.V.I.S. (CEO) | Claude Sonnet 4 | Маршрутизация |
| Chief Estimator | Claude 3.5 Sonnet | Длинный контекст, строгий SOP |
| Vision навыки | GPT-4o | Лучший Vision + .parse |
| Archivist V2 | gpt-4o-mini | Простые задачи |
| FREE навыки | Python only | Без AI |

---

## 🚀 Roadmap

- [ ] `manifest.json` → интеграция в pipeline (`--manifest` флаг)
- [ ] End-to-end тест на полном PDF
- [ ] OpenCV template matching для розеток
- [ ] CSV export для сметных программ
- [ ] Batch mode (несколько PDF за раз)

---

## ⚠️ Чего НЕ делать

1. **Не менять DeviceEntry** без обновления всех навыков
2. **Не print() в stdout** кроме финального JSON
3. **Не удалять takeoff_agent.py** — это reference implementation
4. **Не использовать LangChain** внутри навыков
5. **Не запускать Vision** без HITL checkpoint
6. **Не менять SOUL.md** без веской причины — это "подкорка" агента
