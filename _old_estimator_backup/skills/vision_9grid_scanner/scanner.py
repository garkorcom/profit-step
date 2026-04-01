#!/usr/bin/env python3
"""
Vision 9-Grid Scanner — OpenClaw Estimator Department
======================================================
ШАГ 5 в SOP Chief Estimator. Самый дорогой навык (~$0.27/страница).

Тяжёлый визуальный сканер рабочих чертежей.
Нарезает страницу на 9 секторов (3×3), каждый с zoom 3.0x,
отправляет в GPT-4o Vision с Pydantic Structured Output.
Пропускает пустые ячейки (<50KB). Защита от rate limits.

КЛЮЧЕВЫЕ ОТЛИЧИЯ ОТ МОНОЛИТА v5:
  - Native OpenAI client (без LangChain — легче, быстрее)
  - stderr/stdout разделение (логи не ломают JSON)
  - Pydantic schema: CellTakeoff.devices[] → DeviceEntry
  - 3-attempt retry с exponential backoff на 429
  - argparse CLI для standalone запуска

СТОИМОСТЬ: ~$0.27/стр (9 cells × ~$0.03/cell)
ВРЕМЯ: ~60 сек/страница

Usage:
    python scanner.py --pdf_path blueprint.pdf --page_num 55
    python scanner.py --pdf_path blueprint.pdf --page_num 55 --legend_context "RX=Downlight"
"""

import os
import sys
import json
import time
import base64
import argparse

try:
    import fitz  # PyMuPDF
    from PIL import Image
    from io import BytesIO
    from pydantic import BaseModel, Field
    from typing import List, Literal, Optional
    from openai import OpenAI
except ImportError as e:
    print(json.dumps({"status": "error", "message": f"Missing library: {e}"}))
    sys.exit(1)

# Validate API key
if not os.environ.get("OPENAI_API_KEY"):
    print(json.dumps({"status": "error", "message": "OPENAI_API_KEY not set"}))
    sys.exit(1)

client = OpenAI()


def log(msg):
    """Progress logs → stderr (invisible to agent, visible in terminal)."""
    print(msg, file=sys.stderr, flush=True)


# ==================================================================
# 1. PYDANTIC SCHEMAS (Контракт структурированного вывода)
# ==================================================================
# Гарантирует что GPT-4o вернёт данные ТОЧНО в этом формате.
# Без Pydantic GPT-4o может вернуть "qty: around 5" вместо {"quantity": 5}.
# ВАЖНО: DeviceEntry.section MUST быть Literal из 8 секций.
#          Если добавляешь 9-ю секцию — меняй ВСЕ Pydantic схемы!
# ==================================================================

class DeviceEntry(BaseModel):
    section: Literal[
        "1_distribution", "2_hvac_connections", "3_lighting",
        "4_lighting_controls", "5_receptacles", "6_low_voltage",
        "7_fire_alarm", "8_rough_in"
    ]
    device_type: str
    symbol_on_drawing: str = ""
    zone: str = "Unknown"
    quantity: int
    notes: str = ""
    confidence: Literal["certain", "likely", "uncertain"] = "certain"


class CellTakeoff(BaseModel):
    """What the Vision model returns for one grid cell."""
    zones_identified: List[str] = Field(default_factory=list)
    devices: List[DeviceEntry] = Field(default_factory=list)
    needs_verification: List[str] = Field(default_factory=list)


# ==================================================================
# 2. SCAN PROMPT — Walls → Ceiling → Floor
# ==================================================================
# Логика промпта: направляем взгляд GPT-4o последовательно:
#   1. Стены (розетки и выключатели — самые мелкие!)
#   2. Потолок (светильники, детекторы, спикеры)
#   3. Пол (напольные коробки, пок-тру)
# Эта последовательность подняла точность с 65% до 80% в v5.
# {legend_context} заменяется на символы из legend_extractor.
# ==================================================================

