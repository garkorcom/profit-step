import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "../../config";
import * as envModule from "../../config/env";
import { getTasktotimeServices } from "../../tasktotime/composition";
import { z } from "zod";
import {
    EstimateItem,
    ScopeCandidate,
    findScopeCandidates,
} from "./scopeMatcher";

// ============================================================
// FEATURE FLAG — tasktotime migration
// ============================================================
//
// When `TASKTOTIME_AI_CALLABLES_ENABLED` is true (default):
//   - generateAiTask reads "recent tasks" context from `tasktotime_tasks`
//   - confirmAiTask persists via `createTaskHandler` → `tasktotime_tasks`
// When false (rollback path):
//   - reads/writes target the legacy `gtd_tasks` collection
//
// We import the env module as a namespace (not a destructured const) so
// jest.mock can rebind the `TASKTOTIME_AI_CALLABLES_ENABLED` getter at
// runtime. A direct named import would be inlined by the TS compiler
// (commonjs bindings are read-only in the consumer's perspective).
function tasktotimeEnabled(): boolean {
    return envModule.TASKTOTIME_AI_CALLABLES_ENABLED;
}

// ============================================================
// 1. ZOD SCHEMAS
// ============================================================

const ChecklistItemSchema = z.object({
    title: z.string(),
    isDone: z.literal(false),
});

const TaskDraftSchema = z.object({
    title: z.string(),
    description: z.string().optional().default(""),
    assigneeIds: z.array(z.string()).optional().default([]),
    projectId: z.string().optional(),
    dueDate: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    estimatedMinutes: z.number().optional(),
    zone: z.string().optional(),
    checklist: z.array(ChecklistItemSchema).optional().default([]),
});

const AnalysisSchema = z.object({
    scopeStatus: z.enum([
        "in_estimate_pending",
        "in_estimate_completed",
        "in_change_order",
        "not_in_estimate",
        "uncertain",
    ]),
    matchedEstimateItem: z.string().optional(),
    scopeExplanation: z.string(),
    assigneeReasoning: z.string(),
    confidence: z.object({
        assignee: z.number().min(0).max(1),
        project: z.number().min(0).max(1),
        dueDate: z.number().min(0).max(1),
        scope: z.number().min(0).max(1),
    }),
    possibleDuplicate: z
        .object({
            found: z.boolean(),
            existingTaskTitle: z.string().optional(),
            suggestion: z.enum(["merge", "link", "ignore"]).optional(),
        })
        .optional(),
});

const AiTaskResponseSchema = z.object({
    task: TaskDraftSchema,
    analysis: AnalysisSchema,
});

type AiTaskResponse = z.infer<typeof AiTaskResponseSchema>;

// Schema for confirmAiTask input validation
const ConfirmInputSchema = z.object({
    taskData: z.object({
        title: z.string().min(1).max(500),
        description: z.string().max(5000).optional().default(""),
        assigneeIds: z.array(z.string()).optional().default([]),
        projectId: z.string().optional(),
        clientId: z.string().optional(),
        clientName: z.string().optional().default(""),
        ownerName: z.string().optional().default(""),
        dueDate: z.string().nullable().optional(),
        priority: z.enum(["low", "medium", "high", "urgent", "none"]).optional().default("medium"),
        taskType: z.string().optional().default("maintenance"),
        status: z.string().optional().default("next"),
        needsEstimate: z.boolean().optional().default(false),
        assigneeName: z.string().optional().default(""),
        estimatedMinutes: z.number().optional(),
        checklist: z.array(z.object({
            title: z.string().optional(),
            text: z.string().optional(),
            isDone: z.boolean().optional(),
        })).optional().default([]),
        zone: z.string().nullable().optional(),
        scopeStatus: z.string().nullable().optional(),
    }),
    auditLogId: z.string().optional(),
    userEdits: z.array(z.object({
        field: z.string(),
        aiValue: z.any(),
        userValue: z.any(),
    })).optional().default([]),
    scopeDecision: z.string().nullable().optional(),
});



// ============================================================
// 4. CONTEXT LOADER (Firestore → ContextSnapshot)
// ============================================================

