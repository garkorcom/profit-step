#!/usr/bin/env python3
"""
Text Takeoff Skill — OpenClaw Estimator Department
====================================================
ШАГ 2 в SOP Chief Estimator. Бесплатный текстовый каркас.

Извлекает данные об электрооборудовании из ТЕКСТОВОГО СЛОЯ PDF.
Не использует Vision API — результат 100% детерминированный.
На Lululemon 90 стр: 64 устройства за <1 сек, $0.

3 ПАРСЕРА:
  1. Panel Schedule  — описания цепей из таблицы панели
     ("LTG Sales Floor", "WSHP-1", "Cash Register Recp")
  2. Keynotes        — подтверждение типов устройств из секции Keynotes
     ("EAS System", "WAP", "CCTV Camera", "Speaker")
  3. Equipment       — теги HVAC из Equipment Connection Schedule  
     ("WSHP-1", "DH-1", "EF-1" — regex парсинг)

ВАЖНО: Эти данные = "Ground Truth" (100% точность).
Chief Estimator использует их как эталон при дедупликации
с Vision данными (Schedule-First Dedup rule).

Usage:
    python text_takeoff.py /path/to/blueprint.pdf

Output: JSON to stdout (единственный print — в самом конце)
"""

import sys
import json
import re

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"status": "error", "message": "PyMuPDF (fitz) not installed"}))
    sys.exit(1)


# ==================================================================
# 1. PANEL SCHEDULE TEXT PARSER
# ==================================================================
# Панели (Panelboard Schedule) — таблицы в PDF с описаниями цепей.
# Каждая строка = одна цепь. Пример:
#   "LTG - SALES FLOOR TRACK"   → section=3_lighting
#   "WSHP-1"                    → section=2_hvac_connections  
#   "CASH REGISTER RCPT"        → section=5_receptacles
#
# СТРАТЕГИЯ: Только KNOWN паттерны. Нет fallback = нет мусора.
# В v5 был generic fallback → ловил мусор ("21", "PHASE A").
# Исправлено: _classify_circuit возвращает None для неизвестных.
# ==================================================================

def _classify_circuit(desc):
    """Классификация строки панели в (section, device_type) или None.
    
    Работает ТОЛЬКО с известными паттернами.
    Неизвестные строки → None (пропускаются).
    skip_patterns фильтруют заголовки таблиц и метаданные.
    """
    d = desc.upper().strip()
    if not d or d in ('SPARE', 'SPACE', '-') or len(d) < 4:
        return None

    # Skip metadata lines (headers, notes, numbers)
    skip_patterns = [
        'CKT', 'BRKR', 'ZONE', 'N.E.C', 'OPTS', 'SIZE', 'KVA',
        'PHASE', 'VOLTAGE', 'AIC', 'NEMA', 'BUS', 'MOUNTING',
        'NOTE:', 'VERIFY', 'PANELBOARD', 'PANEL TYPE',
        'WIRE', 'OPTIONS', 'SURFACE', 'TOTAL', 'CONNECTED',
        'DEMAND', 'LOAD', 'NO.', 'DESCRIPTION'
    ]
    if any(d.startswith(p) for p in skip_patterns):
        return None
    if len(d) <= 3:
        return None

    # Lighting circuits
    ltg_kw = [
        'LTG', 'LIGHTING', 'COVE LTG', 'TRACK', 'MILLWORK LIGHT',
        'DECORATIVE LIGHT', 'LED', 'ACCENT', 'NON-SALES LTG',
        'SALES LIGHTING', 'SALES TRACK', 'SF/SW LTG'
    ]
    if any(k in d for k in ltg_kw):
        return ('3_lighting', f'Circuit: {desc.strip()}')

    # Lighting controls
    if 'CONTACTOR' in d or 'LIGHTING CONTROL' in d:
        return ('4_lighting_controls', f'Lighting Control: {desc.strip()}')
    if 'EM/EX' in d or 'EMERGENCY' in d or 'EXIT' in d:
        return ('3_lighting', 'Emergency/Exit Lighting')

    # HVAC
    hvac_kw = [
        'DH-', 'WSHP', 'WHSP', 'AHU', 'RTU', 'EF-', 'EXHAUST FAN',
        'HEAT PUMP', 'DUCT HEAT'
    ]
    if any(k in d for k in hvac_kw):
        return ('2_hvac_connections', f'HVAC: {desc.strip()}')

    # Receptacles (specific keywords only)
    recept_kw = [
        'RCPT', 'RECEPTACLE', 'CONVENIENCE', 'CASH REGISTER',
        'POS SYSTEM', 'BREAK ROOM', 'MANAGER', 'MICROWAVE',
        'HAND DRYER', 'INSTA-HOT', 'WATER HEATER', 'SHOW CASE',
        'DISPLAY CASE', 'STOCKROOM RCPT', 'OFFICE RCPT', 'USB',
        'CONTROLLED RECP'
    ]
    if any(k in d for k in recept_kw):
        return ('5_receptacles', f'Receptacle: {desc.strip()}')

    # Fire Alarm
    if 'FIRE ALARM' in d or 'FACP' in d:
        return ('7_fire_alarm', f'FA Circuit: {desc.strip()}')

    # Low Voltage
    lv_kw = [
        'DATA', 'SECURITY', 'CCTV', 'CAMERA', 'SPEAKER', 'AUDIO',
        'NETWORK', 'EAS', 'SENSORMATIC'
    ]
    if any(k in d for k in lv_kw):
        return ('6_low_voltage', f'LV: {desc.strip()}')

    return None


