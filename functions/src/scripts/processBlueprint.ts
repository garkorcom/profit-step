import * as admin from 'firebase-admin';
import * as fs from 'fs';
import axios from 'axios';
const FormData = require('form-data');
const Fuse = require('fuse.js');
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';

// Load .env from functions root
dotenv.config({ path: require('path').resolve(__dirname, '../../.env') });

// Auto-initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// A simple ID generator mimicking nanoid
function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

async function estimateMarketPrice(itemName: string): Promise<number> {
    if (!process.env.GEMINI_API_KEY) {
        console.log(`⚠️ No GEMINI_API_KEY. Defaulting price to 0 for: ${itemName}`);
        return 0;
    }
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `You are an expert construction estimator in Florida. Estimate the retail market price in USD for 1 unit of "${itemName}". Reply ONLY with a raw number (e.g. 15.50). Nothing else. Do NOT include currency symbols or text.`;
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        const price = parseFloat(text.replace(/[^0-9.]/g, ''));
        return isNaN(price) ? 0 : price;
    } catch (e) {
        console.error(`❌ Gemini Error for ${itemName}:`, e);
        return 0;
    }
}

async function sendTelegramMessage(chatId: string, text: string) {
    if (!chatId || !TELEGRAM_BOT_TOKEN) {
        if (!TELEGRAM_BOT_TOKEN) console.log('⚠️ TELEGRAM_BOT_TOKEN not set, skipping notification');
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'HTML'
        });
        console.log(`📠 Sent Telegram webhook to Chat ID: ${chatId}`);
    } catch (e: any) {
        console.error('❌ Telegram Notify Error:', e.response?.data?.description || e.message);
    }
}

// Phase 3: Assembly Expansion Engine
function expandAssembly(devName: string, qty: number) {
    const lowerName = devName.toLowerCase();
    const assemblies = [];
    
    // Example Expansion: Receptacles
    if (lowerName.includes("receptacle") || lowerName.includes("outlet")) {
        assemblies.push({ name: `${devName} (Device)`, qty: qty });
        assemblies.push({ name: 'Standard Single Gang Box', qty: qty });
        assemblies.push({ name: 'Plastic Wallplate', qty: qty });
        assemblies.push({ name: '12/2 MC Cable (ft)', qty: qty * 15 }); // 15ft average per drop
        assemblies.push({ name: 'Electrician Labor (hrs)', qty: qty * 0.5 }); // 30 min install
    } 
    // Example Expansion: Lighting Fixture
    else if (lowerName.includes("light") || lowerName.includes("fixture")) {
        assemblies.push({ name: `${devName} (Fixture)`, qty: qty });
        assemblies.push({ name: 'Lighting Support Bracket/Wire', qty: qty });
        assemblies.push({ name: '12/2 MC Cable (ft)', qty: qty * 25 });
        assemblies.push({ name: 'Electrician Labor (hrs)', qty: qty * 1.5 });
    } 
    // Fallback: Just the raw device
    else {
        assemblies.push({ name: devName, qty: qty });
    }
    return assemblies;
}

// Phase 10: Flatten JSON 2.0 (rooms[].devices[]) → flat devices[] for assembly expansion
function flattenBlueprint(json: any): any[] {
    // JSON 2.0 format: rooms[].devices[]
    if (json.rooms && Array.isArray(json.rooms)) {
        const deviceMap = new Map<string, { device_type: string; quantity: number; room: string; zone_type: string }>();
        for (const room of json.rooms) {
            for (const dev of (room.devices || [])) {
                const devType = dev.type || dev.id || 'unknown';
                const key = `${room.name}_${devType}`;
                if (deviceMap.has(key)) {
                    deviceMap.get(key)!.quantity += 1;
                } else {
                    deviceMap.set(key, {
                        device_type: devType,
                        quantity: 1,
                        room: room.name,
                        zone_type: room.zone_type || 'dry'
                    });
                }
            }
        }
        const flat = Array.from(deviceMap.values());
        console.log(`🔄 Flattened JSON 2.0: ${json.rooms.length} rooms → ${flat.length} aggregated device groups`);
        return flat;
    }
    // Legacy flat format
    if (json.devices && Array.isArray(json.devices)) {
        return json.devices;
    }
    return [];
}

// ── Structured Error Logger ──
interface LogEntry {
    timestamp: string;
    stage: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
    message: string;
    data?: any;
    error?: string;
}

