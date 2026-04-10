/**
 * @fileoverview Phase 4.1 — Project Templates for Construction GTD
 *
 * Provides built-in templates for common construction projects:
 * - Bathroom renovation ("Ванная под ключ") — 15 tasks
 * - Kitchen renovation ("Кухня") — 12 tasks
 * - Basement finishing — 10 tasks
 * - Electrical work — 8 tasks
 * - General renovation — 14 tasks
 *
 * Also supports custom templates stored in Firestore.
 *
 * Callable function: createProjectFromTemplate
 * HTTP trigger (Telegram bot): instantiateTemplate
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface TemplateTask {
    title: string;
    description?: string;
    phaseTag: string; // demo | rough | finish | punch_list | warranty
    priority: 'high' | 'medium' | 'low';
    estimatedDurationMinutes?: number;
    requiresCompletionProof?: boolean;
    requiresApproval?: boolean;
    checklistItems?: Array<{ text: string; isDone: boolean }>;
    dependsOnIndex?: number; // index of prerequisite task in same template
    dueDaysOffset?: number; // days from project start
    waitingReason?: string | null;
}

interface ProjectTemplate {
    id: string;
    name: string;
    nameEn: string;
    emoji: string;
    description: string;
    category: string; // bathroom | kitchen | basement | electrical | general | custom
    tasks: TemplateTask[];
}

// ═══════════════════════════════════════════════════════════
// BUILT-IN TEMPLATES
// ═══════════════════════════════════════════════════════════

const BATHROOM_TEMPLATE: ProjectTemplate = {
    id: 'bathroom_full',
    name: 'Ванная под ключ',
    nameEn: 'Bathroom Full Renovation',
    emoji: '🚿',
    description: 'Full bathroom renovation: demo, plumbing, tile, fixtures',
    category: 'bathroom',
    tasks: [
        {
            title: 'Protect floors and adjacent areas',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 60,
            dueDaysOffset: 0,
        },
        {
            title: 'Demo existing tile, fixtures, vanity',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 1,
        },
        {
            title: 'Haul out demo debris',
            phaseTag: 'demo',
            priority: 'medium',
            estimatedDurationMinutes: 120,
            dueDaysOffset: 2,
            dependsOnIndex: 1,
        },
        {
            title: 'Rough plumbing (supply + drain)',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 360,
            requiresCompletionProof: true,
            dueDaysOffset: 3,
            dependsOnIndex: 1,
        },
        {
            title: 'Rough electrical (outlets, fan, lighting)',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 240,
            dueDaysOffset: 3,
        },
        {
            title: 'Waterproofing (RedGard / membrane)',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 180,
            requiresCompletionProof: true,
            dueDaysOffset: 5,
            dependsOnIndex: 3,
        },
        {
            title: 'Schedule plumbing inspection',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 30,
            waitingReason: 'inspection',
            dueDaysOffset: 6,
            dependsOnIndex: 3,
        },
        {
            title: 'Drywall / cement board install',
            phaseTag: 'rough',
            priority: 'medium',
            estimatedDurationMinutes: 300,
            dueDaysOffset: 7,
            dependsOnIndex: 5,
        },
        {
            title: 'Tile walls (shower/tub surround)',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 720,
            requiresCompletionProof: true,
            dueDaysOffset: 9,
            dependsOnIndex: 7,
        },
        {
            title: 'Tile floor',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 11,
            dependsOnIndex: 8,
        },
        {
            title: 'Grout + seal tile',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 180,
            dueDaysOffset: 12,
            dependsOnIndex: 9,
        },
        {
            title: 'Install vanity, mirror, accessories',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 240,
            requiresCompletionProof: true,
            dueDaysOffset: 13,
            dependsOnIndex: 10,
        },
        {
            title: 'Install toilet, faucets, shower trim',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 180,
            dueDaysOffset: 13,
            dependsOnIndex: 10,
        },
        {
            title: 'Final cleanup + punch list walkthrough',
            phaseTag: 'punch_list',
            priority: 'high',
            estimatedDurationMinutes: 120,
            requiresCompletionProof: true,
            requiresApproval: true,
            dueDaysOffset: 14,
            checklistItems: [
                { text: 'All fixtures working', isDone: false },
                { text: 'No leaks', isDone: false },
                { text: 'Grout clean + sealed', isDone: false },
                { text: 'Caulk around tub/shower', isDone: false },
                { text: 'Electrical covers installed', isDone: false },
                { text: 'Touch-up paint', isDone: false },
            ],
        },
        {
            title: 'Client walkthrough + sign-off',
            phaseTag: 'punch_list',
            priority: 'high',
            estimatedDurationMinutes: 60,
            requiresApproval: true,
            dueDaysOffset: 15,
            dependsOnIndex: 13,
        },
    ],
};

const KITCHEN_TEMPLATE: ProjectTemplate = {
    id: 'kitchen_full',
    name: 'Кухня ремонт',
    nameEn: 'Kitchen Renovation',
    emoji: '🍳',
    description: 'Full kitchen renovation: demo, cabinets, countertops, tile, appliances',
    category: 'kitchen',
    tasks: [
        {
            title: 'Disconnect appliances + utilities',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 120,
            dueDaysOffset: 0,
        },
        {
            title: 'Demo cabinets, countertops, backsplash',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 1,
        },
        {
            title: 'Demo debris haul-out',
            phaseTag: 'demo',
            priority: 'medium',
            estimatedDurationMinutes: 120,
            dueDaysOffset: 2,
        },
        {
            title: 'Rough plumbing relocations',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 300,
            dueDaysOffset: 3,
        },
        {
            title: 'Rough electrical (new circuits, outlets)',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 360,
            requiresCompletionProof: true,
            dueDaysOffset: 3,
        },
        {
            title: 'Drywall repair + paint',
            phaseTag: 'rough',
            priority: 'medium',
            estimatedDurationMinutes: 300,
            dueDaysOffset: 5,
        },
        {
            title: 'Install cabinets',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 7,
            waitingReason: 'materials',
        },
        {
            title: 'Template + install countertops',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 240,
            requiresCompletionProof: true,
            dueDaysOffset: 10,
            dependsOnIndex: 6,
        },
        {
            title: 'Tile backsplash',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 360,
            requiresCompletionProof: true,
            dueDaysOffset: 12,
            dependsOnIndex: 7,
        },
        {
            title: 'Install appliances',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 240,
            dueDaysOffset: 13,
            dependsOnIndex: 7,
        },
        {
            title: 'Final trim + hardware',
            phaseTag: 'punch_list',
            priority: 'medium',
            estimatedDurationMinutes: 120,
            dueDaysOffset: 14,
            checklistItems: [
                { text: 'Cabinet doors aligned', isDone: false },
                { text: 'Drawer slides smooth', isDone: false },
                { text: 'Handles/knobs installed', isDone: false },
                { text: 'Under-cabinet lighting', isDone: false },
                { text: 'Outlet covers on', isDone: false },
            ],
        },
        {
            title: 'Client walkthrough + sign-off',
            phaseTag: 'punch_list',
            priority: 'high',
            estimatedDurationMinutes: 60,
            requiresApproval: true,
            dueDaysOffset: 15,
        },
    ],
};

const BASEMENT_TEMPLATE: ProjectTemplate = {
    id: 'basement_finish',
    name: 'Подвал (Basement)',
    nameEn: 'Basement Finishing',
    emoji: '🏠',
    description: 'Basement finishing: framing, insulation, drywall, flooring',
    category: 'basement',
    tasks: [
        {
            title: 'Check for moisture / waterproofing',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 120,
            requiresCompletionProof: true,
            dueDaysOffset: 0,
        },
        {
            title: 'Frame walls + bulkheads',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 960,
            dueDaysOffset: 1,
        },
        {
            title: 'Rough electrical + data',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 480,
            dueDaysOffset: 3,
        },
        {
            title: 'Rough plumbing (bathroom if applicable)',
            phaseTag: 'rough',
            priority: 'medium',
            estimatedDurationMinutes: 360,
            dueDaysOffset: 3,
        },
        {
            title: 'Schedule rough inspection',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 30,
            waitingReason: 'inspection',
            dueDaysOffset: 5,
        },
        {
            title: 'Insulation + vapor barrier',
            phaseTag: 'rough',
            priority: 'medium',
            estimatedDurationMinutes: 480,
            dueDaysOffset: 6,
        },
        {
            title: 'Drywall hang + tape + mud',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 960,
            requiresCompletionProof: true,
            dueDaysOffset: 8,
        },
        {
            title: 'Prime + paint',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 480,
            dueDaysOffset: 11,
        },
        {
            title: 'Flooring install (LVP/carpet)',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 13,
            waitingReason: 'materials',
        },
        {
            title: 'Final punch list + client walkthrough',
            phaseTag: 'punch_list',
            priority: 'high',
            estimatedDurationMinutes: 120,
            requiresApproval: true,
            requiresCompletionProof: true,
            dueDaysOffset: 15,
            checklistItems: [
                { text: 'All outlets working', isDone: false },
                { text: 'Doors close properly', isDone: false },
                { text: 'Paint touchup', isDone: false },
                { text: 'Trim/baseboard gaps filled', isDone: false },
            ],
        },
    ],
};

const ELECTRICAL_TEMPLATE: ProjectTemplate = {
    id: 'electrical_service',
    name: 'Электрика',
    nameEn: 'Electrical Service',
    emoji: '⚡',
    description: 'Electrical panel upgrade or full rewire',
    category: 'electrical',
    tasks: [
        {
            title: 'Assess existing panel + load calculation',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 120,
            dueDaysOffset: 0,
        },
        {
            title: 'Pull electrical permit',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 60,
            waitingReason: 'permit',
            dueDaysOffset: 1,
        },
        {
            title: 'Run new circuits + wiring',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 720,
            requiresCompletionProof: true,
            dueDaysOffset: 3,
        },
        {
            title: 'Install new panel / breakers',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 360,
            requiresCompletionProof: true,
            dueDaysOffset: 5,
        },
        {
            title: 'Rough inspection',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 60,
            waitingReason: 'inspection',
            dueDaysOffset: 6,
        },
        {
            title: 'Patch drywall over new wiring',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 240,
            dueDaysOffset: 7,
        },
        {
            title: 'Install outlets, switches, fixtures',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 300,
            requiresCompletionProof: true,
            dueDaysOffset: 8,
        },
        {
            title: 'Final inspection + sign-off',
            phaseTag: 'punch_list',
            priority: 'high',
            estimatedDurationMinutes: 60,
            requiresApproval: true,
            waitingReason: 'inspection',
            dueDaysOffset: 9,
        },
    ],
};

const GENERAL_RENOVATION_TEMPLATE: ProjectTemplate = {
    id: 'general_renovation',
    name: 'Общий ремонт',
    nameEn: 'General Renovation',
    emoji: '🔨',
    description: 'General room renovation: demo, drywall, paint, flooring, trim',
    category: 'general',
    tasks: [
        {
            title: 'Site protection (floors, furniture)',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 60,
            dueDaysOffset: 0,
        },
        {
            title: 'Demo existing finishes',
            phaseTag: 'demo',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 1,
        },
        {
            title: 'Debris removal',
            phaseTag: 'demo',
            priority: 'medium',
            estimatedDurationMinutes: 120,
            dueDaysOffset: 2,
        },
        {
            title: 'Structural repairs (if needed)',
            phaseTag: 'rough',
            priority: 'high',
            estimatedDurationMinutes: 480,
            dueDaysOffset: 3,
        },
        {
            title: 'Electrical updates',
            phaseTag: 'rough',
            priority: 'medium',
            estimatedDurationMinutes: 240,
            dueDaysOffset: 4,
        },
        {
            title: 'Plumbing updates',
            phaseTag: 'rough',
            priority: 'medium',
            estimatedDurationMinutes: 240,
            dueDaysOffset: 4,
        },
        {
            title: 'Drywall repair/install',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 480,
            dueDaysOffset: 6,
        },
        {
            title: 'Skim coat + sand',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 300,
            dueDaysOffset: 8,
        },
        {
            title: 'Prime + paint (2 coats)',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 9,
        },
        {
            title: 'Flooring install',
            phaseTag: 'finish',
            priority: 'high',
            estimatedDurationMinutes: 480,
            requiresCompletionProof: true,
            dueDaysOffset: 11,
            waitingReason: 'materials',
        },
        {
            title: 'Install trim + baseboard',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 300,
            dueDaysOffset: 12,
        },
        {
            title: 'Install doors + hardware',
            phaseTag: 'finish',
            priority: 'medium',
            estimatedDurationMinutes: 240,
            dueDaysOffset: 13,
        },
        {
            title: 'Touch-up + cleanup',
            phaseTag: 'punch_list',
            priority: 'medium',
            estimatedDurationMinutes: 180,
            requiresCompletionProof: true,
            dueDaysOffset: 14,
            checklistItems: [
                { text: 'Paint touch-ups', isDone: false },
                { text: 'Caulk gaps', isDone: false },
                { text: 'Clean all surfaces', isDone: false },
                { text: 'Remove protection', isDone: false },
            ],
        },
        {
            title: 'Client walkthrough + approval',
            phaseTag: 'punch_list',
            priority: 'high',
            estimatedDurationMinutes: 60,
            requiresApproval: true,
            dueDaysOffset: 15,
        },
    ],
};

// All built-in templates indexed by ID
export const BUILT_IN_TEMPLATES: Record<string, ProjectTemplate> = {
    bathroom_full: BATHROOM_TEMPLATE,
    kitchen_full: KITCHEN_TEMPLATE,
    basement_finish: BASEMENT_TEMPLATE,
    electrical_service: ELECTRICAL_TEMPLATE,
    general_renovation: GENERAL_RENOVATION_TEMPLATE,
};

// ═══════════════════════════════════════════════════════════
// TEMPLATE LIST (for bot / API)
// ═══════════════════════════════════════════════════════════

export function getTemplateList(): Array<{
    id: string;
    name: string;
    nameEn: string;
    emoji: string;
    taskCount: number;
    description: string;
}> {
    return Object.values(BUILT_IN_TEMPLATES).map(t => ({
        id: t.id,
        name: t.name,
        nameEn: t.nameEn,
        emoji: t.emoji,
        taskCount: t.tasks.length,
        description: t.description,
    }));
}

// ═══════════════════════════════════════════════════════════
// INSTANTIATE TEMPLATE — creates tasks in Firestore
// ═══════════════════════════════════════════════════════════

export async function instantiateTemplate(params: {
    templateId: string;
    ownerId: string;
    ownerName: string;
    clientId?: string;
    clientName?: string;
    projectId?: string;
    projectName?: string;
    startDate?: Date;
}): Promise<{ taskCount: number; taskIds: string[] }> {
    const template = BUILT_IN_TEMPLATES[params.templateId];
    if (!template) {
        throw new Error(`Template not found: ${params.templateId}`);
    }

    const startDate = params.startDate || new Date();
    const batch = db.batch();
    const taskIds: string[] = [];
    const now = admin.firestore.Timestamp.now();

    for (const tmplTask of template.tasks) {
        const taskRef = db.collection('gtd_tasks').doc();
        taskIds.push(taskRef.id);

        // Calculate due date based on offset
        let dueDate: admin.firestore.Timestamp | null = null;
        if (tmplTask.dueDaysOffset !== undefined) {
            const dd = new Date(startDate);
            dd.setDate(dd.getDate() + tmplTask.dueDaysOffset);
            dueDate = admin.firestore.Timestamp.fromDate(dd);
        }

        // Determine initial status
        let status = 'next_action';
        if (tmplTask.waitingReason) {
            status = 'waiting';
        } else if (tmplTask.dependsOnIndex !== undefined && tmplTask.dependsOnIndex >= 0) {
            // Tasks with dependencies start in projects (backlog)
            status = 'projects';
        }

        batch.set(taskRef, {
            title: tmplTask.title,
            description: tmplTask.description || '',
            status,
            priority: tmplTask.priority,
            phaseTag: tmplTask.phaseTag,
            ownerId: params.ownerId,
            ownerName: params.ownerName,
            clientId: params.clientId || null,
            clientName: params.clientName || null,
            projectId: params.projectId || null,
            projectName: params.projectName || null,
            dueDate,
            estimatedDurationMinutes: tmplTask.estimatedDurationMinutes || null,
            requiresCompletionProof: tmplTask.requiresCompletionProof || false,
            requiresApproval: tmplTask.requiresApproval || false,
            waitingReason: tmplTask.waitingReason || null,
            checklistItems: tmplTask.checklistItems || [],
            dependsOnTaskId: tmplTask.dependsOnIndex !== undefined
                ? taskIds[tmplTask.dependsOnIndex] || null
                : null,
            source: 'template',
            sourceTemplateId: params.templateId,
            sourceTemplateName: template.name,
            templateTaskIndex: template.tasks.indexOf(tmplTask),
            createdAt: now,
            updatedAt: now,
        });
    }

    await batch.commit();

    return { taskCount: taskIds.length, taskIds };
}

// ═══════════════════════════════════════════════════════════
// CALLABLE FUNCTION — createProjectFromTemplate
// ═══════════════════════════════════════════════════════════

export const createProjectFromTemplate = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    }

    const { templateId, clientId, clientName, projectId, projectName, startDate } = data;

    if (!templateId) {
        throw new functions.https.HttpsError('invalid-argument', 'templateId required');
    }

    if (!BUILT_IN_TEMPLATES[templateId]) {
        throw new functions.https.HttpsError('not-found', `Template ${templateId} not found`);
    }

    const userId = context.auth.uid;
    const userDoc = await db.collection('users').doc(userId).get();
    const userName = userDoc.data()?.displayName || 'User';

    const result = await instantiateTemplate({
        templateId,
        ownerId: userId,
        ownerName: userName,
        clientId: clientId || undefined,
        clientName: clientName || undefined,
        projectId: projectId || undefined,
        projectName: projectName || undefined,
        startDate: startDate ? new Date(startDate) : undefined,
    });

    return {
        success: true,
        message: `Created ${result.taskCount} tasks from template`,
        taskCount: result.taskCount,
        taskIds: result.taskIds,
    };
});
