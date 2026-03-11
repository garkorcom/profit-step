import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from 'firebase-functions';
import { safeConfig } from '../utils/safeConfig';
import { BlueprintAgentResult, BlueprintDiscrepancy, BlueprintFileClassification } from '../types/blueprint.types';

// ===== API Keys =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || safeConfig().anthropic?.api_key || safeConfig().anthropic?.key;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || safeConfig().openai?.api_key || safeConfig().openai?.key;

// ===== Building Context (extracted before analysis) =====
export interface BuildingContext {
    buildingType: 'single-family' | 'multi-family' | 'commercial' | 'mixed-use' | 'unknown';
    unitCount: number;         // 0 for single-family
    stories: number;           // 0 if unknown
    mainServiceAmps: number;   // 0 if unknown
    hasCommonLaundry: boolean;
    hasParking: boolean;
    hasRetail: boolean;
}

const DEFAULT_BUILDING_CONTEXT: BuildingContext = {
    buildingType: 'unknown', unitCount: 0, stories: 0, mainServiceAmps: 0,
    hasCommonLaundry: false, hasParking: false, hasRetail: false,
};

// ===== Valid takeoff keys (synced with electricalDevices.ts) =====
const VALID_TAKEOFF_KEYS = new Set([
    // LIGHTING
    'recessed_ic', 'recessed_nc', 'surface', 'pendant', 'chandelier',
    'ceiling_fan', 'under_cabinet', 'exhaust_fan', 'bath_exhaust', 'exterior',
    // RECEPTACLES
    'duplex', 'gfi', 'dedicated_20a', 'outlet_240_30', 'outlet_240_50', 'floor_outlet',
    // SWITCHES
    'single_pole', '3way', '4way', 'dimmer', 'smart_switch', 'occupancy',
    // LOW VOLTAGE
    'smoke', 'smoke_co', 'doorbell', 'doorbell_cam', 'cat6', 'coax', 'speaker_wire', 'central_vac',
    // PANELS & GEAR
    'panel_200', 'panel_400', 'ct_400', 'ct_600',
    'subpanel_100', 'subpanel_125', 'subpanel_200',
    'meter_200', 'meter_320', 'meter_400', 'grounding', 'surge',
    // APPLIANCES
    'range', 'cooktop', 'wall_oven', 'double_oven', 'microwave', 'dishwasher',
    'disposal', 'dryer', 'washer', 'refrigerator', 'freezer',
    'water_heater', 'tankless_wh', 'ev_charger', 'ev_charger_60',
    // HVAC
    'ac_30a', 'ac_40a', 'ac_disc', 'mini_split', 'air_handler', 'thermostat',
    // POOL
    'pool_pump', 'pool_light', 'pool_heater', 'pool_heater_elec',
    'pool_bond', 'pool_light_jbox', 'pool_transformer',
    'spa_pump', 'spa_blower', 'pool_gfi', 'pool_disc', 'pool_automation',
    // GENERATOR
    'generator_panel', 'transfer_switch',
    'gen_pad', 'ats_200', 'ats_400', 'gen_whip', 'gen_disc', 'gen_wire',
    'gen_coord', 'interlock', 'inlet_box',
    // LANDSCAPE
    'landscape_light', 'landscape_transformer', 'irrigation_controller',
    'land_trans_300', 'land_trans_600', 'land_trans_900',
    'land_path', 'land_spot', 'land_well', 'land_flood', 'land_wire',
]);

