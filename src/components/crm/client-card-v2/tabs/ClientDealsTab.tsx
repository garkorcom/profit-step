import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db } from '../../../../firebase/firebase';

interface Props {
  clientId: string;
  clientName?: string;
}

interface DealDoc {
  id: string;
  title?: string;
  stage?: string;
  status?: string;
  value?: { amount: number; currency: string };
  expectedCloseDate?: { toDate: () => Date };
  priority?: string;
}

const ClientDealsTab: React.FC<Props> = ({ clientId }) => {
  const [deals, setDeals] = useState<DealDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'deals'), where('clientId', '==', clientId), orderBy('createdAt', 'desc'), limit(50)),
        );
        if (!cancelled) setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() } as DealDoc)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить сделки');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;

  if (deals.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary" gutterBottom>Сделок ещё нет</Typography>
        <Button
          component={RouterLink}
          to="/crm/deals"
          variant="contained"
          startIcon={<OpenInNewIcon />}
        >
          Создать сделку
        </Button>
      </Paper>
    );
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Сделки ({deals.length})</Typography>
        <Button
          component={RouterLink}
          to="/crm/deals"
          size="small"
          endIcon={<OpenInNewIcon />}
        >
          Все сделки
        </Button>
      </Stack>
      <Paper>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Название</TableCell>
              <TableCell>Стадия</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell align="right">Сумма</TableCell>
              <TableCell>Дата закрытия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {deals.map(d => (
              <TableRow key={d.id} hover>
                <TableCell>{d.title ?? '—'}</TableCell>
                <TableCell><Chip size="small" label={d.stage ?? '—'} variant="outlined" /></TableCell>
                <TableCell><Chip size="small" label={d.status ?? '—'} color={d.status === 'won' ? 'success' : d.status === 'lost' ? 'default' : 'primary'} /></TableCell>
                <TableCell align="right">
                  {d.value ? `${d.value.currency} ${d.value.amount.toLocaleString('en-US')}` : '—'}
                </TableCell>
                <TableCell>
                  {d.expectedCloseDate ? d.expectedCloseDate.toDate().toLocaleDateString('ru-RU') : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
};

export default ClientDealsTab;
