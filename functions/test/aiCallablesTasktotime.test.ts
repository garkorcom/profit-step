/**
 * @fileoverview aiCallablesTasktotime.test.ts
 *
 * Migration tests for the AI callables `generateAiTask` / `confirmAiTask` /
 * `modifyAiTask` to verify they target `tasktotime_tasks` (and never the
 * legacy `gtd_tasks` collection) when the migration flag is on.
 *
 * Mocking strategy — full mock, no emulator:
 *   - `firebase-admin/firestore` → in-memory store with chainable query
 *     builder, doc reads, and `.add()` capture.
 *   - `firebase-functions/v2/https` → expose the raw onCall handler so we
 *     can drive it like a plain async fn.
 *   - `@anthropic-ai/sdk` → deterministic tool_use responses.
 *   - `../src/tasktotime/composition` → stub `getTasktotimeServices`
 *     returning a fake `createTaskHandler.execute` that captures the
 *     command + returns a synthetic Task. This lets us assert the wire
 *     mapping (companyId, by ref, lifecycle, source, money, etc.)
 *     without booting the entire tasktotime adapter graph.
 *
 * Coverage:
 *   1. confirmAiTask (flag=ON) writes via createTaskHandler with correct
 *      companyId / by / lifecycle='ready' / source='ai'; legacy
 *      `gtd_tasks` collection is never touched.
 *   2. confirmAiTask (flag=ON) without companyId on the user → 400
 *      `failed-precondition`.
 *   3. confirmAiTask (flag=OFF, rollback) writes the legacy gtd_tasks
 *      doc and never invokes the tasktotime handler.
 *   4. generateAiTask (flag=ON) reads recent-tasks context from
 *      `tasktotime_tasks` (not gtd_tasks).
 *   5. modifyAiTask reads from `tasktotime_tasks` when given `taskId` +
 *      flag=ON, denies cross-tenant access (404).
 */

// ── Test fixture: companies / users / tasks ──────────────────

const TENANT_A = "company_acme";
const TENANT_B = "company_villains";

const CALLER_UID_A = "uid_caller_a";
const CALLER_UID_B = "uid_caller_b";

const mockUsers: Record<string, { companyId?: string; displayName?: string; name?: string; email?: string }> = {
    [CALLER_UID_A]: {
        companyId: TENANT_A,
        displayName: "Alice Project Manager",
    },
    [CALLER_UID_B]: {
        companyId: TENANT_B,
        displayName: "Bob Other Tenant",
    },
    "uid_no_company": {
        displayName: "Orphan User",
        // No companyId — used to test failed-precondition path
    },
};

// Ten recent tasks in tasktotime_tasks for tenant A
const mockTasktotimeTasks: Record<string, any> = {
    "tt_task_1": {
        title: "Inspection rough-in",
        clientId: "client_villa_a",
        companyId: TENANT_A,
        lifecycle: "completed",
        assignedTo: { id: "uid_worker_a", name: "Worker Alpha" },
        createdAt: 1707998400000, // epoch ms (number) — tasktotime convention
        estimatedDurationMinutes: 120,
        checklistItems: [],
    },
    "tt_task_b": {
        title: "Cross-tenant task (B)",
        clientId: "client_villa_b",
        companyId: TENANT_B,
        lifecycle: "ready",
        assignedTo: { id: "uid_worker_b", name: "Worker Bravo" },
        createdAt: 1708084800000,
        estimatedDurationMinutes: 30,
        checklistItems: [],
    },
};

// Legacy gtd_tasks fixture — separate collection, separate docs.
const mockGtdTasks: Record<string, any> = {
    "gtd_legacy_1": {
        title: "Legacy doc — should never be read in flag=ON",
        clientId: "client_villa_a",
        status: "next",
        assigneeName: "Legacy Worker",
        createdAt: { toDate: () => new Date("2026-01-15T09:00:00Z") },
    },
};