const TAKEOFF_PROMPT = `You are a professional Master Electrician and Estimator.
Your task is to analyze the provided Electrical Blueprint.

BUILDING CONTEXT (determine FIRST, before counting):
1. Identify the BUILDING TYPE: single-family, multi-family, or commercial.
2. If multi-family: count TOTAL DWELLING UNITS from Panel Schedule labels (e.g. "APT-1" through "APT-38" = 38 units).
3. Distinguish PER-UNIT items vs COMMON/BUILDING items.
4. If a Panel Schedule lists N unit subpanels, report the TOTAL (e.g. subpanel_125: 38), not just 1.
5. If this page shows a TYPICAL UNIT floor plan, count items for ONE unit only.

STRATEGY:
1. Locate the SYMBOL LEGEND on the blueprint.
2. Divide the floor plan into 4 QUADRANTS (NW, NE, SW, SE) and scan each systematically.
3. Cross-reference symbols with the legend.
4. If multi-family and you see a PANEL SCHEDULE:
   - Count each unit subpanel listed
   - Read circuit breaker sizes to identify appliances (20A cooktop, 40A tankless WH, etc.)
   - Do NOT confuse a 20A cooktop circuit with a 50A range circuit
5. Sum up totals across all quadrants.

RULES:
1. ONLY count electrical devices, receptacles, switches, lighting, panels, and equipment.
2. DO NOT count wire lengths or conduit runs.
3. Your output MUST be a valid JSON object.
4. The JSON keys MUST use ONLY these standard keys:

  LIGHTING: recessed_ic, recessed_nc, surface, exterior, ceiling_fan, chandelier, pendant, under_cabinet
  RECEPTACLES: duplex, gfi, dedicated_20a, outlet_240_30, outlet_240_50, floor_outlet
  SWITCHES: single_pole, 3way, 4way, dimmer, smart_switch, occupancy
  LOW_VOLTAGE: smoke, smoke_co, doorbell, doorbell_cam, cat6, coax, speaker_wire, central_vac
  VENTILATION: bath_exhaust, exhaust_fan
  PANELS: panel_200, panel_400, ct_400, ct_600, subpanel_100, subpanel_125, subpanel_200, meter_200, meter_320, meter_400, grounding, surge
  APPLIANCES: range, cooktop, wall_oven, double_oven, microwave, dishwasher, disposal, dryer, washer, refrigerator, freezer, water_heater, tankless_wh, ev_charger, ev_charger_60
  HVAC: ac_30a, ac_40a, ac_disc, mini_split, air_handler, thermostat
  POOL: pool_pump, pool_light, pool_heater, pool_heater_elec, pool_bond, pool_light_jbox, pool_transformer, spa_pump, spa_blower, pool_gfi, pool_disc, pool_automation
  GENERATOR: generator_panel, transfer_switch, gen_pad, ats_200, ats_400, gen_whip, gen_disc, gen_wire, gen_coord, interlock, inlet_box
  LANDSCAPE: landscape_light, landscape_transformer, irrigation_controller, land_trans_300, land_trans_600, land_trans_900, land_path, land_spot, land_well, land_flood, land_wire

CRITICAL DISTINCTIONS:
- "cooktop" (20-40A) is NOT "range" (50A) — read the breaker size
- "tankless_wh" (40-60A) is NOT "water_heater" (30A tank) — check circuit label
- "mini_split" (ductless split) is NOT "ac_30a" (central A/C condenser)
- "subpanel_125" is NOT "subpanel_100" — read the panel amperage
- Common laundry dryers count as "dryer", not per-unit

5. Values MUST be non-negative integers. DO NOT include items with count 0.
6. Return ONLY the JSON object, no markdown, no \`\`\`json blocks.
Example: {"recessed_ic": 42, "duplex": 28, "single_pole": 12, "subpanel_125": 38, "tankless_wh": 38}
`;

const DISCREPANCY_PROMPT = `You are a professional Master Electrician acting as Senior Auditor.
INDEPENDENTLY re-count the following items on the blueprint.

RULES:
1. Divide the blueprint into 4 quadrants and scan each.
2. Count carefully. Double-check.
3. Return ONLY a valid JSON object, no markdown.
4. Keys must be exactly the items listed below, values are integers.

ITEMS TO RE-COUNT:
{ITEMS_LIST}

Example: {"recessed_ic": 45, "duplex": 32}
`;