interface ContextSnapshot {
    project: { id: string; name: string; brief: string; clientName: string };
    recentTasks: Array<{
        title: string;
        assigneeName: string;
        status: string;
        completionNotes?: string;
        createdAt: string;
        zone?: string;
    }>;
    estimateItems: EstimateItem[];
    activeChangeOrders: Array<{ id: string; title: string; status: string }>;
    employees: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>;
}

async function loadContextSnapshot(
    projectId: string
): Promise<ContextSnapshot> {
    const db = getFirestore();

    // Recent-tasks query: read from `tasktotime_tasks` when the migration
    // flag is on, otherwise the legacy `gtd_tasks`. Both collections share
    // the `clientId` field name so the query shape is identical; only the
    // result mapping differs (lifecycle vs status, assignedTo.name vs
    // assigneeName, createdAt as epoch ms vs Firestore Timestamp).
    const recentTasksCollection = tasktotimeEnabled()
        ? "tasktotime_tasks"
        : "gtd_tasks";

    // Parallel fetch for speed
    const [projectDoc, tasksSnap, estimatesSnap, cosSnap, employeesSnap, projectsSnap] =
        await Promise.all([
            db.doc(`clients/${projectId}`).get(),
            db
                .collection(recentTasksCollection)
                .where("clientId", "==", projectId)
                .orderBy("createdAt", "desc")
                .limit(30)
                .get(),
            db
                .collection("estimates")
                .where("projectId", "==", projectId)
                .where("status", "in", ["active", "completed"])
                .orderBy("createdAt", "desc")
                .limit(2)
                .get(),
            db
                .collection("changeOrders")
                .where("projectId", "==", projectId)
                .where("status", "==", "active")
                .get(),
            db.collection("users").where("isActive", "!=", false).get(),
            db
                .collection("clients")
                .where("isActive", "!=", false)
                .get(),
        ]);

    const proj = projectDoc.data() || {};

    // Flatten estimate items from estimate docs
    const estimateItems: EstimateItem[] = [];
    for (const doc of estimatesSnap.docs) {
        const items = doc.data().items || [];
        for (const item of items) {
            estimateItems.push({
                lineNumber: item.lineNumber || doc.id,
                description: item.description || "",
                zone: item.zone,
                division: item.division,
                status: item.status || "pending",
                amount: item.amount || 0,
                tags: item.tags || [],
            });
        }
    }

    return {
        project: {
            id: projectId,
            name: proj.name || "",
            brief: proj.brief || "",
            clientName: proj.clientName || "",
        },
        recentTasks: tasksSnap.docs.map((d) => {
            const t = d.data();
            // tasktotime stores createdAt as epoch ms (number); legacy
            // gtd_tasks stores it as a Firestore Timestamp. Handle both.
            let createdAtIso = "";
            if (typeof t.createdAt === "number" && Number.isFinite(t.createdAt)) {
                createdAtIso = new Date(t.createdAt).toISOString();
            } else if (t.createdAt?.toDate?.()) {
                createdAtIso = t.createdAt.toDate().toISOString();
            }
            return {
                title: t.title,
                // tasktotime: assignedTo: { id, name } — denormalised display
                // legacy: assigneeName field
                assigneeName:
                    t.assignedTo?.name ?? t.assigneeName ?? "",
                // tasktotime: lifecycle vocabulary; legacy: status vocabulary
                // The AI prompt accepts either as opaque strings.
                status: t.lifecycle ?? t.status ?? "",
                // tasktotime drops `completionNotes`; gtd_tasks has it.
                completionNotes: t.completionNotes,
                createdAt: createdAtIso,
                // tasktotime drops `zone`; gtd_tasks has it.
                zone: t.zone,
            };
        }),
        estimateItems,
        activeChangeOrders: cosSnap.docs.map((d) => ({
            id: d.id,
            title: d.data().title || "",
            status: d.data().status || "",
        })),
        employees: employeesSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().displayName || d.data().name || d.data().email || "",
        })),
        projects: projectsSnap.docs.map((d) => ({
            id: d.id,
            name: d.data().name || "",
        })),
    };
}

// ============================================================
// 5. CLAUDE API CALL (Tool Use — guaranteed structured output)
// ============================================================

// Lazy-init Anthropic client — secrets are only available at invocation time in GCF v2
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
    if (!_anthropic) {
        _anthropic = new Anthropic({
            apiKey: ANTHROPIC_API_KEY.value(),
        });
    }
    return _anthropic;
}

