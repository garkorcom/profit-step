/**
 * @fileoverview decomposeAiTask.test.ts
 *
 * Coverage for the Phase 5.1 AI Task Decomposition callables:
 *
 *   1. decomposeAiTask returns proposed subtasks (preview only — no writes)
 *      and writes an aiAuditLogs entry with flow='decompose_task'.
 *   2. decomposeAiTask denies cross-tenant reads (returns not-found rather
 *      than leaking the existence of another tenant's task).
 *   3. decomposeAiTask requires companyId on the caller's profile.
 *   4. decomposeAiTask Zod-failure path returns { success: false,
 *      fallbackToManual: true } instead of throwing.
 *   5. confirmAiDecomposition fans out N createTaskHandler.execute calls,
 *      each with parentTaskId, inherits parent linkage (clientId, projectId,
 *      assignedTo), and sets initialLifecycle='ready' / source='ai'.
 *   6. confirmAiDecomposition maps priority vocabulary
 *      ('urgent' → 'critical', 'none' → 'low').
 *   7. confirmAiDecomposition denies cross-tenant parent access.
 *
 * Mocking strategy mirrors aiCallablesTasktotime.test.ts: in-memory
 * Firestore shim, mocked Anthropic SDK, stubbed createTaskHandler.
 */

const TENANT_A = "company_acme";
const TENANT_B = "company_villains";
const CALLER_UID_A = "uid_caller_a";
const CALLER_UID_B = "uid_caller_b";

const mockUsers: Record<
    string,
    { companyId?: string; displayName?: string; email?: string }
> = {
    [CALLER_UID_A]: { companyId: TENANT_A, displayName: "Alice PM" },
    [CALLER_UID_B]: { companyId: TENANT_B, displayName: "Bob PM" },
    uid_no_company: { displayName: "Orphan User" },
};

const mockTasktotimeTasks: Record<string, any> = {
    parent_in_a: {
        companyId: TENANT_A,
        title: "Bathroom remodel — guest wing",
        description: "Demo, plumb, drywall, tile, fixtures.",
        estimatedDurationMinutes: 1800,
        priority: "high",
        bucket: "next",
        clientId: "client_villa_a",
        clientName: "Villa Alpha",
        projectId: "project_42",
        projectName: "Villa Renovation 2026",
        assignedTo: { id: "uid_worker_a", name: "Worker Alpha" },
        dueAt: 1735689600000,
    },
    parent_in_b: {
        companyId: TENANT_B,
        title: "Cross-tenant parent",
        description: "",
        estimatedDurationMinutes: 60,
        priority: "low",
        bucket: "next",
    },
};

const capturedAuditLogAdds: any[] = [];
const capturedAuditLogUpdates: any[] = [];
const mockAuditLogs: Record<string, any> = {};
const capturedCreateTaskCommands: any[] = [];
const mockCreateTaskExecute = jest.fn();

// ── Firestore shim ───────────────────────────────────────────

const mockFirestoreShim = {
    doc: (path: string) => ({
        get: jest.fn().mockImplementation(async () => {
            if (path.startsWith("users/")) {
                const uid = path.slice("users/".length);
                const u = mockUsers[uid];
                return { exists: !!u, data: () => u ?? {} };
            }
            if (path.startsWith("tasktotime_tasks/")) {
                const id = path.slice("tasktotime_tasks/".length);
                const t = mockTasktotimeTasks[id];
                return { exists: !!t, data: () => t };
            }
            if (path.startsWith("aiAuditLogs/")) {
                const id = path.slice("aiAuditLogs/".length);
                const log = mockAuditLogs[id];
                return { exists: !!log, data: () => log };
            }
            return { exists: false, data: () => ({}) };
        }),
        update: jest.fn().mockImplementation(async (data: any) => {
            capturedAuditLogUpdates.push({ path, data });
            if (path.startsWith("aiAuditLogs/")) {
                const id = path.slice("aiAuditLogs/".length);
                if (mockAuditLogs[id]) {
                    mockAuditLogs[id] = { ...mockAuditLogs[id], ...data };
                }
            }
        }),
    }),
    collection: (name: string) => {
        if (name === "aiAuditLogs") {
            return {
                add: jest.fn().mockImplementation(async (data: any) => {
                    const id = `audit_${Object.keys(mockAuditLogs).length + 1}`;
                    mockAuditLogs[id] = { ...data, _id: id };
                    capturedAuditLogAdds.push({ id, data });
                    return { id };
                }),
            };
        }
        // Decompose flow doesn't use other collections; return a stub query.
        return {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest
                .fn()
                .mockImplementation(async () => ({ docs: [], empty: true })),
        };
    },
};