const AUDIT_PROMPT = `You are a professional Master Electrician and Senior Estimator.
Your task is to AUDIT raw electrical takeoff data generated by an AI vision system. Vision systems often hallucinate elements due to poor blueprint scan quality or visually similar symbols.

PROJECT CONTEXT:
- Square Footage: {SQFT}
- Project Type: {PROJECT_TYPE}
- Facility Use / Details: {FACILITY_USE}
- Building Type: {BUILDING_TYPE}
- Dwelling Units: {UNIT_COUNT}
- Stories: {STORIES}
- Main Service: {MAIN_SERVICE_AMPS}A
- Number of Blueprint Pages Scanned: {PAGE_COUNT}

Raw Quantities from Vision Models (Aggregated from {PAGE_COUNT} pages):
{RAW_DATA}

VALIDATION RULES BY BUILDING TYPE:

🏠 SINGLE-FAMILY:
- 1 main panel (200A typical), 0-2 subpanels
- 1 each: range OR cooktop, dishwasher, disposal, water heater/tankless
- Receptacle density: ~1 per 25-50 sqft depending on room types
- 14 dishwashers or 55 ranges = hallucination → reduce to 1

🏢 MULTI-FAMILY ({UNIT_COUNT} units):
- Subpanels ≈ unit count (±20%). 38 units → 30-46 subpanels is NORMAL
- Water heaters/tankless ≈ unit count (1 per unit)
- Cooktops or ranges ≈ unit count (1 per unit, but NOT both)
- Dishwashers: NOT always 1 per unit — micro-units and studios often lack them. Check facility details.
- Dryers: if common laundry rooms → 4-8 total. If in-unit → ≈ unit count.
- Main service: 600A-1200A is NORMAL for 20+ units. Do NOT reduce to 200A.
- Receptacles: 6-10 per micro/studio unit, 12-18 per 1BR+. Total ≈ unitCount × avgPerUnit.
- Smoke/CO: at minimum 1 per unit, often 2-3 per unit (bedroom + hallway)

🏬 COMMERCIAL:
- Larger panels (400A-1200A), do NOT reduce to 200A
- Few residential appliances (no cooktops/ranges unless restaurant)
- Lighting: commercial density, mostly recessed/surface/troffer
- Receptacles: lower density than residential (~1 per 50-80 sqft)

RULES for your audit:
1. FIRST determine building type from context, THEN apply the correct rules above.
2. CONSIDER the page count — multi-page projects naturally have more items.
3. Reduce only TRULY impossible numbers. For multi-family: 38 subpanels for 38 units is correct, NOT a hallucination.
4. If a number looks reasonable for the building type, keep it or smooth it slightly.
5. IF YOU CHANGE ANY NUMBERS, explain in \`auditNotes\` with the building-type rule you applied.
6. Output MUST be ONLY a flat JSON object. No markdown.

Expected JSON Form:
{
  "quantities": { "subpanel_125": 38, "tankless_wh": 38, "duplex": 280 },
  "auditNotes": ["Kept subpanel_125 at 38: matches unit count for multi-family.", "Reduced duplex from 400 to 280: ~7 per unit × 38 units + common areas."]
}
`;

const METADATA_PROMPT = `Extract Project Name/Description, Address, and Area (sq ft) from this blueprint.
Return ONLY a JSON object: {"description": "...", "address": "...", "areaSqft": 2500}
Use null for missing values. No markdown.`;

const BUILDING_CONTEXT_PROMPT = `Analyze this electrical blueprint and extract BUILDING CONTEXT ONLY.
Do NOT count individual devices. Focus ONLY on:
1. Building type: single-family / multi-family / commercial / mixed-use
2. Number of dwelling units (from panel schedule labels like "APT-1".."APT-38", or unit floor plans)
3. Number of stories (from section drawings, floor labels, or title block)
4. Main electrical service size in amps (from MDP/MOP panel schedule header)
5. Are there common/shared laundry rooms? (yes/no)
6. Is there structured parking on lower floors? (yes/no)
7. Is there retail/commercial space? (yes/no)

Return ONLY a JSON object, no markdown:
{"buildingType": "multi-family", "unitCount": 38, "stories": 4, "mainServiceAmps": 1000, "hasCommonLaundry": true, "hasParking": true, "hasRetail": true}
For single-family homes: {"buildingType": "single-family", "unitCount": 0, "stories": 2, "mainServiceAmps": 200, "hasCommonLaundry": false, "hasParking": false, "hasRetail": false}
`;

// ===== Blueprint Input: supports both PDF and images =====
export interface BlueprintInput {
    buffer: Buffer;
    mimeType: string; // 'application/pdf' | 'image/png' | 'image/jpeg'
    fileName: string;
    base64: string; // Pre-computed once to avoid 3x encoding in memory
    isPdf: boolean;
    customPrompt?: string;
}

/**
 * Detect the actual MIME type from the buffer header bytes.
 */
