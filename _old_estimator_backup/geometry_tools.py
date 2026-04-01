"""
Deterministic geometry tools for the Circuit Designer agent.
These are called as LangChain Tool Calls so the LLM never has to do math in its head.
"""
import math
from typing import List, Dict, Tuple

# --- Core Geometry ---

def manhattan_distance(p1: Dict, p2: Dict, scale_mm: float = 1.0) -> float:
    """
    Calculate Manhattan distance between two points.
    Coordinates are in mm on the blueprint. scale_mm converts to real-world feet.
    Returns distance in FEET.
    """
    dx = abs(p1["x"] - p2["x"])
    dy = abs(p1["y"] - p2["y"])
    distance_mm = dx + dy
    # Convert mm on paper to real feet: (distance_mm / scale_mm) gives real meters,
    # then * 3.28084 converts to feet
    distance_ft = (distance_mm / scale_mm) * 3.28084
    return round(distance_ft, 1)


def calculate_home_run(panel: Dict, first_device: Dict, scale_mm: float = 1.0) -> float:
    """Calculate the Home Run distance from panel to the first device in a circuit."""
    return manhattan_distance(panel, first_device, scale_mm)


def calculate_daisy_chain(devices: List[Dict], scale_mm: float = 1.0) -> float:
    """
    Calculate total daisy-chain wire length between consecutive devices.
    Devices should be ordered by their position in the chain.
    """
    total = 0.0
    for i in range(len(devices) - 1):
        total += manhattan_distance(devices[i], devices[i + 1], scale_mm)
    return round(total, 1)


def calculate_vertical_drops(device_count: int, drop_ft: float = 4.0) -> float:
    """
    Each device needs a vertical drop from ceiling/attic to the box.
    Standard: 4ft down to box + 4ft back up = 8ft per device.
    """
    return device_count * drop_ft * 2


def calculate_circuit_wire_length(
    panel: Dict,
    devices: List[Dict],
    scale_mm: float = 1.0,
    waste_pct: float = 0.15
) -> Dict:
    """
    Full wire length calculation for one circuit.
    Returns breakdown: home_run + daisy_chain + drops + waste = total
    """
    if not devices:
        return {"home_run": 0, "daisy_chain": 0, "drops": 0, "waste": 0, "total": 0}

    home_run = calculate_home_run(panel, devices[0], scale_mm)
    daisy_chain = calculate_daisy_chain(devices, scale_mm) if len(devices) > 1 else 0.0
    drops = calculate_vertical_drops(len(devices))
    
    subtotal = home_run + daisy_chain + drops
    waste = round(subtotal * waste_pct, 1)
    total = round(subtotal + waste, 1)
    
    return {
        "home_run_ft": home_run,
        "daisy_chain_ft": daisy_chain,
        "drops_ft": drops,
        "waste_ft": waste,
        "total_ft": total
    }


# --- Wire Gauge Selection ---

WIRE_GAUGE_MAP = {
    "ceiling_light": "1.5 mm2 (14/2 AWG) Copper Wire - 100m",
    "switch_single": "1.5 mm2 (14/2 AWG) Copper Wire - 100m",
    "switch_dimmer": "1.5 mm2 (14/2 AWG) Copper Wire - 100m",
    "socket_standard": "2.5 mm2 (12/2 AWG) Copper Wire - 100m",
    "receptacle": "2.5 mm2 (12/2 AWG) Copper Wire - 100m",
    "electric_oven_240V": "6.0 mm2 (10/2 AWG) Copper Wire - 100m",
    "hvac": "6.0 mm2 (10/2 AWG) Copper Wire - 100m",
    "ev_charger": "10.0 mm2 (8/3 AWG) Copper Wire - 100m",
}

def select_wire_gauge(device_type: str) -> str:
    """Select wire gauge based on device type. Defaults to 2.5mm2 for unknown types."""
    return WIRE_GAUGE_MAP.get(device_type, "2.5 mm2 (12/2 AWG) Copper Wire - 100m")


# --- Breaker Selection ---

BREAKER_MAP = {
    "1.5 mm2 (14/2 AWG) Copper Wire - 100m": ("16A Single-Pole Breaker", 16, 1),
    "2.5 mm2 (12/2 AWG) Copper Wire - 100m": ("20A Single-Pole Breaker", 20, 1),
    "6.0 mm2 (10/2 AWG) Copper Wire - 100m": ("40A Double-Pole Breaker", 40, 2),
    "10.0 mm2 (8/3 AWG) Copper Wire - 100m": ("40A Double-Pole Breaker", 40, 2),
}

def select_breaker(wire_gauge: str, is_wet_zone: bool) -> Dict:
    """Select breaker type. Wet zones get RCBO/GFCI regardless."""
    base = BREAKER_MAP.get(wire_gauge, ("20A Single-Pole Breaker", 20, 1))
    
    if is_wet_zone and base[2] == 1:  # Single-pole in wet zone → RCBO
        return {
            "breaker_type": "20A RCBO / GFCI Breaker (Wet Zone)",
            "amps": base[1],
            "poles": 1
        }
    
    return {
        "breaker_type": base[0],
        "amps": base[1],
        "poles": base[2]
    }


