"""
Device Takeoff Agent v5 — Hybrid Text+Vision
==============================================
Features:
  1. 9-grid zoom (3×3 at 3.0x) for small symbols
  2. Schedule parser (Vision) for fixture/equipment tables
  3. Panel schedule text parser (FREE — PyMuPDF) for all circuits
  4. Keynotes counter (FREE — PyMuPDF) for Power/LV plan notes
  5. Rate limit throttle (0.5s) + retry with backoff
  6. Schedule-first dedup for lighting
  7. Checklist-based prompt: Walls→Ceiling→Floor

Usage:
    python takeoff_agent.py blueprint.pdf
    python takeoff_agent.py blueprint.pdf --pages 54,56,60,61
    python takeoff_agent.py blueprint.pdf --schedules 52,53,58
    python takeoff_agent.py blueprint.pdf --json
    python takeoff_agent.py blueprint.pdf --scan
"""

import os, sys, json, base64, time, re
from typing import List, Literal, Optional
from collections import Counter
from pydantic import BaseModel, Field

from blueprint_parser import (
    scan_pages, find_relevant_pages, find_best_page, pdf_to_base64_jpeg
)

try:
    import fitz
except ImportError:
    print("ERROR: PyMuPDF not installed."); sys.exit(1)


# ==================================================================
# 1. SCHEMAS
# ==================================================================

class DeviceEntry(BaseModel):
    section: Literal[
        "1_distribution", "2_hvac_connections", "3_lighting",
        "4_lighting_controls", "5_receptacles", "6_low_voltage",
        "7_fire_alarm", "8_rough_in"
    ]
    device_type: str
    symbol_on_drawing: str = ""
    zone: str
    quantity: int
    amps: Optional[int] = None
    voltage: Optional[int] = None
    notes: str = ""
    confidence: Literal["certain", "likely", "uncertain"] = "certain"


class LegendSymbol(BaseModel):
    symbol_label: str
    description: str
    category: str


class ExtractedLegend(BaseModel):
    page_title: str
    symbols: List[LegendSymbol]


class ScheduleEntry(BaseModel):
    device_type: str
    mark_or_code: str = ""
    quantity: int = 1
    specs: str = ""
    section: Literal[
        "1_distribution", "2_hvac_connections", "3_lighting",
        "4_lighting_controls", "5_receptacles", "6_low_voltage",
        "7_fire_alarm", "8_rough_in"
    ]


class SchedulePage(BaseModel):
    page_title: str
    entries: List[ScheduleEntry]


class PageTakeoff(BaseModel):
    page_title: str
    zones_identified: List[str]
    devices: List[DeviceEntry]
    needs_verification: List[str] = Field(default_factory=list)


# ==================================================================
# 2. PROMPTS
# ==================================================================

LEGEND_PROMPT = """You are a senior Electrical Estimator. Extract the top 30 most important 
electrical symbols from this legend/key sheet. Focus on: receptacles, switches, lighting 
fixture TYPES (RX-1, TL1, FL, EM, EX), low voltage (data, camera, speaker), fire alarm.
Keep descriptions brief (max 10 words each)."""

SCHEDULE_PROMPT = """You are a senior Electrical Estimator reading a SCHEDULE page.
Extract every item from the tables on this page:
- Panel schedules, equipment connections, fixture schedules
- For each: device_type, mark_or_code, quantity, specs, section (1-8)

Sections: 1_distribution (panels/transformers/disconnects), 2_hvac_connections,
3_lighting (fixture types), 4_lighting_controls, 5_receptacles,
6_low_voltage, 7_fire_alarm, 8_rough_in

If a fixture schedule shows TYPE and QUANTITY columns, extract EVERY row.
READ EACH ROW. Count carefully."""