export function detectMimeType(buffer: Buffer, fileName: string): string {
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
        return 'application/pdf'; // %PDF
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50) {
        return 'image/png';
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        return 'image/jpeg';
    }
    // Fallback: guess from extension
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    return 'application/pdf'; // default
}

// ===== Helpers =====
function flattenResult(raw: Record<string, any>): Record<string, any> {
    // Gemini sometimes returns nested: {"LIGHTING": {"recessed_ic": 42}, "RECEPTACLES": {"duplex": 28}}
    // We need to flatten this to {"recessed_ic": 42, "duplex": 28}
    const flat: Record<string, any> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // Nested category — flatten it
            for (const [innerKey, innerValue] of Object.entries(value)) {
                flat[innerKey] = innerValue;
            }
        } else {
            flat[key] = value;
        }
    }
    return flat;
}

// Keys starting with _ are metadata, not device counts
const METADATA_KEYS = new Set(['_buildingType', '_unitCount', '_stories', '_mainServiceAmps', '_isTypicalUnit']);

function sanitizeAgentResult(raw: Record<string, any>, agentLabel: string): BlueprintAgentResult {
    const flattened = flattenResult(raw);
    const cleaned: BlueprintAgentResult = {};
    const unknownKeys: string[] = [];

    for (const [key, value] of Object.entries(flattened)) {
        // Skip metadata keys silently (they are valid but not counted)
        if (METADATA_KEYS.has(key)) continue;
        if (!VALID_TAKEOFF_KEYS.has(key)) { unknownKeys.push(key); continue; }
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) continue;
        if (num === 0) continue;
        cleaned[key] = Math.round(num);
    }
    if (unknownKeys.length > 0) {
        logger.warn(`${agentLabel}: filtered unknown keys: ${unknownKeys.join(', ')}`);
    }
    return cleaned;
}

function parseJsonResponse(text: string): any {
    // Try direct parse first
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        // Try to extract JSON object from mixed text response
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('No valid JSON found in response');
    }
}

// ===== Metadata Extraction (Gemini — supports PDF natively) =====
export async function extractBlueprintMetadata(input: BlueprintInput): Promise<{ description?: string; address?: string; areaSqft?: number }> {
    if (!GEMINI_API_KEY) return {};

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: METADATA_PROMPT },
                    { inlineData: { mimeType: input.mimeType, data: input.base64 } }
                ]
            }]
        });

        const metadata = parseJsonResponse(result.response.text().trim());
        return {
            description: metadata.description || undefined,
            address: metadata.address || undefined,
            areaSqft: metadata.areaSqft ? Number(metadata.areaSqft) : undefined
        };
    } catch (e) {
        logger.error('Gemini metadata extraction failed', e);
        return {};
    }
}

// ===== Gemini Analysis (supports PDF natively!) =====
export async function analyzeWithGemini(input: BlueprintInput): Promise<BlueprintAgentResult> {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    logger.info(`Gemini: sending ${input.mimeType} (${(input.buffer.length / 1024).toFixed(0)}KB)`);

    const finalPrompt = input.customPrompt
        ? `${TAKEOFF_PROMPT}\n\nUSER SPECIFIC INSTRUCTIONS FOR THIS PROJECT:\n${input.customPrompt}`
        : TAKEOFF_PROMPT;

    const result = await model.generateContent({
        contents: [{
            role: 'user',
            parts: [
                { text: finalPrompt },
                { inlineData: { mimeType: input.mimeType, data: input.base64 } }
            ]
        }]
    });

    const text = result.response.text().trim();
    try {
        return sanitizeAgentResult(parseJsonResponse(text), 'Gemini');
    } catch (e) {
        logger.error('Gemini returned invalid JSON', { text: text.substring(0, 500) });
        throw new Error('Gemini parsing failed');
    }
}