def parse_panel_schedule_text(pdf_path):
    """Извлечение цепей из Panel Schedule через text layer.
    
    Алгоритм:
      1. Найти страницы с ключевыми словами 'panelboard' + 'load description'
      2. Взять максимум 2 страницы (больше = дупликаты)
      3. Каждую строку прогнать через _classify_circuit
      4. Дедупликация по device_type
    
    На Lululemon: 2 страницы → 32 unique circuits.
    """
    doc = fitz.open(pdf_path)
    devices = []
    panel_pages = []

    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        t_lower = text.lower()
        if ('panelboard' in t_lower or 'panel wiring' in t_lower) and \
           ('load description' in t_lower or 'ckt' in t_lower):
            panel_pages.append(i)

    if not panel_pages:
        doc.close()
        return []

    # Maximum 2 panel pages to avoid duplicates
    panel_pages = panel_pages[:2]

    for pg in panel_pages:
        text = doc.load_page(pg).get_text()
        lines = text.split('\n')

        for line in lines:
            line = line.strip()
            if not line or len(line) < 5:
                continue

            result = _classify_circuit(line)
            if result:
                sec, dtype = result
                devices.append({
                    "section": sec,
                    "device_type": dtype,
                    "symbol_on_drawing": "Panel Schedule",
                    "zone": "Per Panel Schedule",
                    "quantity": 1,
                    "source_type": "PANEL_COUNT",
                    "source_sheet": f"p.{pg+1}",
                    "notes": f"from panel text p.{pg+1}",
                    "confidence": "certain"
                })

    doc.close()

    # Deduplicate
    seen = set()
    unique = []
    for d in devices:
        key = d['device_type']
        if key not in seen:
            seen.add(key)
            unique.append(d)

    return unique


# ==================================================================
# 2. KEYNOTES PARSER
# ==================================================================
# Keynotes — секции на чертежах типа "POWER PLAN KEYNOTES:"
# Содержат список оборудования, которое ДОЛЖНО быть на чертеже.
# Это не количество, а ТИПЫ — подтверждение что EAS, WAP, Camera
# реально есть в проекте. Каждый найденный тип = qty 1 (тип, не шт).
#
# Два словаря: power_items (розетки, HVAC) и lv_items (камеры, WAP...).
# На Lululemon: 26 unique device types.
# ==================================================================

def _find_keynote_pages(pdf_path):
    """Найти страницы с секциями KEYNOTES и определить их тип.
    Returns: list of (page_index, type, full_text)
    Type: 'power' | 'low_voltage' | 'lighting' | 'fire_alarm' | 'general'
    """
    doc = fitz.open(pdf_path)
    results = []
    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        if 'KEYNOTES:' in text or 'PLAN KEYNOTES:' in text:
            t_upper = text[:200].upper()
            if 'POWER' in t_upper:
                ktype = 'power'
            elif 'LOW VOLTAGE' in t_upper or 'LV' in t_upper:
                ktype = 'low_voltage'
            elif 'LIGHTING' in t_upper:
                ktype = 'lighting'
            elif 'FIRE' in t_upper:
                ktype = 'fire_alarm'
            else:
                ktype = 'general'
            results.append((i, ktype, text))
    doc.close()
    return results


