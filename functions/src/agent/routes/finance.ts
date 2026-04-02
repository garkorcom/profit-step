/**
 * Finance Routes — context, batch, approve, undo + projects/status (5 endpoints)
 */
import { Router } from 'express';

import { db, FieldValue, Timestamp, logger, fuzzySearchClient, COST_CATEGORY_LABELS } from '../routeContext';
import {
  ProjectStatusQuery,
  FinanceBatchSchema,
  FinanceApproveSchema,
  FinanceUndoSchema,
} from '../schemas';

const router = Router();

// ─── GET /api/projects/status ───────────────────────────────────────

router.get('/api/projects/status', async (req, res, next) => {
  try {
    const q = ProjectStatusQuery.parse(req.query);
    let clientId = q.clientId;

    // Resolve clientName → clientId via fuzzy search
    if (!clientId && q.clientName) {
      const match = await fuzzySearchClient(q.clientName);
      if (!match) {
        res.status(404).json({ error: 'Клиент не найден' });
        return;
      }
      clientId = match.id;
    }

    if (!clientId) {
      res.status(400).json({ error: 'Необходим clientId или clientName' });
      return;
    }

    logger.info('📊 projects:status', { clientId });

    // Parallel queries: count() for totals + limited reads for aggregation
    const [taskCount, costCount, recentTasks, recentCosts, sessions] = await Promise.all([
      db.collection('gtd_tasks').where('clientId', '==', clientId).count().get(),
      db.collection('costs').where('clientId', '==', clientId).count().get(),
      db.collection('gtd_tasks').where('clientId', '==', clientId)
        .orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('costs').where('clientId', '==', clientId)
        .orderBy('createdAt', 'desc').limit(200).get(),
      db.collection('work_sessions').where('clientId', '==', clientId)
        .where('status', '==', 'completed')
        .orderBy('startTime', 'desc').limit(200).get(),
    ]);

    // Task breakdown by status
    const byStatus: Record<string, number> = {};
    recentTasks.docs.forEach((d) => {
      const status = d.data().status as string;
      byStatus[status] = (byStatus[status] || 0) + 1;
    });

    // Financial aggregation
    const totalCosts = recentCosts.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
    const totalMins = sessions.docs.reduce((sum, d) => sum + (d.data().durationMinutes || 0), 0);
    const totalEarn = sessions.docs.reduce((sum, d) => sum + (d.data().sessionEarnings || 0), 0);

    logger.info('📊 projects:status result', {
      clientId,
      tasks: taskCount.data().count,
      costs: costCount.data().count,
      sessions: sessions.size,
    });

    res.json({
      clientId,
      tasks: { total: taskCount.data().count, recentByStatus: byStatus },
      costs: { total: +totalCosts.toFixed(2), count: costCount.data().count },
      time: { totalHours: +(totalMins / 60).toFixed(1), totalEarnings: +totalEarn.toFixed(2) },
    });
  } catch (e) {
    next(e);
  }
});


// ─── GET /api/finance/context ───────────────────────────────────────

