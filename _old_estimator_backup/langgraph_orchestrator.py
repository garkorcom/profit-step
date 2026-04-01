import os
import json
import csv
import logging
from typing import TypedDict, Annotated, List, Dict, Any
from langgraph.graph import StateGraph, START, END
import sqlite3
from langgraph.checkpoint.sqlite import SqliteSaver
from qdrant_client import QdrantClient
from langchain_openai import OpenAIEmbeddings

log = logging.getLogger(__name__)

# Import Phase 9 Deterministic Tools
from geometry_tools import run_deterministic_circuit_design, run_code_compliance_check

# ---------- helpers -----------------------------------------------------------

def _is_pdf(path: str) -> bool:
    """True if path looks like a real PDF file."""
    return path.lower().endswith(".pdf") and os.path.isfile(path)


def _detect_type_from_content(blueprint_json: dict) -> str:
    """Detect blueprint type from Vision-parsed content (rooms & devices).
    Electrical types: socket_standard, switch_*, ceiling_light, electric_oven_*,
                      hvac, ev_charger, receptacle
    Plumbing types:   sink, lavatory, toilet, tub, shower, fixture
    """
    electrical_types = {
        "socket_standard", "switch_single", "switch_dimmer",
        "ceiling_light", "electric_oven_240V", "hvac",
        "ev_charger", "receptacle"
    }
    plumbing_types = {"sink", "lavatory", "toilet", "tub", "shower", "fixture"}

    e_count = 0
    p_count = 0
    for room in blueprint_json.get("rooms", []):
        for dev in room.get("devices", []):
            dt = dev.get("type", "")
            if dt in electrical_types:
                e_count += 1
            elif dt in plumbing_types:
                p_count += 1

    if e_count > 0 and e_count >= p_count:
        return "E"
    elif p_count > 0:
        return "P"
    return "A"

QDRANT_PATH = os.path.dirname(__file__) + "/qdrant_data"
COLLECTION_NAME = "construction_prices"

# Define the State for our graph
class EstimatorState(TypedDict):
    blueprint_path: str
    blueprint_type: str  # E, P, M, A
    blueprint_json: Dict[str, Any]  # Phase 9: JSON 2.0 room-based input
    extracted_features: List[Dict[str, Any]]  # Legacy flat features (plumbing)
    bom: List[Dict[str, Any]]  # Bill of Materials
    total_cost: float
    qa_passed: bool
    qa_feedback: str
    qa_retries: int
    human_approved: bool
    circuits: List[Dict[str, Any]]
    panel_schedule: List[Dict[str, Any]]

# --- Nodes ---

def vision_parser_node(state: EstimatorState):
    """Parse a real PDF blueprint via GPT-4o Vision (multi-page).
    Scans all relevant pages, parses each, and merges results.
    Skips gracefully when: not a PDF, no API key, or parse error."""
    bp_path = state["blueprint_path"]

    # Already have parsed JSON (sample data or previously provided)
    if state.get("blueprint_json", {}).get("rooms"):
        log.info("[Vision Parser] blueprint_json already present — skipping.")
        return {}

    if not _is_pdf(bp_path):
        log.info(f"[Vision Parser] Not a real PDF file ({bp_path}) — skipping.")
        return {}

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        log.warning("[Vision Parser] OPENAI_API_KEY not set — skipping Vision parsing.")
        return {}

    try:
        from blueprint_parser import parse_blueprint_multi
        log.info(f"[Vision Parser] 👁️ Multi-page parsing: {bp_path}")
        parsed = parse_blueprint_multi(bp_path)
        total_devices = sum(len(r.get("devices", [])) for r in parsed.get("rooms", []))
        pages_used = parsed.get("_meta", {}).get("pages_used", [])
        log.info(f"[Vision Parser] ✅ {len(parsed.get('rooms', []))} rooms, {total_devices} devices from {len(pages_used)} pages")
        return {"blueprint_json": parsed}
    except Exception as e:
        log.error(f"[Vision Parser] ❌ Error: {e}")
        return {}


