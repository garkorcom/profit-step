/**
 * @fileoverview Cost Created Trigger for Audit Logging
 * 
 * Logs material purchases and operational expenses to BigQuery.
 * 
 * @module triggers/firestore/onCostCreated
 */

import * as functions from 'firebase-functions';
import { logAuditEvent } from '../../utils/auditLogger';

export const onCostCreated = functions
    .region('us-central1')
    .firestore.document('costs/{costId}')
    .onCreate(async (snap, context) => {
        const cost = snap.data();
        const costId = context.params.costId;

        // Determine event code based on category
        const eventCode = cost.category === 'material'
            ? 'MATERIAL_PURCHASED'
            : 'MATERIAL_PURCHASED'; // Default for now, can expand

        await logAuditEvent({
            entityType: 'cost',
            entityId: costId,
            eventCode: eventCode,
            actorUid: cost.createdBy || cost.uploadedBy,
            projectId: cost.clientId || cost.projectId,
            companyId: cost.companyId,
            after: {
                category: cost.category,
                amount: cost.amount,
                description: cost.description,
                vendor: cost.vendor,
            },
            financialImpact: -(cost.amount || 0), // Negative = expense
        });

        console.log(`📊 Cost logged: $${cost.amount} for ${cost.category}`);
    });

/**
 * Cost Update Trigger - logs price changes
 */
export const onCostUpdate = functions
    .region('us-central1')
    .firestore.document('costs/{costId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const costId = context.params.costId;

        // Price changed
        if (before.amount !== after.amount) {
            const difference = (after.amount || 0) - (before.amount || 0);

            await logAuditEvent({
                entityType: 'cost',
                entityId: costId,
                eventCode: 'PRICE_OVERRIDE',
                actorUid: after.updatedBy,
                projectId: after.clientId,
                companyId: after.companyId,
                before: { amount: before.amount },
                after: { amount: after.amount },
                financialImpact: -difference, // Negative = more expense
            });

            console.log(`📊 Cost ${costId}: price changed $${before.amount} → $${after.amount}`);
        }
    });