// ===== Claude Analysis (supports PDF natively via document type!) =====
export async function analyzeWithClaude(input: BlueprintInput): Promise<BlueprintAgentResult> {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    logger.info(`Claude: sending ${input.mimeType} (${(input.buffer.length / 1024).toFixed(0)}KB)`);

    // Claude handles PDFs via 'document' type, images via 'image' type
    const fileContent = input.isPdf
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: input.base64 } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: input.mimeType as 'image/png' | 'image/jpeg', data: input.base64 } };

    const finalPrompt = input.customPrompt
        ? `${TAKEOFF_PROMPT}\n\nUSER SPECIFIC INSTRUCTIONS FOR THIS PROJECT:\n${input.customPrompt}`
        : TAKEOFF_PROMPT;

    const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{
            role: 'user',
            content: [
                fileContent,
                { type: 'text', text: finalPrompt }
            ]
        }]
    });

    if (msg.content[0].type !== 'text') throw new Error('Claude non-text response');

    const text = msg.content[0].text.trim();
    try {
        return sanitizeAgentResult(parseJsonResponse(text), 'Claude');
    } catch (e) {
        logger.error('Claude returned invalid JSON', { text: text.substring(0, 500) });
        throw new Error('Claude parsing failed');
    }
}

// ===== OpenAI Analysis =====
// GPT-4o only supports images, NOT PDFs.
// Special sentinel: returns null for PDF (caller checks).
export const OPENAI_SKIPPED = '__SKIPPED_PDF__';

export async function analyzeWithOpenAI(input: BlueprintInput): Promise<BlueprintAgentResult | null> {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    if (input.isPdf) {
        logger.info('OpenAI: PDF detected → skipping (GPT-4o images only)');
        return null; // Sentinel: caller treats null as 'skipped'
    }

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    logger.info(`OpenAI: sending ${input.mimeType} (${(input.buffer.length / 1024).toFixed(0)}KB)`);

    const finalPrompt = input.customPrompt
        ? `${TAKEOFF_PROMPT}\n\nUSER SPECIFIC INSTRUCTIONS FOR THIS PROJECT:\n${input.customPrompt}`
        : TAKEOFF_PROMPT;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: finalPrompt },
                {
                    type: 'image_url',
                    image_url: {
                        url: `data:${input.mimeType};base64,${input.base64}`,
                        detail: 'high'
                    }
                }
            ]
        }],
        max_tokens: 1500,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';
    try {
        return sanitizeAgentResult(parseJsonResponse(text), 'OpenAI');
    } catch (e) {
        logger.error('OpenAI returned invalid JSON', { text: text.substring(0, 500) });
        throw new Error('OpenAI parsing failed');
    }
}

// ===== Compare Results (median/voting) =====
function selectBestQty(counts: number[]): number {
    if (counts.length === 0) return 0;
    if (counts.length === 1) return counts[0];
    if (counts.length === 2) return Math.ceil((counts[0] + counts[1]) / 2);

    const [a, b, c] = counts.sort((x, y) => x - y);
    if (a === b) return a;
    if (b === c) return b;
    return b; // median
}

export function compareResults(
    geminiResult?: BlueprintAgentResult,
    claudeResult?: BlueprintAgentResult,
    openAiResult?: BlueprintAgentResult
): { discrepancies: BlueprintDiscrepancy[], finalResult: BlueprintAgentResult } {
    const discrepancies: BlueprintDiscrepancy[] = [];
    const finalResult: BlueprintAgentResult = {};

    const allKeys = new Set([
        ...Object.keys(geminiResult || {}),
        ...Object.keys(claudeResult || {}),
        ...Object.keys(openAiResult || {})
    ]);

    for (const key of allKeys) {
        const gQty = geminiResult !== undefined ? (geminiResult[key] ?? 0) : null;
        const cQty = claudeResult !== undefined ? (claudeResult[key] ?? 0) : null;
        const oQty = openAiResult !== undefined ? (openAiResult[key] ?? 0) : null;

        const validCounts = [gQty, cQty, oQty].filter(v => v !== null) as number[];
        if (validCounts.length === 0) continue;

        const firstVal = validCounts[0];
        const match = validCounts.every(v => v === firstVal);
        const suggestedQty = selectBestQty(validCounts);

        if (suggestedQty === 0 && match) continue;

        if (!match || validCounts.length < 3) {
            discrepancies.push({
                itemId: key,
                geminiQty: gQty,
                claudeQty: cQty,
                openAiQty: oQty,
                match: false,
                suggestedQty
            });
        }

        finalResult[key] = suggestedQty;
    }

    return { discrepancies, finalResult };
}

// ===== Smart Audit (Text-Only Cross Validation) =====