jest.mock("firebase-admin/firestore", () => ({
    getFirestore: () => mockFirestoreShim,
    FieldValue: {
        serverTimestamp: () => new Date("2026-04-27T12:00:00Z"),
    },
}));

// ── functions/v2/https mock — expose raw handler ─────────────

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

// ── Anthropic SDK mock ───────────────────────────────────────

const mockAnthropicCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
    const MockAnthropic = jest.fn().mockImplementation(() => ({
        messages: { create: mockAnthropicCreate },
    }));
    return { __esModule: true, default: MockAnthropic };
});

jest.mock("../src/config", () => ({
    ...jest.requireActual("../src/config"),
    ANTHROPIC_API_KEY: { value: () => "test-key" },
}));

// ── Tasktotime composition mock ──────────────────────────────

jest.mock("../src/tasktotime/composition", () => ({
    getTasktotimeServices: () => ({
        createTaskHandler: { execute: mockCreateTaskExecute },
    }),
}));

// ── Helpers ──────────────────────────────────────────────────

function buildClaudeToolUseResponse(input: Record<string, unknown>) {
    return {
        content: [
            {
                type: "tool_use" as const,
                id: "toolu_test",
                name: "decompose_task",
                input,
            },
        ],
        model: "claude-sonnet-4-20250514",
        role: "assistant" as const,
        stop_reason: "tool_use" as const,
        usage: { input_tokens: 80, output_tokens: 220 },
    };
}

function makeFakeCreatedTask(id: string, companyId: string, parentTaskId?: string) {
    return {
        id,
        companyId,
        title: `Created ${id}`,
        lifecycle: "ready" as const,
        parentTaskId,
        isSubtask: !!parentTaskId,
    };
}

// ── Lazy require ─────────────────────────────────────────────

let decomposeAiTask: (req: any) => Promise<any>;
let confirmAiDecomposition: (req: any) => Promise<any>;

beforeAll(() => {
    const mod = require("../src/callable/ai/decomposeAiTask");
    decomposeAiTask = mod.decomposeAiTask;
    confirmAiDecomposition = mod.confirmAiDecomposition;
});

beforeEach(() => {
    capturedAuditLogAdds.length = 0;
    capturedAuditLogUpdates.length = 0;
    capturedCreateTaskCommands.length = 0;
    Object.keys(mockAuditLogs).forEach((k) => delete mockAuditLogs[k]);
    mockAnthropicCreate.mockReset();
    mockCreateTaskExecute.mockReset();
    mockCreateTaskExecute.mockImplementation(async (cmd: any) => {
        capturedCreateTaskCommands.push(cmd);
        return makeFakeCreatedTask(
            `tt_sub_${capturedCreateTaskCommands.length}`,
            cmd.companyId,
            cmd.parentTaskId,
        );
    });
});

// ============================================================
// decomposeAiTask
// ============================================================