// Convert Zod schema to JSON Schema for Claude Tool definition
const TOOL_DEFINITION: Anthropic.Tool = {
    name: "create_task",
    description:
        "Create a structured task from the user's voice/text input with full scope analysis against the project estimate.",
    input_schema: {
        type: "object" as const,
        properties: {
            task: {
                type: "object",
                properties: {
                    title: { type: "string", description: "Clear, concise task title" },
                    description: { type: "string", description: "Task details" },
                    assigneeIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "User IDs matched from employee list",
                    },
                    projectId: { type: "string" },
                    dueDate: { type: "string", description: "ISO 8601 datetime" },
                    priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                    estimatedMinutes: { type: "number" },
                    zone: { type: "string", description: "Area: Kitchen, Garage, etc." },
                    checklist: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                isDone: { type: "boolean", enum: [false] },
                            },
                            required: ["title", "isDone"],
                        },
                    },
                },
                required: ["title", "priority"],
            },
            analysis: {
                type: "object",
                properties: {
                    scopeStatus: {
                        type: "string",
                        enum: [
                            "in_estimate_pending",
                            "in_estimate_completed",
                            "in_change_order",
                            "not_in_estimate",
                            "uncertain",
                        ],
                    },
                    matchedEstimateItem: { type: "string" },
                    scopeExplanation: { type: "string" },
                    assigneeReasoning: { type: "string" },
                    confidence: {
                        type: "object",
                        properties: {
                            assignee: { type: "number" },
                            project: { type: "number" },
                            dueDate: { type: "number" },
                            scope: { type: "number" },
                        },
                        required: ["assignee", "project", "dueDate", "scope"],
                    },
                    possibleDuplicate: {
                        type: "object",
                        properties: {
                            found: { type: "boolean" },
                            existingTaskTitle: { type: "string" },
                            suggestion: { type: "string", enum: ["merge", "link", "ignore"] },
                        },
                    },
                },
                required: [
                    "scopeStatus",
                    "scopeExplanation",
                    "assigneeReasoning",
                    "confidence",
                ],
            },
        },
        required: ["task", "analysis"],
    },
};

function buildSystemPrompt(
    context: ContextSnapshot,
    scopeCandidates: ScopeCandidate[],
    clientDatetime: string
): string {
    // Sanitize context data to prevent prompt injection
    const sanitize = (obj: any, maxLen = 8000): string => {
        const raw = JSON.stringify(obj);
        // Strip control characters and excessive whitespace
        const clean = raw.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s{3,}/g, " ");
        return clean.length > maxLen ? clean.slice(0, maxLen) + "...truncated" : clean;
    };

    return `You are a construction project management assistant for Garkor, an electrical contracting company in South Florida. The team speaks English and Russian.

CURRENT SYSTEM TIME: ${clientDatetime}

FORMATTING AND LANGUAGE RULES:
1. The user input might be raw voice-to-text transcription containing phonetic errors, run-on sentences, or poor grammar. You MUST fix these errors.
2. Regardless of the input language (Russian/English), you MUST output the final \`title\`, \`description\`, and \`checklist\` items in PROFESSIONAL ENGLISH. 
3. Ensure electrical/construction terminology is accurately translated.

RULES:
- Match employee names loosely (fuzzy). "Mike" → find closest match in employee list.
- Match project names loosely. Use the projectId from context if user references it.
- Convert relative dates ("tomorrow", "next Tuesday", "через два дня") to ISO datetime.
- If the task is complex, generate 3-6 step checklist for electrical work.
- Estimate duration in minutes based on typical electrical work.
- SCOPE: Review the CANDIDATE MATCHES below. Pick the best match or say "not_in_estimate".
  If the matched item status is "completed" or "paid", flag as possible warranty/rework.
- Check recent tasks for possible duplicates.
- Confidence: 0.0-1.0 for each field. Be honest about uncertainty.
- CRITICAL: If you cannot reliably determine a field (assignee, project, dueDate, zone, etc), OMIT IT entirely. Do NOT use placeholder strings like '<UNKNOWN>'.

CONTEXT:
Project: ${(context.project.name || "").slice(0, 200)} (${(context.project.clientName || "").slice(0, 200)})
Brief: ${(context.project.brief || "").slice(0, 500)}

EMPLOYEES:
${sanitize(context.employees, 2000)}

ACTIVE PROJECTS:
${sanitize(context.projects, 2000)}

RECENT TASKS (last 30):
${sanitize(context.recentTasks, 6000)}

ESTIMATE LINE ITEMS:
${sanitize(context.estimateItems, 6000)}

ACTIVE CHANGE ORDERS:
${sanitize(context.activeChangeOrders, 2000)}

SCOPE CANDIDATES (pre-filtered, ranked by relevance):
${sanitize(scopeCandidates.map((c) => ({ ...c.item, matchScore: c.score })), 3000)}`;
}