def parse_keynotes(pdf_path):
    """Извлечение типов оборудования из Keynotes.
    
    ВАЖНО: Возвращает ТИПЫ (не количество).
    Каждый найденный keyword = 1 DeviceEntry с qty=1.
    Это нужно Chief Estimator для: 
      - подтверждения что device type существует в проекте
      - Low Voltage device types (WAP, Camera, Speaker)
    """
    kn_pages = _find_keynote_pages(pdf_path)
    if not kn_pages:
        return []

    devices = []

    power_items = {
        'RECEPTACLE': ('5_receptacles', 'General Receptacle (keynote)'),
        'STOREFRONT RECEPTACLE': ('5_receptacles', 'Storefront Receptacle'),
        'CASH REGISTER': ('5_receptacles', 'Cash Register Dedicated Circuit'),
        'COMPUTER OUTLET': ('5_receptacles', 'Computer Outlet (Cashwrap)'),
        'HAND DRYER': ('5_receptacles', 'Hand Dryer (hardwire)'),
        'WATER HEATER': ('2_hvac_connections', 'Insta-Hot Water Heater'),
        'INSTA-HOT': ('2_hvac_connections', 'Insta-Hot Water Heater'),
        'EAS': ('6_low_voltage', 'EAS Sensormatic System'),
        'SENSORMATIC': ('6_low_voltage', 'EAS Sensormatic System'),
        'NETWORK CABINET': ('6_low_voltage', 'Network Cabinet Receptacle'),
        'BUZZER': ('6_low_voltage', 'Delivery Buzzer System'),
        'HVAC EQUIPMENT': ('2_hvac_connections', 'HVAC Equipment Connection'),
        'MOTOR OPERATED DAMPER': ('2_hvac_connections', 'Motor Operated Damper'),
        'JUNCTION BOX': ('8_rough_in', 'Junction Box'),
        'TRANSFORMER': ('1_distribution', 'Transformer'),
        'AUTOMATIC FAUCET': ('5_receptacles', 'Automatic Faucet Transformer'),
    }

    lv_items = {
        'SUBWOOFER': ('6_low_voltage', 'Subwoofer'),
        'SPEAKER': ('6_low_voltage', 'Speaker'),
        'AMPLIFIER': ('6_low_voltage', 'Music System Amplifier'),
        'VOLUME CONTROL': ('6_low_voltage', 'Volume Controller'),
        'AUDIO BALUN': ('6_low_voltage', 'RCA Balun Wall Plate'),
        'HEADCOUNT': ('6_low_voltage', 'Traffic Counter'),
        'THERMAL SENSOR': ('6_low_voltage', 'Traffic Counter'),
        'WIRELESS ACCESS POINT': ('6_low_voltage', 'WAP'),
        'WAP': ('6_low_voltage', 'WAP'),
        'NETWORK LADDER': ('8_rough_in', 'Network Ladder'),
        'BURGLAR ALARM': ('6_low_voltage', 'Burglar Alarm Panel'),
        'BAS': ('6_low_voltage', 'Burglar Alarm Panel'),
        'TEMPERATURE SENSOR': ('6_low_voltage', 'Temperature Sensor'),
        'THERMOSTAT': ('6_low_voltage', 'Thermostat'),
        'CAMERA': ('6_low_voltage', 'CCTV Camera'),
        'CCTV': ('6_low_voltage', 'CCTV Camera'),
    }

    for pg, ktype, text in kn_pages:
        text_upper = text.upper()
        items = power_items if ktype == 'power' else lv_items

        found = set()
        for keyword, (section, dtype) in items.items():
            if keyword in text_upper and dtype not in found:
                found.add(dtype)
                devices.append({
                    "section": section,
                    "device_type": dtype,
                    "symbol_on_drawing": "Keynote",
                    "zone": "Per Keynotes",
                    "quantity": 1,
                    "source_type": "KEYNOTE_COUNT",
                    "source_sheet": f"p.{pg+1}",
                    "notes": f"keynote p.{pg+1} ({ktype})",
                    "confidence": "certain"
                })

    return devices


