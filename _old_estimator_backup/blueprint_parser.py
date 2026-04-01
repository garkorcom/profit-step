"""
Blueprint Vision Parser — Phase 10
Converts PDF blueprints to JSON 2.0 using GPT-4o Vision + Grid-Based Prompting.

The LLM overlays a virtual 100x100 grid on the floor plan image and reports
device coordinates as percentages. Python then converts these to real-world
millimeters using the blueprint's scale or a default assumption.

Usage:
    OPENAI_API_KEY=sk-... python blueprint_parser.py path/to/blueprint.pdf
"""

import os
import sys
import json
import base64

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF not installed. Run: pip install PyMuPDF")
    sys.exit(1)

from pydantic import BaseModel, Field
from typing import List, Literal, Optional


# ==========================================
# 1. PYDANTIC SCHEMAS (JSON 2.0 output)
# ==========================================

class DevicePosition(BaseModel):
    """A single electrical device on the blueprint."""
    id: str = Field(description="Unique ID like K_R1, B_L1, LR_S2")
    type: Literal[
        "socket_standard",
        "switch_single",
        "switch_dimmer",
        "ceiling_light",
        "electric_oven_240V",
        "hvac",
        "ev_charger",
        "receptacle"
    ] = Field(description="Device type from standard set")
    power_amps: int = Field(
        default=16,
        description="Default 16 for sockets/lights. 40 for ovens, 30 for HVAC, 50 for EV chargers"
    )
    x: float = Field(description="X coordinate on 0-100 grid (percentage from left)")
    y: float = Field(description="Y coordinate on 0-100 grid (percentage from top)")


class RoomData(BaseModel):
    """A room with its zone type and devices."""
    name: str = Field(description="Room name: Kitchen, Bedroom, Bathroom, etc.")
    zone_type: Literal["wet", "dry"] = Field(
        description="MUST be 'wet' for kitchen, bathroom, laundry, outdoor. 'dry' for everything else."
    )
    devices: List[DevicePosition]


class PanelLocation(BaseModel):
    """Electrical panel / breaker box position on the 0-100 grid."""
    x: float = Field(description="X coordinate on 0-100 grid (percentage from left)")
    y: float = Field(description="Y coordinate on 0-100 grid (percentage from top)")


class BlueprintJSON(BaseModel):
    """Full blueprint in JSON 2.0 format."""
    project_id: str = Field(default="Parsed_Blueprint", description="Project identifier")
    scale_multiplier_mm: float = Field(
        default=50.0,
        description="Scale: how many mm on paper = 1m real. If scale bar visible, calculate it. Default 50."
    )
    panel_location: PanelLocation = Field(
        description="Electrical panel/board location on 0-100 grid"
    )
    rooms: List[RoomData]


# ==========================================
# 2. VISION SYSTEM PROMPT
# ==========================================

VISION_SYSTEM_PROMPT = """You are an expert Electrical Estimator analyzing a floor plan / electrical blueprint.

CRITICAL INSTRUCTIONS FOR COORDINATES:
1. Imagine a 100x100 percentage grid overlaying this image:
   - Top-Left corner = (0, 0)
   - Bottom-Right corner = (100, 100)
2. Estimate X, Y coordinates of every electrical symbol based on this percentage grid.
3. X increases left→right, Y increases top→bottom.

DEVICE IDENTIFICATION RULES:
- Look for standard electrical symbols: outlets (⊙), switches (S), lights (○), panel boards (□)
- Sockets/receptacles near counters or walls → "socket_standard"
- Ceiling-mounted circles → "ceiling_light"
- Wall-mounted S symbols → "switch_single" 
- Large appliance symbols (oven, range, dryer) → "electric_oven_240V" with power_amps=40
- HVAC units → "hvac" with power_amps=30

ROOM IDENTIFICATION RULES:
- Kitchen, Bathroom, Laundry, Outdoor → zone_type = "wet"
- Bedroom, Living Room, Office, Hallway, Closet → zone_type = "dry"

PANEL LOCATION:
- Look for the main electrical panel / breaker box / load center
- If not visible, estimate it near the front entrance or utility area

NAMING CONVENTION for device IDs:
- Use room initial + device type abbreviation + number
- Kitchen socket 1 → K_R1, Kitchen socket 2 → K_R2
- Kitchen oven → K_OVEN
- Bedroom light 1 → B_L1, Bedroom switch 1 → B_S1
- Living Room socket 1 → LR_R1
- Bathroom light → BA_L1

SCALE:
- If you can see a scale bar (e.g., "1:50" or "Scale: 1/4" = 1'"), extract scale_multiplier_mm.
- 1:50 means 1mm on paper = 50mm real → scale_multiplier_mm = 50
- If no scale visible, use default 50.

Do NOT hallucinate devices that are not visible. Only report what you can actually see."""