async function callClaude(
    userInput: string,
    context: ContextSnapshot,
    scopeCandidates: ScopeCandidate[],
    clientDatetime: string,
    inputMethod: "text" | "voice" | "photo"
): Promise<{ parsed: AiTaskResponse; latencyMs: number }> {
    const systemPrompt = buildSystemPrompt(context, scopeCandidates, clientDatetime);
    const startTime = Date.now();

    const MAX_RETRIES = 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                // Exponential backoff: 2s on retry
                await new Promise((r) => setTimeout(r, 2000 * attempt));
                console.log(`Claude retry attempt ${attempt}...`);
            }

            const response = await getAnthropic().messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1500,
                system: systemPrompt,
                tools: [TOOL_DEFINITION],
                tool_choice: { type: "tool", name: "create_task" },
                messages: [
                    {
                        role: "user",
                        content: `[Input method: ${inputMethod}]\n\n${userInput}`,
                    },
                ],
            });

            const latencyMs = Date.now() - startTime;

            // Extract tool use block
            const toolBlock = response.content.find((b) => b.type === "tool_use");
            if (!toolBlock || toolBlock.type !== "tool_use") {
                throw new Error("Claude did not return a tool_use block");
            }

            // Validate with Zod
            const parsed = AiTaskResponseSchema.parse(toolBlock.input);

            return { parsed, latencyMs };
        } catch (err: any) {
            lastError = err;
            // Only retry on network/overloaded errors, not validation errors
            const isRetryable = err?.status === 529 || err?.status === 500 ||
                err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT";
            if (!isRetryable || attempt >= MAX_RETRIES) {
                throw err;
            }
        }
    }

    throw lastError || new Error("Claude call failed");
}

// ============================================================
// 6. AUDIT LOG WRITER
// ============================================================

async function writeAuditLog(params: {
    projectId: string;
    userInput: string;
    inputMethod: string;
    contextSummary: { taskCount: number; estimateItemCount: number };
    aiResponse: AiTaskResponse;
    latencyMs: number;
    userId: string;
}): Promise<string> {
    const db = getFirestore();
    const logRef = await db.collection("aiAuditLogs").add({
        ...params,
        timestamp: FieldValue.serverTimestamp(),
        modelUsed: "claude-sonnet-4-20250514",
        userEdits: [], // populated later when user confirms/edits
        wasAccepted: null, // set on confirm/cancel
    });
    return logRef.id;
}

// ============================================================
// 7. MAIN CLOUD FUNCTION
// ============================================================