def orchestrator_node(state: EstimatorState):
    """Chief Engineer determines the blueprint type.
    Priority: 1) content-based detection from blueprint_json,
              2) filename heuristic as fallback."""
    bjson = state.get("blueprint_json", {})

    # Try content-based detection first
    if bjson.get("rooms"):
        bp_type = _detect_type_from_content(bjson)
        log.info(f"[Orchestrator] Type from content analysis: {bp_type}")
    else:
        # Fallback to filename
        bp = state["blueprint_path"].lower()
        if "electrical" in bp or "e-" in bp:
            bp_type = "E"
        elif "plumbing" in bp or "p-" in bp:
            bp_type = "P"
        else:
            bp_type = "A"
        log.info(f"[Orchestrator] Type from filename: {bp_type}")

    return {"blueprint_type": bp_type}

def circuit_designer_node(state: EstimatorState):
    """Phase 9: Deterministic Circuit Designer using geometry_tools.py.
    Groups devices into circuits, calculates wire lengths with Manhattan distance,
    selects wire gauges and breakers — all with Python math, zero LLM."""
    blueprint = state.get("blueprint_json", {})
    
    log.info("[Circuit Designer] Running deterministic routing algorithms...")
    log.info(f"  Scale: {blueprint.get('scale_multiplier_mm', 50)}mm = 1m real")
    log.info(f"  Panel at: {blueprint.get('panel_location', {'x': 0, 'y': 0})}")
    log.info(f"  Rooms: {[r['name'] for r in blueprint.get('rooms', [])]}")
    
    result = run_deterministic_circuit_design(blueprint)
    
    # Log circuit details
    for c in result["circuits"]:
        dedicated = " [DEDICATED]" if c.get("dedicated") else ""
        log.info(f"  → {c['circuit_id']}{dedicated}: {c['devices']} | {c['wire_gauge'][:8]}... | {c['total_wire_length']}ft | {c['breaker']['breaker_type']}")
    
    return {
        "circuits": result["circuits"],
        "panel_schedule": result["panel_schedule"],
        "bom": result["bom"],
        "qa_feedback": ""
    }

def panel_builder_node(state: EstimatorState):
    """Phase 9: Panel is already built by geometry_tools in circuit_designer_node.
    This node now just logs the panel schedule and passes through."""
    circuits = state.get("circuits", [])
    panel_schedule = state.get("panel_schedule", [])
    
    # Calculate total poles
    total_poles = sum(p["poles"] for p in panel_schedule)
    
    log.info(f"[Panel Builder] Panel Schedule: {len(panel_schedule)} circuits, {total_poles} poles total")
    for p in panel_schedule:
        log.info(f"  → {p['circuit_id']}: {p['breaker_type']} ({p['amps']}A, {p['poles']}P)")
    
    # Panel is already complete from circuit_designer — just pass through
    return {}

def plumbing_agent_node(state: EstimatorState):
    """Calculates pipes, P-traps, and angle stops based on wet zones."""
    features = state.get("extracted_features", [])
    feedback = state.get("qa_feedback", "")
    
    # Filter fixtures
    sinks = len([f for f in features if f.get("type") in ["sink", "lavatory"]])
    toilets = len([f for f in features if f.get("type") == "toilet"])
    tubs = len([f for f in features if f.get("type") in ["tub", "shower"]])
    
    p_traps = sinks + tubs
    angle_stops = (sinks * 2) + toilets
    
    total_fixtures = sinks + toilets + tubs
    pex_pipe = total_fixtures * 15.0
    pvc_pipe = total_fixtures * 10.0
    
    if "no PVC drain pipes" in feedback:
        log.info(f"[Plumbing Agent] Fixing QA Feedback: {feedback}")
        pvc_pipe += 20.0
        
    bom = [item for item in state.get("bom", []) if item.get("category") != "plumbing"]
    bom.extend([
        {"item": "1/2 inch PEX Pipe - 100ft", "qty": round(pex_pipe, 1), "unit": "ft", "category": "plumbing"},
        {"item": "1-1/2 inch PVC Pipe - 10ft", "qty": round(pvc_pipe, 1), "unit": "ft", "category": "plumbing"},
        {"item": "P-Trap Kit 1-1/2 inch", "qty": p_traps, "unit": "ea", "category": "plumbing"},
        {"item": "Angle Stop Valve 1/2 x 3/8", "qty": angle_stops, "unit": "ea", "category": "plumbing"}
    ])
    
    return {"bom": bom, "qa_feedback": ""}

