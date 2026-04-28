/**
 * AI Task Decomposition — Phase 5.1
 *
 * Two callables for the "explode a complex task into subtasks" flow:
 *
 *   decomposeAiTask({ taskId })            → preview only (no writes)
 *   confirmAiDecomposition({ parentTaskId, subtasks, auditLogId })
 *                                          → atomically creates subtasks
 *
 * Mirrors the generate / confirm two-phase pattern of generateAiTask: the
 * preview returns proposed subtasks for the operator to edit before any
 * Firestore write happens. Confirm uses the canonical
 * `createTaskHandler` so the same idempotency / trigger fan-out / domain
 * validation rules apply as for any other task creation path.
 *
 * Scope (intentionally tight for v1):
 *   - One level of subtasks (no recursive decomposition).
 *   - No dependency graph — subtasks land independent. The user can wire
 *     `dependsOn` in the dependency-graph view afterwards.
 *   - No estimate-item linkage — only operates on a single existing task.
 *     The richer `decomposeEstimate(estimateId)` flow lives in spec/07-ai/
 *     and stays out of this PR.
 *
 * Related:
 *   - tasktotime/spec/07-ai/decompose-estimate.md (richer flow, future)
 *   - tasktotime/ports/ai/AIAuditPort.ts ('decompose_task' flow added here)
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ANTHROPIC_API_KEY } from "../../config";
import { getTasktotimeServices } from "../../tasktotime/composition";

// ============================================================
// 1. ZOD SCHEMAS
// ============================================================

/**
 * Wire-format priority — kept aligned with the rest of the AI surface
 * (`generateAiTask` / `confirmAiTask` use the same vocabulary). The
 * `confirmAiDecomposition` handler maps `'urgent' → 'critical'` and
 * `'none' → 'low'` to land on the tasktotime domain enum.
 */
const PrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

const ProposedSubtaskSchema = z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional().default(""),
    estimatedDurationMinutes: z.number().int().min(5).max(60 * 24 * 7),
    priority: PrioritySchema,
    /** Optional human-readable justification — surfaced in UI as a hint. */
    rationale: z.string().max(500).optional(),
});

const DecompositionResponseSchema = z.object({
    subtasks: z.array(ProposedSubtaskSchema).min(1).max(20),
    /** Free-form explanation of how the parent was split. */
    summary: z.string().max(2000),
});

type DecompositionResponse = z.infer<typeof DecompositionResponseSchema>;
export type ProposedSubtask = z.infer<typeof ProposedSubtaskSchema>;

// Confirm input — the operator may have edited subtasks in the dialog
// before clicking apply, so we re-validate the full payload server-side.
const ConfirmInputSchema = z.object({
    parentTaskId: z.string().min(1),
    auditLogId: z.string().optional(),
    subtasks: z
        .array(
            z.object({
                title: z.string().min(1).max(500),
                description: z.string().max(5000).optional().default(""),
                estimatedDurationMinutes: z.number().int().min(5).max(60 * 24 * 7),
                priority: z
                    .enum(["low", "medium", "high", "urgent", "none"])
                    .optional()
                    .default("medium"),
            }),
        )
        .min(1)
        .max(20),
});

// ============================================================
// 2. ANTHROPIC CLIENT (lazy — secrets only available at invoke time)
// ============================================================

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
    if (!_anthropic) {
        _anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    }
    return _anthropic;
}

const TOOL_DEFINITION: Anthropic.Tool = {
    name: "decompose_task",
    description:
        "Explode a single project task into 3-12 actionable subtasks. " +
        "Each subtask must be small enough that one worker can finish it in " +
        "one work session (15 min – 8 hours).",
    input_schema: {
        type: "object" as const,
        properties: {
            subtasks: {
                type: "array",
                description: "Ordered list of subtasks (rough execution order)",
                items: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description:
                                "Concise imperative title (e.g. 'Demo old tile floor')",
                        },
                        description: {
                            type: "string",
                            description:
                                "1-3 sentences with concrete steps or gotchas",
                        },
                        estimatedDurationMinutes: {
                            type: "number",
                            description:
                                "Realistic duration in minutes; 15..480 typical",
                        },
                        priority: {
                            type: "string",
                            enum: ["low", "medium", "high", "urgent"],
                        },
                        rationale: {
                            type: "string",
                            description:
                                "Optional: why this subtask is needed / what it produces",
                        },
                    },
                    required: [
                        "title",
                        "estimatedDurationMinutes",
                        "priority",
                    ],
                },
            },
            summary: {
                type: "string",
                description:
                    "1-2 sentence summary of how the parent task was split.",
            },
        },
        required: ["subtasks", "summary"],
    },
};

// ============================================================
// 3. PROMPT
// ============================================================