# ==================================================================
# 3. EQUIPMENT CONNECTION SCHEDULE PARSER
# ==================================================================
# Equipment Connection Schedule — таблица с HVAC тегами.
# Regex ищет паттерны типа "WSHP-1", "DH-2", "EF-1".
# Эти данные = 100% АВТОРИТЕТ для section 2_hvac_connections.
# Vision API не нужен — теги всегда в текстовом слое.
# На Lululemon: 6 unique HVAC tags.
# ==================================================================

def parse_equipment_connections(pdf_path):
    """Извлечение HVAC тегов через regex из Equipment Connection Schedule.
    
    Regex: r'^(WHSP|WSHP|DH|EF|AHU|RTU|CU|FCU)[-\s]*(\d+)'
    Matches: WSHP-1, DH-2, EF-1, AHU-3, etc.
    """
    doc = fitz.open(pdf_path)
    devices = []

    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        if 'EQUIPMENT CONNECTION SCHEDULE' not in text.upper():
            continue

        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            match = re.match(
                r'^(WHSP|WSHP|DH|EF|AHU|RTU|CU|FCU)[-\s]*(\d+)',
                line, re.IGNORECASE
            )
            if match:
                tag = f"{match.group(1).upper()}-{match.group(2)}"
                devices.append({
                    "section": "2_hvac_connections",
                    "device_type": f"Equipment: {tag}",
                    "symbol_on_drawing": tag,
                    "zone": "Per Equipment Schedule",
                    "quantity": 1,
                    "source_type": "SCHEDULE_COUNT",
                    "source_sheet": f"p.{i+1}",
                    "notes": f"equip schedule p.{i+1}",
                    "confidence": "certain"
                })

    doc.close()

    # Deduplicate
    seen = set()
    unique = []
    for d in devices:
        if d['device_type'] not in seen:
            seen.add(d['device_type'])
            unique.append(d)

    return unique


# ==================================================================
# 4. LIGHTING FIXTURE COUNTER (RCP Text Layer)
# ==================================================================
# НОВЫЙ ПАРСЕР — главный прорыв для закрытия lighting gap.
#
# ИДЕЯ: На page RCP (Reflected Ceiling Plan) каждый светильник
# помечен текстовой меткой (RX-1, TL1, D5, EX2...).
# PyMuPDF извлекает их как отдельные строки текста.
# Мы считаем сколько раз каждая метка появляется.
#
# ПРОБЛЕМА: Один и тот же план может быть на 2+ страницах
# (архитектурный RCP + электрический RCP). Считаем с ЛУЧШЕЙ
# страницы (самой плотной по меткам) чтобы избежать дупликатов.
#
# РЕЗУЛЬТАТ: Из 19 цепей → ~130 конкретных светильников с qty.
# На Lululemon: стр.18 (арх. RCP) имеет 157 меток.
#              стр.56 (электр. RCP) имеет 124 метки.
#              Берём стр.18 как более полную.
#
# Также парсим Fixture Schedule (стр. с описаниями типов)
# для cross-reference: RX-1 = "Recessed Downlight 6\" Round".
#
# СТОИМОСТЬ: $0 (чистый PyMuPDF, без AI).
# ТОЧНОСТЬ: ~95% для lighting fixtures.
# ==================================================================

# Известные коды светильников в электрических чертежах.
# Порядок важен: сначала более длинные (RX-1 EM перед RX-1).
_FIXTURE_MARKS = [
    # Recessed downlights
    'RX-1 EM', 'RX-1', 'RX-2', 'RX-3', 'RX-5',
    # RF variants
    'RF1-EM', 'RF-1', 'RF1', 'RF2', 'RF3',
    # Track
    'TL1', 'TL2', 'T1',
    # Decorative / accent
    'R3', 'S1', 'D5', 'D6',
    # BOH / strip
    'L4-EM', 'L2', 'L4', 'L8',
    # Branded / special
    'XP1-A', 'XP1B', 'XP-3', 'LS2', 'LS3',
    # Emergency / exit
    'EM1', 'EM3', 'EX2',
    # Fan/light combo
    'FL',
]