const mockEstimates: any[] = [];
const mockChangeOrders: any[] = [];
const mockEmployees: any[] = [
    {
        id: "uid_worker_a",
        data: () => ({ name: "Worker Alpha", displayName: "Worker Alpha", isActive: true }),
    },
];
const mockClients: any[] = [
    {
        id: "client_villa_a",
        data: () => ({ name: "Villa Alpha", isActive: true }),
    },
];

// Capture writes for assertions.
const capturedGtdWrites: any[] = [];
const capturedAuditLogUpdates: any[] = [];
const mockAuditLogs: Record<string, any> = {};

// ── Mock firebase-admin/firestore ────────────────────────────

function makeQueryFromCollection(name: string, projectId?: string) {
    let docs: any[] = [];

    if (name === "tasktotime_tasks") {
        // Filter by clientId match; preserves epoch ms ordering from highest
        // (most recent) to lowest. Default order maps to ORDER BY createdAt DESC.
        docs = Object.entries(mockTasktotimeTasks)
            .filter(([, t]) => !projectId || t.clientId === projectId)
            .map(([id, t]) => ({ id, data: () => t }))
            .sort((a, b) => b.data().createdAt - a.data().createdAt);
    } else if (name === "gtd_tasks") {
        docs = Object.entries(mockGtdTasks).map(([id, t]) => ({ id, data: () => t }));
    } else if (name === "users") {
        docs = Object.entries(mockUsers).map(([id, u]) => ({ id, data: () => u }));
    } else if (name === "clients") {
        docs = mockClients;
    } else if (name === "estimates") {
        docs = mockEstimates;
    } else if (name === "changeOrders") {
        docs = mockChangeOrders;
    }

    const q: any = {
        where: jest.fn().mockImplementation((field: string, op: string, value: unknown) => {
            if (field === "clientId" && op === "==" && typeof value === "string") {
                docs = docs.filter((d) => d.data().clientId === value);
            }
            return q;
        }),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockImplementation(async () => ({
            docs,
            empty: docs.length === 0,
        })),
    };
    return q;
}

const mockFirestoreShim = {
    doc: (path: string) => ({
        get: jest.fn().mockImplementation(async () => {
            // users/{uid}
            if (path.startsWith("users/")) {
                const uid = path.slice(6);
                const u = mockUsers[uid];
                return {
                    exists: !!u,
                    data: () => u ?? {},
                };
            }
            // tasktotime_tasks/{id}
            if (path.startsWith("tasktotime_tasks/")) {
                const id = path.slice("tasktotime_tasks/".length);
                const t = mockTasktotimeTasks[id];
                return { exists: !!t, data: () => t };
            }
            // gtd_tasks/{id}
            if (path.startsWith("gtd_tasks/")) {
                const id = path.slice("gtd_tasks/".length);
                const t = mockGtdTasks[id];
                return { exists: !!t, data: () => t };
            }
            // clients/{id} — used by loadContextSnapshot project lookup
            if (path.startsWith("clients/")) {
                return { exists: true, data: () => ({ name: "TestProject", brief: "" }) };
            }
            // aiAuditLogs/{id}
            if (path.startsWith("aiAuditLogs/")) {
                const id = path.slice("aiAuditLogs/".length);
                const log = mockAuditLogs[id];
                return { exists: !!log, data: () => log };
            }
            return { exists: false, data: () => ({}) };
        }),
        update: jest.fn().mockImplementation(async (data: any) => {
            capturedAuditLogUpdates.push({ path, data });
        }),
    }),
    collection: (name: string) => {
        if (name === "aiAuditLogs") {
            return {
                add: jest.fn().mockImplementation(async (data: any) => {
                    const id = `audit_${Object.keys(mockAuditLogs).length + 1}`;
                    mockAuditLogs[id] = { ...data, _id: id };
                    return { id };
                }),
            };
        }
        if (name === "gtd_tasks") {
            const q = makeQueryFromCollection(name);
            (q as any).add = jest.fn().mockImplementation(async (data: any) => {
                const id = `gtd_legacy_added_${capturedGtdWrites.length + 1}`;
                capturedGtdWrites.push({ id, data });
                return { id };
            });
            return q;
        }
        return makeQueryFromCollection(name);
    },
};