def pricing_agent_node(state: EstimatorState):
    """Queries Qdrant RAG for prices and calculates total."""
    total = 0.0
    bom = state.get("bom", [])
    
    try:
        client = QdrantClient(path=QDRANT_PATH)
        embeddings = OpenAIEmbeddings()
        
        for item in bom:
            vector = embeddings.embed_query(item["item"])
            # qdrant-client v1.16+ uses query_points instead of search
            from qdrant_client.models import models
            search_result = client.query_points(
                collection_name=COLLECTION_NAME,
                query=vector,
                limit=1
            )
            
            unit_price = 0.0
            if search_result and search_result.points:
                payload = search_result.points[0].payload
                unit_price = payload.get("price", 0.0)
                matched_name = payload.get("name", "")
                log.info(f"  💰 {item['item'][:40]:40s} → matched '{matched_name}' @ ${unit_price}")
                # Price per foot for wire sold by 100m spool
                if "100m" in matched_name and item["unit"] == "ft":
                    # 100m = 328ft, so price per foot = price / 328
                    unit_price = unit_price / 328.0
                    
            item["unit_price"] = round(unit_price, 2)
            item["total_price"] = round(item["qty"] * unit_price, 2)
            total += item["total_price"]
            
    except Exception as e:
        import traceback
        log.error(f"RAG Error: {e}")
        traceback.print_exc()
        for item in bom:
            item["unit_price"] = 0.0
            item["total_price"] = 0.0
            
    # Add Labor Burden
    if state["blueprint_type"] == "E":
        # Count devices from circuits
        circuits = state.get("circuits", [])
        device_count = sum(len(c.get("devices", [])) for c in circuits)
        labor_hrs = device_count * 0.5  # 30 min per device
        labor_cost = labor_hrs * 50.0
        bom.append({"item": "Electrician Labor", "qty": labor_hrs, "unit": "hrs", "unit_price": 50.0, "total_price": labor_cost, "category": "labor"})
        total += labor_cost
    elif state["blueprint_type"] == "P":
        items_count = sum(i["qty"] for i in bom if "Trap" in i["item"] or "Valve" in i["item"])
        labor_cost = items_count * 1.5 * 65.0
        bom.append({"item": "Plumber Labor", "qty": items_count * 1.5, "unit": "hrs", "unit_price": 65.0, "total_price": labor_cost, "category": "labor"})
        total += labor_cost
    
    return {"bom": bom, "total_cost": round(total, 2)}

def qa_agent_node(state: EstimatorState):
    """Phase 9: Deterministic Code Compliance check for Electrical, basic check for Plumbing."""
    bom = state.get("bom", [])
    retries = state.get("qa_retries", 0)
    
    log.info(f"[QA Agent] Auditing BOM (Retry {retries}/3)...")
    
    if retries >= 3:
        log.info("[QA Agent] Max retries reached. Forcing pass to Human Review.")
        return {"qa_passed": True, "qa_feedback": "Auto-passed due to max retries.", "qa_retries": retries + 1}
        
    if state["blueprint_type"] == "E":
        # Phase 9: Deterministic NEC Code Compliance
        log.info("[Code Compliance] Running deterministic NEC checks...")
        circuits = state.get("circuits", [])
        panel_schedule = state.get("panel_schedule", [])
        result = run_code_compliance_check(circuits, panel_schedule)
        
        if result["status"] == "REJECTED":
            log.info(f"[Code Compliance] ❌ REJECTED: {result['code_violation']}")
            return {"qa_passed": False, "qa_feedback": result["code_violation"], "qa_retries": retries + 1}
        else:
            log.info(f"[Code Compliance] ✅ {result['code_violation']}")
            
    elif state["blueprint_type"] == "P":
        has_pipes = any("PVC" in i["item"] and i["qty"] > 0 for i in bom)
        has_traps = any("Trap" in i["item"] and i["qty"] > 0 for i in bom)
        if has_traps and not has_pipes:
            return {"qa_passed": False, "qa_feedback": "Found P-traps but no PVC drain pipes.", "qa_retries": retries + 1}
    
    return {"qa_passed": True, "qa_feedback": "All good.", "qa_retries": retries + 1}