GRID_SCAN_PROMPT = """You are a Chief Electrical Estimator performing a PRECISE device takeoff.
You see ONE CELL of a 3×3 grid from a construction floor plan.
Count ONLY devices visible in THIS cell.

SCAN METHOD: Look at WALLS first, then CEILING, then FLOOR.

■ WALLS — scan left-to-right along every wall segment:
  RECEPTACLES (Section 5):
    • Duplex outlet = small circle/semicircle with 2 short parallel lines touching wall
    • GFCI = same shape but marked "GFI"/"GFCI" or near sink/wet area
    • Quadplex = 4 parallel lines or marked "QDX"
    • Dedicated = has circuit # label next to it ("P-5", "20A", "DED")
    • Hardwire/JB = square box on wall with text label
    TIP: Walk each wall segment slowly. Count EVERY circle-with-lines symbol.
    Common locations: behind counters, under desks, near doors, in restrooms.

  SWITCHES (Section 4):
    • S = single pole (dot + letter S on wall near door)
    • S3/S4 = 3-way/4-way
    • SD = dimmer (S with D)
    • OS = occupancy sensor (small rectangle on wall near door entrance)
    • VS = vacancy sensor (similar to OS)

■ CEILING — scan across the ceiling area:
  LIGHTING (Section 3):
    • RX-1/RX-2/RX-3 = recessed downlight (small filled/open circle on ceiling)
    • TL1/TL2 = track light (line with small dots, each dot = 1 head)
    • FL = fan-light (circle with X)
    • EM/EM3 = emergency light (rectangular with battery symbol)
    • EX = exit sign (arrow + "EXIT")
    • Linear = long line fixture

  FIRE ALARM (Section 7):
    • SD = smoke detector (circle on ceiling — NOT switch on wall!)
    • H/S = horn/strobe (circle with zigzag or "HS")
    • ST = strobe only
    • PS = pull station (on wall near exit)
    • FACP = fire alarm panel (large box)

  LOW VOLTAGE (Section 6):
    • SP = speaker (circle with radiating lines on ceiling)
    • CMB/CMW = camera (triangle/dome on ceiling, B=black W=white)
    • WAP = wifi access point (rectangle/square on ceiling)
    • SUB = subwoofer (above ceiling)

■ FLOOR LEVEL:
    • Floor box = rectangular symbol at floor (not on wall)

■ EQUIPMENT:
  DISTRIBUTION (Section 1):
    • Panel = large rectangle with "Panel L"/"Panel P"
    • Disconnect = "DISC" or switch symbol
    • Transformer = "XFMR" or coil

  HVAC (Section 2 — only items needing ELECTRICAL connection):
    • WSHP/AHU/FCU = HVAC unit (large rectangle with tag)
    • EF = exhaust fan
    • DH = duct heater
    • T-STAT = thermostat (on wall)
    • Do NOT count diffusers, grilles, ductwork (mechanical only)

  LOW VOLTAGE — wall mounted:
    • D/RJ45 = data outlet (small triangle or rectangle on wall)
    • TC = traffic counter (at entrance)
    • VOL = volume control knob
    • EAS = anti-theft antenna
    • BZ = buzzer/doorbell
    • MCP = security panel

{legend_context}

CRITICAL RULES:
1. Count EACH symbol individually. 5 circles on ceiling = qty 5
2. Duplex outlets are very small — look carefully at EVERY wall
3. Smoke detectors (ceiling) ≠ Dimmers (wall). Check position!
4. If you see a circuit label (P-1, P-2...) near a symbol, it's a DEDICATED receptacle
5. If uncertain, add to needs_verification"""


# ==================================================================
# 3. LEGEND
# ==================================================================

def _find_legend_pages(pdf_path):
    doc = fitz.open(pdf_path)
    pages = []
    for i in range(len(doc)):
        text = doc.load_page(i).get_text().lower()
        kws = ["legend", "symbol", "abbreviation", "fixture schedule",
               "fixture type", "luminaire", "device schedule"]
        score = sum(1 for k in kws if k in text)
        if score >= 2: pages.append((score, i))
    doc.close()
    pages.sort(reverse=True)
    return [p for _, p in pages]


def extract_legend(pdf_path):
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage

    lp = _find_legend_pages(pdf_path)
    if not lp: return None
    pg = lp[0]
    print(f"  📖 Legend page: {pg + 1}")
    img = pdf_to_base64_jpeg(pdf_path, page_num=pg, zoom=1.5)

    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    slm = llm.with_structured_output(ExtractedLegend)
    result = slm.invoke([
        SystemMessage(content=LEGEND_PROMPT),
        HumanMessage(content=[
            {"type": "text", "text": "Extract the top 30 electrical symbols."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}", "detail": "high"}}
        ])
    ])
    data = result.model_dump()
    print(f"  ✅ {len(data['symbols'])} symbols")
    return data


# ==================================================================
# 4. SCHEDULE PARSER
# ==================================================================

def parse_schedule(pdf_path, page_num):
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage

    print(f"  📋 Schedule page {page_num + 1}...")
    img = pdf_to_base64_jpeg(pdf_path, page_num=page_num, zoom=2.0)

    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    slm = llm.with_structured_output(SchedulePage)
    result = slm.invoke([
        SystemMessage(content=SCHEDULE_PROMPT),
        HumanMessage(content=[
            {"type": "text", "text": "Read this schedule page. Extract EVERY equipment entry with quantities."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}", "detail": "high"}}
        ])
    ])
    data = result.model_dump()
    total = sum(e.get("quantity", 1) for e in data.get("entries", []))
    print(f"  ✅ '{data.get('page_title', '?')}': {total} items")
    return data


# ==================================================================
# 4a. PANEL SCHEDULE TEXT PARSER (FREE — PyMuPDF, no API)
# ==================================================================