export const generateAiTask = onCall(
    {
        region: "us-east1", // closest to South Florida
        minInstances: 0, // No warm instance — saves ~$3-5/mo; cold start adds ~2-3s
        timeoutSeconds: 30,
        memory: "512MiB",
        secrets: [ANTHROPIC_API_KEY],
    },
    async (request) => {
        // Auth check
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be logged in");
        }
        const userId = request.auth.uid;

        // Validate input
        const { userInput, projectId, inputMethod, clientDatetime } = request.data;

        if (!userInput || typeof userInput !== "string") {
            throw new HttpsError("invalid-argument", "userInput is required");
        }
        if (!projectId || typeof projectId !== "string") {
            throw new HttpsError("invalid-argument", "projectId is required");
        }
        if (!clientDatetime || typeof clientDatetime !== "string") {
            // GOTCHA #3: timezone — frontend MUST send local datetime
            throw new HttpsError(
                "invalid-argument",
                "clientDatetime is required (e.g. 'Monday, Feb 16, 2026, 1:27 PM (EST)')"
            );
        }

        const method = (inputMethod as "text" | "voice" | "photo") || "text";

        try {
            // Step 1: Load context from Firestore (parallel queries)
            const context = await loadContextSnapshot(projectId);

            // Step 2: Deterministic pre-filter with Fuse.js + synonyms
            const scopeCandidates = findScopeCandidates(
                userInput,
                context.estimateItems
            );

            // Step 3: Call Claude via Tool Use
            const { parsed, latencyMs } = await callClaude(
                userInput,
                context,
                scopeCandidates,
                clientDatetime,
                method
            );

            // Step 4: Write audit log
            const auditLogId = await writeAuditLog({
                projectId,
                userInput,
                inputMethod: method,
                contextSummary: {
                    taskCount: context.recentTasks.length,
                    estimateItemCount: context.estimateItems.length,
                },
                aiResponse: parsed,
                latencyMs,
                userId,
            });

            // Step 5: Return draft to frontend (NOT saved to tasks yet!)
            return {
                success: true,
                draft: parsed.task,
                analysis: parsed.analysis,
                auditLogId,
                latencyMs,
            };
        } catch (error: any) {
            // Zod validation failure → return partial data for manual fallback
            if (error instanceof z.ZodError) {
                console.error("Zod validation failed:", error.issues);
                return {
                    success: false,
                    error: "AI response validation failed",
                    zodErrors: error.issues,
                    fallbackToManual: true,
                };
            }

            console.error("generateAiTask error:", error);
            throw new HttpsError(
                "internal",
                error.message || "AI task generation failed"
            );
        }
    }
);

// ============================================================
// 8. COMPANION: Confirm/Save Task (called after user reviews draft)
// ============================================================

/**
 * Resolve the caller's `companyId` from the `users/{uid}` profile. The
 * tasktotime aggregate requires a `companyId` for RLS scoping; the legacy
 * `gtd_tasks` collection had no equivalent so this lookup is new.
 *
 * Throws `failed-precondition` if the user has no companyId — that
 * indicates a partially-provisioned tenant and must be surfaced rather
 * than silently writing to an unscoped row.
 */
async function resolveCallerCompanyId(uid: string): Promise<string> {
    const db = getFirestore();
    const userDoc = await db.doc(`users/${uid}`).get();
    if (!userDoc.exists) {
        throw new HttpsError(
            "failed-precondition",
            `User profile for uid=${uid} not found`
        );
    }
    const companyId = userDoc.data()?.companyId;
    if (typeof companyId !== "string" || companyId.length === 0) {
        throw new HttpsError(
            "failed-precondition",
            `User ${uid} has no companyId — tasktotime write requires tenant scope`
        );
    }
    return companyId;
}

/**
 * Persist via the canonical tasktotime path. Called when the migration
 * flag is enabled.
 *
 * Why use `createTaskHandler` and not write `tasktotime_tasks` directly:
 *   - Idempotency (handler reserves the key + replays return the existing
 *     task instead of creating a duplicate)
 *   - Domain validation (lifecycle, headcount, money)
 *   - Trigger fan-out (onTaskCreate cascade, audit log, BigQuery)
 *   - Future-proof: schema changes land in one place
 *
 * The legacy `gtd_tasks` direct-write path stays in `confirmTaskLegacy`
 * for the rollback case (flag=false). Both paths must produce the same
 * wire response `{ success: true, taskId }` so the frontend hook
 * `useAiTask.confirm` is unaffected.
 */
