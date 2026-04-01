#!/usr/bin/env python3
"""
Auditor — OpenClaw Estimator Department
=========================================
🔴 AUDITOR: Проход 3 — Cross-Reference & Verification.

Принимает результаты ВСЕХ проходов (Extractor, Counter, CV Engine)
и выполняет инженерную сверку:
  - confirmed: 2+ источника согласны
  - text_only: есть в тексте, нет на чертеже
  - vision_only: есть на чертеже, нет в тексте
  - contradictions: qty не совпадает
  - blind_spots: невозможно определить без полевого обследования

СТОИМОСТЬ: $0 (чистый Python, без AI).

Usage:
    python auditor.py --extract extract.json --count count.json
    python auditor.py --extract extract.json --count count.json --cv cv.json
"""

import os
import sys
import json
import argparse
from collections import defaultdict


def log(msg):
    """Логи → stderr."""
    print(msg, file=sys.stderr, flush=True)


# ==================================================================
# МАППИНГ: Нормализация device_type для cross-reference
# ==================================================================
# Разные парсеры могут назвать одно и то же устройство по-разному:
#   Extractor: "Equipment: WSHP-1"
#   Counter:   "HVAC Unit WSHP-1"
#   CV:        "HVAC connection WSHP-1"
# Нормализация сводит их к единому ключу.
# ==================================================================

def _normalize_key(device):
    """Нормализовать device для сравнения.
    
    Ключ = (section, normalized_symbol).
    Если symbol пустой — используем device_type.
    """
    section = device.get("section", "")
    symbol = device.get("symbol_on_drawing", "").strip().upper()
    
    if not symbol:
        # Используем device_type, убирая префиксы
        dtype = device.get("device_type", "")
        for prefix in ["Circuit: ", "Receptacle: ", "Equipment: ",
                        "HVAC: ", "FA Circuit: ", "LV: ", 
                        "EM/Exit: ", "Decorative: "]:
            dtype = dtype.replace(prefix, "")
        symbol = dtype.strip().upper()[:30]
    
    return (section, symbol)


def _group_by_key(devices):
    """Группировать устройства по нормализованному ключу.
    
    Returns: dict[key] → {"qty": total_qty, "devices": [...]}
    """
    groups = defaultdict(lambda: {"qty": 0, "devices": []})
    
    for d in devices:
        key = _normalize_key(d)
        qty = d.get("quantity", 1)
        groups[key]["qty"] += qty
        groups[key]["devices"].append(d)
    
    return dict(groups)