def _classify_circuit(desc):
    """Classify a panel circuit description into section + device_type.
    Returns None for non-electrical lines. Only matches KNOWN patterns."""
    d = desc.upper().strip()
    if not d or d in ('SPARE', 'SPACE', '-') or len(d) < 4:
        return None

    # Skip metadata lines (headers, notes, numbers)
    skip_patterns = ['CKT', 'BRKR', 'ZONE', 'N.E.C', 'OPTS', 'SIZE', 'KVA',
                     'PHASE', 'VOLTAGE', 'AIC', 'NEMA', 'BUS', 'MOUNTING',
                     'NOTE:', 'VERIFY', 'PANELBOARD', 'PANEL TYPE',
                     'WIRE', 'OPTIONS', 'SURFACE']
    if any(d.startswith(p) for p in skip_patterns):
        return None
    if len(d) <= 3:  # Too short to be a description
        return None

    # Lighting circuits
    ltg_kw = ['LTG', 'LIGHTING', 'COVE LTG', 'TRACK', 'MILLWORK LIGHT',
              'DECORATIVE LIGHT', 'LED', 'ACCENT', 'NON-SALES LTG',
              'SALES LIGHTING', 'SALES TRACK', 'SF/SW LTG']
    if any(k in d for k in ltg_kw):
        return ('3_lighting', f'Circuit: {desc.strip()}')

    # Lighting controls
    if 'CONTACTOR' in d or 'LIGHTING CONTROL' in d:
        return ('4_lighting_controls', f'Lighting Control: {desc.strip()}')
    if 'EM/EX' in d or 'EMERGENCY' in d or 'EXIT' in d:
        return ('3_lighting', 'Emergency/Exit Lighting')

    # HVAC
    hvac_kw = ['DH-', 'WSHP', 'WHSP', 'AHU', 'RTU', 'EF-', 'EXHAUST FAN',
               'HEAT PUMP', 'DUCT HEAT']
    if any(k in d for k in hvac_kw):
        return ('2_hvac_connections', f'HVAC: {desc.strip()}')

    # Receptacles (specific keywords only)
    recept_kw = ['RCPT', 'RECEPTACLE', 'CONVENIENCE', 'CASH REGISTER',
                 'POS SYSTEM', 'BREAK ROOM', 'MANAGER', 'MICROWAVE',
                 'HAND DRYER', 'INSTA-HOT', 'WATER HEATER', 'SHOW CASE',
                 'DISPLAY CASE', 'STOCKROOM RCPT', 'OFFICE RCPT', 'USB']
    if any(k in d for k in recept_kw):
        return ('5_receptacles', f'Receptacle: {desc.strip()}')

    # Fire Alarm
    if 'FIRE ALARM' in d or 'FACP' in d:
        return ('7_fire_alarm', f'FA Circuit: {desc.strip()}')

    # Low Voltage
    lv_kw = ['DATA', 'SECURITY', 'CCTV', 'CAMERA', 'SPEAKER', 'AUDIO',
             'NETWORK', 'EAS', 'SENSORMATIC']
    if any(k in d for k in lv_kw):
        return ('6_low_voltage', f'LV: {desc.strip()}')

    # No generic fallback — only classify known patterns
    return None


def parse_panel_schedule_text(pdf_path):
    """Extract panel schedule circuits from PDF text — FREE, no API call.
    Only parses pages that contain actual panel wiring schedules."""
    doc = fitz.open(pdf_path)
    devices = []
    panel_pages = []

    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        # Must contain both 'panelboard' or 'panel wiring' AND 'Load Description'
        t_lower = text.lower()
        if ('panelboard' in t_lower or 'panel wiring' in t_lower) and \
           ('load description' in t_lower or 'ckt' in t_lower):
            panel_pages.append(i)

    if not panel_pages:
        doc.close()
        return []

    # Only use first 2 panel pages (avoid duplicate panels in different sets)
    panel_pages = panel_pages[:2]
    print(f"  📊 Panel schedule text on pages: {[p+1 for p in panel_pages]}")

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
                    "notes": f"from panel text p.{pg+1}",
                    "confidence": "certain"
                })

    doc.close()

    # Deduplicate identical entries
    seen = set()
    unique = []
    for d in devices:
        key = d['device_type']
        if key not in seen:
            seen.add(key)
            unique.append(d)

    print(f"  ✅ Panel schedule: {len(unique)} unique circuits")
    return unique


# ==================================================================
# 4b. KEYNOTES COUNTER (FREE — PyMuPDF, no API)
# ==================================================================

