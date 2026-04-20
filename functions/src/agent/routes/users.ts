/**
 * User & Contact Routes — search, create-from-bot, contacts, bot-directory, telegram-link, notify (8 endpoints)
 */
import { Router } from 'express';

import { db, FieldValue, logger, logAgentActivity, Fuse } from '../routeContext';
import { TELEGRAM_BOT_TOKEN } from '../../config';
import { scopesForRole } from '../agentMiddleware';
import {
  UserSearchQuerySchema,
  ListUsersQuerySchema,
  CreateUserFromBotSchema,
  CreateContactSchema,
  SearchContactsQuerySchema,
  TelegramLinkSchema,
  BotNotifySchema,
} from '../schemas';

const router = Router();

// ─── GET /api/users/list ───────────────────────────────────────────

router.get('/api/users/list', async (req, res, next) => {
  try {
    const params = ListUsersQuerySchema.parse(req.query);
    logger.info('👤 users:list', { role: params.role, limit: params.limit });

    const snap = await db.collection('users').get();
    let users = snap.docs.map((d) => ({
      userId: d.id,
      displayName: d.data().displayName || '',
      email: d.data().email || '',
      role: d.data().role || 'employee',
      hourlyRate: d.data().hourlyRate || 0,
    }));

    // Filter by role if specified
    if (params.role) {
      const roleLower = params.role.toLowerCase();
      users = users.filter((u) => u.role.toLowerCase() === roleLower);
    }

    const total = users.length;
    const result = users.slice(params.offset, params.offset + params.limit);

    res.json({ users: result, count: result.length, total });
  } catch (e) {
    next(e);
  }
});

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

// ─── GET /api/users/bot-directory ──────────────────────────────────
// Master Token only. Returns full user map for bot local cache.

router.get('/api/users/bot-directory', async (req, res, next) => {
  try {
    if (req.agentTokenType !== 'master') {
      res.status(403).json({ error: 'Master Token required', code: 'FORBIDDEN' });
      return;
    }

    logger.info('👤 users:bot-directory');

    const snap = await db.collection('users')
      .where('status', 'in', ['active', 'inactive'])
      .get();

    const users = snap.docs.map(d => {
      const data = d.data();
      const role = data.role || 'worker';
      return {
        uid: d.id,
        displayName: data.displayName || data.email || d.id,
        telegramId: data.telegramId ? Number(data.telegramId) || null : null,
        telegramUsername: data.telegramUsername || null,
        role,
        scopes: data.scopes || scopesForRole(role),
        teamId: data.teamId || null,
        teamLeadUid: data.teamLeadUid || null,
        status: data.status || 'active',
        preferredLanguage: data.preferredLanguage || 'ru',
        hourlyRate: typeof data.hourlyRate === 'number' ? data.hourlyRate : null,
      };
    });

    // Build teams map from users with teamId
    const teamsMap = new Map<string, { teamId: string; leadUid: string | null; memberUids: string[] }>();
    users.forEach(u => {
      if (!u.teamId) return;
      if (!teamsMap.has(u.teamId)) teamsMap.set(u.teamId, { teamId: u.teamId, leadUid: null, memberUids: [] });
      const team = teamsMap.get(u.teamId)!;
      team.memberUids.push(u.uid);
      if (u.role === 'foreman') team.leadUid = u.uid;
    });

    res.json({
      users,
      teams: Array.from(teamsMap.values()),
      lastUpdated: new Date().toISOString(),
      total: users.length,
    });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/users/:uid/telegram-link ──────────────────────────
// Admin scope. Binds Telegram ID to existing CRM user.

router.patch('/api/users/:uid/telegram-link', async (req, res, next) => {
  try {
    const hasAdmin = req.effectiveScopes?.includes('admin') || req.effectiveScopes?.includes('users:manage');
    if (!hasAdmin) {
      res.status(403).json({ error: 'Requires admin or users:manage scope', code: 'FORBIDDEN' });
      return;
    }

    const data = TelegramLinkSchema.parse(req.body);
    const { uid } = req.params;
    const telegramIdStr = String(data.telegramId);

    // 1. Target user exists?
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: `User ${uid} not found`, code: 'USER_NOT_FOUND' });
      return;
    }

    // 2. telegramId uniqueness — not already bound to ANOTHER user
    const conflictSnap = await db.collection('users')
      .where('telegramId', '==', telegramIdStr)
      .limit(1)
      .get();

    if (!conflictSnap.empty && conflictSnap.docs[0].id !== uid) {
      const conflictData = conflictSnap.docs[0].data();
      res.status(409).json({
        error: `Telegram ID ${data.telegramId} уже привязан к ${conflictData.displayName || conflictSnap.docs[0].id}`,
        code: 'TELEGRAM_ID_CONFLICT',
        existingUid: conflictSnap.docs[0].id,
      });
      return;
    }

    // 3. Update
    const updateFields: Record<string, unknown> = {
      telegramId: telegramIdStr,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.telegramUsername) updateFields.telegramUsername = data.telegramUsername;

    await db.collection('users').doc(uid).update(updateFields);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'telegram_linked',
      endpoint: `/api/users/${uid}/telegram-link`,
      metadata: { targetUid: uid, telegramId: data.telegramId },
    });

    const userData = userDoc.data()!;
    res.json({
      uid,
      displayName: userData.displayName || '',
      telegramId: data.telegramId,
      telegramUsername: data.telegramUsername || null,
      message: 'Telegram ID привязан',
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/bot/notify ─────────────────────────────────────────
// Master Token only. Sends Telegram notification to a specific user.

router.post('/api/bot/notify', async (req, res, next) => {
  try {
    if (req.agentTokenType !== 'master') {
      res.status(403).json({ error: 'Master Token required', code: 'FORBIDDEN' });
      return;
    }

    const data = BotNotifySchema.parse(req.body);

    const botToken = TELEGRAM_BOT_TOKEN.value();
    if (!botToken) {
      res.status(503).json({ error: 'Bot token not configured' });
      return;
    }

    const tgResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: data.targetTelegramId,
        text: data.message,
        parse_mode: data.parseMode,
        disable_notification: data.priority === 'silent',
      }),
    });

    const tgResult = await tgResp.json() as { ok: boolean; result?: { message_id: number }; description?: string };

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'bot_notify',
      endpoint: '/api/bot/notify',
      metadata: { targetTelegramId: data.targetTelegramId, type: data.type, delivered: tgResult.ok },
    });

    if (tgResult.ok) {
      res.json({ delivered: true, messageId: tgResult.result?.message_id, timestamp: new Date().toISOString() });
    } else {
      const reason = tgResult.description?.includes('blocked') ? 'user_blocked_bot'
        : tgResult.description?.includes('not found') ? 'chat_not_found'
        : 'telegram_error';
      res.json({ delivered: false, reason, details: tgResult.description, timestamp: new Date().toISOString() });
    }
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/users/migrate-multi-user ─────────────────────────────
// One-time migration: add status='active' to users, type='master' to agent_tokens.
// Master Token only. Safe to run multiple times (idempotent).