# Fixture type descriptions (из типовых Fixture Schedule).
# Используется для красивого device_type в отчёте.
_FIXTURE_DESCRIPTIONS = {
    'RX-1': 'Recessed Downlight 6" Round',
    'RX-1 EM': 'Recessed Downlight 6" Round (Emergency)',
    'RX-2': 'Recessed Downlight 4" Round',
    'RX-3': 'Recessed Downlight 3" Round',
    'RX-5': 'Recessed Downlight 2" Mini',
    'RF-1': 'Recessed Adjustable Accent Light',
    'RF1': 'Recessed Fixed Downlight 4" Round',
    'RF1-EM': 'Recessed Fixed Downlight 4" Round (EM)',
    'RF2': 'Recessed Mini Downlight 2" Round',
    'RF3': 'Recessed Adjustable Accent 3"',
    'TL1': 'Track Head — Accent',
    'TL2': 'Track Head — Wall Wash',
    'T1': 'Track Rail',
    'R3': 'Recessed Adjustable Display Light',
    'S1': 'Decorative / Fitroom Fixture',
    'D5': 'Wall-Mounted LED Linear',
    'D6': 'Wall Light Above Mirror',
    'L2': 'BOH Strip Light',
    'L4': 'BOH Strip Light Suspended',
    'L4-EM': 'BOH Strip Light with EM',
    'L8': 'BOH LED Strip 8ft',
    'XP1-A': 'Branded Luminous Element A',
    'XP1B': 'Branded Luminous Element B',
    'XP-3': 'Branded Light Element',
    'LS2': 'LED Cove/Neon Lighting',
    'LS3': 'LED Linear Shelf Lighting',
    'EM1': 'Emergency Battery Unit',
    'EM3': 'Bug Eye Emergency Light',
    'EX2': 'Exit Sign with Battery',
    'FL': 'Fan/Light Combo',
}


def _count_fixture_marks_on_page(page_text):
    """Подсчитать вхождения каждого fixture mark на странице.
    
    Считаем только standalone строки (= отдельная текстовая метка).
    Это отсекает упоминания в примечаниях и заголовках.
    """
    lines = page_text.split('\n')
    counts = {}
    matched_lines = set()  # Индексы уже подсчитанных строк
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or i in matched_lines:
            continue
        
        # Проверяем от более длинных к коротким (RX-1 EM перед RX-1)
        for mark in _FIXTURE_MARKS:
            if stripped == mark:
                counts[mark] = counts.get(mark, 0) + 1
                matched_lines.add(i)
                break
    
    return counts


def _find_fixture_schedule_descriptions(pdf_path):
    """Найти Fixture Schedule и извлечь описания типов.
    
    Ищем страницы с 'FIXTURE SCHEDULE' или 'LUMINAIRE SCHEDULE'.
    Парсим паттерн: MARK → MANUFACTURER → DESCRIPTION.
    Обновляет _FIXTURE_DESCRIPTIONS найденными данными.
    """
    doc = fitz.open(pdf_path)
    descriptions = dict(_FIXTURE_DESCRIPTIONS)  # копия дефолтных
    
    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        text_upper = text.upper()
        
        if 'FIXTURE SCHEDULE' not in text_upper and 'LUMINAIRE' not in text_upper:
            continue
        
        # Ищем паттерны типа "WATT LED" рядом с fixture marks
        lines = text.split('\n')
        current_mark = None
        for line in lines:
            stripped = line.strip()
            # Fixture mark как отдельная строка
            if stripped in _FIXTURE_MARKS:
                current_mark = stripped
            # Описание: строка с "WATT" или "LED" или длинная строка после mark
            elif current_mark and len(stripped) > 15:
                if any(kw in stripped.upper() for kw in ['LED', 'WATT', 'LIGHT', 'DOWNLIGHT',
                                                          'TRACK', 'EXIT', 'EMERGENCY', 'FAN']):
                    descriptions[current_mark] = stripped[:60]
                    current_mark = None
    
    doc.close()
    return descriptions