jest.mock("firebase-admin/firestore", () => ({
    getFirestore: () => mockFirestoreShim,
    FieldValue: {
        serverTimestamp: () => new Date("2026-04-27T12:00:00Z"),
    },
}));

// ── Mock firebase-functions/v2/https ─────────────────────────

jest.mock("firebase-functions/v2/https", () => ({
    onCall: (_config: unknown, handler: unknown) => handler,
    HttpsError: class HttpsError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = "HttpsError";
        }
    },
}));

// ── Mock Anthropic SDK ───────────────────────────────────────

const mockAnthropicCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
    const MockAnthropic = jest.fn().mockImplementation(() => ({
        messages: { create: mockAnthropicCreate },
    }));
    return { __esModule: true, default: MockAnthropic };
});

// ── Mock Anthropic API key (defineSecret returns a fake value) ────────

jest.mock("../src/config", () => ({
    ...jest.requireActual("../src/config"),
    ANTHROPIC_API_KEY: { value: () => "test-api-key" },
}));

// ── Mock tasktotime composition ──────────────────────────────

const capturedCreateTaskCommands: any[] = [];
const mockCreateTaskExecute = jest.fn();

jest.mock("../src/tasktotime/composition", () => ({
    getTasktotimeServices: () => ({
        createTaskHandler: {
            execute: mockCreateTaskExecute,
        },
    }),
}));

// ── Feature flag override (default: enabled) ─────────────────

let flagEnabled = true;
jest.mock("../src/config/env", () => {
    const actual = jest.requireActual("../src/config/env");
    return Object.defineProperty({ ...actual }, "TASKTOTIME_AI_CALLABLES_ENABLED", {
        get: () => flagEnabled,
        configurable: true,
        enumerable: true,
    });
});

// ── Helpers ──────────────────────────────────────────────────

function buildClaudeToolUseResponse(toolName: string, input: Record<string, unknown>) {
    return {
        content: [
            {
                type: "tool_use" as const,
                id: "toolu_" + Date.now(),
                name: toolName,
                input,
            },
        ],
        model: "claude-sonnet-4-20250514",
        role: "assistant" as const,
        stop_reason: "tool_use" as const,
        usage: { input_tokens: 50, output_tokens: 100 },
    };
}

function makeFakeCreatedTask(id: string, companyId: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        companyId,
        taskNumber: `T-2026-0001`,
        title: "Created via tasktotime",
        lifecycle: "ready",
        bucket: "next",
        priority: "medium",
        source: "ai",
        assignedTo: { id: CALLER_UID_A, name: "Alice Project Manager" },
        createdBy: { id: CALLER_UID_A, name: "Alice Project Manager" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dueAt: Date.now() + 86400000,
        estimatedDurationMinutes: 60,
        actualDurationMinutes: 0,
        requiredHeadcount: 1,
        autoShiftEnabled: false,
        isCriticalPath: false,
        slackMinutes: 0,
        isSubtask: false,
        subtaskIds: [],
        wikiInheritsFromParent: false,
        costInternal: { amount: 0, currency: "USD" },
        priceClient: { amount: 0, currency: "USD" },
        totalEarnings: 0,
        materialsCostPlanned: 0,
        materialsCostActual: 0,
        aiEstimateUsed: false,
        history: [],
        clientVisible: false,
        internalOnly: false,
        ...overrides,
    };
}

// ── Lazy require: must come AFTER the jest.mocks above ──────

let generateAiTask: (req: any) => Promise<any>;
let confirmAiTask: (req: any) => Promise<any>;
let modifyAiTask: (req: any) => Promise<any>;

beforeAll(() => {
    const genMod = require("../src/callable/ai/generateAiTask");
    generateAiTask = genMod.generateAiTask;
    confirmAiTask = genMod.confirmAiTask;
    const modMod = require("../src/callable/ai/modifyAiTask");
    modifyAiTask = modMod.modifyAiTask;
});