export async function performSmartAudit(
    rawQuantities: Record<string, number>,
    squareFootage: string,
    projectType: string,
    pageCount: number = 1,
    facilityUse: string = '',
    buildingContext?: BuildingContext
): Promise<{ auditedQuantities: BlueprintAgentResult; auditNotes: string[] }> {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured for Smart Audit');

    const ctx = buildingContext || DEFAULT_BUILDING_CONTEXT;
    logger.info(`🧠 Performing Smart Audit for ${projectType} (${squareFootage} sqft, ${pageCount} pages, ${ctx.buildingType}, ${ctx.unitCount} units) with ${Object.keys(rawQuantities).length} items`);

    const promptText = AUDIT_PROMPT
        .replace(/{SQFT}/g, squareFootage || 'Unknown')
        .replace(/{PROJECT_TYPE}/g, projectType || 'Unknown')
        .replace(/{PAGE_COUNT}/g, String(pageCount))
        .replace(/{FACILITY_USE}/g, facilityUse || 'Not specified')
        .replace(/{BUILDING_TYPE}/g, ctx.buildingType)
        .replace(/{UNIT_COUNT}/g, String(ctx.unitCount))
        .replace(/{STORIES}/g, String(ctx.stories))
        .replace(/{MAIN_SERVICE_AMPS}/g, String(ctx.mainServiceAmps))
        .replace(/{RAW_DATA}/g, JSON.stringify(rawQuantities, null, 2));

    try {
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
        const msg = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 2000,
            temperature: 0.1,
            messages: [{
                role: 'user',
                content: promptText
            }]
        });

        if (msg.content[0].type !== 'text') throw new Error('Claude non-text response during audit');

        const text = msg.content[0].text.trim();
        const parsed = parseJsonResponse(text);

        let quantities: Record<string, number> = {};
        let notes: string[] = [];

        if (parsed.quantities) {
            quantities = sanitizeAgentResult(parsed.quantities, 'SmartAuditor');
            notes = Array.isArray(parsed.auditNotes) ? parsed.auditNotes : [];
        } else {
            quantities = sanitizeAgentResult(parsed, 'SmartAuditor');
        }

        // Apply deterministic NEC guards after LLM audit
        const { corrected, warnings } = applyNECGuards(quantities, ctx, squareFootage);
        notes.push(...warnings);

        logger.info(`✅ Smart Audit complete. Items: ${Object.keys(corrected).length}. Notes: ${notes.length}. NEC corrections: ${warnings.length}`);
        return { auditedQuantities: corrected, auditNotes: notes };
    } catch (e: any) {
        logger.error('Smart Audit failed', e);
        return { auditedQuantities: rawQuantities, auditNotes: ['Audit failed, returning raw model quantities.'] };
    }
}

// ===== Building Context Extraction (quick Gemini call) =====
export async function extractBuildingContext(input: BlueprintInput): Promise<BuildingContext> {
    if (!GEMINI_API_KEY) return DEFAULT_BUILDING_CONTEXT;

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: BUILDING_CONTEXT_PROMPT },
                    { inlineData: { mimeType: input.mimeType, data: input.base64 } }
                ]
            }]
        });

        const parsed = parseJsonResponse(result.response.text().trim());
        const ctx: BuildingContext = {
            buildingType: ['single-family', 'multi-family', 'commercial', 'mixed-use'].includes(parsed.buildingType)
                ? parsed.buildingType : 'unknown',
            unitCount: Math.max(0, Math.round(Number(parsed.unitCount) || 0)),
            stories: Math.max(0, Math.round(Number(parsed.stories) || 0)),
            mainServiceAmps: Math.max(0, Math.round(Number(parsed.mainServiceAmps) || 0)),
            hasCommonLaundry: !!parsed.hasCommonLaundry,
            hasParking: !!parsed.hasParking,
            hasRetail: !!parsed.hasRetail,
        };

        logger.info(`🏗 Building Context: ${ctx.buildingType}, ${ctx.unitCount} units, ${ctx.stories} stories, ${ctx.mainServiceAmps}A`);
        return ctx;
    } catch (e) {
        logger.error('Building context extraction failed', e);
        return DEFAULT_BUILDING_CONTEXT;
    }
}