class EstimatorTsLogger {
    entries: LogEntry[] = [];
    sessionId: string;
    
    constructor(sessionId: string) {
        this.sessionId = sessionId;
    }
    
    private log(level: LogEntry['level'], stage: string, message: string, data?: any, error?: string) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            stage,
            level,
            message,
            ...(data && { data }),
            ...(error && { error })
        };
        this.entries.push(entry);
        const icon = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '❌', CRITICAL: '🔥' }[level];
        console.log(`${icon} [${stage}] ${message}`);
        if (error) console.log(`   └─ ${error}`);
    }
    
    info(stage: string, msg: string, data?: any) { this.log('INFO', stage, msg, data); }
    warn(stage: string, msg: string, data?: any) { this.log('WARN', stage, msg, data); }
    error(stage: string, msg: string, data?: any, err?: any) { 
        this.log('ERROR', stage, msg, data, err?.message || String(err || '')); 
    }
    critical(stage: string, msg: string, data?: any, err?: any) { 
        this.log('CRITICAL', stage, msg, data, err?.message || String(err || '')); 
    }
    
    getErrors() { return this.entries.filter(e => e.level === 'ERROR' || e.level === 'CRITICAL'); }
    
    async saveToFirestore() {
        try {
            await db.collection('estimator_logs').add({
                sessionId: this.sessionId,
                entries: this.entries,
                errorCount: this.getErrors().length,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (e: any) {
            console.error(`Failed to save logs to Firestore: ${e.message}`);
        }
    }
}

async function main() {
    const pdfPath = process.argv[2];
    const cliChatId = process.argv[3]; // Fallback ID
    
    if (!pdfPath || !fs.existsSync(pdfPath)) {
        console.error("❌ Error: Valid PDF path must be provided as an argument.");
        process.exit(1);
    }
    
    const tslog = new EstimatorTsLogger(`ts_${Date.now()}_${pdfPath.split('/').pop()}`);
    tslog.info('init', `Starting Super-Estimator`, { pdfPath, cliChatId });
    
    console.log(`🚀 Starting Super-Estimator for: ${pdfPath}`);
    
    // Chat ID is passed as CLI argument (from OpenClaw agent)
    const targetChatId = cliChatId || '249539345';
    
    // 1. Send the PDF to the local Python Flask Estimator API (Port 8000)
    const form = new FormData();
    form.append('file', fs.createReadStream(pdfPath));
    form.append('thread_id', `telegram_${Date.now()}`);
    form.append('telegram_chat_id', targetChatId); // Passed to Python for Live Webhooks!
    
    console.log(`📤 Uploading PDF... Chat ID mapped to: ${targetChatId}`);
    let apiResponse;
    try {
        const blueprintAiUrl = process.env.BLUEPRINT_AI_URL;
        if (!blueprintAiUrl) {
            throw new Error('BLUEPRINT_AI_URL env var not set — blueprint AI service offline');
        }
        const response = await axios.post(`${blueprintAiUrl}/api/upload-blueprint`, form, {
            headers: {
                ...form.getHeaders()
            },
            timeout: 0 // No timeout (0)! 10+ page PDFs can take 15-20 mins
        });
        
        apiResponse = response.data;
        console.log("✅ Python API processed the blueprint successfully.");
    } catch (e: any) {
        tslog.critical('flask_api', 'Flask API call failed', {
            responseData: e.response?.data,
            status: e.response?.status,
            code: e.code
        }, e);
        await tslog.saveToFirestore();
        await sendTelegramMessage(targetChatId, `❌ <b>Ошибка парсинга PDF</b>\nAPI не дождался ответа от AI-сметчика или произошел сбой: ${e.message}`);
        process.exit(1);
    }

    const blueprint_json = apiResponse.blueprint_json || apiResponse;
    tslog.info('api_response', 'Flask API response received', {
        hasBlueprint: !!apiResponse.blueprint_json,
        status: apiResponse.status,
        versionDir: apiResponse.version_dir,
        roomCount: (blueprint_json.rooms || []).length,
        deviceCount: (blueprint_json.rooms || []).reduce((sum: number, r: any) => sum + (r.devices || []).length, 0)
    });

    const meta = blueprint_json.project_meta || {};
    let clientId = "telegram_client";
    let clientName = meta.client_name || "Telegram Upload";
    let jobLocation = meta.project_address || "";
    let architectId = "";
    let architectCompany = meta.architect_company || "";
    let projectName = meta.project_name_or_id || "";

    console.log(`\n🏢 [METADATA] Extracted:
Client: ${clientName}
Location: ${jobLocation}
Architect: ${architectCompany} (${meta.architect_name || ''})
Project: ${projectName}\n`);

    // 1. Resolve/Create Client
    if (clientName !== "Telegram Upload" && clientName.trim() !== "") {
        const clientSnap = await db.collection('clients')
            .where('companyId', '==', 'profit_step')
            .where('name', '==', clientName)
            .limit(1).get();
            
        if (!clientSnap.empty) {
            clientId = clientSnap.docs[0].id;
        } else {
            console.log(`👤 Creating new Client: ${clientName}`);
            const newClient = await db.collection('clients').add({
                companyId: 'profit_step',
                name: clientName,
                status: 'lead',
                type: 'individual',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                tags: ['blueprint-auto-extracted']
            });
            clientId = newClient.id;
        }
    }

    // 2. Resolve/Create Architect
    if (architectCompany.trim() !== "") {
        const archSnap = await db.collection('architects')
            .where('companyId', '==', 'profit_step')
            .where('name', '==', architectCompany)
            .limit(1).get();
            
        if (!archSnap.empty) {
            architectId = archSnap.docs[0].id;
        } else {
            console.log(`📐 Creating new Architect: ${architectCompany}`);
            const newArch = await db.collection('architects').add({
                companyId: 'profit_step',
                name: architectCompany,
                contactPerson: meta.architect_name || "",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                tags: ['blueprint-auto-extracted']
            });
            architectId = newArch.id;
        }
    }

    const version_dir = apiResponse.version_dir; // Keep version_dir if it exists in apiResponse
    
    const devices = flattenBlueprint(blueprint_json);
    if (!devices.length) {
        tslog.critical('flatten', 'No devices after flattening', {
            rooms: (blueprint_json.rooms || []).length,
            rawDevices: (blueprint_json.devices || []).length,
            blueprintKeys: Object.keys(blueprint_json)
        });
        await tslog.saveToFirestore();
        await sendTelegramMessage(targetChatId, `❌ <b>Ошибка</b>: Не удалось найти устройства в JSON ответе.`);
        process.exit(1);
    }
    tslog.info('flatten', `Extracted ${devices.length} device groups`, {
        deviceTypes: devices.map((d: any) => d.device_type)
    });
    console.log(`🔍 Extracted ${devices.length} distinct device groups. Checking Catalog...`);
    
    // 2. Load Inventory Catalog
    const catalogSnap = await db.collection('inventory_catalog').get();
    const catalogItems = catalogSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Prepare fuzzy search
    const fuse = new Fuse(catalogItems, { keys: ['name'], threshold: 0.3 });
    
    const internalItems = [];
    const clientItems = [];
    let grandTotal = 0;

    for (const dev of devices) {
        const rawDevName = dev.device_type || dev.symbol_on_drawing;
        const rootQty = dev.quantity || 1;
        
        // Expand assemblies
        const explodedParts = expandAssembly(rawDevName, rootQty);
        
        for (const part of explodedParts) {
            const devName = part.name;
            const qty = part.qty;
            let price = 0;
            
            // Search in DB
            const results = fuse.search(devName);
            if (results.length > 0) {
                const matchedItem = results[0].item as any;
                price = matchedItem.avgPrice || matchedItem.lastPurchasePrice || 0;
                console.log(`✅ [CATALOG] Found "${devName}" matches "${matchedItem.name}" at $${price}`);
            } else {
                console.log(`⚠️ [CATALOG] "${devName}" not found. Asking Gemini for market price...`);
                price = await estimateMarketPrice(devName);
                
                // Add to Firestore Catalog to build the DB
                await db.collection('inventory_catalog').add({
                    name: devName,
                    category: devName.includes('(hrs)') ? 'labor' : 'materials',
                    unit: devName.includes('(hrs)') ? 'hr' : (devName.includes('(ft)') ? 'ft' : 'шт'),
                    lastPurchasePrice: price,
                    avgPrice: price,
                    clientMarkupPercent: 30, // Higher markup for assemblies
                    stockByLocation: { 'warehouse': 0 },
                    totalStock: 0,
                    minStock: 0,
                    isTrackable: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    createdBy: 'super_estimator_agent',
                    isArchived: false,
                    description: 'Auto-added by Gemini Market Analysis (Assembly Element)'
                });
            }

            const totalRow = price * qty;
            grandTotal += totalRow;

            const internalId = generateId();
            internalItems.push({
                id: internalId,
                description: devName,
                type: devName.includes('(hrs)') ? 'labor' : 'material',
                quantity: qty,
                unit: devName.includes('(hrs)') ? 'hr' : (devName.includes('(ft)') ? 'ft' : 'ea'),
                unitCostPrice: price,
                totalCost: totalRow
            });

            clientItems.push({
                id: generateId(),
                internalItemId: internalId,
                description: devName,
                quantity: qty,
                unit: devName.includes('(hrs)') ? 'hr' : (devName.includes('(ft)') ? 'ft' : 'ea'),
                unitPrice: price,
                total: totalRow,
                markupPercent: 30
            });
        }
    }

    const estimateDoc = {
        companyId: "profit_step",
        clientId: clientId,
        clientName: clientName,
        jobLocation: jobLocation,
        architectId: architectId,
        projectName: projectName,
        number: `EST-AI-${Date.now().toString().slice(-4)}`,
        status: "draft",
        version: "v4",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: "super_estimator_agent",
        
        internalItems,
        clientItems,
        
        subtotal: grandTotal,
        taxRate: 0,
        taxAmount: 0,
        total: grandTotal,
        notes: `🤖 Пропущено через ИИ-сметчика.\nАртефакты локально: ${version_dir}`,
        
        validationWarnings: (() => {
            const w: string[] = [];
            const _area = meta.total_area_sqft || blueprint_json.project_meta?.total_area_sqft || 0;
            if (_area > 0) {
                const cps = grandTotal / _area;
                if (cps < 15) w.push(`cost_per_sqft_low:${cps.toFixed(2)}`);
                if (cps > 35) w.push(`cost_per_sqft_high:${cps.toFixed(2)}`);
            }
            const _rooms = blueprint_json.rooms || [];
            const _ur = new Set(_rooms.map((r: any) => r.name || 'Unknown'));
            if (_ur.size > 15) w.push(`room_count_high:${_ur.size}`);
            return w;
        })(),
        
        projectSummary: (() => {
            const _rooms = blueprint_json.rooms || [];
            const _uniqueRooms = new Set(_rooms.map((r: any) => r.name || 'Unknown'));
            const _totalDevices = _rooms.reduce((s: number, r: any) => s + (r.devices || []).length, 0);
            const _totalPages = blueprint_json._meta?.total_pages || blueprint_json._meta?.pages_used?.length || 1;
            const _roomNamesLower = _rooms.map((r: any) => (r.name || '').toLowerCase()).join(' ');
            let _type = 'Mixed/Unknown';
            if (['bedroom', 'bed ', 'main bed', 'family room', 'den', 'laundry'].some(kw => _roomNamesLower.includes(kw))) _type = 'Residential';
            else if (['boh', 'storage', 'lobby', 'office'].some(kw => _roomNamesLower.includes(kw))) _type = 'Commercial';
            const _areaSqft = meta.total_area_sqft || blueprint_json.project_meta?.total_area_sqft || 0;
            return {
                buildingType: _type,
                areaSqft: _areaSqft,
                costPerSqft: _areaSqft > 0 ? Math.round((grandTotal / _areaSqft) * 100) / 100 : null,
                pages: _totalPages,
                rooms: _uniqueRooms.size,
                roomNames: Array.from(_uniqueRooms),
                totalDevices: _totalDevices,
                baseDeviceGroups: devices.length,
                expandedBomItems: internalItems.length
            };
        })()
    };

    // 3. Save to Firestore
    console.log("💾 Saving Draft Estimate to Firestore...");
    try {
        const docRef = await db.collection('estimates').add(estimateDoc);
        console.log(`✅ Success! Estimate ID: ${docRef.id} Total: $${grandTotal}`);
        
        // Asynchronous Notification
        const profitStepUrl = `https://profit-step.web.app/crm/estimates/${docRef.id}`;
        
        // Build PROJECT OVERVIEW from blueprint data
        const rooms = blueprint_json.rooms || [];
        const uniqueRooms = new Set(rooms.map((r: any) => r.name || 'Unknown'));
        const totalDevices = rooms.reduce((sum: number, r: any) => sum + (r.devices || []).length, 0);
        const totalPages = blueprint_json._meta?.total_pages || blueprint_json._meta?.pages_used?.length || 1;
        
        // Infer building type from room names
        const roomNamesLower = rooms.map((r: any) => (r.name || '').toLowerCase()).join(' ');
        let buildingType = 'Mixed/Unknown';
        if (['bedroom', 'bed ', 'main bed', 'family room', 'den', 'laundry'].some(kw => roomNamesLower.includes(kw))) {
            buildingType = 'Residential';
        } else if (['boh', 'storage', 'lobby', 'office'].some(kw => roomNamesLower.includes(kw))) {
            buildingType = 'Commercial';
        }
        
        // Validation rules
        const areaSqft = meta.total_area_sqft || blueprint_json.project_meta?.total_area_sqft || 0;
        const validationWarnings: string[] = [];
        
        let areaLine = '';
        if (areaSqft > 0) {
            areaLine = `• Area: <b>${areaSqft.toLocaleString()}</b> sq ft\n`;
            const costPerSqft = grandTotal / areaSqft;
            if (costPerSqft < 15) {
                areaLine += `• Cost/sq.ft: ⚠️ <b>$${costPerSqft.toFixed(2)}</b> — слишком низкая, проверить просчёт\n`;
                validationWarnings.push(`cost_per_sqft_low:${costPerSqft.toFixed(2)}`);
            } else if (costPerSqft > 35) {
                areaLine += `• Cost/sq.ft: ⚠️ <b>$${costPerSqft.toFixed(2)}</b> — слишком высокая, проверить просчёт\n`;
                validationWarnings.push(`cost_per_sqft_high:${costPerSqft.toFixed(2)}`);
            } else {
                areaLine += `• Cost/sq.ft: ✅ <b>$${costPerSqft.toFixed(2)}</b>\n`;
            }
        } else {
            areaLine = `• Area: <i>не найдена на чертеже</i>\n`;
        }
        
        let roomValidation = '';
        if (uniqueRooms.size > 15) {
            roomValidation = `• Room count: ⚠️ <b>${uniqueRooms.size}</b> — проверить задвоение данных\n`;
            validationWarnings.push(`room_count_high:${uniqueRooms.size}`);
        } else {
            roomValidation = `• Room count: ✅ <b>${uniqueRooms.size}</b>\n`;
        }
        
        if (validationWarnings.length > 0) {
            console.log(`⚠️ [VALIDATION] Warnings: ${validationWarnings.join(', ')}`);
        }
        
        let telegramMessage = `📋 <b>PROJECT OVERVIEW</b>\n`;
        if (clientName !== "Telegram Upload") telegramMessage += `• Client: <b>${clientName}</b>\n`;
        if (projectName) telegramMessage += `• Project: <b>${projectName}</b>\n`;
        if (jobLocation) telegramMessage += `• Address: ${jobLocation}\n`;
        telegramMessage += `• Type: <b>${buildingType}</b>\n`;
        telegramMessage += `• Pages/Floors: <b>${totalPages}</b>\n`;
        telegramMessage += areaLine;
        telegramMessage += `• Devices: <b>${totalDevices}</b>\n`;
        telegramMessage += roomValidation;
        telegramMessage += `─────────────────\n\n`;
        
        telegramMessage += `🎉 <b>Смета готова!</b>\n\n`;
        if (architectCompany) telegramMessage += `📐 <b>Архитектор:</b> ${architectCompany}\n`;
        
        telegramMessage += `\n💰 <b>Предварительная стоимость:</b> $${grandTotal.toFixed(2)} (Материалы + Работа)\n`;
        telegramMessage += `🧩 <b>Базовых узлов:</b> ${devices.length}\n`;
        telegramMessage += `⚙️ <b>Развернуто в сборки:</b> ${internalItems.length}\n`;
        telegramMessage += `\n👉 <a href="${profitStepUrl}">Открыть смету в Profit Step CRM</a>`;

        await sendTelegramMessage(targetChatId, telegramMessage);
        
    } catch (e: any) {
        tslog.critical('firestore_save', 'Failed to save estimate to Firestore', {
            estimateNumber: estimateDoc.number,
            grandTotal
        }, e);
        await tslog.saveToFirestore();
        process.exit(1);
    }
    
    // Save logs to Firestore at the end of successful run
    await tslog.saveToFirestore();
}

main();
