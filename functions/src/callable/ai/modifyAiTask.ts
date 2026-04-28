import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ANTHROPIC_API_KEY } from "../../config";
import * as envModule from "../../config/env";

// ============================================================
// FEATURE FLAG — tasktotime migration
// ============================================================
//
// modifyAiTask is purely an AI inline-edit on a snapshot — it does NOT
// write the task itself. The two paths differ only in WHERE the snapshot
// is sourced from when the caller passes `taskId` (instead of an inline
// `currentTask` object):
//
//   - flag ON  (default) → read from `tasktotime_tasks/{taskId}`
//   - flag OFF (rollback) → read from `gtd_tasks/{taskId}`
//
// When the caller already supplies `currentTask` (the existing frontend
// path), the flag is irrelevant and we operate on the in-memory snapshot
// just like before. Backwards compat is therefore total — no breaking
// change for current frontend callers.
//
// We import the env module as a namespace (not a destructured const) so
// jest.mock can rebind the `TASKTOTIME_AI_CALLABLES_ENABLED` getter at
// runtime.
function tasktotimeEnabled(): boolean {
    return envModule.TASKTOTIME_AI_CALLABLES_ENABLED;
}

// ============================================================
// 1. ZOD SCHEMAS FOR MODIFICATION
// ============================================================

const ChecklistItemSchema = z.object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean(),
});

const TaskModificationSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    estimatedDurationMinutes: z.number().optional(),
    checklistItems: z.array(ChecklistItemSchema).optional(),
});

export type TaskModification = z.infer<typeof TaskModificationSchema>;

// ============================================================
// 2. PROMPTS
// ============================================================

const buildModificationPrompt = (currentTaskJson: string, userCommand: string) => `
You are an intelligent AI Assistant embedded within a Getting Things Done (GTD) Task Management system.
Your job is to act as an interactive editor for a specific task.

The user has provided a command (either text or transcribed voice) instructing you to modify the task.
You will be provided with the CURRENT state of the task in JSON format.
You must apply the requested modifications and return ONLY the modified fields as a JSON object matching the requested schema.

FORMATTING AND LANGUAGE RULES:
1. The user command might contain phonetic errors from voice transcription. Fix them intelligently.
2. Output your modifications in PROFESSIONAL RUSSIAN unless the user explicitly asks for another language.
3. If the user asks to "rename", update the \`title\`.
4. If the user asks to "rewrite description", update the \`description\`.
5. If the user asks to update the checklist, return the FULL updated \`checklistItems\` array. Retain existing IDs for items that are not deleted. If you create a new item, generate a short random string for its \`id\`.
6. Only return the fields that need to be changed. If a field doesn't need to change, omit it from your response.

CURRENT TASK JSON:
${currentTaskJson}

USER COMMAND:
"${userCommand}"
`;

// ============================================================
// 3. SNAPSHOT LOADER (tasktotime_tasks ↔ gtd_tasks)
// ============================================================

/**
 * Read a task snapshot for AI modification. Source collection is
 * controlled by the migration flag:
 *
 *   - flag ON  → `tasktotime_tasks/{taskId}` (canonical)
 *   - flag OFF → `gtd_tasks/{taskId}`        (legacy rollback)
 *
 * Cross-tenant guard: compares the task's `companyId` against the
 * caller's `users/{uid}.companyId`. If they differ we return 404 (not
 * 403) to avoid leaking task existence.
 */
async function loadTaskSnapshot(
    taskId: string,
    callerUid: string,
): Promise<Record<string, unknown>> {
    const db = getFirestore();
    const collection = tasktotimeEnabled() ? "tasktotime_tasks" : "gtd_tasks";

    const userDoc = await db.doc(`users/${callerUid}`).get();
    const callerCompanyId = userDoc.data()?.companyId;

    const taskDoc = await db.doc(`${collection}/${taskId}`).get();
    if (!taskDoc.exists) {
        throw new HttpsError("not-found", `Task ${taskId} not found`);
    }

    const data = taskDoc.data() ?? {};

    // Tenant scope check — only meaningful in the tasktotime path
    // (legacy gtd_tasks docs predate the companyId field). For tasktotime,
    // a missing companyId on the task is itself an integrity bug; we err
    // on the side of returning 404 to avoid leaking the existence.
    if (collection === "tasktotime_tasks") {
        const taskCompanyId = (data as Record<string, unknown>).companyId;
        if (
            typeof callerCompanyId !== "string" ||
            callerCompanyId.length === 0 ||
            taskCompanyId !== callerCompanyId
        ) {
            throw new HttpsError("not-found", `Task ${taskId} not found`);
        }
    }

    // Project a minimal snapshot — Claude does not need every field, just
    // the ones the modification tool can touch.
    const checklist = Array.isArray(data.checklistItems)
        ? data.checklistItems
        : [];
    return {
        id: taskId,
        title: data.title ?? "",
        description: data.description ?? "",
        // tasktotime stores estimatedDurationMinutes; legacy used the same
        // key so this maps directly. Coerce to number; Claude is permissive.
        estimatedDurationMinutes:
            typeof data.estimatedDurationMinutes === "number"
                ? data.estimatedDurationMinutes
                : 0,
        checklistItems: checklist,
    };
}