# ==========================================
# 3. PAGE SCANNER — find the best page(s)
# ==========================================

# Keywords that indicate a page is an electrical plan
_ELECTRICAL_KW = [
    "panel", "breaker", "circuit", "amp", "volt", "wire", "conduit",
    "receptacle", "outlet", "switch", "lighting", "gfci", "afci",
    "load center", "service entrance", "disconnect", "amps",
    "277/480", "120/208", "electric", "e-", "kva",
]

# Keywords that indicate a page is a plumbing plan
_PLUMBING_KW = [
    "plumbing", "drain", "vent", "water", "sewer", "fixture",
    "lavatory", "toilet", "sink", "p-trap", "cleanout", "pex",
    "pvc", "waste", "hot water", "cold water", "backflow",
]

# Keywords for floor plan pages (may contain device symbols)
_FLOORPLAN_KW = [
    "floor plan", "kitchen", "bathroom", "bedroom", "living",
    "restroom", "storage", "hallway", "office", "layout",
]

MAX_IMAGE_BYTES = 15_000_000  # 15 MB — safe limit for GPT-4o Vision


def scan_pages(pdf_path: str) -> list:
    """Scan all pages and score them for electrical / plumbing / floor-plan relevance.
    Returns a sorted list of dicts: [{page: int, score_e: int, score_p: int, score_fp: int, label: str}, ...]
    """
    doc = fitz.open(pdf_path)
    results = []
    for i in range(len(doc)):
        text = doc.load_page(i).get_text().lower()
        se = sum(1 for kw in _ELECTRICAL_KW if kw in text)
        sp = sum(1 for kw in _PLUMBING_KW if kw in text)
        sf = sum(1 for kw in _FLOORPLAN_KW if kw in text)
        # Determine label
        if se >= sp and se > 0:
            label = "E"
        elif sp > se and sp > 0:
            label = "P"
        elif sf > 0:
            label = "FP"
        else:
            label = "-"
        results.append({"page": i, "score_e": se, "score_p": sp, "score_fp": sf, "label": label})
    doc.close()
    return results


def find_best_page(pdf_path: str, prefer: str = "E") -> int:
    """Find the single best page for a given type (E=electrical, P=plumbing)."""
    pages = scan_pages(pdf_path)
    key = "score_e" if prefer == "E" else "score_p"
    ranked = sorted(pages, key=lambda p: (p[key], p["score_fp"]), reverse=True)
    if ranked and ranked[0][key] > 0:
        return ranked[0]["page"]
    fp_pages = [p for p in pages if p["label"] == "FP"]
    if fp_pages:
        return fp_pages[0]["page"]
    return 0


def find_relevant_pages(pdf_path: str, prefer: str = "E",
                        min_score: int = 3, max_pages: int = 5) -> list:
    """Find ALL relevant pages for a type, sorted by score descending.
    Only pages scoring >= min_score are included. Capped at max_pages to limit API cost.
    Returns list of page numbers.
    """
    pages = scan_pages(pdf_path)
    key = "score_e" if prefer == "E" else "score_p"
    relevant = [p for p in pages if p[key] >= min_score]
    relevant.sort(key=lambda p: p[key], reverse=True)
    return [p["page"] for p in relevant[:max_pages]]


# ==========================================
# 4. CORE PARSER (with compression)
# ==========================================

def pdf_to_base64_jpeg(pdf_path: str, page_num: int = 0, zoom: float = 1.5,
                       max_bytes: int = MAX_IMAGE_BYTES) -> str:
    """Convert a PDF page to a base64-encoded JPEG string.
    Automatically reduces quality/zoom if the image exceeds max_bytes.
    """
    doc = fitz.open(pdf_path)
    if page_num >= len(doc):
        page_num = 0
    page = doc.load_page(page_num)

    # Try with requested zoom, then reduce if too large
    for attempt_zoom in [zoom, 1.2, 1.0, 0.8]:
        mat = fitz.Matrix(attempt_zoom, attempt_zoom)
        pix = page.get_pixmap(matrix=mat)
        # Try quality levels
        for quality in [85, 70, 55, 40]:
            jpeg_bytes = pix.tobytes("jpeg")
            # PyMuPDF tobytes("jpeg") doesn't accept quality param,
            # so we use Pillow if available for better compression
            try:
                from io import BytesIO
                from PIL import Image
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                buf = BytesIO()
                img.save(buf, format="JPEG", quality=quality, optimize=True)
                jpeg_bytes = buf.getvalue()
            except ImportError:
                pass  # Use PyMuPDF output as-is

            if len(jpeg_bytes) <= max_bytes:
                doc.close()
                w, h = pix.width, pix.height
                mb = len(jpeg_bytes) / 1_000_000
                print(f"   📐 Image: {w}x{h}, {mb:.1f}MB (zoom={attempt_zoom}, q={quality})")
                return base64.b64encode(jpeg_bytes).decode('utf-8')

    # Last resort: use whatever we have
    doc.close()
    print(f"   ⚠️ Image still large ({len(jpeg_bytes)/1_000_000:.1f}MB), sending anyway")
    return base64.b64encode(jpeg_bytes).decode('utf-8')