async function confirmTaskTasktotime(params: {
    uid: string;
    taskData: z.infer<typeof ConfirmInputSchema>["taskData"];
    auditLogId: string | undefined;
    userEdits: Array<{ field: string; aiValue?: unknown; userValue?: unknown }>;
    scopeDecision: string | null | undefined;
}): Promise<{ taskId: string }> {
    const { uid, taskData, auditLogId, userEdits, scopeDecision } = params;
    const db = getFirestore();
    const companyId = await resolveCallerCompanyId(uid);

    // Resolve display name for the `by` ref. Fallback to uid so the trigger
    // fan-out always has a non-empty actor name (UserRef.name is required).
    const userDoc = await db.doc(`users/${uid}`).get();
    const callerName =
        userDoc.data()?.displayName ??
        userDoc.data()?.name ??
        userDoc.data()?.email ??
        uid;

    // Map legacy AI priority vocabulary (low|medium|high|urgent|none) to
    // tasktotime priority (critical|high|medium|low). 'urgent' and
    // 'critical' collide in meaning — map 'urgent' → 'critical'. 'none' → 'low'.
    const priority: "critical" | "high" | "medium" | "low" =
        taskData.priority === "urgent"
            ? "critical"
            : taskData.priority === "high"
                ? "high"
                : taskData.priority === "low" || taskData.priority === "none"
                    ? "low"
                    : "medium";

    // Map AI dueDate (ISO string) → tasktotime dueAt (epoch ms). Default
    // to "1 week from now" if missing — same fallback as the gtd-proxy.
    const dueAt = (() => {
        if (typeof taskData.dueDate === "string" && taskData.dueDate.length > 0) {
            const ms = Date.parse(taskData.dueDate);
            if (Number.isFinite(ms)) return ms;
        }
        return Date.now() + 7 * 24 * 60 * 60 * 1000;
    })();

    // Build the assignedTo UserRef. The AI returns `assigneeIds[]` (string
    // ids, possibly empty); pick the first as primary and fall back to the
    // caller. `assigneeName` from the legacy shape may have the display name.
    const primaryAssigneeId = taskData.assigneeIds?.[0];
    const assignedTo =
        typeof primaryAssigneeId === "string" && primaryAssigneeId.length > 0
            ? {
                id: primaryAssigneeId,
                name: taskData.assigneeName || primaryAssigneeId,
            }
            : { id: uid, name: callerName };

    // Co-assignees: remaining ids from assigneeIds[]. Names are not in the
    // legacy shape so we use the id as the display fallback.
    const coAssignees = (taskData.assigneeIds ?? []).slice(1).map((id) => ({
        id,
        name: id,
    }));

    // The `clientId` field carries the project id in legacy AI flows (the
    // bot used `clientId` as the canonical link). tasktotime separates
    // clientId vs projectId — preserve both for compatibility.
    const linkedClientId = taskData.clientId || taskData.projectId;
    const linkedProjectId = taskData.projectId;

    // Idempotency key — derived from auditLogId when present (one
    // confirmation per AI draft) so retries are safe. When absent (manual
    // path), use a synthetic uid+timestamp key.
    const idempotencyKey = auditLogId
        ? `confirmAiTask:${auditLogId}`
        : `confirmAiTask:manual:${uid}:${Date.now()}`;

    const services = getTasktotimeServices();
    const task = await services.createTaskHandler.execute({
        idempotencyKey,
        initialLifecycle: "ready",
        by: { id: uid, name: callerName },
        companyId,
        title: taskData.title,
        description: taskData.description || undefined,
        dueAt,
        estimatedDurationMinutes:
            typeof taskData.estimatedMinutes === "number" &&
                Number.isFinite(taskData.estimatedMinutes)
                ? taskData.estimatedMinutes
                : 60,
        bucket: "next",
        priority,
        source: "ai",
        assignedTo,
        coAssignees: coAssignees.length > 0 ? coAssignees : undefined,
        requiredHeadcount: 1,
        costInternal: { amount: 0, currency: "USD" },
        priceClient: { amount: 0, currency: "USD" },
        clientId: linkedClientId || undefined,
        clientName: taskData.clientName || undefined,
        projectId: linkedProjectId || undefined,
    });

    // Update audit log to mirror the legacy behaviour. The audit collection
    // itself is unchanged — only the `confirmedTaskId` now points to a
    // tasktotime_tasks doc id instead of gtd_tasks.
    if (auditLogId) {
        const auditDoc = await db.doc(`aiAuditLogs/${auditLogId}`).get();
        if (auditDoc.exists && auditDoc.data()?.userId === uid) {
            await db.doc(`aiAuditLogs/${auditLogId}`).update({
                wasAccepted: true,
                userEdits,
                scopeDecision: scopeDecision || null,
                confirmedTaskId: task.id,
                confirmedCollection: "tasktotime_tasks",
            });
        }
    }

    return { taskId: task.id };
}