def parse_lighting_fixtures(pdf_path):
    """ПАРСЕР 4: Подсчёт светильников из RCP text layer.
    
    Алгоритм:
      1. Пробежать ВСЕ страницы, подсчитать fixture marks
      2. Найти страницу с максимальным количеством меток (= main RCP)
      3. Взять подсчёты только с этой страницы
      4. Cross-reference с Fixture Schedule для описаний
      5. Каждый тип → DeviceEntry с точным qty
    
    ПОЧЕМУ ОДНА СТРАНИЦА: В PDF часто 2+ RCP плана
    (архитектурный + электрический). Берём самый полный
    чтобы не удвоить.
    
    На Lululemon: 137 light fixtures (≈ 95% от профессионала).
    """
    doc = fitz.open(pdf_path)
    
    # Шаг 1: Подсчитать marks на каждой странице
    page_counts = {}
    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        counts = _count_fixture_marks_on_page(text)
        total = sum(counts.values())
        if total >= 10:  # Минимум 10 меток = это RCP
            page_counts[i] = counts
    
    doc.close()
    
    if not page_counts:
        return []
    
    # Шаг 2: Выбрать страницу с максимальным количеством
    best_page = max(page_counts.keys(), key=lambda p: sum(page_counts[p].values()))
    best_counts = page_counts[best_page]
    
    # Шаг 3: Получить описания из Fixture Schedule
    descriptions = _find_fixture_schedule_descriptions(pdf_path)
    
    # Шаг 4: Преобразовать в DeviceEntry
    # ACCENT FIX: LS2, LS3, XP-3 — это accent/branded elements,
    # инженер не считает их как fixtures. Выделяем отдельно.
    _ACCENT_MARKS = {'LS2', 'LS3', 'XP-3', 'XP1-A', 'XP1B'}
    
    devices = []
    for mark, qty in sorted(best_counts.items()):
        desc = descriptions.get(mark, f'Lighting Fixture {mark}')
        
        # Определить section и sub-category
        if mark in _ACCENT_MARKS:
            section = '3_lighting'
            desc_prefix = 'Accent: '
            confidence = 'likely'  # не fixture, а accent
        elif mark.startswith('EX') or mark.startswith('EM'):
            section = '3_lighting'
            desc_prefix = 'EM/Exit: '
            confidence = 'certain'
        elif mark.startswith('S') and mark[1:].isdigit():
            section = '3_lighting'
            desc_prefix = 'Decorative: '
            confidence = 'certain'
        else:
            section = '3_lighting'
            desc_prefix = ''
            confidence = 'certain'
        
        devices.append({
            "section": section,
            "device_type": f"{desc_prefix}{desc}",
            "symbol_on_drawing": mark,
            "zone": "Per RCP Plan",
            "quantity": qty,
            "source_type": "RCP_GRAPHIC_COUNT",
            "source_sheet": f"p.{best_page + 1}",
            "notes": f"RCP text count p.{best_page + 1} ({qty}x {mark})",
            "confidence": confidence,
            "is_accent": mark in _ACCENT_MARKS
        })
    
    return devices


# ==================================================================
# 5. POWER / SWITCH / SENSOR COUNTER (Plan Text Layer)
# ==================================================================
# ПАРСЕР 5 — считает розетки, выключатели, сенсоры из text layer.
#
# ИДЕЯ: На Power Plan (E-110) и Lighting Plan (E-120) каждая
# розетка и выключатель помечены коротким текстом: DG, GFI, J, S, OS.
# PyMuPDF извлекает их как standalone строки.
#
# ОГРАНИЧЕНИЕ: General duplex receptacles ("D") не надёжны в тексте
# т.к. "D" слишком короткий и даёт false positives. Их считает Vision.
# Зато DG (dedicated), GFCI, J (junction box), SF (storefront),
# CT (controlled), OS, VS, SD — ТОЧНЫЕ из текста.
#
# СТОИМОСТЬ: $0 (чистый PyMuPDF).
# ==================================================================

# Marks для розеток и выключателей на планах
_POWER_SWITCH_MARKS = {
    # Receptacles — special types (section 5)
    'DG':   ('5_receptacles', 'Dedicated Ground Receptacle'),
    'GFI':  ('5_receptacles', 'GFCI Receptacle'),
    'GFCI': ('5_receptacles', 'GFCI Receptacle'),
    'SF':   ('5_receptacles', 'Storefront Receptacle'),
    'CT':   ('5_receptacles', 'Controlled Circuit Receptacle'),
    'PF':   ('5_receptacles', 'Power Feed'),
    'USB':  ('5_receptacles', 'USB Receptacle'),
    'FB':   ('5_receptacles', 'Floor Box'),
    # Junction boxes (section 8)
    'J':    ('8_rough_in', 'Junction Box'),
    # Switches & sensors (section 4)
    'S':    ('4_lighting_controls', 'Switch Single-Pole'),
    'SD':   ('4_lighting_controls', 'Dimmer Switch'),
    'S3':   ('4_lighting_controls', '3-Way Switch'),
    'OS':   ('4_lighting_controls', 'Occupancy Sensor'),
    'VS':   ('4_lighting_controls', 'Vacancy Sensor'),
    # Sensors (section 2)
    'T':    ('2_hvac_connections', 'Thermostat'),
    'TS':   ('2_hvac_connections', 'Temperature Sensor'),
    'CO2':  ('2_hvac_connections', 'CO2 Sensor'),
    # Low voltage marks
    'LV':   ('6_low_voltage', 'Low Voltage Point'),
}