beforeEach(() => {
    flagEnabled = true;
    capturedGtdWrites.length = 0;
    capturedAuditLogUpdates.length = 0;
    capturedCreateTaskCommands.length = 0;
    Object.keys(mockAuditLogs).forEach((k) => delete mockAuditLogs[k]);
    mockAnthropicCreate.mockReset();
    mockCreateTaskExecute.mockReset();
    // Default: createTaskHandler captures the cmd and returns a fake task.
    mockCreateTaskExecute.mockImplementation(async (cmd: any) => {
        capturedCreateTaskCommands.push(cmd);
        return makeFakeCreatedTask(`tt_created_${capturedCreateTaskCommands.length}`, cmd.companyId);
    });
});

// ============================================================
// confirmAiTask — flag ON (canonical path)
// ============================================================

describe("confirmAiTask (flag=ON, tasktotime path)", () => {
    test("writes via createTaskHandler with correct companyId / by / lifecycle / source", async () => {
        // Pre-seed an audit log so we can verify confirmedTaskId update.
        mockAuditLogs["audit_42"] = { userId: CALLER_UID_A };

        const result = await confirmAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskData: {
                    title: "Install EV charger",
                    description: "Level 2 charger, 50A circuit",
                    assigneeIds: ["uid_worker_a"],
                    assigneeName: "Worker Alpha",
                    projectId: "client_villa_a",
                    clientName: "Villa Alpha",
                    dueDate: "2026-05-01T09:00:00-05:00",
                    priority: "high",
                    estimatedMinutes: 360,
                    checklist: [
                        { title: "Run wire from panel", isDone: false },
                        { title: "Mount charger", isDone: false },
                    ],
                },
                auditLogId: "audit_42",
                userEdits: [],
            },
        });

        expect(result).toEqual({ success: true, taskId: expect.stringMatching(/^tt_created_/) });

        // Tasktotime handler was invoked exactly once.
        expect(capturedCreateTaskCommands).toHaveLength(1);
        const cmd = capturedCreateTaskCommands[0];

        // Tenant scope: companyId resolved from users/{uid}.companyId.
        expect(cmd.companyId).toBe(TENANT_A);

        // Identity: by ref derived from auth uid + display name.
        expect(cmd.by).toEqual({ id: CALLER_UID_A, name: "Alice Project Manager" });

        // Source flag — must be 'ai' so the trigger fan-out can label it.
        expect(cmd.source).toBe("ai");

        // Lifecycle: confirm flow always lands on 'ready' (skip 'draft').
        expect(cmd.initialLifecycle).toBe("ready");

        // Priority mapping: legacy 'high' → tasktotime 'high'.
        expect(cmd.priority).toBe("high");

        // Title and description preserved.
        expect(cmd.title).toBe("Install EV charger");
        expect(cmd.description).toBe("Level 2 charger, 50A circuit");

        // Money defaults — tasktotime requires both fields, AI flow has no
        // pricing data so we default to 0 USD per the proxy convention.
        expect(cmd.costInternal).toEqual({ amount: 0, currency: "USD" });
        expect(cmd.priceClient).toEqual({ amount: 0, currency: "USD" });

        // Linking — clientId comes through, projectId mirrored.
        expect(cmd.clientId).toBe("client_villa_a");

        // Idempotency key derives from auditLogId.
        expect(cmd.idempotencyKey).toBe("confirmAiTask:audit_42");

        // Legacy gtd_tasks collection: NEVER written in flag=ON path.
        expect(capturedGtdWrites).toHaveLength(0);

        // Audit log was updated with the new task id.
        const auditUpdate = capturedAuditLogUpdates.find(
            (u) => u.path === "aiAuditLogs/audit_42",
        );
        expect(auditUpdate).toBeDefined();
        expect(auditUpdate.data.confirmedTaskId).toMatch(/^tt_created_/);
        expect(auditUpdate.data.wasAccepted).toBe(true);
        expect(auditUpdate.data.confirmedCollection).toBe("tasktotime_tasks");
    });

    test("priority mapping: 'urgent' → 'critical', 'none' → 'low'", async () => {
        await confirmAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskData: {
                    title: "Urgent task",
                    priority: "urgent",
                    assigneeIds: [],
                },
                userEdits: [],
            },
        });
        expect(capturedCreateTaskCommands.at(-1)!.priority).toBe("critical");

        await confirmAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskData: {
                    title: "Lazy task",
                    priority: "none",
                    assigneeIds: [],
                },
                userEdits: [],
            },
        });
        expect(capturedCreateTaskCommands.at(-1)!.priority).toBe("low");
    });

    test("missing dueDate → defaults to 1 week from now", async () => {
        const before = Date.now();
        await confirmAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskData: {
                    title: "No due date",
                    assigneeIds: [],
                    priority: "medium",
                },
                userEdits: [],
            },
        });
        const after = Date.now();
        const cmd = capturedCreateTaskCommands.at(-1)!;
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        expect(cmd.dueAt).toBeGreaterThanOrEqual(before + oneWeekMs);
        expect(cmd.dueAt).toBeLessThanOrEqual(after + oneWeekMs);
    });

    test("user without companyId → failed-precondition", async () => {
        await expect(
            confirmAiTask({
                auth: { uid: "uid_no_company" },
                data: {
                    taskData: { title: "Orphan task", priority: "low" },
                    userEdits: [],
                },
            }),
        ).rejects.toMatchObject({
            code: "failed-precondition",
        });

        // No tasktotime write attempted.
        expect(capturedCreateTaskCommands).toHaveLength(0);
        expect(capturedGtdWrites).toHaveLength(0);
    });

    test("auth missing → unauthenticated", async () => {
        await expect(
            confirmAiTask({
                auth: null,
                data: { taskData: { title: "x", priority: "low" }, userEdits: [] },
            }),
        ).rejects.toThrow("Must be logged in");
    });

    test("co-assignees populated from assigneeIds tail", async () => {
        await confirmAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskData: {
                    title: "Multi-assignee task",
                    assigneeIds: ["uid_worker_a", "uid_worker_b", "uid_worker_c"],
                    priority: "medium",
                },
                userEdits: [],
            },
        });
        const cmd = capturedCreateTaskCommands.at(-1)!;
        expect(cmd.assignedTo).toEqual({
            id: "uid_worker_a",
            name: expect.any(String),
        });
        expect(cmd.coAssignees).toEqual([
            { id: "uid_worker_b", name: "uid_worker_b" },
            { id: "uid_worker_c", name: "uid_worker_c" },
        ]);
    });
});

