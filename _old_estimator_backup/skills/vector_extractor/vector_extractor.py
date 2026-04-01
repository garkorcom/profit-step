#!/usr/bin/env python3
"""
Vector Extractor — OpenClaw Estimator Department
==================================================
🟡 CV ENGINE: Шаг 2 в CV Pipeline.

Извлекает CAD-блоки и геометрические объекты из ВЕКТОРНЫХ PDF.
Если PDF создан в AutoCAD/Revit — блоки часто имеют имена:
  REC_DUPLEX, LIGHT_RX1, SW_3WAY и т.д.

Для РАСТРОВЫХ PDF (сканы) — возвращает пустой результат,
сигнализируя что нужен Vision API для этой страницы.

СТОИМОСТЬ: $0 (чистый PyMuPDF, без AI).

Два режима:
  1. CAD Block Extraction: page.get_drawings() + text dict
  2. Symbol Density Analysis: подсчёт текстовых меток по зонам

Usage:
    python vector_extractor.py --pdf_path blueprint.pdf --page_num 18
"""

import os
import sys
import json
import argparse

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"status": "error", "message": "PyMuPDF not installed"}))
    sys.exit(1)


def log(msg):
    """Логи → stderr."""
    print(msg, file=sys.stderr, flush=True)


# ==================================================================
# Известные паттерны CAD-блоков → DeviceEntry
# ==================================================================
# Маппинг имён CAD-блоков на section + device_type.
# Расширяется по мере обнаружения новых паттернов.
# ==================================================================

_CAD_BLOCK_MAP = {
    # Receptacles
    "REC_DUPLEX":       ("5_receptacles", "Duplex Receptacle 120V"),
    "REC_QUAD":         ("5_receptacles", "Quadplex Receptacle 120V"),
    "REC_GFCI":         ("5_receptacles", "GFCI Receptacle"),
    "REC_FLOOR":        ("5_receptacles", "Floor Box"),
    "REC_USB":          ("5_receptacles", "USB Receptacle"),
    "REC_DED":          ("5_receptacles", "Dedicated Receptacle"),
    "DUPLEX":           ("5_receptacles", "Duplex Receptacle 120V"),
    # Switches
    "SW_SINGLE":        ("4_lighting_controls", "Single Pole Switch"),
    "SW_3WAY":          ("4_lighting_controls", "3-Way Switch"),
    "SW_DIMMER":        ("4_lighting_controls", "Dimmer Switch"),
    "SW_OCC":           ("4_lighting_controls", "Occupancy Sensor"),
    # Lighting
    "LIGHT_RX1":        ("3_lighting", "Recessed Downlight RX-1"),
    "LIGHT_RX2":        ("3_lighting", "Recessed Downlight RX-2"),
    "LIGHT_TL":         ("3_lighting", "Track Light"),
    "LIGHT_EM":         ("3_lighting", "Emergency Light"),
    "LIGHT_EXIT":       ("3_lighting", "Exit Sign"),
    # Fire Alarm
    "FA_SMOKE":         ("7_fire_alarm", "Smoke Detector"),
    "FA_HORN":          ("7_fire_alarm", "Horn/Strobe"),
    "FA_PULL":          ("7_fire_alarm", "Pull Station"),
    # Low Voltage
    "LV_DATA":          ("6_low_voltage", "Data Outlet RJ45"),
    "LV_CAMERA":        ("6_low_voltage", "CCTV Camera"),
    "LV_SPEAKER":       ("6_low_voltage", "Speaker"),
    "LV_WAP":           ("6_low_voltage", "WiFi Access Point"),
}


def _check_vector_quality(page):
    """Проверить является ли страница векторной (CAD) или растром.
    
    Векторный PDF:
      - Имеет drawings (paths) > 100
      - Текстовые блоки с координатами
    
    Растровый PDF (скан):
      - Мало drawings
      - Крупные image objects
    
    Returns: (is_vector: bool, drawing_count: int, image_count: int)
    """
    drawings = page.get_drawings()
    images = page.get_images()
    
    drawing_count = len(drawings)
    image_count = len(images)
    
    # Если много path-объектов и мало картинок = вектор
    is_vector = drawing_count > 100 and image_count < 5
    
    return is_vector, drawing_count, image_count


