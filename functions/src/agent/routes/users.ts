/**
 * User & Contact Routes — search, create-from-bot, contacts (4 endpoints)
 */
import { Router } from 'express';

import { db, FieldValue, logger, logAgentActivity, Fuse } from '../routeContext';
import {
  UserSearchQuerySchema,
  CreateUserFromBotSchema,
  CreateContactSchema,
  SearchContactsQuerySchema,
} from '../schemas';

const router = Router();

// ─── GET /api/users/search (Phase 2) ───────────────────────────────

router.get('/api/users/search', async (req, res, next) => {
  try {
    const params = UserSearchQuerySchema.parse(req.query);
    logger.info('👤 users:search', { q: params.q });

    const snap = await db.collection('users').get();
    const users = snap.docs.map((d) => ({
      id: d.id,
      displayName: d.data().displayName || '',
      email: d.data().email || '',
      role: d.data().role || 'employee',
      hourlyRate: d.data().hourlyRate || 0,
    }));

    const fuse = new Fuse(users, {
      keys: ['displayName', 'email'],
      threshold: 0.4,
    });

    const results = fuse.search(params.q, { limit: params.limit }).map((r: any) => ({
      userId: r.item.id,
      displayName: r.item.displayName,
      email: r.item.email,
      role: r.item.role,
      hourlyRate: r.item.hourlyRate,
      score: r.score,
    }));

    res.json({ results, count: results.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/users/create-from-bot ────────────────────────────────

router.post('/api/users/create-from-bot', async (req, res, next) => {
  try {
    const data = CreateUserFromBotSchema.parse(req.body);
    const telegramIdStr = String(data.telegramId);
    logger.info('👤 users:create-from-bot', { telegramId: telegramIdStr, displayName: data.displayName });

    // Check if user with this telegramId already exists
    const existingSnap = await db.collection('users')
      .where('telegramId', '==', telegramIdStr)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      // Update hourlyRate for existing user
      const existingDoc = existingSnap.docs[0];
      await existingDoc.ref.update({
        hourlyRate: data.hourlyRate,
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('👤 users:updated hourlyRate', { userId: existingDoc.id, hourlyRate: data.hourlyRate });
      await logAgentActivity({
        userId: req.agentUserId!,
        action: 'user_updated_from_bot',
        endpoint: '/api/users/create-from-bot',
        metadata: { userId: existingDoc.id, telegramId: telegramIdStr, hourlyRate: data.hourlyRate },
      });

      res.status(200).json({
        userId: existingDoc.id,
        updated: true,
        message: `Ставка обновлена: $${data.hourlyRate}/ч`,
      });
      return;
    }

    // Create new user document
    const docRef = await db.collection('users').add({
      telegramId: telegramIdStr,
      displayName: data.displayName,
      hourlyRate: data.hourlyRate,
      role: data.role,
      source: 'bot',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('👤 users:created from bot', { userId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'user_created_from_bot',
      endpoint: '/api/users/create-from-bot',
      metadata: { userId: docRef.id, telegramId: telegramIdStr, displayName: data.displayName },
    });

    res.status(201).json({
      userId: docRef.id,
      created: true,
      message: `Пользователь "${data.displayName}" создан`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/contacts ────────────────────────────────────────────

router.post('/api/contacts', async (req, res, next) => {
  try {
    const data = CreateContactSchema.parse(req.body);
    logger.info('📇 contacts:create', { name: data.name });

    const docRef = await db.collection('contacts').add({
      name: data.name,
      phones: data.phones,
      roles: data.roles,
      linkedProjects: data.linkedProjects,
      notes: data.notes || '',
      emails: data.emails,
      messengers: data.messengers,
      defaultCity: data.defaultCity || null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.agentUserId || 'system',
    });

    logger.info('📇 contacts:created', { contactId: docRef.id });
    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'contact_created',
      endpoint: '/api/contacts',
      metadata: { contactId: docRef.id, name: data.name },
    });

    res.status(201).json({ contactId: docRef.id, name: data.name });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/contacts/search ──────────────────────────────────────

router.get('/api/contacts/search', async (req, res, next) => {
  try {
    const params = SearchContactsQuerySchema.parse(req.query);
    logger.info('📇 contacts:search', { q: params.q, role: params.role, projectId: params.projectId });

    const snap = await db.collection('contacts').get();
    let contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Filter by role if specified
    if (params.role) {
      const roleLower = params.role.toLowerCase();
      contacts = contacts.filter((c: any) =>
        Array.isArray(c.roles) && c.roles.some((r: string) => r.toLowerCase().includes(roleLower))
      );
    }

    // Filter by project if specified
    if (params.projectId) {
      contacts = contacts.filter((c: any) =>
        Array.isArray(c.linkedProjects) && c.linkedProjects.includes(params.projectId)
      );
    }

    // Fuzzy search by name
    const fuseOptions = {
      keys: ['name', 'notes', 'defaultCity'],
      threshold: 0.4,
    };
    const fuse = new Fuse(contacts, fuseOptions);
    const results = fuse.search(params.q, { limit: params.limit }).map((r: any) => ({
      contactId: r.item.id,
      name: r.item.name,
      phones: r.item.phones || [],
      roles: r.item.roles || [],
      linkedProjects: r.item.linkedProjects || [],
      notes: r.item.notes || '',
      emails: r.item.emails || [],
      messengers: r.item.messengers || {},
      defaultCity: r.item.defaultCity || null,
      score: r.score,
    }));

    res.json({ results, count: results.length });
  } catch (e) {
    next(e);
  }
});

export default router;