def _find_keynote_pages(pdf_path):
    """Find pages with keynotes sections."""
    doc = fitz.open(pdf_path)
    results = []
    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        if 'KEYNOTES:' in text or 'PLAN KEYNOTES:' in text:
            # Determine type
            t_lower = text[:200].upper()
            if 'POWER' in t_lower:
                ktype = 'power'
            elif 'LOW VOLTAGE' in t_lower or 'LV' in t_lower:
                ktype = 'low_voltage'
            elif 'LIGHTING' in t_lower:
                ktype = 'lighting'
            elif 'FIRE' in t_lower:
                ktype = 'fire_alarm'
            else:
                ktype = 'general'
            results.append((i, ktype, text))
    doc.close()
    return results


def parse_keynotes(pdf_path):
    """Extract devices from keynotes text — count of unique equipment types."""
    kn_pages = _find_keynote_pages(pdf_path)
    if not kn_pages:
        return []

    print(f"  📝 Keynotes pages: {[(p+1, t) for p, t, _ in kn_pages]}")
    devices = []

    # Pattern: keynotes describe TYPES of connections, not quantities
    # Each numbered item = 1 device type mentioned
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
                    "notes": f"keynote p.{pg+1} ({ktype})",
                    "confidence": "certain"
                })

    print(f"  ✅ Keynotes: {len(devices)} device types confirmed")
    return devices


# ==================================================================
# 4c. EQUIPMENT CONNECTION SCHEDULE TEXT (FREE — PyMuPDF)
# ==================================================================