// ============================================================
// 4. MAIN FUNCTION
// ============================================================

export const modifyAiTask = onCall(
    {
        region: "europe-west1",
        memory: "512MiB",
        timeoutSeconds: 300,
        enforceAppCheck: false,
        secrets: [ANTHROPIC_API_KEY],
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "The function must be called while authenticated."
            );
        }

        // The caller may either:
        //   (a) Pass `currentTask` inline — existing frontend behaviour.
        //       Used by `useCockpitTask.handleAiModification` which already
        //       has the editable form state in memory.
        //   (b) Pass `taskId` — new bot path. We read the snapshot from
        //       Firestore (tasktotime_tasks when flag ON, gtd_tasks when
        //       OFF). Cross-tenant scope is enforced via users/{uid}.companyId
        //       comparison so a caller cannot read another tenant's task.
        const {
            currentTask: inlineCurrentTask,
            userCommand,
            taskId,
        } = request.data as {
            currentTask?: unknown;
            userCommand?: unknown;
            taskId?: unknown;
        };

        if (typeof userCommand !== "string" || userCommand.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "'userCommand' is required."
            );
        }

        let currentTask: unknown;
        if (inlineCurrentTask) {
            currentTask = inlineCurrentTask;
        } else if (typeof taskId === "string" && taskId.length > 0) {
            currentTask = await loadTaskSnapshot(taskId, request.auth.uid);
        } else {
            throw new HttpsError(
                "invalid-argument",
                "Either 'currentTask' or 'taskId' is required."
            );
        }

        // 2. Initialize Anthropic
        const apiKey = ANTHROPIC_API_KEY.value();
        if (!apiKey) {
            throw new HttpsError(
                "internal",
                "Anthropic API key not configured in environment."
            );
        }
        const anthropic = new Anthropic({ apiKey });

        try {
            // 3. Call Claude
            const response = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 2000,
                temperature: 0.2, // Low temp for more deterministic editing
                system: "You are an intelligent task editor. You must follow the formatting rules strictly and return ONLY JSON according to the tool schema.",
                messages: [
                    {
                        role: "user",
                        content: buildModificationPrompt(JSON.stringify(currentTask), userCommand),
                    },
                ],
                tools: [
                    {
                        name: "apply_task_modification",
                        description: "Apply the requested modifications to the task.",
                        input_schema: {
                            type: "object",
                            properties: {
                                title: { type: "string", description: "The updated task title" },
                                description: { type: "string", description: "The updated task description" },
                                estimatedDurationMinutes: { type: "number", description: "The updated estimated duration in minutes" },
                                checklistItems: {
                                    type: "array",
                                    description: "The fully updated checklist array. Include existing items that weren't deleted.",
                                    items: {
                                        type: "object",
                                        properties: {
                                            id: { type: "string" },
                                            text: { type: "string" },
                                            completed: { type: "boolean" }
                                        },
                                        required: ["id", "text", "completed"]
                                    }
                                }
                            }
                        }
                    }
                ],
                tool_choice: { type: "tool", name: "apply_task_modification" }
            });

            const toolCall = response.content.find((block) => block.type === "tool_use");
            if (!toolCall || toolCall.type !== "tool_use") {
                throw new Error("Claude did not return a tool_use block.");
            }

            // 4. Validate output
            const parsedModification = TaskModificationSchema.parse(toolCall.input);

            return {
                data: parsedModification,
                status: "success"
            };

        } catch (error: any) {
            console.error("modifyAiTask Error:", error);
            throw new HttpsError(
                "internal",
                error.message || "Failed to process task modification via AI."
            );
        }
    }
);
