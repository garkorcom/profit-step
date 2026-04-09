/**
 * AdvanceDetailDialog — drill-down view for a single advance account.
 * Shows advance info, transaction history, and quick actions
 * (return, payroll deduction, write-off, settle).
 */

import React, { useState, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  Typography, Chip, Table, TableContainer, TableHead, TableRow,
  TableCell, TableBody, Paper, Divider, Alert, TextField,
  InputAdornment,
  IconButton, Tooltip, CircularProgress,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import PaymentIcon from '@mui/icons-material/Payment';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  collection, addDoc, doc, updateDoc, Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import { useAuth } from '../../../auth/AuthContext';
import type {
  AdvanceAccount, AdvanceTransaction, AdvanceTransactionType,
} from '../../../types/advanceAccount.types';
import {
  computeAdvanceBalance, ADVANCE_TX_CONFIG,
} from '../../../types/advanceAccount.types';
import { COST_CATEGORIES } from '../../../types/finance.types';
import toast from 'react-hot-toast';

// ── Props ──────────────────────────────────────────────────────────────────

interface AdvanceDetailDialogProps {
  open: boolean;
  advance: AdvanceAccount;
  /** Transactions for THIS advance only */
  transactions: AdvanceTransaction[];
  onClose: () => void;
  onChanged: () => void;
  employees: Array<{ id: string; name: string }>;
  /** All open advances (for transfer feature, future) */
  allAdvances: AdvanceAccount[];
  allTransactions: AdvanceTransaction[];
}

// ── Quick Action types ─────────────────────────────────────────────────────

type QuickAction = 'return' | 'payroll_deduction' | 'write_off' | null;

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: Timestamp | undefined): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Component ──────────────────────────────────────────────────────────────