interface ParentTaskSnapshot {
    title: string;
    description: string;
    estimatedDurationMinutes: number;
    priority: string;
    category?: string;
    phase?: string;
    clientName?: string;
    projectName?: string;
}

function buildSystemPrompt(parent: ParentTaskSnapshot): string {
    // Sanitize free-form fields to defuse prompt injection from task content.
    const clean = (s: unknown, max = 500): string => {
        if (typeof s !== "string") return "";
        return s
            .replace(/[\x00-\x1F\x7F]/g, "")
            .replace(/\s{3,}/g, " ")
            .slice(0, max);
    };

    return `You are a construction project planner for an electrical/general contractor in South Florida. The team speaks English and Russian.

Your job: take ONE existing project task and split it into a list of smaller, actionable subtasks the field crew can execute one-by-one. The parent task already exists — you are NOT creating it; you are decomposing it.

RULES:
1. Output 3 to 12 subtasks. Fewer is OK if the parent is small.
2. Each subtask must be doable by one worker in one session (15 min – 8 hours, typically 30 min – 4 hours).
3. Order matters — list subtasks in rough execution order (demo → rough-in → finish → cleanup).
4. The combined subtask duration should approximate the parent's duration (within ±50%). If parent's duration is unset/zero, use industry-typical numbers.
5. Subtask priority defaults to the parent's priority unless a step is clearly more or less urgent (e.g. inspection blocking > other steps).
6. ALWAYS write subtask titles and descriptions in PROFESSIONAL ENGLISH, even if the parent is in Russian.
7. Each title is imperative and concrete: "Demo bathroom tile floor", not "Tile work".
8. Avoid placeholder fluff like "Plan the work" — every subtask must produce something physical or a decision.
9. If the parent is genuinely atomic (e.g. "Replace one outlet"), return a single subtask that mirrors it — do NOT pad with bureaucracy.

PARENT TASK:
Title: ${clean(parent.title, 200)}
Description: ${clean(parent.description, 2000)}
Estimated duration: ${parent.estimatedDurationMinutes} minutes
Priority: ${clean(parent.priority, 50)}
${parent.category ? `Category: ${clean(parent.category, 50)}\n` : ""}${parent.phase ? `Phase: ${clean(parent.phase, 50)}\n` : ""}${parent.clientName ? `Client: ${clean(parent.clientName, 100)}\n` : ""}${parent.projectName ? `Project: ${clean(parent.projectName, 200)}\n` : ""}
Now call the \`decompose_task\` tool with the subtask list and a short summary.`;
}

// ============================================================
// 4. CLAUDE CALL
// ============================================================

async function callClaude(
    parent: ParentTaskSnapshot,
): Promise<{ parsed: DecompositionResponse; latencyMs: number; tokensIn: number; tokensOut: number }> {
    const systemPrompt = buildSystemPrompt(parent);
    const startTime = Date.now();
    const MAX_RETRIES = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                await new Promise((r) => setTimeout(r, 2000 * attempt));
                console.log(`Claude decompose retry attempt ${attempt}…`);
            }

            const response = await getAnthropic().messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 2500,
                system: systemPrompt,
                tools: [TOOL_DEFINITION],
                tool_choice: { type: "tool", name: "decompose_task" },
                messages: [
                    {
                        role: "user",
                        content: `Decompose the parent task above into subtasks.`,
                    },
                ],
            });

            const latencyMs = Date.now() - startTime;
            const toolBlock = response.content.find((b) => b.type === "tool_use");
            if (!toolBlock || toolBlock.type !== "tool_use") {
                throw new Error("Claude did not return a tool_use block");
            }

            const parsed = DecompositionResponseSchema.parse(toolBlock.input);
            return {
                parsed,
                latencyMs,
                tokensIn: response.usage.input_tokens,
                tokensOut: response.usage.output_tokens,
            };
        } catch (err: any) {
            lastError = err;
            const isRetryable =
                err?.status === 529 ||
                err?.status === 500 ||
                err?.code === "ECONNRESET" ||
                err?.code === "ETIMEDOUT";
            if (!isRetryable || attempt >= MAX_RETRIES) {
                throw err;
            }
        }
    }

    throw lastError || new Error("Claude decompose call failed");
}

// ============================================================
// 5. AUDIT LOG
// ============================================================

async function writeAuditLog(params: {
    taskId: string;
    parent: ParentTaskSnapshot;
    response: DecompositionResponse;
    latencyMs: number;
    tokensIn: number;
    tokensOut: number;
    userId: string;
    companyId: string;
}): Promise<string> {
    const db = getFirestore();
    const logRef = await db.collection("aiAuditLogs").add({
        flow: "decompose_task",
        taskId: params.taskId,
        userId: params.userId,
        companyId: params.companyId,
        parent: params.parent,
        response: params.response,
        latencyMs: params.latencyMs,
        tokensIn: params.tokensIn,
        tokensOut: params.tokensOut,
        timestamp: FieldValue.serverTimestamp(),
        modelUsed: "claude-sonnet-4-20250514",
        userEdits: [],
        wasAccepted: null,
    });
    return logRef.id;
}

