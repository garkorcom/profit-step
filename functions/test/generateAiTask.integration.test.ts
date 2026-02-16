/**
 * @fileoverview generateAiTask.integration.test.ts
 * Integration tests for the generateAiTask Cloud Function.
 *
 * Strategy — FULL MOCK (no emulator needed):
 * - Mock firebase-functions/v2/https → expose raw handler
 * - Mock @anthropic-ai/sdk → deterministic tool_use responses
 * - Mock firebase-admin/firestore → in-memory context + audit log capture
 * - Validate: Zod parsing, response shape, scope analysis, audit writes
 */

// ── Mock Firestore ───────────────────────────────────────────

const mockAuditLogs: Record<string, any> = {};
let auditLogCounter = 0;

const mockFirestoreData: Record<string, any> = {
    "projects/proj_villa_miami": {
        name: "Villa Miami Beach",
        brief: "Custom residential build, 15,000 sqft, oceanfront",
        clientName: "Pavel Durov",
        status: "active",
    },
};

const mockDocs = {
    tasks: [
        {
            id: "t_101",
            data: () => ({
                title: "Check Master Bath wiring",
                assigneeName: "Nikolai Smirnov",
                status: "done",
                createdAt: { toDate: () => new Date("2026-02-15T09:00:00Z") },
                zone: "Master Bath",
                projectId: "proj_villa_miami",
            }),
        },
    ],
    estimates: [
        {
            id: "est_villa",
            data: () => ({
                projectId: "proj_villa_miami",
                status: "active",
                items: [
                    { lineNumber: "est_1", description: "Rough-in Electrical, Kitchen", zone: "Kitchen", division: "Rough Electric", status: "pending", amount: 5000, tags: ["wire", "rough", "kitchen"] },
                    { lineNumber: "est_2", description: "Install 15A Receptacles, Master Bath", zone: "Master Bath", division: "Finish", status: "paid", amount: 1800, tags: ["plug", "switch", "finish", "bath"] },
                    { lineNumber: "est_3", description: "Main Panel 200A Upgrade", zone: "Utility", division: "Service", status: "pending", amount: 4500, tags: ["panel", "breaker", "main"] },
                ],
            }),
        },
    ],
    changeOrders: [],
    employees: [
        { id: "u1", data: () => ({ name: "Nikolai Smirnov", displayName: "Nikolai Smirnov", isActive: true }) },
        { id: "u2", data: () => ({ name: "Carlos Mateo", displayName: "Carlos Mateo", isActive: true }) },
    ],
    projects: [
        { id: "proj_villa_miami", data: () => ({ name: "Villa Miami Beach", status: "active" }) },
    ],
};

// Create a chainable Firestore query mock
function createQueryMock(docs: any[]) {
    const q: any = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({ docs, empty: docs.length === 0 }),
    };
    return q;
}

jest.mock("firebase-admin/firestore", () => {
    return {
        getFirestore: () => ({
            doc: (path: string) => ({
                get: jest.fn().mockResolvedValue({
                    exists: !!mockFirestoreData[path],
                    data: () => mockFirestoreData[path] || {},
                }),
            }),
            collection: (name: string) => {
                const docs = (mockDocs as any)[name] || [];
                return createQueryMock(docs);
            },
        }),
        FieldValue: {
            serverTimestamp: () => new Date(),
        },
    };
});

// Override audit log writes to capture them
const originalGetFirestore = jest.requireMock("firebase-admin/firestore").getFirestore;
const getFirestoreMock = originalGetFirestore as jest.Mock;

// ── Mock firebase-functions ──────────────────────────────────

jest.mock("firebase-functions/v2/https", () => ({
    onCall: (_config: any, handler: any) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = "HttpsError";
        }
    },
}));

// ── Mock Anthropic ───────────────────────────────────────────

const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
    const MockAnthropic = jest.fn().mockImplementation(() => ({
        messages: { create: mockCreate },
    }));
    return { __esModule: true, default: MockAnthropic };
});

// ── HELPERS ──────────────────────────────────────────────────

function buildClaudeResponse(toolInput: Record<string, unknown>) {
    return {
        content: [{
            type: "tool_use" as const,
            id: "toolu_" + Date.now(),
            name: "create_task",
            input: toolInput,
        }],
        model: "claude-sonnet-4-20250514",
        role: "assistant" as const,
        stop_reason: "tool_use" as const,
        usage: { input_tokens: 100, output_tokens: 200 },
    };
}

// ── SETUP ────────────────────────────────────────────────────

let handler: (request: any) => Promise<any>;

beforeAll(() => {
    // Patch getFirestore to also support aiAuditLogs add()
    const origFS = jest.requireMock("firebase-admin/firestore").getFirestore();
    jest.requireMock("firebase-admin/firestore").getFirestore = () => ({
        ...origFS,
        collection: (name: string) => {
            if (name === "aiAuditLogs") {
                return {
                    add: jest.fn().mockImplementation((data: any) => {
                        const id = `audit_${++auditLogCounter}`;
                        mockAuditLogs[id] = data;
                        return Promise.resolve({ id });
                    }),
                };
            }
            const docs = (mockDocs as any)[name] || [];
            return createQueryMock(docs);
        },
        doc: origFS.doc,
    });

    const mod = require("../src/callable/ai/generateAiTask");
    handler = mod.generateAiTask;
});