def parse_blueprint(pdf_path: str, page_num: int = None,
                    assumed_width_m: float = 20.0) -> dict:
    """
    Parse a blueprint PDF into JSON 2.0 format using GPT-4o Vision.

    Args:
        pdf_path: Path to the PDF file
        page_num: Page number to parse (0-indexed). If None, auto-detects best page.
        assumed_width_m: Assumed real-world width in meters (default 20m).

    Returns:
        Dictionary in JSON 2.0 format ready for the LangGraph orchestrator.
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"Blueprint not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    print(f"📄 Blueprint: {pdf_path} ({total_pages} pages)")

    # Auto-detect best page if not specified
    if page_num is None:
        print("🔍 Scanning pages for electrical/plumbing content...")
        pages = scan_pages(pdf_path)
        # Show top candidates
        for p in pages:
            if p["score_e"] + p["score_p"] + p["score_fp"] > 0:
                print(f"   [{p['page']:2d}] E={p['score_e']:2d} P={p['score_p']:2d} FP={p['score_fp']:2d} → {p['label']}")
        page_num = find_best_page(pdf_path, prefer="E")
        print(f"   → Selected page {page_num}")
    else:
        print(f"   Using specified page {page_num}")

    # Step 1: Convert PDF page to compressed image
    print("🖼️  Converting to JPEG (with compression)...")
    base64_image = pdf_to_base64_jpeg(pdf_path, page_num=page_num, zoom=1.5)

    # Step 2: Send to GPT-4o Vision with structured output
    print("👁️  Vision Agent analyzing (takes ~10-15 sec)...")

    llm = ChatOpenAI(model="gpt-4o", temperature=0)
    structured_llm = llm.with_structured_output(BlueprintJSON)

    messages = [
        SystemMessage(content=VISION_SYSTEM_PROMPT),
        HumanMessage(content=[
            {
                "type": "text",
                "text": f"Analyze this floor plan (page {page_num + 1} of {total_pages}). "
                        "Extract all rooms, their zone types (wet/dry), "
                        "and the position of every electrical device. Report coordinates on a 0-100 grid."
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}",
                    "detail": "high"
                }
            }
        ])
    ]

    result = structured_llm.invoke(messages)

    # Step 3: Post-process — convert grid % → real mm coordinates
    print("🔢 Converting grid coordinates to real-world mm...")

    data = result.model_dump()

    scale = data.get("scale_multiplier_mm", 50.0)
    paper_width_mm = (assumed_width_m * 1000) / scale
    grid_to_paper_mm = paper_width_mm / 100.0

    # Convert panel location
    panel = data.get("panel_location", {"x": 5, "y": 50})
    data["panel_location"] = {
        "x": round(panel.get("x", 5) * grid_to_paper_mm),
        "y": round(panel.get("y", 50) * grid_to_paper_mm)
    }

    # Convert device coordinates
    total_devices = 0
    for room in data.get("rooms", []):
        for dev in room.get("devices", []):
            dev["x"] = round(dev["x"] * grid_to_paper_mm)
            dev["y"] = round(dev["y"] * grid_to_paper_mm)
            total_devices += 1

    # Attach metadata
    data["_meta"] = {
        "source_pdf": os.path.basename(pdf_path),
        "page_used": page_num,
        "total_pages": total_pages
    }

    print(f"✅ Page {page_num + 1} parsed: {len(data.get('rooms', []))} rooms, {total_devices} devices")

    return data


# ==========================================
# 5. MULTI-PAGE MERGE
# ==========================================

def _merge_results(results: list) -> dict:
    """Merge multiple parse_blueprint results into one combined result.
    Rooms with the same name are merged (devices combined, deduplicated by ID).
    """
    if not results:
        return {}
    if len(results) == 1:
        return results[0]

    merged = {
        "project_id": results[0].get("project_id", "Parsed_Blueprint"),
        "scale_multiplier_mm": results[0].get("scale_multiplier_mm", 50.0),
        "panel_location": results[0].get("panel_location", {"x": 0, "y": 0}),
        "rooms": [],
        "_meta": {
            "source_pdf": results[0].get("_meta", {}).get("source_pdf", ""),
            "pages_used": [r.get("_meta", {}).get("page_used", 0) for r in results],
            "total_pages": results[0].get("_meta", {}).get("total_pages", 0)
        }
    }

    # Merge rooms by name
    room_map = {}  # name -> {zone_type, devices: {id -> device}}
    for res in results:
        for room in res.get("rooms", []):
            name = room["name"]
            if name not in room_map:
                room_map[name] = {
                    "name": name,
                    "zone_type": room["zone_type"],
                    "devices": {}
                }
            # Merge devices (dedup by ID)
            for dev in room.get("devices", []):
                dev_id = dev.get("id", f"unknown_{len(room_map[name]['devices'])}")
                if dev_id not in room_map[name]["devices"]:
                    room_map[name]["devices"][dev_id] = dev

    # Convert back to list format
    for name, room_data in room_map.items():
        merged["rooms"].append({
            "name": room_data["name"],
            "zone_type": room_data["zone_type"],
            "devices": list(room_data["devices"].values())
        })

    return merged


def parse_blueprint_multi(pdf_path: str, page_nums: list = None,
                          assumed_width_m: float = 20.0,
                          prefer: str = "E") -> dict:
    """Parse MULTIPLE pages from a PDF and merge results.

    Args:
        pdf_path: Path to the PDF file
        page_nums: List of page numbers. If None, auto-detects all relevant pages.
        assumed_width_m: Assumed real-world width in meters.
        prefer: "E" for electrical, "P" for plumbing (used for auto-detection).

    Returns:
        Merged dictionary in JSON 2.0 format.
    """
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"Blueprint not found: {pdf_path}")

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    # Auto-detect relevant pages
    if page_nums is None:
        page_nums = find_relevant_pages(pdf_path, prefer=prefer)
        if not page_nums:
            # Fallback to single best page
            page_nums = [find_best_page(pdf_path, prefer=prefer)]

    print(f"📄 Blueprint: {pdf_path} ({total_pages} pages)")
    print(f"📑 Processing {len(page_nums)} pages: {page_nums}")

    results = []
    for i, pg in enumerate(page_nums):
        print(f"\n--- Page {pg + 1}/{total_pages} ({i + 1}/{len(page_nums)}) ---")
        try:
            res = parse_blueprint(pdf_path, page_num=pg, assumed_width_m=assumed_width_m)
            if res.get("rooms"):
                results.append(res)
            else:
                print(f"   ⚠️ No rooms found on page {pg + 1}, skipping")
        except Exception as e:
            print(f"   ❌ Error on page {pg + 1}: {e}")

    if not results:
        print("\n⚠️ No devices found on any page")
        return {"rooms": [], "panel_location": {"x": 0, "y": 0},
                "scale_multiplier_mm": 50.0,
                "_meta": {"source_pdf": os.path.basename(pdf_path),
                          "pages_used": page_nums, "total_pages": total_pages}}

    merged = _merge_results(results)

    total_devices = sum(len(r.get("devices", [])) for r in merged.get("rooms", []))
    print(f"\n🔗 Merged result:")
    print(f"   Rooms: {len(merged.get('rooms', []))}")
    print(f"   Total devices: {total_devices}")
    print(f"   Pages used: {merged['_meta']['pages_used']}")

    return merged


# ==========================================
# 5. STANDALONE CLI
# ==========================================

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Blueprint Vision Parser (GPT-4o)")
    ap.add_argument("pdf", help="Path to blueprint PDF")
    ap.add_argument("--page", type=int, default=None,
                    help="Page number (0-indexed). Auto-detects if omitted.")
    ap.add_argument("--scan", action="store_true",
                    help="Only scan pages and print scores, don't parse.")
    args = ap.parse_args()

    if args.scan:
        pages = scan_pages(args.pdf)
        print(f"\n{'Page':>4s}  {'E':>3s}  {'P':>3s}  {'FP':>3s}  Label")
        print("-" * 30)
        for p in pages:
            total = p["score_e"] + p["score_p"] + p["score_fp"]
            if total > 0:
                print(f"  {p['page']:2d}   {p['score_e']:3d}  {p['score_p']:3d}  {p['score_fp']:3d}  {p['label']}")
        best_e = find_best_page(args.pdf, "E")
        best_p = find_best_page(args.pdf, "P")
        print(f"\nBest electrical page: {best_e}")
        print(f"Best plumbing page:   {best_p}")
    else:
        if not os.environ.get("OPENAI_API_KEY"):
            print("ERROR: OPENAI_API_KEY not set.")
            sys.exit(1)
        result = parse_blueprint(args.pdf, page_num=args.page)
        print("\n" + "=" * 60)
        print("JSON 2.0 OUTPUT:")
        print("=" * 60)
        print(json.dumps(result, indent=2, ensure_ascii=False))

