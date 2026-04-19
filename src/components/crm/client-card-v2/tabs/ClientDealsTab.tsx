import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink } from 'react-router-dom';
import { DealResource, listDeals } from '../../../../api/dealsApi';

interface Props {
  clientId: string;
  clientName?: string;
}

const ClientDealsTab: React.FC<Props> = ({ clientId }) => {
  const [deals, setDeals] = useState<DealResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listDeals({ clientId, limit: 50 });
        if (!cancelled) setDeals(list);
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
                <TableCell>
                  <Chip
                    size="small"
                    label={d.status}
                    color={d.status === 'won' ? 'success' : d.status === 'lost' ? 'default' : 'primary'}
                  />
                </TableCell>
                <TableCell align="right">
                  {d.value ? `${d.value.currency} ${d.value.amount.toLocaleString('en-US')}` : '—'}
                </TableCell>
                <TableCell>
                  {d.expectedCloseDate ? new Date(d.expectedCloseDate).toLocaleDateString('ru-RU') : '—'}
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
