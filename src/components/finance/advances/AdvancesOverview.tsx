/**
 * AdvancesOverview — main screen for employee advance (PO/podotchet) accounts.
 * Shows summary cards, filters, and a table of all advances with balances.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Paper, Typography, Card, CardContent, Table, TableContainer,
  TableHead, TableRow, TableCell, TableBody, Button, FormControl,
  InputLabel, Select, MenuItem, Chip, Tooltip, IconButton, Skeleton,
  TablePagination,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ReceiptIcon from '@mui/icons-material/Receipt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  collection, query, orderBy, getDocs, Timestamp,
} from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import type {
  AdvanceAccount, AdvanceTransaction, AdvanceSummary,
} from '../../../types/advanceAccount.types';
import {
  computeAdvanceBalance, computeAdvanceSummary,
} from '../../../types/advanceAccount.types';

import IssueAdvanceDialog from './IssueAdvanceDialog';
import RecordExpenseDialog from './RecordExpenseDialog';
import AdvanceDetailDialog from './AdvanceDetailDialog';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysAgo(ts: Timestamp): number {
  return Math.floor((Date.now() - ts.seconds * 1000) / 86_400_000);
}

// ── Component ───────────────────────────────────────────────────────────────

interface AdvancesOverviewProps {
  /** Employees for filter dropdown (from parent FinancePage) */
  employees: Array<{ id: string; name: string }>;
}