const AdvanceDetailDialog: React.FC<AdvanceDetailDialogProps> = ({
  open, advance, transactions, onClose, onChanged, employees: _employees,
  allAdvances: _allAdvances, allTransactions,
}) => {
  const { currentUser } = useAuth();

  // Quick action state
  const [activeAction, setActiveAction] = useState<QuickAction>(null);
  const [actionAmount, setActionAmount] = useState('');
  const [actionDescription, setActionDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Computed ──────────────────────────────────────────────────────────

  const balance = useMemo(
    () => computeAdvanceBalance(advance, allTransactions),
    [advance, allTransactions],
  );

  const activeTx = useMemo(
    () => transactions.filter(tx => tx.status === 'active'),
    [transactions],
  );

  const totalSpent = useMemo(
    () => activeTx
      .filter(tx => tx.type === 'expense_report')
      .reduce((s, tx) => s + tx.amount, 0),
    [activeTx],
  );

  const totalReturned = useMemo(
    () => activeTx
      .filter(tx => tx.type === 'return')
      .reduce((s, tx) => s + tx.amount, 0),
    [activeTx],
  );

  const totalDeducted = useMemo(
    () => activeTx
      .filter(tx => tx.type === 'payroll_deduction')
      .reduce((s, tx) => s + tx.amount, 0),
    [activeTx],
  );

  const totalWrittenOff = useMemo(
    () => activeTx
      .filter(tx => tx.type === 'write_off')
      .reduce((s, tx) => s + tx.amount, 0),
    [activeTx],
  );

  const parsedAmount = parseFloat(actionAmount);
  const isActionValid = parsedAmount > 0 && actionDescription.trim().length > 0;

  // ── Quick action handlers ─────────────────────────────────────────────

  const openAction = (action: QuickAction) => {
    setActiveAction(action);
    // Pre-fill amount with remaining balance for returns
    if (action === 'return' || action === 'payroll_deduction' || action === 'write_off') {
      setActionAmount(balance > 0 ? balance.toFixed(2) : '');
    }
    setActionDescription('');
  };

  const cancelAction = () => {
    setActiveAction(null);
    setActionAmount('');
    setActionDescription('');
  };

  const submitAction = async () => {
    if (!activeAction || !isActionValid || !currentUser) return;

    setSaving(true);
    try {
      const txData: Record<string, unknown> = {
        advanceId: advance.id,
        employeeId: advance.employeeId,
        employeeName: advance.employeeName,
        type: activeAction as AdvanceTransactionType,
        amount: Math.round(parsedAmount * 100) / 100,
        description: actionDescription.trim(),
        hasReceipt: false,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        status: 'active',
      };

      await addDoc(collection(db, 'advance_transactions'), txData);

      const labels: Record<string, string> = {
        return: 'Return',
        payroll_deduction: 'Payroll deduction',
        write_off: 'Write-off',
      };

      toast.success(`${labels[activeAction]} of $${parsedAmount.toFixed(2)} recorded`);
      cancelAction();
      onChanged();
    } catch (err) {
      console.error('Error recording action:', err);
      toast.error('Failed to record action');
    } finally {
      setSaving(false);
    }
  };

  // ── Settle / Cancel advance ───────────────────────────────────────────

  const handleSettle = async () => {
    if (balance !== 0) {
      toast.error(`Cannot settle — balance is $${balance.toFixed(2)}, must be $0.00`);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'advance_accounts', advance.id), {
        status: 'settled',
        settledAt: serverTimestamp(),
      });
      toast.success('Advance settled');
      onChanged();
      onClose();
    } catch (err) {
      console.error('Error settling advance:', err);
      toast.error('Failed to settle advance');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (activeTx.length > 0) {
      toast.error('Cannot cancel — advance has active transactions. Void them first.');
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'advance_accounts', advance.id), {
        status: 'cancelled',
      });
      toast.success('Advance cancelled');
      onChanged();
      onClose();
    } catch (err) {
      console.error('Error cancelling advance:', err);
      toast.error('Failed to cancel advance');
    } finally {
      setSaving(false);
    }
  };

  // ── Void a transaction ────────────────────────────────────────────────

  const handleVoidTx = async (tx: AdvanceTransaction) => {
    const reason = window.prompt('Reason for voiding this transaction:');
    if (!reason?.trim()) return;

    try {
      await updateDoc(doc(db, 'advance_transactions', tx.id), {
        status: 'voided',
        voidReason: reason.trim(),
      });
      toast.success('Transaction voided');
      onChanged();
    } catch (err) {
      console.error('Error voiding transaction:', err);
      toast.error('Failed to void transaction');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  const isOpen = advance.status === 'open';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">
            Advance Details — {advance.employeeName}
          </Typography>
          <Chip
            label={advance.status}
            color={advance.status === 'open' ? 'warning' : advance.status === 'settled' ? 'success' : 'default'}
            variant="outlined"
          />
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {/* ── Summary section ──────────────────────────────────────────── */}
        <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">Issued</Typography>
            <Typography variant="h6" fontWeight="bold">
              ${advance.amount.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatDate(advance.issuedAt)}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">Spent</Typography>
            <Typography variant="h6" color="warning.main">${totalSpent.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">Returned</Typography>
            <Typography variant="h6" color="success.main">${totalReturned.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">Deducted</Typography>
            <Typography variant="h6" color="secondary">${totalDeducted.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">Written Off</Typography>
            <Typography variant="h6" color="error">${totalWrittenOff.toLocaleString()}</Typography>
          </Box>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Typography variant="caption" color="text.secondary">Balance</Typography>
            <Typography
              variant="h6"
              fontWeight="bold"
              color={balance === 0 ? 'text.secondary' : balance > 0 ? 'warning.main' : 'error.main'}
            >
              ${balance.toLocaleString()}
            </Typography>
          </Box>
        </Box>

        {advance.description && (
          <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
            <Typography variant="body2"><strong>Purpose:</strong> {advance.description}</Typography>
            {advance.projectName && (
              <Typography variant="body2"><strong>Project:</strong> {advance.projectName}</Typography>
            )}
          </Alert>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* ── Quick Actions (only for open advances) ───────────────────── */}
        {isOpen && (
          <>
            <Box display="flex" gap={1} mb={2} flexWrap="wrap">
              <Button
                size="small"
                variant={activeAction === 'return' ? 'contained' : 'outlined'}
                color="success"
                startIcon={<UndoIcon />}
                onClick={() => activeAction === 'return' ? cancelAction() : openAction('return')}
                disabled={saving}
              >
                Return Cash
              </Button>
              <Button
                size="small"
                variant={activeAction === 'payroll_deduction' ? 'contained' : 'outlined'}
                color="secondary"
                startIcon={<PaymentIcon />}
                onClick={() => activeAction === 'payroll_deduction' ? cancelAction() : openAction('payroll_deduction')}
                disabled={saving}
              >
                Payroll Deduction
              </Button>
              <Button
                size="small"
                variant={activeAction === 'write_off' ? 'contained' : 'outlined'}
                color="error"
                startIcon={<DeleteSweepIcon />}
                onClick={() => activeAction === 'write_off' ? cancelAction() : openAction('write_off')}
                disabled={saving}
              >
                Write Off
              </Button>
            </Box>

            {/* Quick action form */}
            {activeAction && (
              <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle2" gutterBottom>
                  {ADVANCE_TX_CONFIG[activeAction].label}
                  {balance > 0 && (
                    <Typography component="span" variant="body2" color="text.secondary">
                      {' '}(max: ${balance.toFixed(2)})
                    </Typography>
                  )}
                </Typography>
                <Box display="flex" gap={1.5} alignItems="flex-start" flexWrap="wrap">
                  <TextField
                    label="Amount"
                    type="number"
                    size="small"
                    value={actionAmount}
                    onChange={e => setActionAmount(e.target.value)}
                    InputProps={{
                      startAdornment: <InputAdornment position="start">$</InputAdornment>,
                    }}
                    inputProps={{ min: 0.01, step: 0.01 }}
                    sx={{ width: 150 }}
                  />
                  <TextField
                    label="Reason / Description"
                    size="small"
                    value={actionDescription}
                    onChange={e => setActionDescription(e.target.value)}
                    sx={{ flex: 1, minWidth: 200 }}
                    placeholder={
                      activeAction === 'return' ? 'e.g. Employee returned unused cash'
                        : activeAction === 'payroll_deduction' ? 'e.g. Deduct from April payroll'
                        : 'e.g. Receipt lost, approved by management'
                    }
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={submitAction}
                    disabled={saving || !isActionValid}
                    color={
                      activeAction === 'return' ? 'success'
                        : activeAction === 'payroll_deduction' ? 'secondary'
                        : 'error'
                    }
                    sx={{ minWidth: 90, height: 40 }}
                  >
                    {saving ? <CircularProgress size={18} /> : 'Save'}
                  </Button>
                  <Button size="small" onClick={cancelAction} sx={{ height: 40 }}>
                    Cancel
                  </Button>
                </Box>
              </Paper>
            )}
          </>
        )}

        {/* ── Transactions table ───────────────────────────────────────── */}
        <Typography variant="subtitle2" gutterBottom>
          Transactions ({transactions.length})
        </Typography>
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Receipt</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No transactions yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map(tx => {
                  const config = ADVANCE_TX_CONFIG[tx.type];
                  const isVoided = tx.status === 'voided';
                  const catLabel = tx.category
                    ? COST_CATEGORIES.find(c => c.id === tx.category)?.label || tx.category
                    : '—';

                  return (
                    <TableRow
                      key={tx.id}
                      sx={{
                        opacity: isVoided ? 0.5 : 1,
                        textDecoration: isVoided ? 'line-through' : 'none',
                      }}
                    >
                      <TableCell>{formatTimestamp(tx.createdAt)}</TableCell>
                      <TableCell>
                        <Chip
                          label={config.label}
                          size="small"
                          sx={{ bgcolor: config.color, color: 'white', fontWeight: 500 }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        ${tx.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>{catLabel}</TableCell>
                      <TableCell>
                        <Tooltip title={tx.description}>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
                            {tx.description}
                          </Typography>
                        </Tooltip>
                        {isVoided && tx.voidReason && (
                          <Typography variant="caption" color="error" display="block">
                            Voided: {tx.voidReason}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {tx.receiptUrl ? (
                          <Tooltip title="View receipt">
                            <IconButton
                              size="small"
                              href={tx.receiptUrl}
                              target="_blank"
                              component="a"
                            >
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : tx.hasReceipt ? (
                          <Chip label="Pending" size="small" variant="outlined" />
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={tx.status}
                          size="small"
                          color={isVoided ? 'error' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="center">
                        {!isVoided && isOpen && (
                          <Tooltip title="Void this transaction">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleVoidTx(tx)}
                            >
                              <BlockIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>

      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Box display="flex" gap={1}>
          {isOpen && (
            <>
              <Tooltip title={balance !== 0
                ? `Balance must be $0 to settle (current: $${balance.toFixed(2)})`
                : 'Mark this advance as fully reconciled'
              }>
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<CheckCircleIcon />}
                    onClick={handleSettle}
                    disabled={saving || balance !== 0}
                  >
                    Settle
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={activeTx.length > 0
                ? 'Cannot cancel — has active transactions'
                : 'Cancel this advance (no transactions recorded)'
              }>
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleCancel}
                    disabled={saving || activeTx.length > 0}
                  >
                    Cancel Advance
                  </Button>
                </span>
              </Tooltip>
            </>
          )}
        </Box>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AdvanceDetailDialog;