GRID_SCAN_PROMPT = """You are a Chief Electrical Estimator performing a PRECISE device takeoff.
You see ONE CELL of a 3x3 grid from a construction floor plan.
Count ONLY devices visible in THIS cell.

SCAN METHOD: Look at WALLS first, then CEILING, then FLOOR.

■ WALLS — scan left-to-right along every wall segment:
  RECEPTACLES (Section 5):
    • Duplex outlet = small circle/semicircle with 2 short parallel lines touching wall
    • GFCI = same shape marked "GFI"/"GFCI" or near sink/wet area
    • Dedicated = has circuit # label ("P-5", "20A", "DED")
    TIP: Count EVERY circle-with-lines symbol on walls. They are small!
  
  SWITCHES (Section 4):
    • S = single pole, S3/S4 = 3-way/4-way, SD = dimmer
    • OS/VS = occupancy/vacancy sensor (small rectangle near door)

■ CEILING — scan across the ceiling area:
  LIGHTING (Section 3):
    • RX = Recessed Downlight (circle or square on ceiling)
    • TL = Track Light (line with marks)
    • FL = Fluorescent/Linear (rectangle)
    • EM/EX = Emergency/Exit light
    • Cove = Cove lighting (dashed line along wall/ceiling edge)
  
  FIRE ALARM (Section 7):
    • SD = Smoke Detector (circle on ceiling — NOT a switch on wall!)
    • H/S = Horn/Strobe (circle with zigzag or "H/S" label)
    • HD = Heat Detector
    • Pull Station = near exit doors
  
  LOW VOLTAGE (Section 6):
    • SP = Speaker (circle with "SP")
    • CAM/CMB/CMW = Camera
    • WAP = WiFi Access Point
    • OCC = Occupancy sensor

■ FLOOR — look for floor-mounted items:
    • Floor box / Poke-thru (square symbol on floor)

{legend_context}

CRITICAL RULES:
1. Count EACH symbol individually. 5 circles on ceiling = qty 5, not 1.
2. Duplex outlets are VERY SMALL — look carefully at EVERY wall line.
3. Smoke detectors are on CEILING. Dimmers (SD) are on WALLS near doors.
4. If a symbol is partially cut off at cell edge, count it only if >50% visible.
5. If uncertain about a symbol, set confidence to "uncertain" and add to needs_verification."""


# ==================================================================
# 3. GRID CELL CROPPER (Нарезка на 9 секторов)
# ==================================================================
# Почему 9 ячеек, а не 1 страница?
# GPT-4o на полностраничном чертеже пропускает 40-50% символов.
# Нарезка 3×3 + zoom 3.0x даёт козырёк: каждый символ становится
# visual prominence достаточным для Vision API.
#
# MIN_CELL_BYTES = 50KB: пустые ячейки (title block, поля)
# меньше 50KB и не содержат данных. Экономим ~$0.06/стр.
# ==================================================================

CELL_LABELS = [
    "Top-Left",    "Top-Center",  "Top-Right",
    "Mid-Left",    "Mid-Center",  "Mid-Right",
    "Bot-Left",    "Bot-Center",  "Bot-Right"
]

MIN_CELL_BYTES = 50_000  # Skip cells smaller than 50KB (blank/title block)


def crop_cell(pdf_path, page_num, row, col, zoom=3.0):
    """Crop one cell from 3×3 grid. Returns (base64_jpeg, size_bytes)."""
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)

    w, h = page.rect.width, page.rect.height
    cw, ch = w / 3, h / 3
    clip = fitz.Rect(col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)

    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip)

    im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=85, optimize=True)
    jpeg = buf.getvalue()

    doc.close()
    return base64.b64encode(jpeg).decode("utf-8"), len(jpeg)


# ==================================================================
# 4. VISION API CALL (native OpenAI, structured output)
# ==================================================================
# Используем client.beta.chat.completions.parse (aне LangChain).
# parse() гарантирует Pydantic schema в ответе.
# 3 попытки с exponential backoff (2s, 4s, 6s) на 429.
# ==================================================================