// ============================================================
// 6. PARENT LOOKUP — RLS-safe
// ============================================================

interface CallerScope {
    uid: string;
    companyId: string;
    displayName: string;
}

async function resolveCaller(uid: string): Promise<CallerScope> {
    const db = getFirestore();
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) {
        throw new HttpsError(
            "failed-precondition",
            `User profile for uid=${uid} not found`,
        );
    }
    const data = userDoc.data() ?? {};
    const companyId = data.companyId;
    if (typeof companyId !== "string" || companyId.length === 0) {
        throw new HttpsError(
            "failed-precondition",
            `User ${uid} has no companyId — decomposition requires tenant scope`,
        );
    }
    const displayName = data.displayName ?? data.name ?? data.email ?? uid;
    return { uid, companyId, displayName };
}

async function loadParent(
    taskId: string,
    companyId: string,
): Promise<ParentTaskSnapshot & { exists: true } | { exists: false }> {
    const db = getFirestore();
    const doc = await db.doc(`tasktotime_tasks/${taskId}`).get();
    if (!doc.exists) return { exists: false };
    const data = doc.data() ?? {};
    if (data.companyId !== companyId) {
        // Cross-tenant read — surface as not-found rather than leaking
        // existence of another tenant's task.
        return { exists: false };
    }
    return {
        exists: true,
        title: typeof data.title === "string" ? data.title : "",
        description:
            typeof data.description === "string" ? data.description : "",
        estimatedDurationMinutes:
            typeof data.estimatedDurationMinutes === "number" &&
            Number.isFinite(data.estimatedDurationMinutes)
                ? data.estimatedDurationMinutes
                : 0,
        priority: typeof data.priority === "string" ? data.priority : "medium",
        category: typeof data.category === "string" ? data.category : undefined,
        phase: typeof data.phase === "string" ? data.phase : undefined,
        clientName:
            typeof data.clientName === "string" ? data.clientName : undefined,
        projectName:
            typeof data.projectName === "string" ? data.projectName : undefined,
    };
}

// ============================================================
// 7. CALLABLE: decomposeAiTask (preview only)
// ============================================================

export const decomposeAiTask = onCall(
    {
        region: "us-east1",
        minInstances: 0,
        timeoutSeconds: 30,
        memory: "512MiB",
        secrets: [ANTHROPIC_API_KEY],
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be logged in");
        }
        const caller = await resolveCaller(request.auth.uid);

        const taskId = request.data?.taskId;
        if (typeof taskId !== "string" || taskId.length === 0) {
            throw new HttpsError("invalid-argument", "taskId is required");
        }

        const parent = await loadParent(taskId, caller.companyId);
        if (!parent.exists) {
            throw new HttpsError(
                "not-found",
                `Task ${taskId} not found for this tenant`,
            );
        }

        try {
            const { parsed, latencyMs, tokensIn, tokensOut } = await callClaude({
                title: parent.title,
                description: parent.description,
                estimatedDurationMinutes: parent.estimatedDurationMinutes,
                priority: parent.priority,
                category: parent.category,
                phase: parent.phase,
                clientName: parent.clientName,
                projectName: parent.projectName,
            });

            const auditLogId = await writeAuditLog({
                taskId,
                parent: {
                    title: parent.title,
                    description: parent.description,
                    estimatedDurationMinutes: parent.estimatedDurationMinutes,
                    priority: parent.priority,
                    category: parent.category,
                    phase: parent.phase,
                    clientName: parent.clientName,
                    projectName: parent.projectName,
                },
                response: parsed,
                latencyMs,
                tokensIn,
                tokensOut,
                userId: caller.uid,
                companyId: caller.companyId,
            });

            return {
                success: true,
                parentTaskId: taskId,
                parentTitle: parent.title,
                proposedSubtasks: parsed.subtasks,
                summary: parsed.summary,
                auditLogId,
                latencyMs,
            };
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                console.error("decomposeAiTask Zod validation failed:", error.issues);
                return {
                    success: false,
                    error: "AI response validation failed",
                    zodErrors: error.issues,
                    fallbackToManual: true,
                };
            }
            console.error("decomposeAiTask error:", error);
            throw new HttpsError(
                "internal",
                error?.message || "AI decomposition failed",
            );
        }
    },
);

// ============================================================
// 8. CALLABLE: confirmAiDecomposition (apply)
// ============================================================

/**
 * Map AI priority vocabulary to tasktotime domain priority. Same mapping
 * used by `confirmAiTask` (urgent → critical, none → low).
 */