beforeEach(() => {
    mockCreate.mockReset();
    auditLogCounter = 0;
    Object.keys(mockAuditLogs).forEach(k => delete mockAuditLogs[k]);
});

async function callHandler(params: {
    userInput: string;
    projectId?: string;
    clientDatetime?: string;
    inputMethod?: string;
}) {
    return handler({
        auth: { uid: "test_user_001", token: {} },
        data: {
            userInput: params.userInput,
            projectId: params.projectId || "proj_villa_miami",
            clientDatetime: params.clientDatetime || "Monday, Feb 16, 2026, 7:30 PM (EST)",
            inputMethod: params.inputMethod || "voice",
        },
    });
}

// ============================================================
// 🛑 PP#1: Greedy Client — EV Charger
// ============================================================

describe("🛑 Integration PP#1: Greedy Client", () => {
    test("returns not_in_estimate for EV charger request", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Install EV Charger in Garage",
                description: "Level 2 charger with dedicated 50A circuit",
                assigneeIds: ["u1"],
                projectId: "proj_villa_miami",
                dueDate: "2026-02-20T09:00:00-05:00",
                priority: "high",
                estimatedMinutes: 360,
                zone: "Garage",
                checklist: [
                    { title: "Run 6/3 wire from panel", isDone: false },
                    { title: "Install 50A breaker", isDone: false },
                ],
            },
            analysis: {
                scopeStatus: "not_in_estimate",
                scopeExplanation: "EV charger not in estimate — extra work",
                assigneeReasoning: "Nikolai — senior electrician",
                confidence: { assignee: 0.8, project: 0.95, dueDate: 0.7, scope: 0.95 },
            },
        }));

        const result = await callHandler({
            userInput: "Хозяин купил Теслу. Нужно срочно кинуть кабель в гараж и поставить зарядную станцию.",
        });

        expect(result.success).toBe(true);
        expect(result.analysis.scopeStatus).toBe("not_in_estimate");
        expect(result.draft.zone).toBe("Garage");
        expect(result.auditLogId).toBeDefined();
    });
});

// ============================================================
// 💸 PP#2: Warranty Trap
// ============================================================

describe("💸 Integration PP#2: Warranty Trap", () => {
    test("in_estimate_completed for paid receptacle", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Check sparking receptacle in Master Bath",
                assigneeIds: ["u1"],
                projectId: "proj_villa_miami",
                dueDate: "2026-02-17T08:00:00-05:00",
                priority: "urgent",
                estimatedMinutes: 60,
                zone: "Master Bath",
            },
            analysis: {
                scopeStatus: "in_estimate_completed",
                matchedEstimateItem: "est_2",
                scopeExplanation: "est_2 status=PAID → warranty/rework",
                assigneeReasoning: "'Коля' = Nikolai (u1)",
                confidence: { assignee: 0.9, project: 0.95, dueDate: 0.85, scope: 0.9 },
            },
        }));

        const result = await callHandler({
            userInput: "Клиент ругается, этот чертов плаг в хозяйской ванной искрит. Пусть Коля сгоняет завтра.",
        });

        expect(result.success).toBe(true);
        expect(result.analysis.scopeStatus).toBe("in_estimate_completed");
        expect(result.analysis.matchedEstimateItem).toBe("est_2");
        expect(result.draft.priority).toBe("urgent");
    });
});

// ============================================================
// 🤪 PP#3: Drunk Foreman
// ============================================================

describe("🤪 Integration PP#3: Drunk Foreman", () => {
    test("final assignee=Nikolai, final date=Thursday", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Check grounding at Villa Miami",
                assigneeIds: ["u1"],
                projectId: "proj_villa_miami",
                dueDate: "2026-02-19T09:00:00-05:00",
                priority: "medium",
                estimatedMinutes: 120,
            },
            analysis: {
                scopeStatus: "uncertain",
                scopeExplanation: "Grounding not directly in estimate",
                assigneeReasoning: "User corrected Carlos→Nikolai",
                confidence: { assignee: 0.95, project: 0.8, dueDate: 0.9, scope: 0.5 },
            },
        }));

        const result = await callHandler({
            userInput: "Скажи Карлосу... А нет, пусть Николай. Проверить заземление. Завтра... нет, в четверг.",
        });

        expect(result.success).toBe(true);
        expect(result.draft.assigneeIds).toEqual(["u1"]);
        expect(result.draft.dueDate).toContain("2026-02-19");
    });
});

// ============================================================
// 🦇 PP#4: Batman
// ============================================================