def audit(extract_data, count_data=None, cv_data=None):
    """Сверка трёх источников данных.
    
    Алгоритм:
      1. Нормализовать все устройства из каждого источника
      2. Найти пересечения и уникальные элементы
      3. Для пересечений — сравнить qty
      4. Сформировать 5 категорий результата
    """
    log("🔴 AUDITOR: Cross-reference начинается...")
    
    # Извлечь списки devices
    ext_devices = extract_data.get("devices", [])
    cnt_devices = count_data.get("devices", []) if count_data else []
    cv_devices = cv_data.get("devices", []) if cv_data else []
    
    # Группировать по ключу
    ext_groups = _group_by_key(ext_devices)
    cnt_groups = _group_by_key(cnt_devices)
    cv_groups = _group_by_key(cv_devices)
    
    # Все ключи
    all_keys = set(ext_groups.keys()) | set(cnt_groups.keys()) | set(cv_groups.keys())
    
    # 5 категорий результата
    confirmed = []       # 2+ источника согласны
    text_only = []       # Только в Extractor
    vision_only = []     # Только в Counter/CV
    contradictions = []  # Qty не совпадает
    blind_spots = []     # Невозможно определить
    
    for key in sorted(all_keys):
        section, symbol = key
        
        in_ext = key in ext_groups
        in_cnt = key in cnt_groups
        in_cv = key in cv_groups
        
        sources = []
        if in_ext:
            sources.append(("EXTRACTOR", ext_groups[key]["qty"]))
        if in_cnt:
            sources.append(("COUNTER", cnt_groups[key]["qty"]))
        if in_cv:
            sources.append(("CV_ENGINE", cv_groups[key]["qty"]))
        
        entry = {
            "section": section,
            "symbol": symbol,
            "sources": {name: qty for name, qty in sources},
            "source_count": len(sources)
        }
        
        if len(sources) >= 2:
            # Проверяем согласованность qty
            qtys = [qty for _, qty in sources]
            if max(qtys) - min(qtys) <= 2:
                # Близкие значения → CONFIRMED (берём max)
                entry["quantity"] = max(qtys)
                entry["confidence"] = "confirmed"
                entry["resolution"] = "Multi-source agreement"
                confirmed.append(entry)
            else:
                # Большое расхождение → CONTRADICTION
                entry["quantity"] = max(qtys)  # Берём наибольшее
                entry["confidence"] = "uncertain"
                entry["resolution"] = f"Qty mismatch: {dict(sources)}"
                contradictions.append(entry)
        elif len(sources) == 1:
            source_name, qty = sources[0]
            entry["quantity"] = qty
            
            if source_name == "EXTRACTOR":
                entry["confidence"] = "certain"
                entry["resolution"] = "Text/Schedule confirmed only"
                text_only.append(entry)
            else:
                entry["confidence"] = "likely"
                entry["resolution"] = f"Visual count only ({source_name})"
                vision_only.append(entry)
    
    # Blind spots: стандартные проблемы
    standard_blind_spots = []
    
    # Проверка: есть ли FA данные
    fa_items = [d for d in ext_devices if d.get("section") == "7_fire_alarm"]
    if len(fa_items) <= 1:
        standard_blind_spots.append({
            "category": "Fire Alarm",
            "issue": "Только FACP найден. Извещатели, стробы, сирены — нужен Vision по F-leafs",
            "recommendation": "Запустить 9-grid на FA plans"
        })
    
    # Проверка: есть ли розетки с точными qty
    recp_items = [d for d in ext_devices if d.get("section") == "5_receptacles"]
    graphic_recp_count = sum(1 for d in recp_items 
                            if "graphic" in d.get("notes", "").lower()
                            or d.get("source_type") == "PLAN_GRAPHIC_COUNT")
    if graphic_recp_count == 0:
        standard_blind_spots.append({
            "category": "Receptacles",
            "issue": "Нет графического подсчёта розеток. Только panel/keynote типы.",
            "recommendation": "Запустить 9-grid на Power Plans"
        })
    
    # Проверка: BOM данные
    standard_blind_spots.append({
        "category": "Rough-In Materials",
        "issue": "EMT footage, wire LF, box count — невозможно определить без CAD overlay",
        "recommendation": "Использовать budgetary allowance на основе площади объекта"
    })
    
    # Проверка: Labor
    standard_blind_spots.append({
        "category": "Labor Estimate",
        "issue": "Трудозатраты невозможно автоматически рассчитать",
        "recommendation": "Экспертная оценка на основе point count и типа объекта"
    })
    
    blind_spots = standard_blind_spots
    
    # Summary
    total_confirmed_qty = sum(e["quantity"] for e in confirmed)
    total_text_qty = sum(e["quantity"] for e in text_only)
    total_vision_qty = sum(e["quantity"] for e in vision_only)
    total_contradiction_qty = sum(e["quantity"] for e in contradictions)
    
    log(f"   ✅ Confirmed: {len(confirmed)} items ({total_confirmed_qty} qty)")
    log(f"   📄 Text-only: {len(text_only)} items ({total_text_qty} qty)")
    log(f"   👁 Vision-only: {len(vision_only)} items ({total_vision_qty} qty)")
    log(f"   ⚠️  Contradictions: {len(contradictions)} items")
    log(f"   🔍 Blind spots: {len(blind_spots)} categories")
    
    return {
        "status": "success",
        "summary": {
            "confirmed_items": len(confirmed),
            "confirmed_qty": total_confirmed_qty,
            "text_only_items": len(text_only),
            "text_only_qty": total_text_qty,
            "vision_only_items": len(vision_only),
            "vision_only_qty": total_vision_qty,
            "contradictions": len(contradictions),
            "blind_spots": len(blind_spots),
            "sources_used": {
                "extractor": len(ext_devices) > 0,
                "counter": len(cnt_devices) > 0,
                "cv_engine": len(cv_devices) > 0
            }
        },
        "confirmed": confirmed,
        "text_only": text_only,
        "vision_only": vision_only,
        "contradictions": contradictions,
        "blind_spots": blind_spots
    }


# ==================================================================
# CLI
# ==================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Auditor — Cross-reference verification"
    )
    parser.add_argument("--extract", required=True,
                        help="Path to extract.json (Extractor output)")
    parser.add_argument("--count", default=None,
                        help="Path to count.json (Counter output)")
    parser.add_argument("--cv", default=None,
                        help="Path to cv_count.json (CV Engine output)")
    args = parser.parse_args()
    
    # Load data
    with open(args.extract) as f:
        extract_data = json.load(f)
    
    count_data = None
    if args.count and os.path.exists(args.count):
        with open(args.count) as f:
            count_data = json.load(f)
    
    cv_data = None
    if args.cv and os.path.exists(args.cv):
        with open(args.cv) as f:
            cv_data = json.load(f)
    
    result = audit(extract_data, count_data, cv_data)
    print(json.dumps(result, ensure_ascii=False, indent=2))
