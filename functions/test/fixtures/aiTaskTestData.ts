/**
 * @fileoverview Test seed data for AI Task System tests.
 * Mirrors the QA checklist Part 1: employees, projects, estimates, tasks, change orders.
 */

import { EstimateItem } from "../../src/callable/ai/scopeMatcher";

// ============================================================
// 1.1 Test Employees
// ============================================================

export const testEmployees = [
    { id: "emp_carlos", name: "Carlos Rodriguez", isActive: true, avatarUrl: null },
    { id: "emp_mike", name: "Michael Smith", isActive: true, avatarUrl: null },
    { id: "emp_nikolai", name: "Nikolai Petrov", isActive: true, avatarUrl: null },
    { id: "emp_anna", name: "Anna Martinez", isActive: true, avatarUrl: null },
    { id: "emp_jose", name: "Jose Garcia", isActive: true, avatarUrl: null },
    { id: "emp_ivan", name: "Ivan Kozlov", isActive: true, avatarUrl: null },
    { id: "emp_david", name: "David Brown", isActive: false },
];

// ============================================================
// 1.2 Test Projects
// ============================================================

export const testProjects = [
    {
        id: "proj_villa",
        name: "Villa Miami Beach",
        status: "active",
        clientName: "John Jarjura",
        brief: "Custom single-family residence, 4500 sqft, 2 stories. Full electrical: 200A service, 2 panels, smart home (Lutron), pool equipment. Hurricane zone.",
    },
    {
        id: "proj_aldi",
        name: "ALDI Homestead #247",
        status: "active",
        clientName: "ALDI Inc.",
        brief: "Grocery store TI, 11500 sqft commercial. Full electrical buildout: lighting, power, HVAC connections, fire alarm.",
    },
    {
        id: "proj_vanilla",
        name: "Vanilla Cafe Aventura",
        status: "active",
        clientName: "Vanilla Group LLC",
        brief: "Restaurant buildout, 2800 sqft. Kitchen equipment connections, decorative lighting, patio power.",
    },
    {
        id: "proj_closed",
        name: "Old Navy Sawgrass",
        status: "completed",
    },
];

// ============================================================
// 1.3 Villa Miami Beach Estimate Items
// ============================================================

export const villaEstimateItems: EstimateItem[] = [
    { lineNumber: "E-01", description: "200A Main Service Entrance", zone: "Exterior", division: "Service", status: "completed", amount: 4500, tags: ["panel", "meter", "service"] },
    { lineNumber: "E-02", description: "Panel A Installation (125A)", zone: "Garage", division: "Distribution", status: "completed", amount: 2800, tags: ["panel", "loadcenter", "breaker"] },
    { lineNumber: "E-03", description: "Panel B Installation (125A)", zone: "Utility Room", division: "Distribution", status: "completed", amount: 2800, tags: ["panel", "loadcenter"] },
    { lineNumber: "E-04", description: "Rough-in: EMT conduit and boxes - 1st Floor", zone: "1st Floor", division: "Rough Electric", status: "completed", amount: 8500, tags: ["conduit", "emt", "box", "rough"] },
    { lineNumber: "E-05", description: "Rough-in: EMT conduit and boxes - 2nd Floor", zone: "2nd Floor", division: "Rough Electric", status: "completed", amount: 7200, tags: ["conduit", "emt", "box", "rough"] },
    { lineNumber: "E-06", description: "Wire pulling - all branch circuits THHN", zone: "All", division: "Rough Electric", status: "completed", amount: 6200, tags: ["wire", "thhn", "romex", "cable"] },
    { lineNumber: "E-07", description: "Kitchen receptacles and dedicated circuits", zone: "Kitchen", division: "Devices", status: "completed", amount: 3200, tags: ["receptacle", "outlet", "gfci", "kitchen"] },
    { lineNumber: "E-08", description: "Bathroom GFI receptacles", zone: "Bathrooms", division: "Devices", status: "completed", amount: 1800, tags: ["gfci", "gfi", "receptacle", "bathroom"] },
    { lineNumber: "E-09", description: "General receptacles - all rooms", zone: "All", division: "Devices", status: "in_progress", amount: 4500, tags: ["receptacle", "outlet", "duplex"] },
    { lineNumber: "E-10", description: "Switches and dimmers - Lutron Caseta", zone: "All", division: "Devices", status: "pending", amount: 5800, tags: ["switch", "dimmer", "lutron", "smart switch", "caseta"] },
    { lineNumber: "E-11", description: "Recessed LED lighting (4\" IC rated)", zone: "All", division: "Lighting", status: "pending", amount: 7500, tags: ["recessed", "can light", "led", "luminaire", "downlight"] },
    { lineNumber: "E-12", description: "Decorative fixtures - Owner supplied, install only", zone: "All", division: "Lighting", status: "pending", amount: 2200, tags: ["fixture", "chandelier", "pendant", "sconce"] },
    { lineNumber: "E-13", description: "Exterior landscape lighting circuits", zone: "Exterior", division: "Lighting", status: "pending", amount: 3500, tags: ["landscape", "exterior", "low voltage", "transformer"] },
    { lineNumber: "E-14", description: "Pool sub-panel (45A) and equipment connections", zone: "Pool", division: "Equipment", status: "pending", amount: 4800, tags: ["pool", "sub-panel", "pump", "heater", "bonding"] },
    { lineNumber: "E-15", description: "Smoke / CO detectors (hardwired, interconnected)", zone: "All", division: "Life Safety", status: "pending", amount: 1600, tags: ["smoke", "detector", "co", "alarm", "fire"] },
    { lineNumber: "E-16", description: "Ceiling fan rough-in and installation (5 locations)", zone: "Various", division: "Devices", status: "pending", amount: 2000, tags: ["fan", "ceiling fan"] },
    { lineNumber: "E-17", description: "Lutron Smart Bridge and programming", zone: "All", division: "Low Voltage", status: "pending", amount: 1500, tags: ["lutron", "smart home", "bridge", "automation"] },
];