// ===== Deterministic NEC Ratio Guards =====
export function applyNECGuards(
    quantities: Record<string, number>,
    context: BuildingContext,
    squareFootage?: string
): { corrected: Record<string, number>; warnings: string[] } {
    const corrected = { ...quantities };
    const warnings: string[] = [];
    const units = context.unitCount || 1;
    const sqft = Number(squareFootage) || 0;
    const isMultiFamily = context.buildingType === 'multi-family' || context.buildingType === 'mixed-use';
    const isSingleFamily = context.buildingType === 'single-family';

    const clamp = (key: string, max: number, reason: string) => {
        if (corrected[key] && corrected[key] > max) {
            warnings.push(`📐 NEC Guard: Reduced ${key} from ${corrected[key]} to ${max} — ${reason}`);
            corrected[key] = max;
        }
    };

    const clampMin = (key: string, min: number, reason: string) => {
        if (corrected[key] && corrected[key] < min) {
            warnings.push(`📐 NEC Guard: Increased ${key} from ${corrected[key]} to ${min} — ${reason}`);
            corrected[key] = min;
        }
    };

    if (isSingleFamily) {
        // Single-family: strict per-house limits
        clamp('range', 3, 'max 1-2 ranges in a single-family home');
        clamp('cooktop', 3, 'max 1-2 cooktops in a single-family home');
        clamp('dishwasher', 3, 'max 1-2 dishwashers in a single-family home');
        clamp('disposal', 3, 'max 1-2 disposals in a single-family home');
        clamp('water_heater', 3, 'max 1-2 water heaters in a single-family home');
        clamp('tankless_wh', 3, 'max 1-2 tankless WHs in a single-family home');
        clamp('dryer', 3, 'max 1-2 dryers in a single-family home');
        clamp('washer', 3, 'max 1-2 washers in a single-family home');

        // Panels: 1 main + 0-3 subpanels
        const totalPanels = (corrected['panel_200'] || 0) + (corrected['panel_400'] || 0);
        if (totalPanels > 2) clamp('panel_200', 1, 'single-family typically has 1 main panel');
        const totalSub = (corrected['subpanel_100'] || 0) + (corrected['subpanel_125'] || 0) + (corrected['subpanel_200'] || 0);
        if (totalSub > 4) {
            clamp('subpanel_100', 2, 'max 2-3 subpanels in a single-family home');
            clamp('subpanel_125', 2, 'max 2-3 subpanels in a single-family home');
        }

        // Receptacle density: max ~1 per 15 sqft
        if (sqft > 0) {
            clamp('duplex', Math.ceil(sqft / 15), `max receptacle density 1 per 15 sqft for ${sqft} sqft`);
        }
    }

    if (isMultiFamily && units > 1) {
        // Multi-family: per-unit ratio guards
        const maxPerUnit = Math.ceil(units * 2); // generous 2× buffer

        clamp('range', maxPerUnit, `max 2 per unit × ${units} units`);
        clamp('cooktop', maxPerUnit, `max 2 per unit × ${units} units`);
        clamp('water_heater', maxPerUnit, `max 2 per unit × ${units} units`);
        clamp('tankless_wh', maxPerUnit, `max 2 per unit × ${units} units`);
        clamp('dishwasher', maxPerUnit, `max 2 per unit × ${units} units`);
        clamp('refrigerator', maxPerUnit, `max 2 per unit × ${units} units`);

        // Panels should be roughly proportional to units
        const totalSub = (corrected['subpanel_100'] || 0) + (corrected['subpanel_125'] || 0) + (corrected['subpanel_200'] || 0);
        if (totalSub > units * 2) {
            // Too many — scale down proportionally
            for (const key of ['subpanel_100', 'subpanel_125', 'subpanel_200']) {
                clamp(key, Math.ceil(units * 1.5), `subpanels should be roughly proportional to ${units} units`);
            }
        }

        // Dryers: if common laundry, limit to ~2 per floor
        if (context.hasCommonLaundry) {
            const maxDryers = Math.max(6, (context.stories || 1) * 4);
            clamp('dryer', maxDryers, `common laundry: max ~${maxDryers} dryers for ${context.stories || 1} floors`);
        }

        // NEC: minimum 1 smoke/CO per dwelling unit
        const totalSmoke = (corrected['smoke'] || 0) + (corrected['smoke_co'] || 0);
        if (totalSmoke > 0 && totalSmoke < units) {
            const primaryKey = corrected['smoke_co'] ? 'smoke_co' : 'smoke';
            clampMin(primaryKey, units, `NEC requires minimum 1 smoke/CO per dwelling unit (${units} units)`);
        }
    }

    return { corrected, warnings };
}