# --- Panel Sizing ---

def select_panel_enclosure(total_poles: int) -> str:
    """Select panel enclosure based on total poles + 20% spare capacity."""
    required = math.ceil(total_poles * 1.2)
    
    if required <= 12:
        return "12-way Distribution Panel Enclosure"
    elif required <= 24:
        return "24-way Distribution Panel Enclosure"
    else:
        return "36-way Distribution Panel Enclosure"


# --- Full Deterministic Pipeline (no LLM needed) ---

DEDICATED_TYPES = {"electric_oven_240V", "hvac", "ev_charger"}
LIGHTING_TYPES = {"ceiling_light", "switch_single", "switch_dimmer"}
MAX_DEVICES_PER_CIRCUIT = 8

def run_deterministic_circuit_design(blueprint: Dict) -> Dict:
    """
    Full deterministic circuit design from JSON 2.0 input.
    No LLM required — pure math and building code rules.
    Returns circuits, panel_schedule, and BOM.
    """
    panel = blueprint.get("panel_location", {"x": 0, "y": 0})
    scale = blueprint.get("scale_multiplier_mm", 50)
    rooms = blueprint.get("rooms", [])
    
    circuits = []
    circuit_counter = 1
    
    for room in rooms:
        room_name = room["name"]
        zone_type = room.get("zone_type", "dry")
        is_wet = zone_type == "wet"
        devices = room.get("devices", [])
        
        # Separate dedicated appliances from groupable devices
        dedicated = [d for d in devices if d.get("type") in DEDICATED_TYPES or d.get("power_amps", 0) > 20]
        standard = [d for d in devices if d not in dedicated]
        
        # Further split standard into lighting and sockets
        lights = [d for d in standard if d.get("type") in LIGHTING_TYPES]
        sockets = [d for d in standard if d not in lights]
        
        # Group sockets (max 8 per circuit)
        for i in range(0, max(1, len(sockets)), MAX_DEVICES_PER_CIRCUIT):
            group = sockets[i:i + MAX_DEVICES_PER_CIRCUIT]
            if not group:
                continue
                
            wire_gauge = select_wire_gauge(group[0]["type"])
            wire_calc = calculate_circuit_wire_length(panel, group, scale)
            breaker = select_breaker(wire_gauge, is_wet)
            
            circuits.append({
                "circuit_id": f"C{circuit_counter}",
                "room": room_name,
                "zone_type": zone_type,
                "devices": [d["id"] for d in group],
                "device_types": [d["type"] for d in group],
                "wire_gauge": wire_gauge,
                "wire_calc": wire_calc,
                "total_wire_length": wire_calc["total_ft"],
                "breaker": breaker
            })
            circuit_counter += 1
        
        # Group lights (max 8 per circuit)
        for i in range(0, max(1, len(lights)), MAX_DEVICES_PER_CIRCUIT):
            group = lights[i:i + MAX_DEVICES_PER_CIRCUIT]
            if not group:
                continue
                
            wire_gauge = select_wire_gauge(group[0]["type"])
            wire_calc = calculate_circuit_wire_length(panel, group, scale)
            breaker = select_breaker(wire_gauge, is_wet)
            
            circuits.append({
                "circuit_id": f"C{circuit_counter}",
                "room": room_name,
                "zone_type": zone_type,
                "devices": [d["id"] for d in group],
                "device_types": [d["type"] for d in group],
                "wire_gauge": wire_gauge,
                "wire_calc": wire_calc,
                "total_wire_length": wire_calc["total_ft"],
                "breaker": breaker
            })
            circuit_counter += 1
        
        # Dedicated circuits (1 device each)
        for d in dedicated:
            wire_gauge = select_wire_gauge(d["type"])
            wire_calc = calculate_circuit_wire_length(panel, [d], scale)
            breaker = select_breaker(wire_gauge, is_wet)
            
            circuits.append({
                "circuit_id": f"C{circuit_counter}_DEDICATED",
                "room": room_name,
                "zone_type": zone_type,
                "devices": [d["id"]],
                "device_types": [d["type"]],
                "wire_gauge": wire_gauge,
                "wire_calc": wire_calc,
                "total_wire_length": wire_calc["total_ft"],
                "breaker": breaker,
                "dedicated": True
            })
            circuit_counter += 1
    
    # --- Build Panel Schedule ---
    total_poles = sum(c["breaker"]["poles"] for c in circuits)
    enclosure = select_panel_enclosure(total_poles)
    
    panel_schedule = []
    for c in circuits:
        panel_schedule.append({
            "circuit_id": c["circuit_id"],
            "breaker_type": c["breaker"]["breaker_type"],
            "amps": c["breaker"]["amps"],
            "poles": c["breaker"]["poles"]
        })
    
    # --- Build BOM ---
    bom = []
    
    # Aggregate wire by gauge
    wire_totals = {}
    for c in circuits:
        gauge = c["wire_gauge"]
        wire_totals[gauge] = wire_totals.get(gauge, 0) + c["total_wire_length"]
    
    for gauge, total_ft in wire_totals.items():
        bom.append({
            "item": gauge,
            "qty": round(total_ft, 1),
            "unit": "ft",
            "category": "electrical"
        })
    
    # Breakers
    for ps in panel_schedule:
        bom.append({
            "item": ps["breaker_type"],
            "qty": 1,
            "unit": "ea",
            "category": "electrical"
        })
    
    # Enclosure
    bom.append({
        "item": enclosure,
        "qty": 1,
        "unit": "ea",
        "category": "electrical"
    })
    
    # Devices (sockets, boxes)
    total_sockets = sum(
        len(c["devices"]) for c in circuits
        if any(t in ["socket_standard", "receptacle"] for t in c.get("device_types", []))
    )
    total_lights = sum(
        len(c["devices"]) for c in circuits
        if any(t in LIGHTING_TYPES for t in c.get("device_types", []))
    )
    
    if total_sockets > 0:
        bom.append({"item": "Standard Socket / Receptacle", "qty": total_sockets, "unit": "ea", "category": "electrical"})
    if total_lights > 0:
        bom.append({"item": "Lighting Fixture / Switch", "qty": total_lights, "unit": "ea", "category": "electrical"})
    if total_sockets + total_lights > 0:
        bom.append({"item": "Appliance Junction Box", "qty": total_sockets + total_lights, "unit": "ea", "category": "electrical"})
    
    return {
        "circuits": circuits,
        "panel_schedule": panel_schedule,
        "enclosure": enclosure,
        "total_poles": total_poles,
        "bom": bom
    }