// ============================================================
// confirmAiTask — flag OFF (legacy rollback path)
// ============================================================

describe("confirmAiTask (flag=OFF, legacy rollback)", () => {
    beforeEach(() => {
        flagEnabled = false;
    });

    test("writes legacy gtd_tasks doc and never invokes tasktotime handler", async () => {
        const result = await confirmAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskData: {
                    title: "Legacy path task",
                    priority: "medium",
                    assigneeIds: ["uid_worker_a"],
                    projectId: "client_villa_a",
                    clientName: "Villa Alpha",
                },
                userEdits: [],
            },
        });

        expect(result).toEqual({ success: true, taskId: expect.stringMatching(/^gtd_legacy_added_/) });

        // Tasktotime handler must NOT be called in rollback mode.
        expect(capturedCreateTaskCommands).toHaveLength(0);

        // Legacy gtd_tasks collection received the write.
        expect(capturedGtdWrites).toHaveLength(1);
        const legacyDoc = capturedGtdWrites[0].data;
        expect(legacyDoc.title).toBe("Legacy path task");
        expect(legacyDoc.source).toBe("ai");
        expect(legacyDoc.ownerId).toBe(CALLER_UID_A);
    });
});

// ============================================================
// generateAiTask — context loader uses tasktotime_tasks
// ============================================================

