/**
 * @fileoverview Client Expenses Tab
 *
 * Shows all bank transactions (approved & draft) assigned to this client's projects
 * from the Reconciliation Hub. Allows viewing expenses grouped by project with totals.
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Chip,
  Card,
  CardContent,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  TablePagination,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { projectsApi } from '../../api/projectsApi';
import { Project } from '../../types/project.types';

interface ClientExpensesTabProps {
  clientId: string;
  clientName: string;
}

interface BankTx {
  id: string;
  date: Timestamp | string;
  rawDescription: string;
  cleanMerchant: string;
  amount: number;
  paymentType: 'company' | 'cash';
  categoryId: string;
  projectId: string | null;
  status: 'draft' | 'approved' | 'ignored';
}

const COST_CATEGORY_LABELS: Record<string, string> = {
  materials: '🧱 Материалы',
  tools: '🛠️ Инструменты',
  reimbursement: '💷 Возмещение',
  fuel: '⛽ Топливо',
  housing: '🏠 Жилье',
  food: '🍔 Питание',
  permit: '📄 Документы',
  other: '📦 Прочее',
};

const toDate = (d: Timestamp | string | null | undefined): Date | null => {
  if (!d) return null;
  if (typeof d === 'string') return new Date(d);
  if (typeof (d as Timestamp).toDate === 'function') return (d as Timestamp).toDate();
  return null;
};

const renderDate = (d: Timestamp | string | null | undefined) => {
  const date = toDate(d);
  return date ? date.toLocaleDateString('ru-RU') : '';
};

const ClientExpensesTab: React.FC<ClientExpensesTabProps> = ({ clientId, clientName }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [expenses, setExpenses] = useState<BankTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    const fetchExpenses = async () => {
      setLoading(true);
      try {
        // 1. Get all projects for this client
        const projectsList = await projectsApi.getProjectsByClient(clientId);
        setProjects(projectsList);

        if (projectsList.length === 0) {
          setExpenses([]);
          setLoading(false);
          return;
        }

        // 2. Query bank_transactions where projectId matches any client project
        // Firestore 'in' supports up to 30 values — chunk if needed
        const projectIds = projectsList.map(p => p.id);
        const allTxs: BankTx[] = [];

        for (let i = 0; i < projectIds.length; i += 30) {
          const chunk = projectIds.slice(i, i + 30);
          const q = query(
            collection(db, 'bank_transactions'),
            where('projectId', 'in', chunk),
          );
          const snap = await getDocs(q);
          snap.docs.forEach(d => {
            allTxs.push({ id: d.id, ...d.data() } as BankTx);
          });
        }

        // Sort by date descending
        allTxs.sort((a, b) => {
          const da = toDate(a.date)?.getTime() || 0;
          const db2 = toDate(b.date)?.getTime() || 0;
          return db2 - da;
        });

        setExpenses(allTxs);
      } catch (err) {
        console.error('Error fetching client expenses:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchExpenses();
  }, [clientId]);

  // Filtered
  const filtered = useMemo(() => {
    let result = expenses;

    if (selectedProjectId !== 'all') {
      result = result.filter(t => t.projectId === selectedProjectId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.cleanMerchant || '').toLowerCase().includes(q) ||
        (t.rawDescription || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [expenses, selectedProjectId, searchQuery]);

  // Summary
  const summary = useMemo(() => {
    const total = filtered.reduce((s, t) => s + Math.abs(t.amount), 0);
    const approved = filtered.filter(t => t.status === 'approved');
    const approvedTotal = approved.reduce((s, t) => s + Math.abs(t.amount), 0);
    const draft = filtered.filter(t => t.status === 'draft');
    const draftTotal = draft.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Per-category breakdown
    const byCategory: Record<string, number> = {};
    filtered.forEach(t => {
      const cat = t.categoryId || 'other';
      byCategory[cat] = (byCategory[cat] || 0) + Math.abs(t.amount);
    });

    return { total, approvedTotal, draftTotal, approvedCount: approved.length, draftCount: draft.length, byCategory };
  }, [filtered]);

  // Per-project totals
  const projectTotals = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach(t => {
      if (t.projectId) {
        map[t.projectId] = (map[t.projectId] || 0) + Math.abs(t.amount);
      }
    });
    return map;
  }, [expenses]);

  const paginated = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  const fmtDollar = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) return <Box p={4} textAlign="center"><CircularProgress /></Box>;

  if (projects.length === 0) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
        <ReceiptLongIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
        <Typography color="text.secondary">
          У клиента нет проектов. Создайте проект, чтобы привязывать расходы.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      {/* Summary Cards */}
      <Box display="flex" gap={1.5} mb={2} flexWrap="wrap">
        <Card sx={{ minWidth: 140, bgcolor: '#e8f5e9', border: '1px solid #c8e6c9' }} elevation={0}>
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary">✅ Утверждено</Typography>
            <Typography variant="h6" fontWeight="bold" color="success.dark">
              {fmtDollar(summary.approvedTotal)}
            </Typography>
            <Typography variant="caption" color="text.secondary">{summary.approvedCount} записей</Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 140, bgcolor: '#fff3e0', border: '1px solid #ffe0b2' }} elevation={0}>
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary">⏳ Черновики</Typography>
            <Typography variant="h6" fontWeight="bold" color="warning.dark">
              {fmtDollar(summary.draftTotal)}
            </Typography>
            <Typography variant="caption" color="text.secondary">{summary.draftCount} записей</Typography>
          </CardContent>
        </Card>
        <Card sx={{ minWidth: 140, bgcolor: '#e3f2fd', border: '1px solid #bbdefb' }} elevation={0}>
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary">📊 Всего</Typography>
            <Typography variant="h6" fontWeight="bold" color="primary.dark">
              {fmtDollar(summary.total)}
            </Typography>
            <Typography variant="caption" color="text.secondary">{filtered.length} записей</Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Category Breakdown Chips */}
      {Object.keys(summary.byCategory).length > 0 && (
        <Box display="flex" gap={0.5} mb={2} flexWrap="wrap">
          {Object.entries(summary.byCategory)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, total]) => (
              <Chip
                key={cat}
                label={`${COST_CATEGORY_LABELS[cat] || cat}: ${fmtDollar(total)}`}
                size="small"
                variant="outlined"
              />
            ))}
        </Box>
      )}

      {/* Filters */}
      <Box display="flex" gap={1.5} mb={2} alignItems="center" flexWrap="wrap">
        <TextField
          size="small"
          placeholder="Поиск..."
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          sx={{ width: 200, bgcolor: 'white' }}
        />
        <Select
          size="small"
          value={selectedProjectId}
          onChange={e => { setSelectedProjectId(e.target.value); setPage(0); }}
          sx={{ minWidth: 250, bgcolor: 'white' }}
        >
          <MenuItem value="all">Все проекты ({expenses.length})</MenuItem>
          {projects.map(p => (
            <MenuItem key={p.id} value={p.id}>
              {p.name} ({projectTotals[p.id] ? fmtDollar(projectTotals[p.id]) : '$0'})
            </MenuItem>
          ))}
        </Select>
        <Typography variant="body2" color="text.secondary">
          {filtered.length} записей
        </Typography>
      </Box>

      {/* Table */}
      <TableContainer component={Paper} elevation={1} sx={{ maxHeight: 'calc(100vh - 400px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell><strong>Дата</strong></TableCell>
              <TableCell><strong>Контрагент</strong></TableCell>
              <TableCell><strong>Описание</strong></TableCell>
              <TableCell align="right"><strong>Сумма</strong></TableCell>
              <TableCell><strong>Категория</strong></TableCell>
              <TableCell><strong>Тип</strong></TableCell>
              <TableCell><strong>Проект</strong></TableCell>
              <TableCell><strong>Статус</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginated.map(t => (
              <TableRow
                key={t.id}
                sx={{
                  backgroundColor: t.status === 'approved' ? '#f1f8e9' : '#fff',
                  '&:hover': { backgroundColor: t.status === 'approved' ? '#e8f5e9' : '#f5f5f5' },
                }}
              >
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{renderDate(t.date)}</TableCell>
                <TableCell sx={{ fontWeight: 'bold', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.cleanMerchant || '—'}
                </TableCell>
                <TableCell sx={{ fontSize: '0.78rem', color: 'text.secondary', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.rawDescription}
                </TableCell>
                <TableCell align="right">
                  <Typography fontWeight="bold" color={t.amount > 0 ? 'success.main' : 'error.main'}>
                    ${Math.abs(t.amount).toFixed(2)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={COST_CATEGORY_LABELS[t.categoryId] || t.categoryId || 'Прочее'}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.73rem' }}
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={t.paymentType === 'company' ? '🏢 Комп.' : '💵 Личн.'}
                    size="small"
                    color={t.paymentType === 'company' ? 'primary' : 'default'}
                    variant="outlined"
                    sx={{ fontSize: '0.73rem' }}
                  />
                </TableCell>
                <TableCell sx={{ fontSize: '0.78rem', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {projects.find(p => p.id === t.projectId)?.name || '—'}
                </TableCell>
                <TableCell>
                  <Chip
                    label={t.status === 'approved' ? '✅ OK' : '⏳ Draft'}
                    size="small"
                    color={t.status === 'approved' ? 'success' : 'warning'}
                    variant={t.status === 'approved' ? 'filled' : 'outlined'}
                    sx={{ fontSize: '0.73rem' }}
                  />
                </TableCell>
              </TableRow>
            ))}
            {paginated.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                  <ReceiptLongIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                  <Typography variant="body1" color="text.secondary">
                    {searchQuery ? `Ничего не найдено по "${searchQuery}"` : 'Нет расходов по этому клиенту'}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    Расходы появятся после назначения проектов в Reconciliation Hub
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {filtered.length > rowsPerPage && (
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[25, 50, 100]}
          labelRowsPerPage="Строк:"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
        />
      )}
    </Box>
  );
};

export default ClientExpensesTab;