const AdvancesOverview: React.FC<AdvancesOverviewProps> = ({ employees }) => {
  const [advances, setAdvances] = useState<AdvanceAccount[]>([]);
  const [transactions, setTransactions] = useState<AdvanceTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'settled' | 'cancelled'>('open');

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Dialogs
  const [issueOpen, setIssueOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [detailAdvance, setDetailAdvance] = useState<AdvanceAccount | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load all advances
      const advQ = query(
        collection(db, 'advance_accounts'),
        orderBy('issuedAt', 'desc'),
      );
      const advSnap = await getDocs(advQ);
      const advList = advSnap.docs.map(d => ({ id: d.id, ...d.data() } as AdvanceAccount));

      // Load all transactions
      const txQ = query(
        collection(db, 'advance_transactions'),
        orderBy('createdAt', 'desc'),
      );
      const txSnap = await getDocs(txQ);
      const txList = txSnap.docs.map(d => ({ id: d.id, ...d.data() } as AdvanceTransaction));

      setAdvances(advList);
      setTransactions(txList);
    } catch (err) {
      console.error('Error loading advances:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtering ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return advances.filter(a => {
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterEmployee !== 'all' && a.employeeId !== filterEmployee) return false;
      return true;
    });
  }, [advances, filterStatus, filterEmployee]);

  // ── Summary (for filtered set) ────────────────────────────────────────

  const summary: AdvanceSummary = useMemo(() => {
    const filteredIds = new Set(filtered.map(a => a.id));
    const filteredTx = transactions.filter(tx => filteredIds.has(tx.advanceId));
    return computeAdvanceSummary(filtered, filteredTx);
  }, [filtered, transactions]);

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box>
        <Skeleton variant="rounded" height={80} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={300} />
      </Box>
    );
  }

  return (
    <Box>
      {/* ── Summary Cards ──────────────────────────────────────────────── */}
      <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
        <Box sx={{ flex: 1, minWidth: 150 }}>
          <Card sx={{ bgcolor: '#2196f3', color: 'white', height: '100%' }}>
            <CardContent>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>Issued (Open)</Typography>
              <Typography variant="h5" fontWeight="bold">
                ${summary.totalIssued.toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ flex: 1, minWidth: 150 }}>
          <Card sx={{ bgcolor: '#ff9800', color: 'white', height: '100%' }}>
            <CardContent>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>Spent</Typography>
              <Typography variant="h5" fontWeight="bold">
                ${summary.totalSpent.toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ flex: 1, minWidth: 150 }}>
          <Card sx={{ bgcolor: summary.balance >= 0 ? '#4caf50' : '#f44336', color: 'white', height: '100%' }}>
            <CardContent>
              <Tooltip title="Issued − Spent − Returned − Deducted − Written-off" arrow>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>PO Balance</Typography>
              </Tooltip>
              <Typography variant="h5" fontWeight="bold">
                ${summary.balance.toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ flex: 1, minWidth: 150 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">Open Advances</Typography>
              <Typography variant="h5" fontWeight="bold">{summary.openCount}</Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* ── Actions + Filters ──────────────────────────────────────────── */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Box display="flex" gap={1}>
          <Button variant="contained" startIcon={<AddIcon />} size="small"
            onClick={() => setIssueOpen(true)}>
            Issue Advance
          </Button>
          <Button variant="outlined" startIcon={<ReceiptIcon />} size="small"
            onClick={() => setExpenseOpen(true)}>
            Record Expense
          </Button>
        </Box>
        <Box display="flex" gap={1}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Employee</InputLabel>
            <Select value={filterEmployee} label="Employee"
              onChange={e => { setFilterEmployee(e.target.value); setPage(0); }}>
              <MenuItem value="all">All Employees</MenuItem>
              {employees.map(emp => (
                <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Status</InputLabel>
            <Select value={filterStatus} label="Status"
              onChange={e => { setFilterStatus(e.target.value as typeof filterStatus); setPage(0); }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="settled">Settled</MenuItem>
              <MenuItem value="cancelled">Cancelled</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Employee</TableCell>
              <TableCell>Project</TableCell>
              <TableCell align="right">Issued</TableCell>
              <TableCell align="right">Spent</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Age</TableCell>
              <TableCell align="center">Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No advances found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filtered
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map(advance => {
                  const balance = computeAdvanceBalance(advance, transactions);
                  const age = daysAgo(advance.issuedAt);
                  const spent = advance.amount - balance;

                  return (
                    <TableRow key={advance.id} hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => setDetailAdvance(advance)}>
                      <TableCell>{formatDate(advance.issuedAt)}</TableCell>
                      <TableCell>{advance.employeeName}</TableCell>
                      <TableCell>{advance.projectName || '—'}</TableCell>
                      <TableCell align="right">${advance.amount.toLocaleString()}</TableCell>
                      <TableCell align="right">${spent.toLocaleString()}</TableCell>
                      <TableCell align="right" sx={{
                        fontWeight: 600,
                        color: balance === 0 ? 'text.secondary'
                          : balance > 0 ? 'warning.main' : 'error.main',
                      }}>
                        ${balance.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={advance.status}
                          size="small"
                          color={advance.status === 'open' ? 'warning'
                            : advance.status === 'settled' ? 'success' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {advance.status === 'open' && (
                          <Chip
                            label={`${age}d`}
                            size="small"
                            color={age > 14 ? 'error' : age > 7 ? 'warning' : 'default'}
                            variant="outlined"
                          />
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <IconButton size="small" onClick={(e) => {
                          e.stopPropagation();
                          setDetailAdvance(advance);
                        }}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
            )}
          </TableBody>
        </Table>
        {filtered.length > rowsPerPage && (
          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        )}
      </TableContainer>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <IssueAdvanceDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        onSaved={loadData}
        employees={employees}
      />

      <RecordExpenseDialog
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        onSaved={loadData}
        advances={advances.filter(a => a.status === 'open')}
        transactions={transactions}
      />

      {detailAdvance && (
        <AdvanceDetailDialog
          open={!!detailAdvance}
          advance={detailAdvance}
          transactions={transactions.filter(tx => tx.advanceId === detailAdvance.id)}
          onClose={() => setDetailAdvance(null)}
          onChanged={loadData}
          employees={employees}
          allAdvances={advances.filter(a => a.status === 'open')}
          allTransactions={transactions}
        />
      )}
    </Box>
  );
};

export default AdvancesOverview;
