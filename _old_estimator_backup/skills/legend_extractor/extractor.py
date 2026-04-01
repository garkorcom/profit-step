#!/usr/bin/env python3
"""
Legend Extractor — OpenClaw Estimator Department
==================================================
ШАГ 3 в SOP Chief Estimator. Розеттский камень для Vision.

Извлекает символы из легенды электрических чертежей (Vision API).
Генерирует legend_context строку для vision_9grid_scanner.

ПОТОК ДАННЫХ:
  legend_extractor → legend_context строка
  vision_9grid_scanner --legend_context "RX-1=Recessed Downlight (Lighting)"
  
  Без legend_context Vision API не знает что "RX-1" = downlight.
  С ним точность возрастает на ~15%.

Zoom 1.5x (не 3x) — легнеда в основном текст, высокий zoom не нужен.
Стоимость: ~$0.10 (один API вызов).

Usage:
    python extractor.py --pdf_path blueprint.pdf --page_num 52
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
    from typing import List, Literal
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
# SCHEMAS
# ==================================================================
# LegendSymbol: один символ из легенды (symbol + description + category)
# ExtractedLegend: полный список символов со страницы
# ==================================================================

class LegendSymbol(BaseModel):
    symbol: str = Field(description="Symbol code or abbreviation (e.g., RX-1, S, GFCI)")
    description: str = Field(description="Full description of the symbol")
    category: Literal[
        "Lighting", "Receptacle", "Switch", "Fire Alarm",
        "Low Voltage", "HVAC", "Distribution", "Rough-In", "Other"
    ]


class ExtractedLegend(BaseModel):
    page_title: str
    symbols: List[LegendSymbol]


# ==================================================================
# PROMPT
# ==================================================================

LEGEND_PROMPT = """You are reading an ELECTRICAL LEGEND page from construction drawings.
Extract ALL electrical symbols shown on this page.

For each symbol, provide:
- symbol: The code/abbreviation shown (RX-1, TL1, S, S3, GFCI, SD, H/S, etc.)
- description: Full text description next to the symbol
- category: One of: Lighting, Receptacle, Switch, Fire Alarm, Low Voltage, HVAC, Distribution, Rough-In, Other

RULES:
1. Extract the top 30 most important electrical symbols
2. Include ALL lighting fixture types (RX, TL, FL, EM, EX, etc.)
3. Include ALL receptacle types (duplex, GFCI, dedicated, floor box)
4. Include ALL switch types (S, S3, S4, SD, OS, VS)
5. Include fire alarm devices (SD, H/S, pull station)
6. Include low voltage items (speaker, camera, WAP, data)
7. Do NOT skip symbols just because they seem minor"""


# ==================================================================
# EXTRACT
# ==================================================================

def extract_legend(pdf_path, page_num):
    """Extract legend symbols from one page."""
    log(f"📖 Legend page {page_num + 1}...")

    # Render at 1.5x (legend is mostly text, doesn't need 3x)
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)
    mat = fitz.Matrix(1.5, 1.5)
    pix = page.get_pixmap(matrix=mat)

    im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=85, optimize=True)
    jpeg = buf.getvalue()
    doc.close()

    img_b64 = base64.b64encode(jpeg).decode("utf-8")
    log(f"   Image: {len(jpeg)//1000}KB")

    for attempt in range(3):
        try:
            if attempt > 0:
                wait = (attempt + 1) * 2
                log(f"   ⏳ Retry {attempt+1}/3, waiting {wait}s...")
                time.sleep(wait)
            else:
                time.sleep(0.5)

            response = client.beta.chat.completions.parse(
                model="gpt-4o",
                temperature=0,
                messages=[
                    {"role": "system", "content": LEGEND_PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": "Extract the top 30 electrical symbols from this legend."},
                        {"type": "image_url", "image_url": {
                            "url": f"data:image/jpeg;base64,{img_b64}",
                            "detail": "high"
                        }}
                    ]}
                ],
                response_format=ExtractedLegend
            )

            result = response.choices[0].message.parsed
            log(f"   ✅ {len(result.symbols)} symbols extracted")
            return result.model_dump()

        except Exception as e:
            err = str(e)
            if "429" in err and attempt < 2:
                continue
            log(f"   ❌ Error: {err}")
            return None

    return None


# ==================================================================
# MAIN
# ==================================================================

def run(pdf_path, page_num):
    if not os.path.exists(pdf_path):
        return {"status": "error", "message": f"File not found: {pdf_path}"}

    result = extract_legend(pdf_path, page_num)

    if result is None:
        return {"status": "error", "message": "Legend extraction failed"}

    symbols = result.get("symbols", [])

    # Build legend_context string for vision_9grid_scanner
    context_lines = []
    for s in symbols:
        context_lines.append(f"{s['symbol']}={s['description']} ({s['category']})")

    legend_context = "\n".join(context_lines)

    return {
        "status": "success",
        "page_index": page_num,
        "total_symbols": len(symbols),
        "legend_context": legend_context,
        "symbols": symbols
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Legend Extractor")
    parser.add_argument("--pdf_path", required=True)
    parser.add_argument("--page_num", type=int, required=True,
                        help="Page index (0-based)")
    args = parser.parse_args()

    result = run(args.pdf_path, args.page_num)
    print(json.dumps(result, ensure_ascii=False, indent=2))