/**
 * Legacy persistence path — writes directly to `gtd_tasks`. Kept behind
 * the feature flag for instant rollback. Mirrors the original
 * pre-migration behaviour byte-for-byte.
 */
async function confirmTaskLegacy(params: {
    uid: string;
    taskData: z.infer<typeof ConfirmInputSchema>["taskData"];
    auditLogId: string | undefined;
    userEdits: Array<{ field: string; aiValue?: unknown; userValue?: unknown }>;
    scopeDecision: string | null | undefined;
}): Promise<{ taskId: string }> {
    const { uid, taskData, auditLogId, userEdits, scopeDecision } = params;
    const db = getFirestore();

    const gtdTask: Record<string, any> = {
        ownerId: uid,
        ownerName: taskData.ownerName || "",
        title: taskData.title || "",
        description: taskData.description || "",
        status: taskData.status || "next",
        priority: taskData.priority || "medium",
        taskType: taskData.taskType || "maintenance",
        clientId: taskData.projectId || taskData.clientId || null,
        clientName: taskData.clientName || "",
        dueDate: taskData.dueDate || null,
        needsEstimate: taskData.needsEstimate || false,
        assigneeId: taskData.assigneeIds?.[0] || null,
        assigneeName: taskData.assigneeName || "",
        coAssignees: [],
        coAssigneeIds: taskData.assigneeIds?.slice(1) || [],
        estimatedMinutes: taskData.estimatedMinutes || null,
        estimatedHours: taskData.estimatedMinutes
            ? Math.round((taskData.estimatedMinutes / 60) * 10) / 10
            : null,
        checklistItems: (taskData.checklist || []).map(
            (item: any, i: number) => ({
                id: `ai_sub_${Date.now()}_${i}`,
                text: item.title || item.text || "",
                completed: false,
                createdAt: FieldValue.serverTimestamp(),
            })
        ),
        context: "@office",
        source: "ai",
        aiAuditLogId: auditLogId || null,
        scopeStatus: scopeDecision || taskData.scopeStatus || null,
        zone: taskData.zone || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };

    const taskRef = await db.collection("gtd_tasks").add(gtdTask);

    if (auditLogId) {
        const auditDoc = await db.doc(`aiAuditLogs/${auditLogId}`).get();
        if (auditDoc.exists && auditDoc.data()?.userId === uid) {
            await db.doc(`aiAuditLogs/${auditLogId}`).update({
                wasAccepted: true,
                userEdits,
                scopeDecision: scopeDecision || null,
                confirmedTaskId: taskRef.id,
            });
        }
    }

    return { taskId: taskRef.id };
}

export const confirmAiTask = onCall(
    {
        region: "us-east1",
        timeoutSeconds: 10,
        memory: "256MiB",
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "Must be logged in");
        }

        // Validate input with Zod
        let validData;
        try {
            validData = ConfirmInputSchema.parse(request.data);
        } catch (err: any) {
            if (err instanceof z.ZodError) {
                throw new HttpsError(
                    "invalid-argument",
                    `Invalid input: ${err.issues.map((i) => i.message).join(", ")}`
                );
            }
            throw new HttpsError("invalid-argument", "Invalid task data");
        }

        const { taskData, auditLogId, userEdits, scopeDecision } = validData;
        const uid = request.auth.uid;

        // Branch on the migration flag. When ON (default) → tasktotime;
        // when OFF → legacy gtd_tasks. Both paths return the SAME wire
        // shape { success, taskId } so the frontend is unaffected.
        try {
            const result = tasktotimeEnabled()
                ? await confirmTaskTasktotime({
                    uid,
                    taskData,
                    auditLogId,
                    userEdits: userEdits ?? [],
                    scopeDecision,
                })
                : await confirmTaskLegacy({
                    uid,
                    taskData,
                    auditLogId,
                    userEdits: userEdits ?? [],
                    scopeDecision,
                });

            return { success: true, taskId: result.taskId };
        } catch (err: any) {
            // Re-throw HttpsError as-is; wrap anything else as internal.
            if (err instanceof HttpsError) throw err;
            console.error("confirmAiTask error:", err);
            throw new HttpsError(
                "internal",
                err?.message || "Failed to persist confirmed task"
            );
        }
    }
);