describe("🦇 Integration PP#4: Batman", () => {
    test("empty assigneeIds, not_in_estimate", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Pour concrete foundation",
                assigneeIds: [],
                projectId: "proj_villa_miami",
                dueDate: "2030-01-01T09:00:00-05:00",
                priority: "low",
            },
            analysis: {
                scopeStatus: "not_in_estimate",
                scopeExplanation: "Concrete is not electrical",
                assigneeReasoning: "'Бэтмен' not in employees",
                confidence: { assignee: 0.0, project: 0.5, dueDate: 0.3, scope: 0.95 },
            },
        }));

        const result = await callHandler({
            userInput: "Поручи Бэтмену залить бетонный фундамент до 2030 года.",
        });

        expect(result.success).toBe(true);
        expect(result.draft.assigneeIds).toEqual([]);
        expect(result.analysis.confidence.assignee).toBe(0.0);
    });
});

// ============================================================
// 👯‍♂️ PP#5: Amnesia
// ============================================================

describe("👯‍♂️ Integration PP#5: Amnesia", () => {
    test("possibleDuplicate found", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Re-check Master Bath wiring",
                assigneeIds: [],
                projectId: "proj_villa_miami",
                dueDate: "2026-02-17T09:00:00-05:00",
                priority: "medium",
            },
            analysis: {
                scopeStatus: "in_estimate_pending",
                matchedEstimateItem: "est_1",
                scopeExplanation: "Matches rough-in scope",
                assigneeReasoning: "'кто-то' — no specific assignee",
                confidence: { assignee: 0.0, project: 0.9, dueDate: 0.7, scope: 0.75 },
                possibleDuplicate: {
                    found: true,
                    existingTaskTitle: "Check Master Bath wiring",
                    suggestion: "merge",
                },
            },
        }));

        const result = await callHandler({
            userInput: "Надо кто-то глянул провода в ванной (master bath).",
        });

        expect(result.success).toBe(true);
        expect(result.analysis.possibleDuplicate.found).toBe(true);
        expect(result.analysis.possibleDuplicate.suggestion).toBe("merge");
    });
});

// ============================================================
// ⏱ PP#6: Timezone Trap
// ============================================================

describe("⏱ Integration PP#6: Timezone Trap", () => {
    test("Claude receives client local time in system prompt", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Morning inspection",
                assigneeIds: ["u1"],
                projectId: "proj_villa_miami",
                dueDate: "2026-02-17T08:00:00-05:00",
                priority: "medium",
            },
            analysis: {
                scopeStatus: "uncertain",
                scopeExplanation: "General task",
                assigneeReasoning: "Default",
                confidence: { assignee: 0.5, project: 0.8, dueDate: 0.9, scope: 0.3 },
            },
        }));

        const result = await callHandler({
            userInput: "Сделай завтра утром.",
            clientDatetime: "Monday, Feb 16, 2026, 9:00 PM (EST)",
        });

        expect(result.success).toBe(true);
        expect(result.draft.dueDate).toContain("2026-02-17");

        // Verify system prompt contains client's local time
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.system).toContain("9:00 PM (EST)");
    });
});

// ============================================================
// 🏗 Input validation & Error handling
// ============================================================

describe("🏗 Input validation & Error handling", () => {
    test("no auth → throws unauthenticated", async () => {
        await expect(handler({
            auth: null,
            data: { userInput: "test", projectId: "x", clientDatetime: "now" },
        })).rejects.toThrow("Must be logged in");
    });

    test("no userInput → throws invalid-argument", async () => {
        await expect(handler({
            auth: { uid: "u1" },
            data: { projectId: "x", clientDatetime: "now" },
        })).rejects.toThrow("userInput is required");
    });

    test("no clientDatetime → throws invalid-argument", async () => {
        await expect(handler({
            auth: { uid: "u1" },
            data: { userInput: "test", projectId: "x" },
        })).rejects.toThrow("clientDatetime is required");
    });

    test("malformed Claude response → fallbackToManual", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: { title: "Broken" },
            analysis: { scopeStatus: "invalid_value" },
        }));

        const result = await callHandler({ userInput: "Malformed test" });

        expect(result.success).toBe(false);
        expect(result.fallbackToManual).toBe(true);
        expect(result.zodErrors.length).toBeGreaterThan(0);
    });

    test("audit log captures correct metadata", async () => {
        mockCreate.mockResolvedValueOnce(buildClaudeResponse({
            task: {
                title: "Audit test",
                assigneeIds: ["u1"],
                projectId: "proj_villa_miami",
                dueDate: "2026-02-17T09:00:00-05:00",
                priority: "medium",
            },
            analysis: {
                scopeStatus: "uncertain",
                scopeExplanation: "Test",
                assigneeReasoning: "Test",
                confidence: { assignee: 0.5, project: 0.5, dueDate: 0.5, scope: 0.5 },
            },
        }));

        const result = await callHandler({ userInput: "Audit logging test" });

        expect(result.success).toBe(true);
        expect(result.auditLogId).toBe("audit_1");

        // Check captured audit log
        const log = mockAuditLogs["audit_1"];
        expect(log).toBeDefined();
        expect(log.userInput).toBe("Audit logging test");
        expect(log.modelUsed).toBe("claude-sonnet-4-20250514");
        expect(log.wasAccepted).toBeNull();
        expect(log.userId).toBe("test_user_001");
    });
});