router.post('/api/users/migrate-multi-user', async (req, res, next) => {
  try {
    if (req.agentTokenType !== 'master') {
      res.status(403).json({ error: 'Master Token required' });
      return;
    }

    const dryRun = req.query.dryRun === 'true';
    const results: { users: { total: number; updated: number; skipped: number; names: string[] }; tokens: { total: number; updated: number; skipped: number } } = {
      users: { total: 0, updated: 0, skipped: 0, names: [] },
      tokens: { total: 0, updated: 0, skipped: 0 },
    };

    // Migration 1: users.status
    const usersSnap = await db.collection('users').get();
    results.users.total = usersSnap.size;
    const batch = db.batch();

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      if (data.status) {
        results.users.skipped++;
        continue;
      }
      results.users.names.push(`${userDoc.id} (${data.displayName || data.name || '?'})`);
      if (!dryRun) {
        batch.update(userDoc.ref, { status: 'active' });
      }
      results.users.updated++;
    }

    if (!dryRun && results.users.updated > 0) {
      await batch.commit();
    }

    // Migration 2: agent_tokens.type
    const tokensSnap = await db.collection('agent_tokens').get();
    results.tokens.total = tokensSnap.size;

    for (const tokenDoc of tokensSnap.docs) {
      const data = tokenDoc.data();
      if (data.type) {
        results.tokens.skipped++;
        continue;
      }
      if (!dryRun) {
        await tokenDoc.ref.update({ type: 'master' });
      }
      results.tokens.updated++;
    }

    logger.info('🔄 migrate-multi-user', { dryRun, users: results.users.updated, tokens: results.tokens.updated });

    res.json({
      dryRun,
      ...results,
      message: dryRun ? 'Dry run — no writes made' : 'Migration complete',
    });
  } catch (e) {
    next(e);
  }
});


export default router;