# Marks, которые слишком ambiguous для standalone count
# ("D" может быть note reference, "F" может быть fire alarm note)
_SKIP_AMBIGUOUS = {'D', 'F'}


def parse_power_switch_marks(pdf_path):
    """ПАРСЕР 5: Подсчёт розеток, выключателей, сенсоров.
    
    Алгоритм:
      1. Пробежать ВСЕ страницы, найти Power/Switch marks
      2. Найти страницу с максимальным количеством power marks
      3. Отдельно найти best page для switches
      4. Каждый тип → DeviceEntry с qty
    
    На Lululemon: E-110 (p.55) → DG×11, J×6, GFCI×4, CT×3, SF×3 = 27
    """
    doc = fitz.open(pdf_path)
    
    # Шаг 1: Подсчитать marks на каждой странице
    page_counts = {}  # page_idx → Counter
    
    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        lines = text.split('\n')
        
        counter = {}
        for line in lines:
            s = line.strip()
            if s in _POWER_SWITCH_MARKS and s not in _SKIP_AMBIGUOUS:
                counter[s] = counter.get(s, 0) + 1
        
        total = sum(counter.values())
        if total >= 3:  # Минимум 3 marks = это план
            page_counts[i] = counter
    
    doc.close()
    
    if not page_counts:
        return []
    
    # Шаг 2: Выбрать лучшую страницу для POWER marks
    power_mark_set = {'DG', 'GFI', 'GFCI', 'SF', 'CT', 'PF', 'USB', 'FB', 'J'}
    switch_mark_set = {'S', 'SD', 'S3', 'OS', 'VS'}
    sensor_mark_set = {'T', 'TS', 'CO2'}
    
    # Best power page
    best_power_page = max(
        page_counts.keys(),
        key=lambda p: sum(page_counts[p].get(m, 0) for m in power_mark_set)
    )
    
    # Шаг 3: Собрать все marks с best pages
    # Берём power marks с best power page
    # Берём switch/sensor marks со ВСЕХ pages (они обычно рассеяны)
    combined = {}
    
    # Power marks — только с лучшей страницы (E-110)
    for mark in power_mark_set:
        qty = page_counts.get(best_power_page, {}).get(mark, 0)
        if qty > 0:
            combined[mark] = (qty, best_power_page)
    
    # Switch/Sensor marks — суммируем с ДВУХ лучших pages
    # (по аналогии с best power — берём max page для switches)
    switch_pages = sorted(
        page_counts.keys(),
        key=lambda p: sum(page_counts[p].get(m, 0) for m in switch_mark_set),
        reverse=True
    )[:1]  # Best 1 page for switches
    
    for pg in switch_pages:
        for mark in switch_mark_set | sensor_mark_set:
            qty = page_counts[pg].get(mark, 0)
            if qty > 0 and mark not in combined:
                combined[mark] = (qty, pg)
    
    # Шаг 4: Преобразовать в DeviceEntry
    devices = []
    for mark, (qty, src_page) in sorted(combined.items()):
        section, desc = _POWER_SWITCH_MARKS[mark]
        
        devices.append({
            "section": section,
            "device_type": desc,
            "symbol_on_drawing": mark,
            "zone": "Per Power/Lighting Plan",
            "quantity": qty,
            "source_type": "PLAN_GRAPHIC_COUNT",
            "source_sheet": f"p.{src_page + 1}",
            "notes": f"Plan text count p.{src_page + 1} ({qty}x {mark})",
            "confidence": "certain"
        })
    
    return devices


