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
    // ── RLS: worker/driver/supply cannot view project financial status ──
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole === 'worker' || rlsRole === 'driver' || rlsRole === 'supply') {
      res.status(403).json({ error: 'Project status requires foreman/manager/accountant/admin role' });
      return;
    }
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
    // ── RLS: finance context is admin/manager/accountant only ──
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole === 'worker' || rlsRole === 'driver' || rlsRole === 'supply') {
      res.status(403).json({ error: 'Finance context requires manager/accountant/admin role' });
      return;
    }
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

    // ── Auto-approve pass: check finance_rules with autoApprove=true ──
    let autoApprovedCount = 0;
    const rulesSnap = await db.collection('finance_rules').where('autoApprove', '==', true).get();
    if (rulesSnap.size > 0) {
      const autoRules = new Map<string, { paymentType: string; categoryId: string; projectId: string | null }>();
      rulesSnap.docs.forEach(d => {
        const rd = d.data();
        autoRules.set(d.id, {
          paymentType: rd.defaultPaymentType || 'cash',
          categoryId: rd.defaultCategoryId || 'other',
          projectId: rd.defaultProjectId || null,
        });
      });

      // Re-query newly saved drafts that match auto-approve rules
      const draftsSnap = await db.collection('bank_transactions').where('status', '==', 'draft').get();
      const autoApproveBatch = db.batch();
      let opsCount = 0;
      for (const doc of draftsSnap.docs) {
        const txData = doc.data();
        const merchant = (txData.cleanMerchant || '').trim().toLowerCase();
        const rule = autoRules.get(merchant);
        if (!rule) continue;
        if (opsCount >= 450) break; // safety: batch limit

        // Auto-approve: update the bank_transaction
        autoApproveBatch.update(doc.ref, {
          status: 'approved',
          paymentType: rule.paymentType,
          categoryId: rule.categoryId,
          projectId: rule.projectId,
          autoApproved: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        opsCount++;

        // Create cost if company + projectId
        if (rule.paymentType === 'company' && rule.projectId) {
          const costRef = db.collection('costs').doc();
          const isRefund = txData.amount > 0;
          const effectiveAmount = isRefund ? -Math.abs(txData.amount) : Math.abs(txData.amount);
          autoApproveBatch.set(costRef, {
            userId: 'auto-approve',
            userName: 'Auto-approve rule',
            clientId: rule.projectId,
            clientName: 'Auto-approved via rule',
            category: rule.categoryId,
            categoryLabel: COST_CATEGORY_LABELS[rule.categoryId as keyof typeof COST_CATEGORY_LABELS] || rule.categoryId,
            amount: effectiveAmount,
            originalAmount: Math.abs(txData.amount),
            paymentType: rule.paymentType,
            description: `[Auto] ${txData.cleanMerchant || ''}`,
            status: 'confirmed',
            source: 'bank_statement',
            date: txData.date || FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          });
          opsCount++;
        }
        autoApprovedCount++;
      }
      if (autoApprovedCount > 0) {
        await autoApproveBatch.commit();
        logger.info(`🤖 finance:batch auto-approved ${autoApprovedCount} transactions`);
      }
    }

    // ── Tampa geo-auto-approve: detect FL Tampa-area transactions ──
    let tampaAutoCount = 0;
    const TAMPA_CITIES = new Set([
      'tampa','wesley chapel','zephyrhills','brandon','riverview','lutz','land o lakes',
      'new port richey','plant city','valrico','seffner','temple terrace','odessa',
      'spring hill','lakeland','dade city','brooksville','st petersburg','clearwater',
      'largo','pinellas park','dunedin','tarpon springs','palm harbor','safety harbor',
      'seminole','sarasota','bradenton','palmetto','venice','north port','englewood',
      'ellenton','parrish','osprey','nokomis','winter haven','bartow','auburndale',
      'haines city','lake wales','polk city','mulberry','davenport','hudson','port richey',
      'crystal river','inverness','orlando','kissimmee','sanford','winter park',
      'altamonte springs','casselberry','oviedo','apopka','clermont','leesburg',
      'mount dora','ocala','st cloud','winter garden','celebration','port charlotte',
      'punta gorda','cape coral','fort myers','lehigh acres','bonita springs','estero',
      'daytona beach','deland','deltona','new smyrna beach','ormond beach','fern park',
    ]);

    // Find Tampa project
    const tampaProjectSnap = await db.collection('projects').where('status', '==', 'active').get();
    const tampaProject = tampaProjectSnap.docs.find(d => {
      const name = (d.data().name || '').toLowerCase();
      return name.includes('tampa') || name.includes('тампа');
    });

    if (tampaProject) {
      const tampaProjectId = tampaProject.data().clientId || tampaProject.id;
      const tampaProjectName = tampaProject.data().name || 'Tampa';
      const remainingDrafts = await db.collection('bank_transactions').where('status', '==', 'draft').get();
      const tampaBatch = db.batch();
      let tampaOps = 0;

      for (const txDoc of remainingDrafts.docs) {
        const txData = txDoc.data();
        const desc = (txData.rawDescription || '').toUpperCase();
        // Check if any Tampa-area city appears in the raw description
        let isTampa = false;
        for (const city of TAMPA_CITIES) {
          if (desc.includes(city.toUpperCase())) { isTampa = true; break; }
        }
        if (!isTampa) continue;
        if (tampaOps >= 400) break;

        tampaBatch.update(txDoc.ref, {
          status: 'approved',
          paymentType: 'company',
          projectId: tampaProjectId,
          autoApproved: true,
          autoApproveSource: 'tampa-geo',
          updatedAt: FieldValue.serverTimestamp(),
        });
        tampaOps++;

        // Create cost record
        const costRef = db.collection('costs').doc();
        const isRefund = txData.amount > 0;
        const effectiveAmount = isRefund ? -Math.abs(txData.amount) : Math.abs(txData.amount);
        tampaBatch.set(costRef, {
          userId: 'auto-tampa',
          userName: 'Tampa geo-auto',
          clientId: tampaProjectId,
          clientName: tampaProjectName,
          category: txData.categoryId || 'other',
          categoryLabel: COST_CATEGORY_LABELS[(txData.categoryId || 'other') as keyof typeof COST_CATEGORY_LABELS] || 'other',
          amount: effectiveAmount,
          originalAmount: Math.abs(txData.amount),
          paymentType: 'company',
          description: `[Tampa Auto] ${txData.cleanMerchant || ''}`,
          status: 'confirmed',
          source: 'bank_statement',
          date: txData.date || FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });
        tampaOps++;
        tampaAutoCount++;
      }

      if (tampaAutoCount > 0) {
        await tampaBatch.commit();
        logger.info(`🏗️ finance:batch tampa-geo auto-approved ${tampaAutoCount} transactions → ${tampaProjectName}`);
      }
    }

    res.status(200).json({
      success: true,
      count: savedCount,
      autoApproved: autoApprovedCount,
      tampaAutoApproved: tampaAutoCount,
      totalReceived: data.transactions.length,
    });
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

        // Действие А: Создаёт costs — для company (с проектом) ИЛИ personal (с сотрудником)
        const shouldCreateCost =
          (t.paymentType === 'company' && t.projectId) ||
          (t.paymentType === 'cash' && t.employeeId);

        if (shouldCreateCost) {
           const costRef = db.collection('costs').doc();
           generatedCostId = costRef.id;

           const isRefund = t.amount > 0;
           const effectiveAmount = isRefund ? -Math.abs(t.amount) : Math.abs(t.amount);

           batch.set(costRef, {
             userId: t.employeeId || req.agentUserId || 'system',
             userName: t.employeeName || req.agentUserName || 'system',
             clientId: t.projectId || null,
             clientName: t.paymentType === 'cash' ? 'Personal expense' : 'Reconciled via Bank',
             category: t.categoryId,
             categoryLabel: COST_CATEGORY_LABELS[t.categoryId as keyof typeof COST_CATEGORY_LABELS] || t.categoryId,
             amount: effectiveAmount,
             originalAmount: Math.abs(t.amount),
             taxAmount: t.taxAmount || 0,
             paymentType: t.paymentType,
             employeeId: t.employeeId || null,
             employeeName: t.employeeName || null,
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
           employeeId: t.employeeId || null,
           employeeName: t.employeeName || null,
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


// ─── GET /api/finance/rules ──────────────────────────────────────────

router.get('/api/finance/rules', async (req, res, next) => {
  try {
    // ── RLS: finance rules admin/manager/accountant only ──
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole === 'worker' || rlsRole === 'driver' || rlsRole === 'supply' || rlsRole === 'foreman') {
      res.status(403).json({ error: 'Finance rules requires manager/accountant/admin role' });
      return;
    }
    const snap = await db.collection('finance_rules').get();
    const rules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ rules });
  } catch (e) {
    next(e);
  }
});

// ─── PUT /api/finance/rules/:id ─────────────────────────────────────

router.put('/api/finance/rules/:id', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole !== 'admin' && rlsRole !== 'manager' && rlsRole !== 'accountant') {
      res.status(403).json({ error: 'Finance rules requires manager/accountant/admin role' });
      return;
    }
    const { id } = req.params;
    const { autoApprove, defaultPaymentType, defaultCategoryId, defaultProjectId } = req.body;
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof autoApprove === 'boolean') update.autoApprove = autoApprove;
    if (defaultPaymentType) update.defaultPaymentType = defaultPaymentType;
    if (defaultCategoryId) update.defaultCategoryId = defaultCategoryId;
    if (defaultProjectId !== undefined) update.defaultProjectId = defaultProjectId || null;
    await db.collection('finance_rules').doc(id).update(update);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/finance/rules/:id ──────────────────────────────────

router.delete('/api/finance/rules/:id', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole !== 'admin' && rlsRole !== 'manager' && rlsRole !== 'accountant') {
      res.status(403).json({ error: 'Finance rules requires manager/accountant/admin role' });
      return;
    }
    await db.collection('finance_rules').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