def human_review_node(state: EstimatorState):
    """Dummy node. The graph interrupts BEFORE reaching this node."""
    return {"human_approved": True}

# --- Router ---

def route_by_type(state: EstimatorState):
    if state["blueprint_type"] == "E":
        return "electrical"
    elif state["blueprint_type"] == "P":
        return "plumbing"
    return "end"

def route_qa(state: EstimatorState):
    if state.get("qa_passed", False):
        return "human_review"
    if state["blueprint_type"] == "E":
        return "circuit_designer"
    return "plumbing"

# --- Build the Graph ---

DB_PATH = os.path.dirname(__file__) + "/checkpoints.sqlite"

def build_graph(auto_approve: bool = False):
    """Build the LangGraph estimator. When auto_approve=True, skip human_review interrupt."""
    builder = StateGraph(EstimatorState)

    builder.add_node("vision_parser", vision_parser_node)
    builder.add_node("orchestrator", orchestrator_node)
    builder.add_node("circuit_designer", circuit_designer_node)
    builder.add_node("panel_builder", panel_builder_node)
    builder.add_node("plumbing", plumbing_agent_node)
    builder.add_node("qa", qa_agent_node)
    builder.add_node("human_review", human_review_node)
    builder.add_node("pricing", pricing_agent_node)

    builder.add_edge(START, "vision_parser")
    builder.add_edge("vision_parser", "orchestrator")
    builder.add_conditional_edges("orchestrator", route_by_type, {
        "electrical": "circuit_designer",
        "plumbing": "plumbing",
        "end": END
    })
    builder.add_edge("circuit_designer", "panel_builder")
    builder.add_edge("panel_builder", "qa")
    builder.add_edge("plumbing", "qa")
    builder.add_conditional_edges("qa", route_qa, {
        "human_review": "human_review",
        "circuit_designer": "circuit_designer",
        "plumbing": "plumbing"
    })
    builder.add_edge("human_review", "pricing")
    builder.add_edge("pricing", END)

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    memory = SqliteSaver(conn)

    if auto_approve:
        return builder.compile(checkpointer=memory)
    else:
        return builder.compile(checkpointer=memory, interrupt_before=["human_review"])

# Default graph (with human review) for backward compatibility
graph = build_graph(auto_approve=False)

# --- JSON 2.0 Test Blueprints ---

SAMPLE_ELECTRICAL_BLUEPRINT = {
    "project_id": "Apt_101",
    "scale_multiplier_mm": 50,
    "panel_location": {"x": 0, "y": 0},
    "rooms": [
        {
            "name": "Kitchen",
            "zone_type": "wet",
            "devices": [
                {"id": "K_R1", "type": "socket_standard", "x": 1000, "y": 5000},
                {"id": "K_R2", "type": "socket_standard", "x": 1500, "y": 5000},
                {"id": "K_OVEN", "type": "electric_oven_240V", "power_amps": 40, "x": 2000, "y": 5000}
            ]
        },
        {
            "name": "Bedroom",
            "zone_type": "dry",
            "devices": [
                {"id": "B_L1", "type": "ceiling_light", "x": 4000, "y": 4000},
                {"id": "B_S1", "type": "switch_single", "x": 4000, "y": 1000}
            ]
        }
    ]
}