describe("generateAiTask (flag=ON, context loader)", () => {
    test("recent-tasks context is read from tasktotime_tasks (not gtd_tasks)", async () => {
        // Spy on the firestore collection reader to confirm which collection
        // is queried for recent tasks. We already mock getFirestore — we
        // wrap `collection(...)` to record calls.
        const collectionSpy = jest.spyOn(mockFirestoreShim, "collection");

        mockAnthropicCreate.mockResolvedValueOnce(
            buildClaudeToolUseResponse("create_task", {
                task: {
                    title: "Test task",
                    priority: "medium",
                    assigneeIds: [],
                    projectId: "client_villa_a",
                },
                analysis: {
                    scopeStatus: "uncertain",
                    scopeExplanation: "Routine",
                    assigneeReasoning: "n/a",
                    confidence: { assignee: 0.5, project: 0.5, dueDate: 0.5, scope: 0.5 },
                },
            }),
        );

        const result = await generateAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                userInput: "Test input",
                projectId: "client_villa_a",
                clientDatetime: "Mon, Apr 27, 2026, 12:00 PM (EST)",
                inputMethod: "text",
            },
        });

        expect(result.success).toBe(true);

        // Verify the tasktotime collection was read for recent tasks
        // and the legacy collection was not.
        const collectionCalls = collectionSpy.mock.calls.map((c) => c[0]);
        expect(collectionCalls).toContain("tasktotime_tasks");
        expect(collectionCalls).not.toContain("gtd_tasks");

        collectionSpy.mockRestore();
    });
});

// ============================================================
// modifyAiTask — taskId mode reads from tasktotime_tasks
// ============================================================

describe("modifyAiTask (flag=ON, taskId mode)", () => {
    test("reads task snapshot from tasktotime_tasks when taskId provided", async () => {
        mockAnthropicCreate.mockResolvedValueOnce(
            buildClaudeToolUseResponse("apply_task_modification", {
                title: "Inspection rough-in (revised)",
                description: "Refreshed description",
            }),
        );

        const result = await modifyAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                taskId: "tt_task_1",
                userCommand: "Rename the task",
            },
        });

        expect(result.status).toBe("success");
        expect(result.data.title).toBe("Inspection rough-in (revised)");

        // Inspect the prompt sent to Claude — should contain the snapshot
        // we loaded (title 'Inspection rough-in', est duration 120).
        const claudeCallArg = mockAnthropicCreate.mock.calls[0][0];
        const userMsg = claudeCallArg.messages[0].content;
        expect(userMsg).toContain("Inspection rough-in");
        expect(userMsg).toContain("\"estimatedDurationMinutes\":120");
    });

    test("cross-tenant taskId returns 404 (not 403) — does not leak existence", async () => {
        // Caller A tries to read tenant B's task.
        await expect(
            modifyAiTask({
                auth: { uid: CALLER_UID_A },
                data: {
                    taskId: "tt_task_b", // belongs to TENANT_B
                    userCommand: "Try to peek",
                },
            }),
        ).rejects.toMatchObject({ code: "not-found" });

        // Claude was never called — the guard fires before any AI call.
        expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    test("inline currentTask still works (backwards compat with frontend)", async () => {
        mockAnthropicCreate.mockResolvedValueOnce(
            buildClaudeToolUseResponse("apply_task_modification", {
                title: "Updated inline task",
            }),
        );

        const result = await modifyAiTask({
            auth: { uid: CALLER_UID_A },
            data: {
                currentTask: {
                    title: "Inline snapshot",
                    description: "From frontend",
                    estimatedDurationMinutes: 90,
                    checklistItems: [],
                },
                userCommand: "Rename it",
            },
        });

        expect(result.status).toBe("success");
        expect(result.data.title).toBe("Updated inline task");
    });

    test("missing taskId AND currentTask → invalid-argument", async () => {
        await expect(
            modifyAiTask({
                auth: { uid: CALLER_UID_A },
                data: { userCommand: "Do something" },
            }),
        ).rejects.toMatchObject({ code: "invalid-argument" });
    });

    test("auth missing → unauthenticated", async () => {
        await expect(
            modifyAiTask({
                auth: null,
                data: { taskId: "tt_task_1", userCommand: "Try" },
            }),
        ).rejects.toThrow("authenticated");
    });
});
