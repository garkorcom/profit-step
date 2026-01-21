/**
 * @fileoverview Template Matcher Utilities
 * 
 * Provides pattern matching for task descriptions against
 * predefined templates for instant estimation.
 */

import * as admin from 'firebase-admin';
import {
    AIEstimateTemplate,
    TemplateMatchResult,
    TEMPLATE_CONFIG,
    DEFAULT_TEMPLATES,
} from '../types/aiTemplates';
import { AIEstimateResponse } from '../types/aiEstimate';
import { normalizeDescription } from './aiCacheUtils';

const db = admin.firestore();

/**
 * Find a matching template for the given description
 */
export async function findTemplateMatch(
    description: string,
    role?: string
): Promise<TemplateMatchResult> {
    const normalized = normalizeDescription(description);

    try {
        // MVP: Use hardcoded templates directly
        // TODO: Add Firestore lookup when index is created
        const templates: AIEstimateTemplate[] = DEFAULT_TEMPLATES.map((t, i) => ({
            ...t,
            id: `default_${i}`,
            createdAt: admin.firestore.Timestamp.now(),
        }));

        console.log(`[Template] Checking ${templates.length} templates for: "${normalized}"`);

        // Try to match each template
        for (const template of templates) {
            // Check role filter if specified
            if (template.roleFilter && role && !role.toLowerCase().includes(template.roleFilter.toLowerCase())) {
                continue;
            }

            // Check pattern match (glob-style)
            const patternRegex = globToRegex(template.pattern);
            if (patternRegex.test(normalized)) {
                const quantity = extractQuantity(description, template.unitRegex, template.defaultUnits);
                const totalHours = template.hoursPerUnit * quantity;

                console.log(`✨ Template HIT: "${template.pattern}" → ${quantity} × ${template.hoursPerUnit}h = ${totalHours}h`);

                return {
                    matched: true,
                    template,
                    quantity,
                    totalHours,
                };
            }

            // Check keywords
            for (const keyword of template.keywords) {
                if (normalized.includes(keyword.toLowerCase())) {
                    const quantity = extractQuantity(description, template.unitRegex, template.defaultUnits);
                    const totalHours = template.hoursPerUnit * quantity;

                    console.log(`✨ Keyword HIT: "${keyword}" → ${quantity} × ${template.hoursPerUnit}h = ${totalHours}h`);

                    return {
                        matched: true,
                        template,
                        quantity,
                        totalHours,
                    };
                }
            }
        }

        return { matched: false, quantity: 0, totalHours: 0 };

    } catch (error) {
        console.error('[Template Matcher] Error:', error);
        return { matched: false, quantity: 0, totalHours: 0 };
    }
}

/**
 * Convert glob pattern to regex
 * "розетк*" → /розетк.* /i
 */
function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
        .replace(/\*/g, '.*')                   // * → .*
        .replace(/\?/g, '.');                   // ? → .
    return new RegExp(escaped, 'i');
}

/**
 * Extract quantity from description using regex
 */
function extractQuantity(description: string, unitRegex: string, defaultUnits: number): number {
    try {
        const regex = new RegExp(unitRegex, 'i');
        const match = description.match(regex);

        if (match && match[1]) {
            const qty = parseInt(match[1], 10);
            if (!isNaN(qty) && qty > 0) {
                return qty;
            }
        }
    } catch (e) {
        // Invalid regex, use default
    }

    return defaultUnits;
}

/**
 * Convert template match to AIEstimateResponse format
 */
export function templateToResponse(
    matchResult: TemplateMatchResult,
    hourlyRate: number
): AIEstimateResponse {
    const template = matchResult.template!;
    const hours = matchResult.totalHours;
    const cost = Math.round(hours * hourlyRate);

    // Build reasoning with quantity
    const reasoning = matchResult.quantity > 1
        ? `${template.reasoning} Расчёт: ${matchResult.quantity} ${template.unitName} × ${template.hoursPerUnit}ч = ${hours}ч.`
        : template.reasoning;

    return {
        estimated_hours: hours,
        calculated_cost: cost,
        reasoning,
        suggested_materials: template.materials,
        suggested_tools: template.tools,
        fromTemplate: true,
        fromCache: false,
    };
}

/**
 * Seed default templates to Firestore (run once)
 */
export async function seedDefaultTemplates(): Promise<void> {
    const batch = db.batch();

    for (const template of DEFAULT_TEMPLATES) {
        const docRef = db.collection(TEMPLATE_CONFIG.COLLECTION).doc();
        batch.set(docRef, {
            ...template,
            createdAt: admin.firestore.Timestamp.now(),
        });
    }

    await batch.commit();
    console.log(`✅ Seeded ${DEFAULT_TEMPLATES.length} default templates`);
}
