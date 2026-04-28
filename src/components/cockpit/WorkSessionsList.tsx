/**
 * @fileoverview WorkSessionsList — Shows work sessions for a task
 * Extracted from UnifiedCockpitPage inline component.
 * @module components/cockpit/WorkSessionsList
 */

import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Avatar, Chip, Divider, CircularProgress,
} from '@mui/material';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';

interface WorkSession {
  id: string;
  workerName?: string;
  userName?: string;
  startTime?: { toDate: () => Date };
  endTime?: { toDate: () => Date };
  durationMinutes?: number;
  earnings?: number;
  relatedTaskId?: string;
}

interface WorkerSummary {
  name: string;
  totalMinutes: number;
  totalEarnings: number;
  count: number;
}

interface WorkSessionsListProps {
  taskId: string;
}

const WorkSessionsList: React.FC<WorkSessionsListProps> = ({ taskId }) => {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const { userProfile } = useAuth();
  const companyId = userProfile?.companyId;

  useEffect(() => {
    if (!taskId || !companyId) return;
    setLoadingSessions(true);

    // companyId filter REQUIRED — RLS read rule on work_sessions (PR #95).
    const q = query(
      collection(db, 'work_sessions'),
      where('companyId', '==', companyId),
      where('relatedTaskId', '==', taskId),
      orderBy('startTime', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkSession)));
      setLoadingSessions(false);
    }, (error) => {
      console.error('Error fetching work sessions:', error);
      setLoadingSessions(false);
    });

    return () => unsubscribe();
  }, [taskId, companyId]);

  if (loadingSessions && sessions.length === 0) return <CircularProgress size={20} />;
  if (sessions.length === 0) return null;

  // Group by worker for summary
  const workerSummary = sessions.reduce<Record<string, WorkerSummary>>((acc, s) => {
    const name = s.workerName || s.userName || 'Работник';
    const start = s.startTime?.toDate ? s.startTime.toDate() : null;
    const end = s.endTime?.toDate ? s.endTime.toDate() : null;
    const duration = s.durationMinutes || (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0);
    if (!acc[name]) acc[name] = { name, totalMinutes: 0, totalEarnings: 0, count: 0 };
    acc[name].totalMinutes += duration;
    acc[name].totalEarnings += s.earnings || 0;
    acc[name].count += 1;
    return acc;
  }, {});

  const workerList = Object.values(workerSummary).sort((a, b) => b.totalMinutes - a.totalMinutes);
  const totalMinutes = workerList.reduce((s, w) => s + w.totalMinutes, 0);
  const totalEarnings = workerList.reduce((s, w) => s + w.totalEarnings, 0);

  return (
    <Box sx={{ mt: 1 }}>
      {/* Per-worker summary */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          👥 Кто сколько работал
        </Typography>
        {workerList.map(w => {
          const pct = totalMinutes > 0 ? Math.round((w.totalMinutes / totalMinutes) * 100) : 0;
          return (
            <Box key={w.name} sx={{ mb: 1.5 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                    {w.name.charAt(0).toUpperCase()}
                  </Avatar>
                  <Typography variant="body2" fontWeight={500}>{w.name}</Typography>
                  <Chip label={`${w.count} сес.`} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                </Box>
                <Box textAlign="right">
                  <Typography variant="body2" fontWeight={600}>
                    {Math.floor(w.totalMinutes / 60)}ч {w.totalMinutes % 60}м
                  </Typography>
                  {w.totalEarnings > 0 && (
                    <Typography variant="caption" color="success.main">
                      ${w.totalEarnings.toFixed(2)}
                    </Typography>
                  )}
                </Box>
              </Box>
              <Box sx={{ width: '100%', bgcolor: 'grey.200', borderRadius: 1, height: 6 }}>
                <Box sx={{ width: `${pct}%`, bgcolor: 'primary.main', borderRadius: 1, height: 6, transition: 'width 0.3s' }} />
              </Box>
            </Box>
          );
        })}
        <Divider sx={{ my: 1 }} />
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" fontWeight={600}>Итого</Typography>
          <Box textAlign="right">
            <Typography variant="body2" fontWeight={700}>
              {Math.floor(totalMinutes / 60)}ч {totalMinutes % 60}м
            </Typography>
            {totalEarnings > 0 && (
              <Typography variant="caption" color="success.main" fontWeight={600}>
                ${totalEarnings.toFixed(2)}
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Individual sessions */}
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
        Сессии ({sessions.length})
      </Typography>
      {sessions.map((s) => {
        const start = s.startTime?.toDate ? s.startTime.toDate() : null;
        const end = s.endTime?.toDate ? s.endTime.toDate() : null;
        const duration = s.durationMinutes || (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0);
        return (
          <Paper
            key={s.id}
            variant="outlined"
            sx={{ p: 1.5, mb: 1, borderRadius: 2 }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem', bgcolor: 'primary.light' }}>
                  {(s.workerName || s.userName || 'Р').charAt(0).toUpperCase()}
                </Avatar>
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {s.workerName || s.userName || 'Работник'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {start ? formatDate(start, 'dd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                    {end ? ` → ${formatDate(end, 'HH:mm', { locale: ru })}` : ' → в процессе'}
                  </Typography>
                </Box>
              </Box>
              <Box textAlign="right">
                <Typography variant="body2" fontWeight={600}>
                  {duration ? `${Math.floor(duration / 60)}ч ${duration % 60}м` : '—'}
                </Typography>
                {s.earnings ? (
                  <Typography variant="caption" color="success.main">
                    ${s.earnings.toFixed(2)}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
};

export default WorkSessionsList;
