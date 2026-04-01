#!/usr/bin/env python3
"""
Schedule Parser — OpenClaw Estimator Department
=================================================
ШАГ 4 в SOP Chief Estimator. АВТОРИТЕТНЫЙ источник количеств.

Vision-парсер для schedule страниц (Fixture, Panel, Equipment).
Извлекает АВТОРИТЕТНЫЕ количества для освещения и HVAC.

ПОЧЕМУ ВАЖНО: Schedule-First Dedup правило гласит:
  "Если в Schedule написано 40 светильников, а Vision нашёл 45 —
  верим Schedule. Этот навык даёт эталонные цифры."

Native OpenAI + Pydantic SchedulePage schema.
stderr → логи, stdout → JSON.
Стоимость: ~$0.10/страница.

Usage:
    python parser.py --pdf_path blueprint.pdf --pages 52,53,58
"""

import os
import sys
import json
import time
import base64
import argparse

try:
    import fitz
    from PIL import Image
    from io import BytesIO
    from pydantic import BaseModel, Field
    from typing import List, Literal, Optional
    from openai import OpenAI
except ImportError as e:
    print(json.dumps({"status": "error", "message": f"Missing library: {e}"}))
    sys.exit(1)

if not os.environ.get("OPENAI_API_KEY"):
    print(json.dumps({"status": "error", "message": "OPENAI_API_KEY not set"}))
    sys.exit(1)

client = OpenAI()


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# ==================================================================
# SCHEMAS (контракт структурированного вывода)
# ==================================================================
# ScheduleEntry: одна строка из таблицы (=1 fixture type + qty)
# SchedulePage: одна страница, содержащая entries[]
# ==================================================================

class ScheduleEntry(BaseModel):
    mark_or_code: str = Field(description="Fixture mark, equipment tag, or circuit ID")
    device_type: str = Field(description="Full device description")
    section: Literal[
        "1_distribution", "2_hvac_connections", "3_lighting",
        "4_lighting_controls", "5_receptacles", "6_low_voltage",
        "7_fire_alarm", "8_rough_in"
    ]
    quantity: int = Field(description="Total quantity from schedule")
    specs: str = Field(default="", description="Voltage, wattage, manufacturer")


class SchedulePage(BaseModel):
    page_title: str
    schedule_type: Literal["lighting", "equipment", "panel", "other"]
    entries: List[ScheduleEntry]


# ==================================================================
# PROMPT
# ==================================================================

SCHEDULE_PROMPT = """You are reading a construction SCHEDULE page (a table/spreadsheet).
Extract EVERY row from the schedule into structured data.

RULES:
1. Read the table header to understand columns (Mark, Description, Qty, Voltage, etc.)
2. Each row = one ScheduleEntry
3. If the table has a "QTY" or "QUANTITY" column, use that number exactly
4. If no QTY column, count the number of fixture marks mentioned on drawings (if visible)
5. Classify each entry into the correct section:
   - Lighting fixtures (RX, TL, FL, EM, EX, etc.) → 3_lighting
   - HVAC equipment (WSHP, DH, EF, RTU, AHU) → 2_hvac_connections
   - Panel/transformer → 1_distribution
   - Fire alarm devices → 7_fire_alarm
6. Include manufacturer, voltage, wattage in specs field
7. Do NOT skip any rows, even if they seem like duplicates"""


# ==================================================================
# PAGE RENDERER
# ==================================================================

def render_page(pdf_path, page_num, zoom=2.0):
    """Render page to JPEG base64."""
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)

    im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=85, optimize=True)
    jpeg = buf.getvalue()
    doc.close()

    return base64.b64encode(jpeg).decode("utf-8"), len(jpeg)


# ==================================================================
# PARSE ONE SCHEDULE PAGE
# ==================================================================

def parse_one_page(pdf_path, page_num):
    """Parse a single schedule page via Vision API."""
    log(f"  📋 Schedule page {page_num + 1}...")

    img_b64, size = render_page(pdf_path, page_num, zoom=2.0)
    log(f"     Image: {size // 1000}KB")

    for attempt in range(3):
        try:
            if attempt > 0:
                wait = (attempt + 1) * 2
                log(f"     ⏳ Retry {attempt+1}/3, waiting {wait}s...")
                time.sleep(wait)
            else:
                time.sleep(0.5)

            response = client.beta.chat.completions.parse(
                model="gpt-4o",
                temperature=0,
                messages=[
                    {"role": "system", "content": SCHEDULE_PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": "Read this schedule page. Extract EVERY entry with quantities."},
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}",
                            "detail": "high"
                        }}
                    ]}
                ],
                response_format=SchedulePage
            )

            result = response.choices[0].message.parsed
            n = len(result.entries)
            log(f"     ✅ '{result.page_title}': {n} entries ({result.schedule_type})")
            return result.model_dump()

        except Exception as e:
            err = str(e)
            if "429" in err and attempt < 2:
                continue
            log(f"     ❌ Error: {err}")
            return None

    return None


# ==================================================================
# MAIN
# ==================================================================

def run(pdf_path, page_indices):
    if not os.path.exists(pdf_path):
        return {"status": "error", "message": f"File not found: {pdf_path}"}

    log(f"📋 Schedule Parser: {len(page_indices)} pages")

    schedules = []
    total_entries = 0

    for pg in page_indices:
        result = parse_one_page(pdf_path, pg)
        if result:
            schedules.append({"page": pg, **result})
            total_entries += len(result.get("entries", []))

    return {
        "status": "success",
        "total_entries": total_entries,
        "pages_parsed": len(schedules),
        "schedules": schedules
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Schedule Parser")
    parser.add_argument("--pdf_path", required=True)
    parser.add_argument("--pages", required=True,
                        help="Comma-separated page indices (0-based)")
    args = parser.parse_args()

    pages = [int(p.strip()) for p in args.pages.split(",")]
    result = run(args.pdf_path, pages)
    print(json.dumps(result, ensure_ascii=False, indent=2))
