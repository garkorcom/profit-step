/**
 * Teams CRUD Routes — list, create, update, delete + member management (6 endpoints)
 *
 * Data model:
 *   Collection `teams` — { name, leadUid, memberUids[], createdAt, updatedAt, companyId }
 *   User docs keep `teamId` and `teamLeadUid` fields in sync for fast lookups.
 *
 * RLS:
 *   - admin/manager: full CRUD
 *   - foreman: read own team, manage own team members
 *   - worker/driver/supply/accountant: read own team only
 */
import { Router } from 'express';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { CreateTeamSchema, UpdateTeamSchema, TeamMemberSchema } from '../schemas';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────

function canManageTeams(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

function canManageOwnTeam(role: string): boolean {
  return role === 'foreman';
}

// ─── GET /api/teams ────────────────────────────────────────────────────

router.get('/api/teams', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;

    logger.info('👥 teams:list', { role: rlsRole });

    const snap = await db.collection('teams').get();
    let teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Non-admin/manager: only see their own team
    if (!canManageTeams(rlsRole)) {
      teams = teams.filter((t: any) =>
        t.leadUid === rlsUserId || (Array.isArray(t.memberUids) && t.memberUids.includes(rlsUserId))
      );
    }

    // Enrich with member details
    const enriched = await Promise.all(teams.map(async (team: any) => {
      const memberUids: string[] = team.memberUids || [];
      let members: { uid: string; displayName: string; role: string }[] = [];

      if (memberUids.length > 0 && memberUids.length <= 30) {
        // Batch read member docs (Firestore getAll limit = 100)
        const refs = memberUids.map(uid => db.collection('users').doc(uid));
        const memberDocs = await db.getAll(...refs);
        members = memberDocs
          .filter(d => d.exists)
          .map(d => ({
            uid: d.id,
            displayName: d.data()?.displayName || d.data()?.email || d.id,
            role: d.data()?.role || 'worker',
          }));
      }

      return {
        id: team.id,
        name: team.name,
        leadUid: team.leadUid,
        memberCount: memberUids.length,
        members,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
      };
    }));

    res.json({ teams: enriched, total: enriched.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/teams ───────────────────────────────────────────────────

router.post('/api/teams', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    if (!canManageTeams(rlsRole)) {
      res.status(403).json({ error: 'Requires admin or manager role' });
      return;
    }

    const data = CreateTeamSchema.parse(req.body);
    logger.info('👥 teams:create', { name: data.name, lead: data.leadUid });

    // Verify lead exists
    const leadDoc = await db.collection('users').doc(data.leadUid).get();
    if (!leadDoc.exists) {
      res.status(404).json({ error: `Lead user ${data.leadUid} not found` });
      return;
    }

    // Ensure lead is included in memberUids
    const memberUids = Array.from(new Set([data.leadUid, ...data.memberUids]));

    // Create team
    const teamRef = await db.collection('teams').add({
      name: data.name,
      leadUid: data.leadUid,
      memberUids,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update users with teamId/teamLeadUid
    const batch = db.batch();
    for (const uid of memberUids) {
      batch.update(db.collection('users').doc(uid), {
        teamId: teamRef.id,
        teamLeadUid: data.leadUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'team_created',
      endpoint: '/api/teams',
      metadata: { teamId: teamRef.id, name: data.name, leadUid: data.leadUid, memberCount: memberUids.length },
    });

    res.status(201).json({
      id: teamRef.id,
      name: data.name,
      leadUid: data.leadUid,
      memberUids,
      message: `Team "${data.name}" created with ${memberUids.length} members`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── PUT /api/teams/:id ────────────────────────────────────────────────

router.put('/api/teams/:id', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    if (!canManageTeams(rlsRole)) {
      res.status(403).json({ error: 'Requires admin or manager role' });
      return;
    }

    const { id } = req.params;
    const data = UpdateTeamSchema.parse(req.body);
    logger.info('👥 teams:update', { teamId: id, ...data });

    const teamDoc = await db.collection('teams').doc(id).get();
    if (!teamDoc.exists) {
      res.status(404).json({ error: `Team ${id} not found` });
      return;
    }

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.name) update.name = data.name;

    // If changing lead, verify new lead exists and update user docs
    if (data.leadUid) {
      const leadDoc = await db.collection('users').doc(data.leadUid).get();
      if (!leadDoc.exists) {
        res.status(404).json({ error: `New lead ${data.leadUid} not found` });
        return;
      }
      update.leadUid = data.leadUid;

      // Ensure new lead is in memberUids
      const currentMembers: string[] = teamDoc.data()?.memberUids || [];
      if (!currentMembers.includes(data.leadUid)) {
        update.memberUids = FieldValue.arrayUnion(data.leadUid);
      }

      // Update all members' teamLeadUid
      const batch = db.batch();
      for (const uid of currentMembers) {
        batch.update(db.collection('users').doc(uid), {
          teamLeadUid: data.leadUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      // Also update new lead if not yet a member
      if (!currentMembers.includes(data.leadUid)) {
        batch.update(db.collection('users').doc(data.leadUid), {
          teamId: id,
          teamLeadUid: data.leadUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await db.collection('teams').doc(id).update(update);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'team_updated',
      endpoint: `/api/teams/${id}`,
      metadata: { teamId: id, ...data },
    });

    res.json({ id, ...data, message: 'Team updated' });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/teams/:id ─────────────────────────────────────────────

router.delete('/api/teams/:id', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    if (rlsRole !== 'admin') {
      res.status(403).json({ error: 'Only admin can delete teams' });
      return;
    }

    const { id } = req.params;
    logger.info('👥 teams:delete', { teamId: id });

    const teamDoc = await db.collection('teams').doc(id).get();
    if (!teamDoc.exists) {
      res.status(404).json({ error: `Team ${id} not found` });
      return;
    }

    // Clear teamId/teamLeadUid on all members
    const memberUids: string[] = teamDoc.data()?.memberUids || [];
    if (memberUids.length > 0) {
      const batch = db.batch();
      for (const uid of memberUids) {
        batch.update(db.collection('users').doc(uid), {
          teamId: FieldValue.delete(),
          teamLeadUid: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await db.collection('teams').doc(id).delete();

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'team_deleted',
      endpoint: `/api/teams/${id}`,
      metadata: { teamId: id, name: teamDoc.data()?.name, membersCleared: memberUids.length },
    });

    res.json({ deleted: true, id, membersCleared: memberUids.length });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/teams/:id/members ──────────────────────────────────────

router.post('/api/teams/:id/members', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    const { id } = req.params;

    const teamDoc = await db.collection('teams').doc(id).get();
    if (!teamDoc.exists) {
      res.status(404).json({ error: `Team ${id} not found` });
      return;
    }

    const teamData = teamDoc.data()!;

    // RLS: admin/manager can manage any team; foreman can manage own team
    if (!canManageTeams(rlsRole)) {
      if (canManageOwnTeam(rlsRole) && teamData.leadUid === rlsUserId) {
        // OK — foreman managing own team
      } else {
        res.status(403).json({ error: 'Cannot manage this team' });
        return;
      }
    }

    const data = TeamMemberSchema.parse(req.body);
    logger.info('👥 teams:addMember', { teamId: id, uid: data.uid });

    // Verify user exists
    const userDoc = await db.collection('users').doc(data.uid).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: `User ${data.uid} not found` });
      return;
    }

    // Check if already a member
    const currentMembers: string[] = teamData.memberUids || [];
    if (currentMembers.includes(data.uid)) {
      res.status(409).json({ error: `User ${data.uid} is already a member of this team` });
      return;
    }

    // Check if user is in another team
    const userData = userDoc.data()!;
    if (userData.teamId && userData.teamId !== id) {
      res.status(409).json({
        error: `User ${userData.displayName || data.uid} is already in team "${userData.teamId}". Remove from current team first.`,
        currentTeamId: userData.teamId,
      });
      return;
    }

    // Add to team
    await db.collection('teams').doc(id).update({
      memberUids: FieldValue.arrayUnion(data.uid),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update user doc
    await db.collection('users').doc(data.uid).update({
      teamId: id,
      teamLeadUid: teamData.leadUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'team_member_added',
      endpoint: `/api/teams/${id}/members`,
      metadata: { teamId: id, addedUid: data.uid },
    });

    res.status(201).json({
      teamId: id,
      addedUid: data.uid,
      memberCount: currentMembers.length + 1,
      message: `${userData.displayName || data.uid} added to team "${teamData.name}"`,
    });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/teams/:id/members/:uid ────────────────────────────────

router.delete('/api/teams/:id/members/:uid', async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;
    const { id, uid } = req.params;

    const teamDoc = await db.collection('teams').doc(id).get();
    if (!teamDoc.exists) {
      res.status(404).json({ error: `Team ${id} not found` });
      return;
    }

    const teamData = teamDoc.data()!;

    // RLS: admin/manager or foreman of this team
    if (!canManageTeams(rlsRole)) {
      if (canManageOwnTeam(rlsRole) && teamData.leadUid === rlsUserId) {
        // OK
      } else {
        res.status(403).json({ error: 'Cannot manage this team' });
        return;
      }
    }

    // Cannot remove team lead
    if (uid === teamData.leadUid) {
      res.status(400).json({
        error: 'Cannot remove team lead. Change the lead first via PUT /api/teams/:id',
      });
      return;
    }

    const currentMembers: string[] = teamData.memberUids || [];
    if (!currentMembers.includes(uid)) {
      res.status(404).json({ error: `User ${uid} is not a member of this team` });
      return;
    }

    logger.info('👥 teams:removeMember', { teamId: id, uid });

    // Remove from team
    await db.collection('teams').doc(id).update({
      memberUids: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Clear user's team fields
    await db.collection('users').doc(uid).update({
      teamId: FieldValue.delete(),
      teamLeadUid: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'team_member_removed',
      endpoint: `/api/teams/${id}/members/${uid}`,
      metadata: { teamId: id, removedUid: uid },
    });

    res.json({
      teamId: id,
      removedUid: uid,
      memberCount: currentMembers.length - 1,
      message: 'Member removed from team',
    });
  } catch (e) {
    next(e);
  }
});

export default router;