function mapPriority(
    p: "low" | "medium" | "high" | "urgent" | "none",
): "low" | "medium" | "high" | "critical" {
    if (p === "urgent") return "critical";
    if (p === "high") return "high";
    if (p === "low" || p === "none") return "low";
    return "medium";
}

export const confirmAiDecomposition = onCall(
    {
        region: "us-east1",
        minInstances: 0,
        timeoutSeconds: 60,
        memory: "256MiB",
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be logged in");
        }

        const parsed = ConfirmInputSchema.safeParse(request.data);
        if (!parsed.success) {
            throw new HttpsError(
                "invalid-argument",
                `Invalid payload: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
            );
        }
        const { parentTaskId, subtasks, auditLogId } = parsed.data;

        const caller = await resolveCaller(request.auth.uid);

        // Verify parent exists + tenant ownership BEFORE creating subtasks.
        // Otherwise an attacker who guesses a foreign task id could spawn
        // subtasks against it, even though the writes themselves would carry
        // the attacker's companyId.
        const parent = await loadParent(parentTaskId, caller.companyId);
        if (!parent.exists) {
            throw new HttpsError(
                "not-found",
                `Parent task ${parentTaskId} not found for this tenant`,
            );
        }

        // Inherit linkage from parent so subtasks roll up correctly in the
        // by-project / by-client views. We re-read here (rather than trust
        // the snapshot) because loadParent strips fields it doesn't need.
        const db = getFirestore();
        const parentDocSnap = await db.doc(`tasktotime_tasks/${parentTaskId}`).get();
        const parentData = parentDocSnap.data() ?? {};
        const parentClientId =
            typeof parentData.clientId === "string" ? parentData.clientId : undefined;
        const parentClientName =
            typeof parentData.clientName === "string"
                ? parentData.clientName
                : undefined;
        const parentProjectId =
            typeof parentData.projectId === "string" ? parentData.projectId : undefined;
        const parentProjectName =
            typeof parentData.projectName === "string"
                ? parentData.projectName
                : undefined;
        const parentBucket =
            typeof parentData.bucket === "string" ? parentData.bucket : "next";
        const parentDueAt =
            typeof parentData.dueAt === "number" && Number.isFinite(parentData.dueAt)
                ? parentData.dueAt
                : Date.now() + 7 * 24 * 60 * 60 * 1000;
        const parentAssignedTo =
            parentData.assignedTo &&
            typeof parentData.assignedTo === "object" &&
            typeof (parentData.assignedTo as any).id === "string" &&
            typeof (parentData.assignedTo as any).name === "string"
                ? {
                      id: (parentData.assignedTo as any).id as string,
                      name: (parentData.assignedTo as any).name as string,
                  }
                : { id: caller.uid, name: caller.displayName };

        const services = getTasktotimeServices();
        const createdTaskIds: string[] = [];
        const by = { id: caller.uid, name: caller.displayName };

        for (let i = 0; i < subtasks.length; i++) {
            const sub = subtasks[i];
            // Idempotency key — derived from auditLogId+index when present so
            // a retry after partial failure resumes cleanly. If the auditLog
            // was lost, fall back to a parent+index+timestamp synthetic key
            // (still deterministic across retries within the same minute).
            const idempotencyKey = auditLogId
                ? `confirmAiDecomposition:${auditLogId}:${i}`
                : `confirmAiDecomposition:${parentTaskId}:${i}:${Math.floor(
                      Date.now() / 60000,
                  )}`;

            const created = await services.createTaskHandler.execute({
                idempotencyKey,
                initialLifecycle: "ready",
                by,
                companyId: caller.companyId,
                title: sub.title,
                description: sub.description || undefined,
                dueAt: parentDueAt,
                estimatedDurationMinutes: sub.estimatedDurationMinutes,
                bucket: parentBucket as any,
                priority: mapPriority(sub.priority),
                source: "ai",
                assignedTo: parentAssignedTo,
                requiredHeadcount: 1,
                costInternal: { amount: 0, currency: "USD" },
                priceClient: { amount: 0, currency: "USD" },
                clientId: parentClientId,
                clientName: parentClientName,
                projectId: parentProjectId,
                projectName: parentProjectName,
                parentTaskId,
            });

            createdTaskIds.push(created.id);
        }

        // Audit log accept update — only mutate logs the caller owns.
        if (auditLogId) {
            const auditDoc = await db.doc(`aiAuditLogs/${auditLogId}`).get();
            if (auditDoc.exists && auditDoc.data()?.userId === caller.uid) {
                await db.doc(`aiAuditLogs/${auditLogId}`).update({
                    wasAccepted: true,
                    confirmedSubtaskIds: createdTaskIds,
                    confirmedCollection: "tasktotime_tasks",
                });
            }
        }

        return {
            success: true,
            parentTaskId,
            createdTaskIds,
        };
    },
);