def vision_scan_cell(img_b64, cell_label, prompt):
    """Send one cell to GPT-4o Vision. Returns CellTakeoff or None."""
    for attempt in range(3):
        try:
            if attempt > 0:
                wait = (attempt + 1) * 2
                log(f"      ⏳ Retry {attempt+1}/3, waiting {wait}s...")
                time.sleep(wait)
            else:
                time.sleep(0.5)  # Throttle between calls

            response = client.beta.chat.completions.parse(
                model="gpt-4o",
                temperature=0,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": [
                        {
                            "type": "text",
                            "text": f"SCAN cell [{cell_label}]: Walls → Ceiling → Floor. Count EVERY device."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{img_b64}",
                                "detail": "high"
                            }
                        }
                    ]}
                ],
                response_format=CellTakeoff
            )

            return response.choices[0].message.parsed

        except Exception as e:
            err = str(e)
            if "429" in err and attempt < 2:
                continue
            else:
                log(f"      ❌ API error: {err}")
                return None

    return None


# ==================================================================
# 5. MAIN SCANNER — ОРКЕСТРАТОР 9 ЯЧЕЕК
# ==================================================================
# Flow:
#   1. Построить prompt (с legend_context если есть)
#   2. Пробежать 3×3 = 9 ячеек
#   3. Каждую ячейку: crop → check size → Vision API → merge
#   4. Вернуть объединённый список devices + summary
# ==================================================================

def scan_page(pdf_path, page_num, legend_context=""):
    """Scan one page using 9-grid at 3.0x zoom. Returns result dict."""
    if not os.path.exists(pdf_path):
        return {"status": "error", "message": f"File not found: {pdf_path}"}

    # Build prompt with optional legend
    legend_block = ""
    if legend_context:
        legend_block = f"KNOWN SYMBOLS FROM LEGEND:\n{legend_context}"
    prompt = GRID_SCAN_PROMPT.replace("{legend_context}", legend_block)

    all_devices = []
    all_verif = []
    all_zones = set()
    cells_scanned = 0
    cells_skipped = 0

    log(f"🔍 9-Grid scan: page {page_num + 1}")

    for r in range(3):
        for c in range(3):
            idx = r * 3 + c
            label = CELL_LABELS[idx]

            # Crop cell
            img_b64, size_bytes = crop_cell(pdf_path, page_num, r, c, zoom=3.0)

            # Skip blank cells
            if size_bytes < MIN_CELL_BYTES:
                log(f"   [{label:>10s}] ⬜ blank ({size_bytes//1000}KB) — skip")
                cells_skipped += 1
                continue

            log(f"   [{label:>10s}] 📷 {size_bytes//1000}KB → Vision API...")

            # Call Vision
            result = vision_scan_cell(img_b64, label, prompt)
            cells_scanned += 1

            if result is None:
                all_verif.append(f"Cell {label}: scan failed")
                continue

            n = sum(d.quantity for d in result.devices)
            log(f"              ✅ {n} devices")

            # Merge results, tag each device with cell zone
            for dev in result.devices:
                d = dev.model_dump()
                if d["zone"] == "Unknown":
                    d["zone"] = label
                all_devices.append(d)

            all_verif.extend(result.needs_verification)
            all_zones.update(result.zones_identified)

    log(f"   📊 Done: {cells_scanned} cells scanned, {cells_skipped} skipped")

    return {
        "status": "success",
        "page_index": page_num,
        "page_number": page_num + 1,
        "summary": {
            "total_devices_found": sum(d.get("quantity", 0) for d in all_devices),
            "cells_scanned": cells_scanned,
            "cells_skipped": cells_skipped,
            "zones_detected": sorted(all_zones)
        },
        "devices": all_devices,
        "needs_verification": all_verif
    }


# ==================================================================
# CLI ENTRY POINT
# ==================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Vision 9-Grid Scanner — scan one drawing page"
    )
    parser.add_argument("--pdf_path", required=True, help="Path to PDF")
    parser.add_argument("--page_num", type=int, required=True,
                        help="Page index (0-based)")
    parser.add_argument("--legend_context", type=str, default="",
                        help="Legend text for context")
    args = parser.parse_args()

    result = scan_page(args.pdf_path, args.page_num, args.legend_context)

    # ONLY print to stdout — this is what the agent reads
    print(json.dumps(result, ensure_ascii=False, indent=2))