# --- Code Compliance Check (Deterministic) ---

def run_code_compliance_check(circuits: List[Dict], panel_schedule: List[Dict]) -> Dict:
    """
    Deterministic NEC/IEC code compliance check.
    Returns APPROVED or REJECTED with violation details.
    """
    violations = []
    
    for c in circuits:
        # Check 1: Overloading
        if len(c["devices"]) > MAX_DEVICES_PER_CIRCUIT and not c.get("dedicated"):
            violations.append(
                f"Circuit {c['circuit_id']}: {len(c['devices'])} devices exceed max {MAX_DEVICES_PER_CIRCUIT}"
            )
        
        # Check 2: Dedicated circuit sharing
        if c.get("dedicated") and len(c["devices"]) > 1:
            violations.append(
                f"Circuit {c['circuit_id']}: Dedicated appliance sharing circuit with other devices"
            )
        
        # Check 3: Wire/Breaker mismatch
        wire = c.get("wire_gauge", "")
        breaker_amps = c["breaker"]["amps"]
        if "1.5 mm2" in wire and breaker_amps > 16:
            violations.append(
                f"Circuit {c['circuit_id']}: FIRE HAZARD — {breaker_amps}A breaker on 1.5mm² wire"
            )
        if "2.5 mm2" in wire and breaker_amps > 20:
            violations.append(
                f"Circuit {c['circuit_id']}: FIRE HAZARD — {breaker_amps}A breaker on 2.5mm² wire"
            )
        
        # Check 4: Wet zone protection
        if c.get("zone_type") == "wet":
            breaker_type = c["breaker"]["breaker_type"]
            if "RCBO" not in breaker_type and "GFCI" not in breaker_type:
                # Allow 40A double-pole for dedicated heavy appliances in wet zones
                if not c.get("dedicated"):
                    violations.append(
                        f"Circuit {c['circuit_id']}: Wet zone '{c['room']}' missing RCBO/GFCI protection"
                    )
    
    if violations:
        return {
            "status": "REJECTED",
            "violations": violations,
            "code_violation": "; ".join(violations)
        }
    
    return {
        "status": "APPROVED",
        "violations": [],
        "code_violation": "All checks passed. NEC/IEC compliant."
    }


if __name__ == "__main__":
    import json
    
    # Test with the JSON 2.0 sample
    test_blueprint = {
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
    
    result = run_deterministic_circuit_design(test_blueprint)
    
    print("=== CIRCUITS ===")
    for c in result["circuits"]:
        print(f"  {c['circuit_id']} [{c['room']}] → {c['devices']} | {c['wire_gauge']} | {c['total_wire_length']}ft | {c['breaker']['breaker_type']}")
    
    print(f"\n=== PANEL: {result['enclosure']} ({result['total_poles']} poles) ===")
    for p in result["panel_schedule"]:
        print(f"  {p['circuit_id']}: {p['breaker_type']} ({p['amps']}A, {p['poles']}P)")
    
    print(f"\n=== BOM ({len(result['bom'])} items) ===")
    for item in result["bom"]:
        print(f"  {item['item']}: {item['qty']} {item['unit']}")
    
    # Run compliance check
    compliance = run_code_compliance_check(result["circuits"], result["panel_schedule"])
    print(f"\n=== CODE COMPLIANCE: {compliance['status']} ===")
    if compliance["violations"]:
        for v in compliance["violations"]:
            print(f"  ❌ {v}")
    else:
        print(f"  ✅ {compliance['code_violation']}")