SAMPLE_PLUMBING_FEATURES = [
    {"type": "sink", "x": 15, "y": 15},
    {"type": "sink", "x": 15, "y": 20},
    {"type": "toilet", "x": 15, "y": 25},
    {"type": "shower", "x": 20, "y": 30}
]

# --- Entry Point ---
def run_pipeline(blueprint_path: str, blueprint_json: Dict = None, dummy_features: List[Dict] = None, thread_id: str = "thread_1", target_graph=None):
    bp = blueprint_path.lower()
    g = target_graph or graph

    # Only use sample data when: (a) it's a known sample file AND (b) no real PDF exists
    if blueprint_json is None and not _is_pdf(blueprint_path):
        if "electrical" in bp or "e-" in bp:
            blueprint_json = SAMPLE_ELECTRICAL_BLUEPRINT
    
    if dummy_features is None:
        if "plumbing" in bp or "p-" in bp:
            dummy_features = SAMPLE_PLUMBING_FEATURES
        else:
            dummy_features = []
        
    initial_state = {
        "blueprint_path": blueprint_path,
        "blueprint_json": blueprint_json or {},
        "extracted_features": dummy_features,
        "bom": [],
        "circuits": [],
        "panel_schedule": [],
        "total_cost": 0.0,
        "qa_passed": False,
        "qa_feedback": "",
        "qa_retries": 0,
        "blueprint_type": "",
        "human_approved": False
    }
    
    config = {"configurable": {"thread_id": thread_id}}
    result = g.invoke(initial_state, config=config)
    return result, config, g

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Profit Step Estimator Pipeline")
    parser.add_argument("blueprint", nargs="?", default="electrical_plan_E1.pdf",
                        help="Path to blueprint file")
    parser.add_argument("--json", action="store_true",
                        help="Output clean JSON only (no log messages)")
    parser.add_argument("--auto-approve", action="store_true",
                        help="Skip human review, run full pipeline")
    args = parser.parse_args()

    # Configure logging
    if args.json:
        logging.basicConfig(level=logging.WARNING)  # Suppress info logs
    else:
        logging.basicConfig(level=logging.INFO, format="%(message)s")

    # Build graph with appropriate mode
    g = build_graph(auto_approve=args.auto_approve)
    res, conf, g = run_pipeline(args.blueprint, target_graph=g)

    if args.json:
        # Clean JSON output for programmatic consumption
        final_state = g.get_state(conf)
        vals = final_state.values if final_state else res
        output = {
            "status": "completed" if args.auto_approve else "paused_for_review",
            "blueprint_type": vals.get("blueprint_type", ""),
            "total_cost": vals.get("total_cost", 0.0),
            "bom": vals.get("bom", []),
            "circuits": vals.get("circuits", []),
            "panel_schedule": vals.get("panel_schedule", [])
        }
        print(json.dumps(output, ensure_ascii=False))
    else:
        # Human-readable output (original behavior)
        current_state = g.get_state(conf)
        if current_state and current_state.next:
            log.info("\n--- PIPELINE PAUSED FOR HUMAN REVIEW ---")
            log.info(f"Next node to execute: {current_state.next}")
        
        circuits = (current_state.values if current_state else res).get("circuits", [])
        if circuits:
            log.info(f"\nCircuits ({len(circuits)}):")
            for c in circuits:
                calc = c.get("wire_calc", {})
                log.info(f"  {c['circuit_id']} [{c.get('room', '?')}]: HomeRun={calc.get('home_run_ft', '?')}ft + Chain={calc.get('daisy_chain_ft', '?')}ft + Drops={calc.get('drops_ft', '?')}ft + Waste={calc.get('waste_ft', '?')}ft = {c['total_wire_length']}ft")
        
        bom = (current_state.values if current_state else res).get("bom", [])
        log.info("\nCurrent BOM:")
        log.info(json.dumps(bom, indent=2))
        
        total = (current_state.values if current_state else res).get("total_cost", 0)
        if total:
            log.info(f"\n💰 Total Cost: ${total}")
        elif not args.auto_approve:
            log.info("\nRun 'python resume_pipeline.py' to approve and continue to Pricing & Export.")