def _extract_text_blocks_with_coords(page):
    """Извлечь текстовые блоки с координатами.
    
    Используем page.get_text("dict") для получения:
      - text: содержимое блока
      - bbox: координаты (x0, y0, x1, y1)
      - size: размер шрифта
    
    Это позволяет определить ГДЕ на странице находится символ.
    """
    data = page.get_text("dict")
    blocks = []
    
    for block in data.get("blocks", []):
        if block.get("type") != 0:  # text blocks only
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if text:
                    bbox = span.get("bbox", (0, 0, 0, 0))
                    blocks.append({
                        "text": text,
                        "x": (bbox[0] + bbox[2]) / 2,
                        "y": (bbox[1] + bbox[3]) / 2,
                        "size": span.get("size", 0),
                        "bbox": bbox
                    })
    
    return blocks


def _find_cad_blocks(page):
    """Поиск CAD-блоков по имени в потоке страницы.
    
    AutoCAD PDF обычно содержит /BDC (Begin Marked Content)
    с /MCID и /OC (Optional Content) тегами.
    Ищем характерные имена блоков.
    """
    devices = []
    
    # Извлекаем все текстовые элементы с позициями
    text_blocks = _extract_text_blocks_with_coords(page)
    
    # Ищем текст, совпадающий с известными CAD-блоками
    for tb in text_blocks:
        text_upper = tb["text"].upper().replace("-", "_").replace(" ", "_")
        
        for block_name, (section, device_type) in _CAD_BLOCK_MAP.items():
            if block_name in text_upper:
                devices.append({
                    "section": section,
                    "device_type": device_type,
                    "symbol_on_drawing": tb["text"],
                    "zone": f"x={tb['x']:.0f},y={tb['y']:.0f}",
                    "quantity": 1,
                    "source_type": "CV_PATTERN_COUNT",
                    "confidence": "likely",
                    "notes": f"CAD block match: {block_name}"
                })
                break
    
    return devices


def _analyze_drawing_density(page):
    """Анализ плотности графических объектов.
    
    Подсчитывает drawing paths по зонам страницы (3×3 grid).
    Высокая плотность = чертёж с деталями.
    Низкая плотность = пустая/title block зона.
    """
    drawings = page.get_drawings()
    w, h = page.rect.width, page.rect.height
    
    # 3×3 grid density
    grid = [[0]*3 for _ in range(3)]
    for d in drawings:
        if "items" in d:
            for item in d["items"]:
                if len(item) >= 3:
                    # Get first point
                    try:
                        pt = item[1]
                        if hasattr(pt, 'x'):
                            col = min(int(pt.x / (w/3)), 2)
                            row = min(int(pt.y / (h/3)), 2)
                            grid[row][col] += 1
                    except (IndexError, TypeError):
                        pass
    
    return grid


def extract_page(pdf_path, page_num):
    """Главная функция: извлечь данные из одной страницы.
    
    Алгоритм:
      1. Проверить вектор/растр
      2. Если вектор → искать CAD блоки
      3. Анализ плотности drawings
      4. Вернуть результат с метками source_type
    """
    if not os.path.exists(pdf_path):
        return {"status": "error", "message": f"File not found: {pdf_path}"}
    
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)
    
    # Шаг 1: Проверка типа
    is_vector, draw_count, img_count = _check_vector_quality(page)
    
    log(f"📐 Page {page_num + 1}: {'VECTOR' if is_vector else 'RASTER'} "
        f"({draw_count} drawings, {img_count} images)")
    
    # Шаг 2: CAD блоки
    devices = []
    if is_vector:
        devices = _find_cad_blocks(page)
        log(f"   CAD blocks found: {len(devices)}")
    
    # Шаг 3: Drawing density
    density = _analyze_drawing_density(page)
    
    doc.close()
    
    return {
        "status": "success",
        "page_index": page_num,
        "page_number": page_num + 1,
        "is_vector": is_vector,
        "drawing_count": draw_count,
        "image_count": img_count,
        "density_grid": density,
        "devices": [d for d in devices],
        "total_devices": len(devices),
        "recommendation": "Use Vision API" if not devices else "CAD data extracted"
    }


# ==================================================================
# CLI
# ==================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Vector Extractor — CAD blocks from PDF"
    )
    parser.add_argument("--pdf_path", required=True, help="Path to PDF")
    parser.add_argument("--page_num", type=int, required=True,
                        help="Page index (0-based)")
    args = parser.parse_args()
    
    result = extract_page(args.pdf_path, args.page_num)
    print(json.dumps(result, ensure_ascii=False, indent=2))