// ============================================================
// 1.4 Recent Tasks (Villa Miami Beach)
// ============================================================

export const villaRecentTasks = [
    { title: "Install Panel A breakers", assigneeName: "Carlos Rodriguez", status: "done", createdAt: "2026-02-10T09:00:00Z", zone: "Garage", completionNotes: "All 24 spaces filled" },
    { title: "Install Panel B breakers", assigneeName: "Carlos Rodriguez", status: "done", createdAt: "2026-02-10T14:00:00Z", zone: "Utility Room" },
    { title: "Pull wire - 2nd floor circuits", assigneeName: "Jose Garcia", status: "done", createdAt: "2026-02-11T08:00:00Z", zone: "2nd Floor" },
    { title: "Install kitchen GFI outlets", assigneeName: "Nikolai Petrov", status: "done", createdAt: "2026-02-12T09:00:00Z", zone: "Kitchen", completionNotes: "6x 20A GFCI + 2x dedicated for fridge/disposal" },
    { title: "Install bathroom GFI receptacles", assigneeName: "Nikolai Petrov", status: "done", createdAt: "2026-02-13T09:00:00Z", zone: "Bathrooms", completionNotes: "All 4 bathrooms done" },
    { title: "Install master bath light fixture", assigneeName: "Nikolai Petrov", status: "done", createdAt: "2026-02-14T10:00:00Z", zone: "Master Bath" },
    { title: "Run conduit for landscape lighting", assigneeName: "Mike Smith", status: "in_progress", createdAt: "2026-02-15T08:00:00Z", zone: "Exterior" },
    { title: "Order Lutron Caseta switches (48 units)", assigneeName: "Anna Martinez", status: "done", createdAt: "2026-02-14T11:00:00Z", zone: "All", completionNotes: "Ordered from CED, ETA Feb 18" },
    { title: "Install general outlets - Living Room", assigneeName: "Nikolai Petrov", status: "in_progress", createdAt: "2026-02-15T09:00:00Z", zone: "Living Room" },
    { title: "Buy 200ft #6 THHN for pool feeder", assigneeName: "Carlos Rodriguez", status: "todo", createdAt: "2026-02-16T07:00:00Z", zone: "Pool" },
];

// ============================================================
// 1.5 Change Orders
// ============================================================

export const villaChangeOrders = [
    {
        id: "co_001",
        title: "CO#1 — Add EV charger circuit to garage",
        status: "active",
        items: ["Run #6 THHN from Panel A to garage wall", "Install 50A NEMA 14-50 outlet", "New 50A 2-pole breaker"],
    },
];