describe("decomposeAiTask", () => {
    test("returns proposed subtasks and writes aiAuditLogs entry", async () => {
        mockAnthropicCreate.mockResolvedValueOnce(
            buildClaudeToolUseResponse({
                subtasks: [
                    {
                        title: "Demo old tile",
                        description: "Strip floor + walls.",
                        estimatedDurationMinutes: 240,
                        priority: "high",
                    },
                    {
                        title: "Plumbing rough",
                        estimatedDurationMinutes: 360,
                        priority: "high",
                    },
                    {
                        title: "Drywall",
                        estimatedDurationMinutes: 300,
                        priority: "medium",
                    },
                ],
                summary: "Three-phase remodel: demo, rough, finish",
            }),
        );

        const result = await decomposeAiTask({
            auth: { uid: CALLER_UID_A },
            data: { taskId: "parent_in_a" },
        });

        expect(result.success).toBe(true);
        expect(result.parentTaskId).toBe("parent_in_a");
        expect(result.parentTitle).toBe("Bathroom remodel — guest wing");
        expect(result.proposedSubtasks).toHaveLength(3);
        expect(result.proposedSubtasks[0]).toMatchObject({
            title: "Demo old tile",
            estimatedDurationMinutes: 240,
            priority: "high",
        });
        expect(result.summary).toContain("remodel");
        expect(result.auditLogId).toMatch(/^audit_/);

        // No subtasks created in the preview phase.
        expect(capturedCreateTaskCommands).toHaveLength(0);

        // Audit log persisted with correct flow + tenant.
        expect(capturedAuditLogAdds).toHaveLength(1);
        const audit = capturedAuditLogAdds[0].data;
        expect(audit.flow).toBe("decompose_task");
        expect(audit.taskId).toBe("parent_in_a");
        expect(audit.companyId).toBe(TENANT_A);
        expect(audit.userId).toBe(CALLER_UID_A);
        expect(audit.tokensIn).toBe(80);
        expect(audit.tokensOut).toBe(220);
        expect(audit.wasAccepted).toBeNull();
    });

    test("cross-tenant access returns not-found (no leakage)", async () => {
        await expect(
            decomposeAiTask({
                auth: { uid: CALLER_UID_A }, // Tenant A
                data: { taskId: "parent_in_b" }, // Tenant B's task
            }),
        ).rejects.toMatchObject({ code: "not-found" });

        // Anthropic was never called — we short-circuit at the lookup.
        expect(mockAnthropicCreate).not.toHaveBeenCalled();
        expect(capturedAuditLogAdds).toHaveLength(0);
    });

    test("user without companyId → failed-precondition", async () => {
        await expect(
            decomposeAiTask({
                auth: { uid: "uid_no_company" },
                data: { taskId: "parent_in_a" },
            }),
        ).rejects.toMatchObject({ code: "failed-precondition" });

        expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    test("missing taskId → invalid-argument", async () => {
        await expect(
            decomposeAiTask({
                auth: { uid: CALLER_UID_A },
                data: {},
            }),
        ).rejects.toMatchObject({ code: "invalid-argument" });
    });

    test("auth missing → unauthenticated", async () => {
        await expect(
            decomposeAiTask({
                auth: null,
                data: { taskId: "parent_in_a" },
            }),
        ).rejects.toThrow("Must be logged in");
    });

    test("AI returns invalid shape → fallbackToManual response", async () => {
        // Subtask with negative duration → Zod min(5) trips.
        mockAnthropicCreate.mockResolvedValueOnce(
            buildClaudeToolUseResponse({
                subtasks: [
                    {
                        title: "Bad subtask",
                        estimatedDurationMinutes: -5,
                        priority: "high",
                    },
                ],
                summary: "broken",
            }),
        );

        const result = await decomposeAiTask({
            auth: { uid: CALLER_UID_A },
            data: { taskId: "parent_in_a" },
        });

        expect(result.success).toBe(false);
        expect(result.fallbackToManual).toBe(true);
        expect(Array.isArray(result.zodErrors)).toBe(true);
        // Audit log NOT written in the fallback path — we only persist
        // successful decompositions.
        expect(capturedAuditLogAdds).toHaveLength(0);
    });
});

// ============================================================
// confirmAiDecomposition
// ============================================================

describe("confirmAiDecomposition", () => {
    test("creates N subtasks via createTaskHandler with parentTaskId + parent linkage", async () => {
        mockAuditLogs["audit_99"] = { userId: CALLER_UID_A, flow: "decompose_task" };

        const result = await confirmAiDecomposition({
            auth: { uid: CALLER_UID_A },
            data: {
                parentTaskId: "parent_in_a",
                auditLogId: "audit_99",
                subtasks: [
                    {
                        title: "Demo",
                        description: "Strip floor",
                        estimatedDurationMinutes: 240,
                        priority: "high",
                    },
                    {
                        title: "Plumbing",
                        estimatedDurationMinutes: 360,
                        priority: "high",
                    },
                ],
            },
        });

        expect(result).toEqual({
            success: true,
            parentTaskId: "parent_in_a",
            createdTaskIds: ["tt_sub_1", "tt_sub_2"],
        });

        expect(capturedCreateTaskCommands).toHaveLength(2);

        const cmd0 = capturedCreateTaskCommands[0];
        expect(cmd0.parentTaskId).toBe("parent_in_a");
        expect(cmd0.companyId).toBe(TENANT_A);
        expect(cmd0.initialLifecycle).toBe("ready");
        expect(cmd0.source).toBe("ai");
        expect(cmd0.title).toBe("Demo");
        expect(cmd0.description).toBe("Strip floor");
        expect(cmd0.estimatedDurationMinutes).toBe(240);
        expect(cmd0.priority).toBe("high");
        // Linkage inherited from parent.
        expect(cmd0.clientId).toBe("client_villa_a");
        expect(cmd0.clientName).toBe("Villa Alpha");
        expect(cmd0.projectId).toBe("project_42");
        expect(cmd0.projectName).toBe("Villa Renovation 2026");
        expect(cmd0.assignedTo).toEqual({
            id: "uid_worker_a",
            name: "Worker Alpha",
        });
        expect(cmd0.dueAt).toBe(1735689600000);
        expect(cmd0.bucket).toBe("next");
        // Idempotency key derives from auditLogId + index.
        expect(cmd0.idempotencyKey).toBe("confirmAiDecomposition:audit_99:0");

        const cmd1 = capturedCreateTaskCommands[1];
        expect(cmd1.parentTaskId).toBe("parent_in_a");
        expect(cmd1.title).toBe("Plumbing");
        expect(cmd1.idempotencyKey).toBe("confirmAiDecomposition:audit_99:1");

        // Audit log marked accepted with subtask ids.
        const auditUpdate = capturedAuditLogUpdates.find(
            (u) => u.path === "aiAuditLogs/audit_99",
        );
        expect(auditUpdate?.data.wasAccepted).toBe(true);
        expect(auditUpdate?.data.confirmedSubtaskIds).toEqual([
            "tt_sub_1",
            "tt_sub_2",
        ]);
        expect(auditUpdate?.data.confirmedCollection).toBe("tasktotime_tasks");
    });

    test("priority vocab mapping: urgent → critical, none → low", async () => {
        await confirmAiDecomposition({
            auth: { uid: CALLER_UID_A },
            data: {
                parentTaskId: "parent_in_a",
                subtasks: [
                    {
                        title: "Urgent step",
                        estimatedDurationMinutes: 60,
                        priority: "urgent",
                    },
                    {
                        title: "Lazy step",
                        estimatedDurationMinutes: 30,
                        priority: "none",
                    },
                ],
            },
        });

        expect(capturedCreateTaskCommands).toHaveLength(2);
        expect(capturedCreateTaskCommands[0].priority).toBe("critical");
        expect(capturedCreateTaskCommands[1].priority).toBe("low");
    });

    test("cross-tenant parent → not-found", async () => {
        await expect(
            confirmAiDecomposition({
                auth: { uid: CALLER_UID_A }, // tenant A
                data: {
                    parentTaskId: "parent_in_b", // tenant B
                    subtasks: [
                        {
                            title: "Sneaky",
                            estimatedDurationMinutes: 60,
                            priority: "low",
                        },
                    ],
                },
            }),
        ).rejects.toMatchObject({ code: "not-found" });

        expect(capturedCreateTaskCommands).toHaveLength(0);
    });

    test("user without companyId → failed-precondition", async () => {
        await expect(
            confirmAiDecomposition({
                auth: { uid: "uid_no_company" },
                data: {
                    parentTaskId: "parent_in_a",
                    subtasks: [
                        {
                            title: "x",
                            estimatedDurationMinutes: 30,
                            priority: "low",
                        },
                    ],
                },
            }),
        ).rejects.toMatchObject({ code: "failed-precondition" });

        expect(capturedCreateTaskCommands).toHaveLength(0);
    });

    test("missing parentTaskId → invalid-argument (Zod)", async () => {
        await expect(
            confirmAiDecomposition({
                auth: { uid: CALLER_UID_A },
                data: {
                    subtasks: [
                        {
                            title: "x",
                            estimatedDurationMinutes: 30,
                            priority: "low",
                        },
                    ],
                },
            }),
        ).rejects.toMatchObject({ code: "invalid-argument" });
    });

    test("empty subtasks array → invalid-argument (Zod)", async () => {
        await expect(
            confirmAiDecomposition({
                auth: { uid: CALLER_UID_A },
                data: {
                    parentTaskId: "parent_in_a",
                    subtasks: [],
                },
            }),
        ).rejects.toMatchObject({ code: "invalid-argument" });
    });

    test("audit log update is gated by userId ownership", async () => {
        // Audit log owned by a DIFFERENT user — confirm should still
        // create subtasks but skip the audit update.
        mockAuditLogs["audit_owned_by_b"] = { userId: CALLER_UID_B };

        await confirmAiDecomposition({
            auth: { uid: CALLER_UID_A },
            data: {
                parentTaskId: "parent_in_a",
                auditLogId: "audit_owned_by_b",
                subtasks: [
                    {
                        title: "x",
                        estimatedDurationMinutes: 30,
                        priority: "low",
                    },
                ],
            },
        });

        // Subtask was still created.
        expect(capturedCreateTaskCommands).toHaveLength(1);
        // But the audit log was NOT updated (silent skip).
        const auditUpdate = capturedAuditLogUpdates.find(
            (u) => u.path === "aiAuditLogs/audit_owned_by_b",
        );
        expect(auditUpdate).toBeUndefined();
    });

    test("auth missing → unauthenticated", async () => {
        await expect(
            confirmAiDecomposition({
                auth: null,
                data: {
                    parentTaskId: "parent_in_a",
                    subtasks: [
                        {
                            title: "x",
                            estimatedDurationMinutes: 30,
                            priority: "low",
                        },
                    ],
                },
            }),
        ).rejects.toThrow("Must be logged in");
    });
});