def parse_equipment_connections(pdf_path):
    """Extract from ELECTRICAL EQUIPMENT CONNECTION SCHEDULE text."""
    doc = fitz.open(pdf_path)
    devices = []

    for i in range(len(doc)):
        text = doc.load_page(i).get_text()
        if 'EQUIPMENT CONNECTION SCHEDULE' not in text.upper():
            continue

        print(f"  🔌 Equipment Connection Schedule on page {i+1}")
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            # Match equipment IDs like WHSP-1, DH-1, EF-1, RTU-1
            match = re.match(r'^(WHSP|WSHP|DH|EF|AHU|RTU|CU|FCU)[-\s]*(\d+)', line, re.IGNORECASE)
            if match:
                tag = f"{match.group(1).upper()}-{match.group(2)}"
                devices.append({
                    "section": "2_hvac_connections",
                    "device_type": f"Equipment: {tag}",
                    "symbol_on_drawing": tag,
                    "zone": "Per Equipment Schedule",
                    "quantity": 1,
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

    if unique:
        print(f"  ✅ Equipment connections: {len(unique)} items")
    return unique


# ==================================================================
# 5. 9-GRID SCANNER (3×3 at 3.0x zoom)
# ==================================================================

def _crop_grid_cell(pdf_path, page_num, row, col, zoom=3.0):
    """Crop a 1/9 cell from a page. row/col: 0-2."""
    doc = fitz.open(pdf_path)
    page = doc.load_page(page_num)
    w, h = page.rect.width, page.rect.height
    cw, ch = w / 3, h / 3
    clip = fitz.Rect(col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, clip=clip)

    try:
        from io import BytesIO
        from PIL import Image
        im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        buf = BytesIO()
        im.save(buf, format="JPEG", quality=85, optimize=True)
        jpeg = buf.getvalue()
    except ImportError:
        jpeg = pix.tobytes("jpeg")

    doc.close()
    return base64.b64encode(jpeg).decode('utf-8'), pix.width, pix.height, len(jpeg)


def scan_page_9grid(pdf_path, page_num, legend=None):
    """Scan a drawing page with 3×3 grid at 3.0x zoom."""
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    legend_ctx = _build_legend_context(legend)
    prompt = GRID_SCAN_PROMPT.replace("{legend_context}", legend_ctx)

    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    slm = llm.with_structured_output(PageTakeoff)

    all_devices = []
    all_verif = []
    all_zones = set()
    cell_labels = [
        "Top-Left", "Top-Center", "Top-Right",
        "Mid-Left", "Mid-Center", "Mid-Right",
        "Bot-Left", "Bot-Center", "Bot-Right"
    ]

    for r in range(3):
        for c in range(3):
            idx = r * 3 + c
            label = cell_labels[idx]
            img_b64, pw, ph, size_bytes = _crop_grid_cell(pdf_path, page_num, r, c, zoom=3.0)
            mb = size_bytes / 1_000_000

            # Skip nearly blank cells (< 50KB = mostly white/empty)
            if size_bytes < 50_000:
                print(f"      [{label:>10s}] ⬜ blank — skip")
                continue

            print(f"      [{label:>10s}] {pw}x{ph} {mb:.1f}MB", end="")

            # Retry with backoff for rate limits
            for attempt in range(3):
                try:
                    if attempt > 0 or idx > 0:
                        time.sleep(0.5)  # throttle between calls
                    result = slm.invoke([
                        SystemMessage(content=prompt),
                        HumanMessage(content=[
                            {"type": "text",
                             "text": f"Page {page_num+1}/{total_pages}, cell {label}. "
                                     "SCAN: Walls → Ceiling → Floor. "
                                     "Count EVERY device in this cell only."},
                            {"type": "image_url", "image_url": {
                                "url": f"data:image/jpeg;base64,{img_b64}", "detail": "high"
                            }}
                        ])
                    ])
                    data = result.model_dump()
                    n = sum(d.get("quantity", 0) for d in data.get("devices", []))
                    print(f" → {n} dev")
                    all_devices.extend(data.get("devices", []))
                    all_verif.extend(data.get("needs_verification", []))
                    all_zones.update(data.get("zones_identified", []))
                    break
                except Exception as e:
                    err = str(e)
                    if "429" in err and attempt < 2:
                        wait = (attempt + 1) * 2  # 2s, 4s
                        print(f" → 429, retry in {wait}s...", end="")
                        time.sleep(wait)
                    else:
                        print(f" → ❌ {e}")
                        break

    total = sum(d.get("quantity", 0) for d in all_devices)
    print(f"  ✅ Page {page_num+1}: {total} devices from {len(all_zones)} zones (9-grid)")

    return {
        "page": page_num,
        "page_title": f"Drawing p.{page_num+1} (9-grid 3.0x)",
        "source": "drawing",
        "zones_identified": list(all_zones),
        "devices": all_devices,
        "needs_verification": all_verif
    }


def _build_legend_context(legend):
    if not legend or not legend.get("symbols"): return ""
    lines = ["KNOWN SYMBOLS:"]
    for s in legend["symbols"]:
        lines.append(f"  {s['symbol_label']} = {s['description']} [{s['category']}]")
    return "\n".join(lines)


# ==================================================================
# 6. ENHANCED PAGE SCANNER
# ==================================================================

_FA_KW = ["fire alarm", "facp", "horn", "strobe", "pull station",
           "smoke detector", "duct detector", "notification"]
_MECH_KW = ["mechanical", "hvac", "heat pump", "exhaust fan",
            "wshp", "ahu", "duct heater"]
_LV_KW = ["low voltage", "data", "cctv", "camera", "speaker",
           "audio", "wifi", "wap", "security", "intercom", "eas"]


def enhanced_scan(pdf_path):
    from blueprint_parser import _ELECTRICAL_KW, _FLOORPLAN_KW, _PLUMBING_KW
    doc = fitz.open(pdf_path)
    results = []
    for i in range(len(doc)):
        text = doc.load_page(i).get_text().lower()
        se = sum(1 for k in _ELECTRICAL_KW if k in text)
        sf = sum(1 for k in _FLOORPLAN_KW if k in text)
        sfa = sum(1 for k in _FA_KW if k in text)
        sm = sum(1 for k in _MECH_KW if k in text)
        slv = sum(1 for k in _LV_KW if k in text)
        sched_kw = ["schedule", "fixture schedule", "panel schedule",
                    "equipment schedule", "connection schedule", "circuit"]
        ss = sum(1 for k in sched_kw if k in text)
        results.append({
            "page": i, "score_e": se, "score_fp": sf,
            "score_fa": sfa, "score_m": sm, "score_lv": slv,
            "score_sched": ss, "is_schedule": ss >= 2,
            "combined": se + sf * 2 + sfa + sm + slv + ss * 2
        })
    doc.close()
    return results


def auto_select_pages(pdf_path, max_drawings=8, max_schedules=3):
    """Auto-select schedule pages + drawing pages."""
    all_p = enhanced_scan(pdf_path)
    legend = _find_legend_pages(pdf_path)

    # Schedules (high sched score)
    scheds = sorted(
        [p for p in all_p if p["is_schedule"] and p["score_e"] >= 2],
        key=lambda x: x["score_sched"] + x["score_e"], reverse=True
    )[:max_schedules]

    # Drawings (exclude legend + schedules)
    exclude = set(legend + [p["page"] for p in scheds])
    draws = sorted(
        [p for p in all_p if p["combined"] >= 4 and p["page"] not in exclude],
        key=lambda x: x["combined"], reverse=True
    )[:max_drawings]

    return {
        "legend": legend[:1],
        "schedules": [p["page"] for p in scheds],
        "drawings": [p["page"] for p in draws]
    }


# ==================================================================
# 7. ORCHESTRATOR
# ==================================================================

SECTION_NAMES = {
    "1_distribution": "1. Distribution & Power Equipment",
    "2_hvac_connections": "2. HVAC & Plumbing Connections",
    "3_lighting": "3. Lighting Fixtures",
    "4_lighting_controls": "4. Lighting Controls",
    "5_receptacles": "5. Power Receptacles & Connections",
    "6_low_voltage": "6. Low Voltage (IT, AV, Security)",
    "7_fire_alarm": "7. Fire Alarm",
    "8_rough_in": "8. Rough-In Materials",
}


def run_takeoff(pdf_path, page_nums=None, sched_pages=None, max_pages=10):
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(pdf_path)

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    print(f"📄 TAKEOFF v5: {os.path.basename(pdf_path)} ({total_pages} pages)")
    print("=" * 70)

    # ── Legend ──
    print("\n📖 STEP 1: Legend")
    legend = None
    try:
        legend = extract_legend(pdf_path)
    except Exception as e:
        print(f"  ⚠️  {e}")

    # ── Page plan ──
    if page_nums is not None or sched_pages is not None:
        plan = {
            "schedules": sched_pages or [],
            "drawings": page_nums or []
        }
    else:
        plan = auto_select_pages(pdf_path, max_drawings=max_pages)
        print(f"\n📊 Auto-selected:")
        print(f"   Schedules: {plan['schedules']}")
        print(f"   Drawings:  {plan['drawings']}")

    all_results = []

    # ── Schedules ──
    if plan["schedules"]:
        print(f"\n📋 STEP 2: Schedules ({len(plan['schedules'])} pages)")
        for pg in plan["schedules"]:
            try:
                sched = parse_schedule(pdf_path, pg)
                devices = [{
                    "section": e.get("section", "8_rough_in"),
                    "device_type": e.get("device_type", "Unknown"),
                    "symbol_on_drawing": e.get("mark_or_code", ""),
                    "zone": "Per Schedule",
                    "quantity": e.get("quantity", 1),
                    "notes": e.get("specs", ""),
                    "confidence": "certain"
                } for e in sched.get("entries", [])]
                if devices:
                    all_results.append({
                        "page": pg,
                        "page_title": sched.get("page_title", f"Schedule p.{pg+1}"),
                        "source": "schedule",
                        "devices": devices,
                        "needs_verification": []
                    })
            except Exception as e:
                print(f"  ❌ {e}")

    # ── Text-based parsers (FREE — no API) ──
    print(f"\n📝 STEP 2b: Text-Based Extraction (FREE)")
    text_devices = []

    # Panel schedule
    try:
        pd = parse_panel_schedule_text(pdf_path)
        text_devices.extend(pd)
    except Exception as e:
        print(f"  ⚠️ Panel schedule: {e}")

    # Keynotes
    try:
        kd = parse_keynotes(pdf_path)
        text_devices.extend(kd)
    except Exception as e:
        print(f"  ⚠️ Keynotes: {e}")

    # Equipment connections
    try:
        ed = parse_equipment_connections(pdf_path)
        text_devices.extend(ed)
    except Exception as e:
        print(f"  ⚠️ Equipment: {e}")

    if text_devices:
        all_results.append({
            "page": -1,
            "page_title": "Text Extraction (PyMuPDF)",
            "source": "text",
            "devices": text_devices,
            "needs_verification": []
        })
        print(f"  ✅ Total text-extracted: {len(text_devices)} items")

    # ── Drawings (9-grid) ──
    print(f"\n🔍 STEP 3: Drawing Scan — 9-grid 3.0x ({len(plan['drawings'])} pages)")
    for i, pg in enumerate(plan["drawings"]):
        print(f"\n── Page {pg+1}/{total_pages} ({i+1}/{len(plan['drawings'])}) ──")
        try:
            result = scan_page_9grid(pdf_path, pg, legend=legend)
            if result.get("devices"):
                all_results.append(result)
            else:
                print(f"  ⚠️  No devices on page {pg+1}")
        except Exception as e:
            print(f"  ❌ {e}")

    # ── Aggregate ──
    print(f"\n🔗 STEP 4: Aggregate & Cross-Reference")
    report = _aggregate(all_results, total_pages, pdf_path, legend)
    return report


# ==================================================================
# 8. SMART AGGREGATION WITH DEDUP
# ==================================================================

def _normalize_device_key(dtype, sym):
    """Normalize device type for dedup."""
    dtype_l = dtype.lower().strip()
    sym_l = sym.lower().strip()
    # Normalize common variants
    aliases = {
        "duplex receptacle": "Duplex Receptacle",
        "duplex outlet": "Duplex Receptacle",
        "standard receptacle": "Duplex Receptacle",
        "receptacle": "Duplex Receptacle",
        "gfci receptacle": "GFCI Receptacle",
        "gfci outlet": "GFCI Receptacle",
        "recessed downlight": "Recessed Downlight",
        "recessed can": "Recessed Downlight",
        "recessed light": "Recessed Downlight",
        "exit sign": "Exit Sign",
        "emergency light": "Emergency Light",
        "smoke detector": "Smoke Detector",
        "single pole switch": "Single Pole Switch",
        "switch": "Single Pole Switch",
        "security camera": "CCTV Camera",
        "cctv camera": "CCTV Camera",
        "camera": "CCTV Camera",
        "data outlet": "Data Outlet",
        "data port": "Data Outlet",
        "speaker": "Speaker",
        "wireless access point": "WAP",
        "occupancy sensor": "Occupancy Sensor",
        "vacancy sensor": "Occupancy Sensor",
    }
    for pat, norm in aliases.items():
        if pat in dtype_l:
            return norm
    return dtype


def _aggregate(all_results, total_pages, pdf_path, legend):
    # Phase 1: Collect schedule items first (authoritative for lighting quantities)
    schedule_types = {}  # section_key -> {normalized_type -> qty}
    for pr in all_results:
        if pr.get("source") != "schedule":
            continue
        for dev in pr.get("devices", []):
            sec = dev.get("section", "8_rough_in")
            raw = dev.get("device_type", "Unknown")
            sym = dev.get("symbol_on_drawing", "")
            dtype = _normalize_device_key(raw, sym)
            qty = dev.get("quantity", 1)
            if sec not in schedule_types:
                schedule_types[sec] = {}
            if dtype not in schedule_types[sec]:
                schedule_types[sec][dtype] = 0
            schedule_types[sec][dtype] += qty

    sections = {k: {} for k in SECTION_NAMES}
    all_verif = []
    all_zones = set()
    drawing_skipped = set()  # track items skipped because schedule is authoritative

    for pr in all_results:
        page = pr.get("page", 0)
        source = pr.get("source", "drawing")

        for v in pr.get("needs_verification", []):
            all_verif.append(f"[Page {page+1}] {v}")

        for dev in pr.get("devices", []):
            sec = dev.get("section", "8_rough_in")
            raw_dtype = dev.get("device_type", "Unknown")
            sym = dev.get("symbol_on_drawing", "")
            dtype = _normalize_device_key(raw_dtype, sym)
            zone = dev.get("zone", "Unknown")
            qty = dev.get("quantity", 1)
            conf = dev.get("confidence", "certain")
            notes = dev.get("notes", "")

            all_zones.add(zone)

            # Schedule-first dedup: if schedule has qty for this LIGHTING type,
            # skip drawing counts (schedule is authoritative for fixture quantities)
            if source == "drawing" and sec == "3_lighting":
                if sec in schedule_types and dtype in schedule_types[sec]:
                    drawing_skipped.add(dtype)
                    continue  # skip — schedule has authoritative count

            key = f"{dtype}"
            if key not in sections[sec]:
                sections[sec][key] = {
                    "device_type": dtype,
                    "symbol": sym,
                    "total_qty": 0,
                    "zone_breakdown": {},
                    "amps": dev.get("amps"),
                    "voltage": dev.get("voltage"),
                    "notes": set(),
                    "confidence": conf,
                    "source_pages": set(),
                    "sources": set()
                }

            sections[sec][key]["total_qty"] += qty
            sections[sec][key]["source_pages"].add(page)
            sections[sec][key]["sources"].add(source)
            if zone not in sections[sec][key]["zone_breakdown"]:
                sections[sec][key]["zone_breakdown"][zone] = 0
            sections[sec][key]["zone_breakdown"][zone] += qty
            if notes:
                sections[sec][key]["notes"].add(notes)
            if conf == "uncertain":
                sections[sec][key]["confidence"] = "uncertain"

    if drawing_skipped:
        print(f"  📊 Schedule-first dedup: skipped drawing counts for {drawing_skipped}")

    # Build report
    report_sections = {}
    total_points = 0
    for sec_key, devices in sections.items():
        items = []
        sec_total = 0
        for key, data in sorted(devices.items()):
            item = {
                "device_type": data["device_type"],
                "symbol": data["symbol"],
                "quantity": data["total_qty"],
                "zone_breakdown": data["zone_breakdown"],
                "confidence": data["confidence"],
                "source_pages": sorted(data["source_pages"]),
                "sources": sorted(data["sources"]),
            }
            if data["amps"]: item["amps"] = data["amps"]
            if data["voltage"]: item["voltage"] = data["voltage"]
            if data["notes"]: item["notes"] = "; ".join(data["notes"])
            items.append(item)
            sec_total += data["total_qty"]
        report_sections[sec_key] = {
            "name": SECTION_NAMES[sec_key],
            "subtotal": sec_total,
            "items": items
        }
        total_points += sec_total

    # Cross-ref: items from BOTH schedule and drawing
    cross_ref = []
    for sec_key, devices in sections.items():
        for key, data in devices.items():
            if "schedule" in data["sources"] and "drawing" in data["sources"]:
                cross_ref.append(
                    f"⚠️ {data['device_type']}: found in both schedule and drawing "
                    f"(qty={data['total_qty']}) — verify not double-counted"
                )

    return {
        "source_pdf": os.path.basename(pdf_path),
        "total_pages": total_pages,
        "pages_scanned": sorted(set(pr.get("page", 0) for pr in all_results)),
        "legend_extracted": bool(legend),
        "legend_symbols": len(legend.get("symbols", [])) if legend else 0,
        "total_points": total_points,
        "zones": sorted(all_zones),
        "sections": report_sections,
        "needs_verification": all_verif,
        "cross_reference_warnings": cross_ref,
    }


# ==================================================================
# 9. REPORT PRINTER
# ==================================================================

def print_report(report):
    print("\n" + "=" * 80)
    print(f"📋 ELECTRICAL DEVICE TAKEOFF — {report['source_pdf']}")
    print("=" * 80)

    print(f"\n🔌 TOTAL POINTS: {report['total_points']}")
    for sk in sorted(report["sections"]):
        s = report["sections"][sk]
        if s["subtotal"] > 0:
            print(f"   {s['name']}: {s['subtotal']}")

    print(f"\n   Legend: {'✅ ' + str(report['legend_symbols']) + ' sym' if report['legend_extracted'] else '❌'}")
    print(f"   Pages: {report['pages_scanned']}")
    print(f"   Zones: {len(report['zones'])}")

    for sk in sorted(report["sections"]):
        s = report["sections"][sk]
        if not s["items"]: continue

        print(f"\n{'━' * 80}")
        print(f"  {s['name']}  (Subtotal: {s['subtotal']})")
        print(f"{'━' * 80}")
        print(f"  {'Device':<32s} {'Sym':<8s} {'Qty':>4s}  {'Src':<6s}  Zones")
        print(f"  {'─' * 75}")

        for item in s["items"]:
            zones_str = ", ".join(f"{z}:{c}" for z, c in sorted(item["zone_breakdown"].items())[:5])
            src = "S+D" if "schedule" in item.get("sources", []) and "drawing" in item.get("sources", []) \
                else "Sched" if "schedule" in item.get("sources", []) else "Draw"
            conf = "⚠️" if item["confidence"] == "uncertain" else ""
            print(f"  {item['device_type']:<32s} {item['symbol']:<8s} {item['quantity']:>4d}  {src:<6s}  {zones_str} {conf}")

    if report["needs_verification"]:
        print(f"\n{'━' * 80}")
        print("⚠️  REQUIRES MANUAL VERIFICATION:")
        for v in report["needs_verification"][:10]:
            print(f"   • {v}")
        if len(report["needs_verification"]) > 10:
            print(f"   ... and {len(report['needs_verification']) - 10} more")

    if report["cross_reference_warnings"]:
        print(f"\n{'━' * 80}")
        print("🔄 CROSS-REF (schedule + drawing overlap):")
        for w in report["cross_reference_warnings"]:
            print(f"   • {w}")

    print(f"\n{'━' * 80}")


# ==================================================================
# 10. CLI
# ==================================================================

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Device Takeoff Agent v4")
    ap.add_argument("pdf", help="Path to blueprint PDF")
    ap.add_argument("--pages", type=str, default=None,
                    help="Drawing page numbers (0-indexed, comma-separated)")
    ap.add_argument("--schedules", type=str, default=None,
                    help="Schedule page numbers (0-indexed, comma-separated)")
    ap.add_argument("--max-pages", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--scan", action="store_true",
                    help="Only scan pages (no API key)")
    args = ap.parse_args()

    if args.scan:
        pages = enhanced_scan(args.pdf)
        print(f"\n{'Pg':>4s}  {'E':>3s}  {'FP':>3s}  {'FA':>3s}  {'M':>3s}  {'LV':>3s}  {'Sch':>3s}  Comb")
        print("-" * 50)
        for p in pages:
            if p["combined"] > 0:
                print(f"  {p['page']:2d}   {p['score_e']:3d}  {p['score_fp']:3d}  "
                      f"{p['score_fa']:3d}  {p['score_m']:3d}  {p['score_lv']:3d}  "
                      f"{p['score_sched']:3d}  {p['combined']:3d}"
                      f"{'  📋' if p['is_schedule'] else ''}")
        sys.exit(0)

    if not os.environ.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY not set."); sys.exit(1)

    pg = [int(x) for x in args.pages.split(",")] if args.pages else None
    sp = [int(x) for x in args.schedules.split(",")] if args.schedules else None

    report = run_takeoff(args.pdf, page_nums=pg, sched_pages=sp, max_pages=args.max_pages)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False, default=list))
    else:
        print_report(report)
