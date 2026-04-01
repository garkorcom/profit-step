#!/usr/bin/env python3
"""
Preflight Scanner — OpenClaw Estimator Department
===================================================
ШАГ 1 в SOP Chief Estimator. Первая линия разведки.

Детерминированный (FREE, без AI) классификатор страниц PDF.
Пробегает ВСЕ страницы через PyMuPDF text layer, считает keywords
по 9 словарям и раскладывает по routing buckets.

РЕЗУЛЬТАТ:
  - manifest.json — сохраняется рядом с PDF (карта проекта)
  - JSON summary — выводится В STDOUT (для агента)

ЗАЧЕМ: Без manifest.json Vision-навыки не знают какие страницы
        сканировать. Этот скрипт экономит ~$2-5 на ненужных API calls,
        отсекая архитектурные/общие страницы.

Usage:
    python scanner.py /path/to/blueprint.pdf
"""

import sys
import json
import os
from datetime import datetime

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"status": "error", "message": "PyMuPDF (fitz) not installed"}))
    sys.exit(1)


# ==================================================================
# KEYWORD DICTIONARIES
# ==================================================================
# Каждый словарь — набор строк, которые ищутся в тексте страницы (lower).
# Чем больше совпадений — тем выше score для данной категории.
# Словари расширены из takeoff_agent v5 на основе реальных проектов
# (Lululemon, Bal Harbour, Farmers Milk).
# ==================================================================

_ELECTRICAL_KW = [
    "electrical", "power", "lighting", "receptacle", "panelboard",
    "luminaire", "circuit", "conduit", "switch", "outlet", "gfci",
    "breaker", "transformer", "disconnect", "branch circuit"
]

_FLOORPLAN_KW = [
    "plan", "scale", "north", "key plan", "floor plan", "level",
    "enlarged", "detail", "section", "elevation"
]

_FA_KW = [
    "fire alarm", "facp", "horn", "strobe", "pull station",
    "smoke detector", "notification", "fire protection",
    "annunciator", "fire rated", "sprinkler"
]

_MECH_KW = [
    "mechanical", "hvac", "heat pump", "exhaust fan", "wshp", "ahu",
    "duct heater", "rtu", "thermostat", "refrigerant", "condensing"
]

_LV_KW = [
    "low voltage", "data", "cctv", "camera", "speaker", "audio",
    "security", "intercom", "eas", "wifi", "access point", "network",
    "sensormatic", "burglar", "telephone"
]

_PLUMB_KW = [
    "plumbing", "water heater", "domestic water", "sanitary",
    "waste", "vent", "fixture unit", "backflow"
]

_SCHED_KW = [
    "schedule", "fixture schedule", "panel schedule",
    "equipment schedule", "connection schedule", "lighting schedule",
    "load description", "panelboard"
]

_LEGEND_KW = [
    "legend", "symbol", "abbreviation", "device schedule",
    "symbol list", "fixture type", "luminaire schedule"
]

_KEYNOTE_KW = [
    "keynotes:", "plan keynotes:", "general notes", "keynote"
]


# ==================================================================
# SCORING ENGINE
# ==================================================================
# Каждая страница получает вектор из 9 scores.
# Пример: {electrical: 5, floorplan: 3, legend: 0, ...}
# На основе вектора _classify_page решает куда положить страницу.
# ==================================================================

def _score_text(text):
    """Подсчитать совпадения текста страницы по всем 9 словарям.
    
    Алгоритм: простой поиск подстроки (O(n*m)).
    На 90 страницах это занимает <1 сек.
    """
    t = text.lower()
    return {
        "electrical": sum(1 for k in _ELECTRICAL_KW if k in t),
        "floorplan":  sum(1 for k in _FLOORPLAN_KW if k in t),
        "fire_alarm": sum(1 for k in _FA_KW if k in t),
        "mechanical": sum(1 for k in _MECH_KW if k in t),
        "low_voltage": sum(1 for k in _LV_KW if k in t),
        "plumbing":   sum(1 for k in _PLUMB_KW if k in t),
        "schedule":   sum(1 for k in _SCHED_KW if k in t),
        "legend":     sum(1 for k in _LEGEND_KW if k in t),
        "keynote":    sum(1 for k in _KEYNOTE_KW if k in t),
    }


