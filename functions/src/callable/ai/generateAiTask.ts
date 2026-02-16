import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
    EstimateItem,
    ScopeCandidate,
    findScopeCandidates,
} from "./scopeMatcher";

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
    assigneeIds: z.array(z.string()),
    projectId: z.string(),
    dueDate: z.string(),
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

    // Parallel fetch for speed
    const [projectDoc, tasksSnap, estimatesSnap, cosSnap, employeesSnap, projectsSnap] =
        await Promise.all([
            db.doc(`projects/${projectId}`).get(),
            db
                .collection("tasks")
                .where("projectId", "==", projectId)
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
            db.collection("employees").where("isActive", "==", true).get(),
            db
                .collection("projects")
                .where("status", "==", "active")
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
            return {
                title: t.title,
                assigneeName: t.assigneeName || "",
                status: t.status,
                completionNotes: t.completionNotes,
                createdAt: t.createdAt?.toDate?.()?.toISOString?.() || "",
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
            name: d.data().name || d.data().displayName || "",
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

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

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
                required: ["title", "assigneeIds", "projectId", "dueDate", "priority"],
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
    return `You are a construction project management assistant for Garkor, an electrical contracting company in South Florida. The team speaks English and Russian.

CURRENT SYSTEM TIME: ${clientDatetime}

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

CONTEXT:
Project: ${context.project.name} (${context.project.clientName})
Brief: ${context.project.brief}

EMPLOYEES:
${JSON.stringify(context.employees)}

ACTIVE PROJECTS:
${JSON.stringify(context.projects)}

RECENT TASKS (last 30):
${JSON.stringify(context.recentTasks)}

ESTIMATE LINE ITEMS:
${JSON.stringify(context.estimateItems)}

ACTIVE CHANGE ORDERS:
${JSON.stringify(context.activeChangeOrders)}

SCOPE CANDIDATES (pre-filtered, ranked by relevance):
${JSON.stringify(scopeCandidates.map((c) => ({ ...c.item, matchScore: c.score })))}`;
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

    const response = await anthropic.messages.create({
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
        minInstances: 1, // GOTCHA #4: prevent cold starts ($3-5/mo)
        timeoutSeconds: 30,
        memory: "512MiB",
        secrets: ["ANTHROPIC_API_KEY"],
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

        const { taskData, auditLogId, userEdits, scopeDecision } = request.data;

        const db = getFirestore();

        // Save the actual task
        const taskRef = await db.collection("tasks").add({
            ...taskData,
            createdBy: "ai",
            aiAuditLogId: auditLogId,
            scopeStatus: scopeDecision || taskData.scopeStatus,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            createdByUid: request.auth.uid,
        });

        // Update audit log with user's edits and confirmation
        if (auditLogId) {
            await db.doc(`aiAuditLogs/${auditLogId}`).update({
                wasAccepted: true,
                userEdits: userEdits || [],
                scopeDecision: scopeDecision || null,
                confirmedTaskId: taskRef.id,
            });
        }

        return { success: true, taskId: taskRef.id };
    }
);
