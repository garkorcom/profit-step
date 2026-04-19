import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../../firebase/firebase';

interface Props {
  clientId: string;
}

interface EstimateDoc {
  id: string;
  number?: string;
  status?: string;
  total?: number;
  marginPercent?: number;
  estimateType?: string;
  createdAt?: { toDate: () => Date };
}

const ClientEstimatesTab: React.FC<Props> = ({ clientId }) => {
  const [estimates, setEstimates] = useState<EstimateDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'estimates'), where('clientId', '==', clientId), orderBy('createdAt', 'desc'), limit(50)),
        );
        if (!cancelled) setEstimates(snap.docs.map(d => ({ id: d.id, ...d.data() } as EstimateDoc)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить сметы');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (estimates.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">Смет ещё нет</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Сметы ({estimates.length})</Typography>
      </Stack>
      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>№</TableCell>
              <TableCell>Тип</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell align="right">Сумма</TableCell>
              <TableCell align="right">Маржа</TableCell>
              <TableCell>Дата</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {estimates.map(e => (
              <TableRow key={e.id} hover>
                <TableCell>{e.number ?? e.id.slice(0, 6)}</TableCell>
                <TableCell><Chip size="small" label={e.estimateType ?? 'client'} variant="outlined" /></TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={e.status ?? '—'}
                    color={e.status === 'approved' ? 'success' : e.status === 'sent' ? 'primary' : 'default'}
                  />
                </TableCell>
                <TableCell align="right">{e.total ? `$${e.total.toLocaleString('en-US')}` : '—'}</TableCell>
                <TableCell align="right">{e.marginPercent != null ? `${e.marginPercent.toFixed(1)}%` : '—'}</TableCell>
                <TableCell>{e.createdAt ? e.createdAt.toDate().toLocaleDateString('ru-RU') : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
};

export default ClientEstimatesTab;