def _classify_page(scores, text_len):
    """Классификация страницы в один из 5 routing buckets.
    
    ПРИОРИТЕТЫ (порядок важен!):
      1. Legend (legend score >= 2)         → legend_pages
      2. Schedule (schedule score >= 2)     → schedule_pages  
      3. Drawing (combined score >= 4)      → drawing_pages
      4. General (всё остальное)            → general_pages
    
    Keynote pages — дополнительный тег, не отдельный bucket.
    Страницы с <50 символами считаются scanned (без OCR).
    """
    is_scanned = text_len < 50
    tags = []

    # Priority 1: Legend
    if scores["legend"] >= 2:
        return "legend_pages", ["LEGEND"], is_scanned

    # Priority 2: Schedule
    if scores["schedule"] >= 2:
        return "schedule_pages", ["SCHEDULE"], is_scanned

    # Priority 3: Keynotes (on a drawing page)
    if scores["keynote"] >= 1:
        tags.append("KEYNOTES")

    # Priority 4: Drawing (needs minimum score and text)
    combined = (
        scores["electrical"] +
        scores["floorplan"] * 2 +
        scores["fire_alarm"] +
        scores["mechanical"] +
        scores["low_voltage"] +
        scores["plumbing"]
    )

    if combined >= 4 and not is_scanned:
        tags.append("DRAWING")
        if scores["electrical"] > 0: tags.append("ELEC")
        if scores["fire_alarm"] > 0: tags.append("FIRE_ALARM")
        if scores["mechanical"] > 0: tags.append("MECH")
        if scores["low_voltage"] > 0: tags.append("LOW_VOLT")
        if scores["plumbing"] > 0:   tags.append("PLUMB")
        return "drawing_pages", tags, is_scanned

    # Default
    if not tags:
        tags.append("GENERAL")
    return "general_pages", tags, is_scanned


# ==================================================================
# MAIN SCANNER
# ==================================================================
# Основной flow:
#   1. Открыть PDF через PyMuPDF
#   2. Пробежать ВСЕ страницы, извлечь текст
#   3. Посчитать scores, классифицировать
#   4. Сохранить manifest.json рядом с PDF
#   5. Вернуть summary + alerts в stdout (для агента)
# ==================================================================

def run_preflight(pdf_path):
    """Полный preflight scan → manifest.json + summary JSON в stdout."""
    if not os.path.exists(pdf_path):
        return {
            "status": "error",
            "message": f"File not found: {pdf_path}"
        }

    try:
        doc = fitz.open(pdf_path)
        total_pages = len(doc)

        manifest = {
            "project_identity": {
                "source_file": os.path.basename(pdf_path),
                "absolute_path": os.path.abspath(pdf_path),
                "total_pages": total_pages,
                "ingest_timestamp": datetime.utcnow().isoformat() + "Z"
            },
            "qc_metrics": {
                "total_pages": total_pages,
                "scanned_pages_detected": 0,
                "has_text_layer": True
            },
            "routing_buckets": {
                "legend_pages": [],
                "schedule_pages": [],
                "drawing_pages": [],
                "keynote_pages": [],
                "general_pages": []
            },
            "pages": []
        }

        for i in range(total_pages):
            page = doc.load_page(i)
            text = page.get_text("text")
            text_len = len(text.strip())

            scores = _score_text(text)
            bucket, tags, is_scanned = _classify_page(scores, text_len)

            if is_scanned:
                manifest["qc_metrics"]["scanned_pages_detected"] += 1

            # Route to bucket
            manifest["routing_buckets"][bucket].append(i)

            # Also track keynote pages separately
            if "KEYNOTES" in tags and bucket != "general_pages":
                if i not in manifest["routing_buckets"]["keynote_pages"]:
                    manifest["routing_buckets"]["keynote_pages"].append(i)

            manifest["pages"].append({
                "index": i,
                "page_number": i + 1,
                "tags": tags,
                "bucket": bucket,
                "scores": scores,
                "text_chars": text_len,
                "is_scan": is_scanned
            })

        doc.close()

        # QC check
        scanned_pct = manifest["qc_metrics"]["scanned_pages_detected"] / total_pages
        if scanned_pct > 0.3:
            manifest["qc_metrics"]["has_text_layer"] = False

        # Save manifest.json next to PDF
        project_dir = os.path.dirname(os.path.abspath(pdf_path))
        manifest_path = os.path.join(project_dir, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

        # Build summary
        rb = manifest["routing_buckets"]
        alerts = []
        if not rb["legend_pages"]:
            alerts.append("⚠️ Легенда не обнаружена — точность Vision будет снижена")
        if scanned_pct > 0.3:
            alerts.append(f"⚠️ {manifest['qc_metrics']['scanned_pages_detected']}/{total_pages} страниц без текстового слоя — потребуется OCR")
        if not rb["drawing_pages"]:
            alerts.append("⚠️ Рабочие чертежи не обнаружены — возможно PDF не электрический")

        return {
            "status": "success",
            "manifest_path": manifest_path,
            "summary": {
                "total_pages": total_pages,
                "legends": len(rb["legend_pages"]),
                "schedules": len(rb["schedule_pages"]),
                "drawings": len(rb["drawing_pages"]),
                "keynotes": len(rb["keynote_pages"]),
                "general": len(rb["general_pages"]),
                "scans_detected": manifest["qc_metrics"]["scanned_pages_detected"]
            },
            "alerts": alerts,
            "top_drawing_pages": sorted(
                rb["drawing_pages"],
                key=lambda idx: manifest["pages"][idx]["scores"]["electrical"],
                reverse=True
            )[:10]
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "status": "error",
            "message": "Usage: scanner.py <pdf_path>"
        }))
        sys.exit(1)

    result = run_preflight(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