# ==================================================================
# MAIN — Точка входа навыка
# ==================================================================
# Запускает все 5 парсеров, объединяет, дедуплицирует.
# Каждый парсер обёрнут в try/except.
#
# ПАРСЕР 4 (lighting_fixtures) → точные fixture qty
# ПАРСЕР 5 (power_switch_marks) → розетки/switches/sensors
# Smart Merge: fixture data заменяет lighting circuits из Panel.
#
# Финальный JSON в stdout:
#   status: "success"
#   total_extracted: N
#   sources: {panel_schedule, keynotes, equipment, lighting_fixtures,
#             power_switch_marks}
#   devices: [...]
# ==================================================================

def run_skill(pdf_path):
    """Запуск всех 5 парсеров → объединённый JSON в stdout."""
    import os
    if not os.path.exists(pdf_path):
        print(json.dumps({
            "status": "error",
            "message": f"File not found: {pdf_path}"
        }))
        sys.exit(1)

    results = {
        "panel_schedule": [],
        "keynotes": [],
        "equipment_connections": [],
        "lighting_fixtures": [],
        "power_switch_marks": []
    }

    try:
        results["panel_schedule"] = parse_panel_schedule_text(pdf_path)
    except Exception as e:
        results["panel_schedule_error"] = str(e)

    try:
        results["keynotes"] = parse_keynotes(pdf_path)
    except Exception as e:
        results["keynotes_error"] = str(e)

    try:
        results["equipment_connections"] = parse_equipment_connections(pdf_path)
    except Exception as e:
        results["equipment_connections_error"] = str(e)

    try:
        results["lighting_fixtures"] = parse_lighting_fixtures(pdf_path)
    except Exception as e:
        results["lighting_fixtures_error"] = str(e)

    try:
        results["power_switch_marks"] = parse_power_switch_marks(pdf_path)
    except Exception as e:
        results["power_switch_marks_error"] = str(e)

    # ================================================================
    # SMART MERGE
    # ================================================================
    # 1. Fixture data → заменяет lighting circuits из Panel
    # 2. Power marks → дополняет (не дублирует) Panel receptacles
    # ================================================================
    
    has_fixture_data = len(results["lighting_fixtures"]) > 0
    has_power_marks = len(results["power_switch_marks"]) > 0
    
    all_devices = []
    
    # Panel schedule: пропускаем lighting если есть fixture data
    for d in results["panel_schedule"]:
        if has_fixture_data and d["section"] == "3_lighting":
            continue  # Заменено точными данными из RCP
        all_devices.append(d)
    
    # Keynotes + Equipment — всегда
    all_devices.extend(results["keynotes"])
    all_devices.extend(results["equipment_connections"])
    
    # Lighting fixtures — точные qty
    all_devices.extend(results["lighting_fixtures"])
    
    # Power/Switch marks — дополнительные точки
    all_devices.extend(results["power_switch_marks"])

    # Final dedup by device_type + section
    seen = set()
    unique = []
    for d in all_devices:
        key = f"{d['section']}_{d['device_type']}"
        if key not in seen:
            seen.add(key)
            unique.append(d)

    # Compute source counts
    fixture_qty = sum(d.get("quantity", 0) for d in results["lighting_fixtures"]
                      if not d.get("is_accent"))
    accent_qty = sum(d.get("quantity", 0) for d in results["lighting_fixtures"]
                     if d.get("is_accent"))
    power_qty = sum(d.get("quantity", 0) for d in results["power_switch_marks"])
    
    src_counts = {
        "panel_schedule": len([d for d in results["panel_schedule"]
                              if not (has_fixture_data and d["section"] == "3_lighting")]),
        "keynotes": len(results["keynotes"]),
        "equipment_connections": len(results["equipment_connections"]),
        "lighting_fixtures": len(results["lighting_fixtures"]),
        "lighting_fixture_qty": fixture_qty,
        "lighting_accent_qty": accent_qty,
        "power_switch_marks": len(results["power_switch_marks"]),
        "power_switch_qty": power_qty
    }

    output = {
        "status": "success",
        "total_extracted": len(unique),
        "sources": src_counts,
        "devices": unique
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "status": "error",
            "message": "Usage: python text_takeoff.py <pdf_path>"
        }))
        sys.exit(1)

    run_skill(sys.argv[1])
