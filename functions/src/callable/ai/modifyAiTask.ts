import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

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
// 3. MAIN FUNCTION
// ============================================================

export const modifyAiTask = onCall(
    {
        region: "europe-west1",
        memory: "512MiB",
        timeoutSeconds: 300,
        enforceAppCheck: false,
    },
    async (request) => {
        // 1. Auth Check
        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "The function must be called while authenticated."
            );
        }

        const { currentTask, userCommand } = request.data;
        if (!currentTask || !userCommand) {
            throw new HttpsError(
                "invalid-argument",
                "Both 'currentTask' and 'userCommand' are required."
            );
        }

        // 2. Initialize Anthropic
        const apiKey = process.env.ANTHROPIC_API_KEY;
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