router.get('/api/finance/context', async (req, res, next) => {
  try {
    logger.info('🏦 finance:context');
    // Active projects (using projects collection, mapped to clientId)
    const projectsSnap = await db.collection('projects').where('status', '==', 'active').get();
    const projects = projectsSnap.docs.map(d => ({ 
       id: d.id, 
       projectId: d.data().clientId || d.id, 
       name: d.data().name || 'Unknown', 
       clientName: d.data().clientName || '' 
    }));
    
    const categories = Object.keys(COST_CATEGORY_LABELS);

    const rulesSnap = await db.collection('finance_rules').get();
    const rules = rulesSnap.docs.map(d => ({ merchantName: d.id, ...d.data() }));

    res.json({ projects, categories, rules });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/finance/transactions/batch ───────────────────────────

router.post('/api/finance/transactions/batch', async (req, res, next) => {
  try {
    const data = FinanceBatchSchema.parse(req.body);
    logger.info(`🏦 finance:batch. Count: ${data.transactions.length}`);

    const CHUNK_SIZE = 400;
    let savedCount = 0;

    for (let i = 0; i < data.transactions.length; i += CHUNK_SIZE) {
      const chunk = data.transactions.slice(i, i + CHUNK_SIZE);
      
      const refs = chunk.map(t => db.collection('bank_transactions').doc(t.id));
      const snaps = await db.getAll(...refs);
      
      const approvedIds = new Set<string>();
      snaps.forEach(snap => {
        if (snap.exists && snap.data()?.status === 'approved') {
          approvedIds.add(snap.id);
        }
      });

      const batch = db.batch();
      for (const t of chunk) {
        if (approvedIds.has(t.id)) {
          logger.info(`🏦 finance:batch. Skipping ${t.id} - already approved`);
          continue;
        }
        const docRef = db.collection('bank_transactions').doc(t.id);
        batch.set(docRef, {
          ...t,
          status: 'draft',
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        savedCount++;
      }
      await batch.commit();
    }

    res.status(200).json({ success: true, count: savedCount, totalReceived: data.transactions.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/finance/transactions/approve ─────────────────────────

router.post('/api/finance/transactions/approve', async (req, res, next) => {
  try {
    const data = FinanceApproveSchema.parse(req.body);
    logger.info(`🏦 finance:approve. Count: ${data.transactions.length}`);

    // Each transaction can generate up to 3 batch ops (cost + rule + bank_tx update).
    // Firestore batch limit = 500 ops. 150 × 3 = 450 — safe margin.
    const CHUNK_SIZE = 150;
    for (let i = 0; i < data.transactions.length; i += CHUNK_SIZE) {
      const chunk = data.transactions.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();

      for (const t of chunk) {
        let generatedCostId: string | null = null;
        
        // Действие А: Копирует данные и создает документы в costs 
        if (t.paymentType === 'company' && t.projectId) {
           const costRef = db.collection('costs').doc();
           generatedCostId = costRef.id;
           
           const isRefund = t.amount > 0;
           const effectiveAmount = isRefund ? -Math.abs(t.amount) : Math.abs(t.amount);
           
           batch.set(costRef, {
             userId: req.agentUserId || 'system',
             userName: req.agentUserName || 'system',
             clientId: t.projectId,
             clientName: 'Reconciled via Bank', 
             category: t.categoryId,
             categoryLabel: COST_CATEGORY_LABELS[t.categoryId as keyof typeof COST_CATEGORY_LABELS] || t.categoryId,
             amount: effectiveAmount,
             originalAmount: Math.abs(t.amount),
             taxAmount: t.taxAmount || 0,
             description: `[Bank] ${t.cleanMerchant}${t.rawDescription ? ' - ' + t.rawDescription : ''}`,
             receiptPhotoUrl: null,
             voiceNoteUrl: null,
             status: 'confirmed',
             source: 'bank_statement',
             date: Timestamp.fromDate(new Date(t.date)),
             createdAt: FieldValue.serverTimestamp(),
           });
        }

        // Действие Б: Самообучение (Upsert в finance_rules)
        const safeMerchant = t.cleanMerchant.trim().toLowerCase();
        if (safeMerchant) {
          const ruleRef = db.collection('finance_rules').doc(safeMerchant);
          batch.set(ruleRef, {
            merchantName: safeMerchant,
            defaultPaymentType: t.paymentType,
            defaultCategoryId: t.categoryId,
            defaultProjectId: t.projectId || null,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        // Действие В: Обновление статуса в bank_transactions
        const draftRef = db.collection('bank_transactions').doc(t.id);
        batch.update(draftRef, {
           status: 'approved',
           paymentType: t.paymentType,
           categoryId: t.categoryId,
           projectId: t.projectId || null,
           costId: generatedCostId,
           updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    res.status(200).json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/finance/transactions/undo ─────────────────────────

router.post('/api/finance/transactions/undo', async (req, res, next) => {
  try {
    const data = FinanceUndoSchema.parse(req.body);
    logger.info(`🏦 finance:undo. Count: ${data.transactionIds.length}`);

    const batch = db.batch();
    const refs = data.transactionIds.map(id => db.collection('bank_transactions').doc(id));
    const snaps = await db.getAll(...refs);

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const txData = snap.data()!;
      if (txData.status !== 'approved') continue;

      if (txData.costId) {
        batch.delete(db.collection('costs').doc(txData.costId));
      }

      batch.update(snap.ref, {
        status: 'draft',
        costId: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    res.status(200).json({ success: true, count: snaps.filter(s => s.exists).length });
  } catch (e) {
    next(e);
  }
});


export default router;
