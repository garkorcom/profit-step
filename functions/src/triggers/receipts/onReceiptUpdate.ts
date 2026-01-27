/**
 * @fileoverview Trigger for creating ledger entries from shopping receipts
 * 
 * When a receipt gets a totalAmount (during manager review), 
 * automatically creates a debit entry in the project ledger.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * Trigger on receipt update - create ledger entry when totalAmount is added
 */
export const onReceiptUpdate = functions.firestore
    .document('receipts/{receiptId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const receiptId = context.params.receiptId;

        // Only process when totalAmount is added or changed
        if (before.totalAmount === after.totalAmount) {
            return; // No change in amount
        }

        // Skip if no amount set yet
        if (!after.totalAmount || after.totalAmount <= 0) {
            console.log(`⏭️ Receipt ${receiptId} has no totalAmount, skipping ledger entry`);
            return;
        }

        // Skip if ledger entry already exists for this receipt
        if (after.ledgerEntryId) {
            console.log(`⏭️ Receipt ${receiptId} already has ledger entry, skipping`);
            return;
        }

        const clientId = after.clientId;
        if (!clientId) {
            console.log(`⏭️ Receipt ${receiptId} has no clientId, skipping ledger entry`);
            return;
        }

        console.log(`🧾 Processing receipt ${receiptId} with amount $${after.totalAmount}`);

        try {
            // Get or create project for this client
            const projectsSnap = await db.collection('projects')
                .where('clientId', '==', clientId)
                .where('status', '==', 'active')
                .limit(1)
                .get();

            let projectId: string;
            let projectRef;

            if (projectsSnap.empty) {
                // Create default project
                projectRef = db.collection('projects').doc();
                projectId = projectRef.id;

                await projectRef.set({
                    clientId,
                    clientName: after.clientName || 'Unknown',
                    companyId: 'default',
                    name: 'Основной проект',
                    status: 'active',
                    totalDebit: 0,
                    totalCredit: 0,
                    balance: 0,
                    createdAt: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                    createdBy: 'system'
                });
                console.log(`📁 Created default project for client ${clientId}`);
            } else {
                projectId = projectsSnap.docs[0].id;
            }

            // Create ledger entry
            const ledgerRef = db.collection('project_ledger').doc();
            const uploaderName = after.uploadedByName || `User ${after.uploadedBy}`;
            const itemCount = after.linkedItemIds?.length || 0;

            await ledgerRef.set({
                projectId,
                clientId,
                companyId: 'default',
                type: 'debit',
                category: 'materials',
                amount: Math.round(after.totalAmount * 100) / 100,
                description: `Закупка: ${uploaderName}, ${itemCount} товаров`,
                sourceType: 'shopping_receipt',
                sourceId: receiptId,
                date: after.createdAt || admin.firestore.Timestamp.now(),
                createdAt: admin.firestore.Timestamp.now(),
                createdBy: 'system'
            });

            // Update project totals
            const projectDoc = projectsSnap.empty ? projectRef : db.collection('projects').doc(projectId);
            const currentProject = projectsSnap.empty ? null : projectsSnap.docs[0].data();

            const newDebit = (currentProject?.totalDebit || 0) + after.totalAmount;
            const newCredit = currentProject?.totalCredit || 0;

            await projectDoc!.update({
                totalDebit: Math.round(newDebit * 100) / 100,
                balance: Math.round((newDebit - newCredit) * 100) / 100,
                updatedAt: admin.firestore.Timestamp.now()
            });

            // Mark receipt as processed
            await change.after.ref.update({
                ledgerEntryId: ledgerRef.id
            });

            console.log(`💰 Ledger entry created: $${after.totalAmount} materials for project ${projectId}`);

        } catch (error) {
            console.error('❌ Error creating ledger entry from receipt:', error);
        }
    });
