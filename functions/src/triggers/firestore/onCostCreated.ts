/**
 * @fileoverview Cost Created Trigger for Audit Logging
 *
 * Logs material purchases and operational expenses to BigQuery.
 *
 * SAFETY:
 * - try/catch with structured error logging (functions.logger)
 * - onCostUpdate: field-change guard skips if no relevant fields changed
 * - Returns null on error to prevent retries
 *
 * @module triggers/firestore/onCostCreated
 */

import * as functions from 'firebase-functions';
import { logAuditEvent } from '../../utils/auditLogger';

export const onCostCreated = functions
    .region('us-central1')
    .firestore.document('costs/{costId}')
    .onCreate(async (snap, context) => {
        const costId = context.params.costId;

        try {
            const cost = snap.data();

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

            functions.logger.info('onCostCreated: audit logged', {
                costId,
                amount: cost.amount,
                category: cost.category,
            });

            return null;
        } catch (error: any) {
            functions.logger.error('onCostCreated: failed', {
                costId,
                collection: 'costs',
                errorMessage: error?.message,
                errorStack: error?.stack,
            });
            return null;
        }
    });

/**
 * Cost Update Trigger - logs price changes
 *
 * GUARD: skips if amount, category, vendor, description unchanged
 */
export const onCostUpdate = functions
    .region('us-central1')
    .firestore.document('costs/{costId}')
    .onUpdate(async (change, context) => {
        const costId = context.params.costId;

        try {
            const before = change.before.data();
            const after = change.after.data();

            // Field-change guard: skip if no auditable fields changed
            if (
                before.amount === after.amount &&
                before.category === after.category &&
                before.vendor === after.vendor &&
                before.description === after.description
            ) {
                functions.logger.debug('onCostUpdate: no relevant fields changed, skipping', { costId });
                return null;
            }

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

                functions.logger.info('onCostUpdate: price change logged', {
                    costId,
                    beforeAmount: before.amount,
                    afterAmount: after.amount,
                });
            }

            return null;
        } catch (error: any) {
            functions.logger.error('onCostUpdate: failed', {
                costId,
                collection: 'costs',
                errorMessage: error?.message,
                errorStack: error?.stack,
            });
            return null;
        }
    });