// ===== V3 Reconciliation (arbiter rotation) =====
export async function performTargetedReconciliation(
    input: BlueprintInput,
    discrepancies: BlueprintDiscrepancy[]
): Promise<BlueprintAgentResult> {
    if (discrepancies.length === 0) return {};

    const itemsList = discrepancies.map(d => `- ${d.itemId}`).join('\n');
    const prompt = DISCREPANCY_PROMPT.replace('{ITEMS_LIST}', itemsList);
    const base64Data = input.base64;
    const isPdf = input.isPdf;

    // Arbiter rotation: Claude → OpenAI (images only) → Gemini
    if (ANTHROPIC_API_KEY) {
        logger.info('V3 Arbiter: Claude');
        try {
            const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
            const fileContent = isPdf
                ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64Data } }
                : { type: 'image' as const, source: { type: 'base64' as const, media_type: input.mimeType as 'image/png' | 'image/jpeg', data: base64Data } };
            const msg = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1500,
                messages: [{ role: 'user', content: [fileContent, { type: 'text', text: prompt }] }]
            });
            if (msg.content[0].type === 'text') {
                return sanitizeAgentResult(parseJsonResponse(msg.content[0].text.trim()), 'Claude-Arbiter');
            }
        } catch (e) { logger.warn('Claude arbiter failed', e); }
    }

    if (OPENAI_API_KEY && !isPdf) {
        logger.info('V3 Arbiter: OpenAI');
        try {
            const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{
                    role: 'user', content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${base64Data}`, detail: 'high' } }
                    ]
                }],
                max_tokens: 1500,
            });
            const text = response.choices[0]?.message?.content?.trim() || '';
            return sanitizeAgentResult(parseJsonResponse(text), 'OpenAI-Arbiter');
        } catch (e) { logger.warn('OpenAI arbiter failed', e); }
    }

    // Fallback: Gemini
    if (GEMINI_API_KEY) {
        logger.info('V3 Arbiter: Gemini (fallback)');
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent({
            contents: [{
                role: 'user', parts: [
                    { text: prompt },
                    { inlineData: { mimeType: input.mimeType, data: base64Data } }
                ]
            }]
        });
        return sanitizeAgentResult(parseJsonResponse(result.response.text().trim()), 'Gemini-Arbiter');
    }

    throw new Error('No API keys available for reconciliation');
}

// ===== Classify Blueprint (quick Gemini call) =====
const CLASSIFY_PROMPT = `Analyze this document and classify it into EXACTLY ONE category.

Categories:
- electrical_plan (floor plan or blueprint showing electrical symbols, outlets, switches, lighting)
- schedule (panel schedule, circuit schedule, or equipment schedule table)
- cover (title page, cover sheet, table of contents, or general notes)
- specification (written specifications, material lists, or code references)
- other (anything else — plumbing, HVAC, structural, landscape, or unrelated)

Return ONLY the category name, nothing else.
Example: electrical_plan`;

export async function classifyBlueprint(input: BlueprintInput): Promise<BlueprintFileClassification> {
    if (!GEMINI_API_KEY) return 'other';

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: CLASSIFY_PROMPT },
                    { inlineData: { mimeType: input.mimeType, data: input.base64 } }
                ]
            }]
        });

        const text = result.response.text().trim().toLowerCase().replace(/[^a-z_]/g, '');
        const valid: BlueprintFileClassification[] = ['electrical_plan', 'schedule', 'cover', 'specification', 'other'];
        if (valid.includes(text as BlueprintFileClassification)) {
            return text as BlueprintFileClassification;
        }
        logger.warn(`Gemini classified as unknown: "${text}", defaulting to "other"`);
        return 'other';
    } catch (e) {
        logger.error('Classification failed', e);
        return 'other';
    }
}

// ===== Merge Results (sum counts across multiple files) =====
export function mergeResults(results: BlueprintAgentResult[]): BlueprintAgentResult {
    const merged: BlueprintAgentResult = {};
    for (const result of results) {
        for (const [key, value] of Object.entries(result)) {
            merged[key] = (merged[key] || 0) + value;
        }
    }
    return merged;
}

