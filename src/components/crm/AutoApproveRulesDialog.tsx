/**
 * Auto-Approve Rules Dialog
 * Manages finance_rules with autoApprove flag.
 * Rules are self-learned on each manual approve; this UI lets you toggle auto-approve.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Switch, Typography, CircularProgress, Chip, IconButton, Box,
  TextField, InputAdornment, Tooltip, Alert,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import { getAuth } from 'firebase/auth';

interface FinanceRule {
  id: string;
  merchantName: string;
  defaultPaymentType: string;
  defaultCategoryId: string;
  defaultProjectId: string | null;
  autoApprove?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  materials: '🧱 Матер.',
  tools: '🛠️ Инстр.',
  reimbursement: '💷 Возм.',
  fuel: '⛽ Топливо',
  housing: '🏠 Жилье',
  food: '🍔 Еда',
  permit: '📄 Док.',
  other: '📦 Прочее',
};

const AutoApproveRulesDialog: React.FC<Props> = ({ open, onClose }) => {
  const [rules, setRules] = useState<FinanceRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const getApiUrl = () => import.meta.env.VITE_FIREBASE_FUNCTIONS_URL || 'https://us-central1-profit-step.cloudfunctions.net/agentApi';

  const getToken = async () => {
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error('Not authenticated');
    return token;
  };

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      setRules(data.rules || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchRules();
  }, [open, fetchRules]);

  const handleToggle = async (ruleId: string, currentValue: boolean) => {
    // Optimistic
    setRules(prev => prev.map(r => r.id === ruleId ? { ...r, autoApprove: !currentValue } : r));
    try {
      const token = await getToken();
      const resp = await fetch(`${getApiUrl()}/api/finance/rules/${encodeURIComponent(ruleId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ autoApprove: !currentValue }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
    } catch (e) {
      // Revert
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, autoApprove: currentValue } : r));
      setError((e as Error).message);
    }
  };

  const handleDelete = async (ruleId: string) => {
    if (!window.confirm('Удалить правило?')) return;
    setRules(prev => prev.filter(r => r.id !== ruleId));
    try {
      const token = await getToken();
      await fetch(`${getApiUrl()}/api/finance/rules/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      setError((e as Error).message);
      fetchRules(); // reload on error
    }
  };

  const filtered = search.trim()
    ? rules.filter(r => r.merchantName.includes(search.toLowerCase()))
    : rules;

  const autoCount = rules.filter(r => r.autoApprove).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" fontWeight="bold">
            ⚙️ Правила авто-утверждения
          </Typography>
          <Chip label={`${autoCount} активных`} color="success" size="small" />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Правила создаются автоматически при ручном утверждении. Включите переключатель — и новые транзакции от этого контрагента будут утверждаться автоматически.
        </Typography>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

        <TextField
          size="small"
          fullWidth
          placeholder="Поиск по контрагенту..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          sx={{ mb: 2 }}
        />

        {loading ? (
          <Box textAlign="center" py={4}><CircularProgress /></Box>
        ) : (
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell><strong>Контрагент</strong></TableCell>
                  <TableCell><strong>Тип</strong></TableCell>
                  <TableCell><strong>Категория</strong></TableCell>
                  <TableCell align="center"><strong>Авто</strong></TableCell>
                  <TableCell align="right" sx={{ width: 50 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.sort((a, b) => (b.autoApprove ? 1 : 0) - (a.autoApprove ? 1 : 0) || a.merchantName.localeCompare(b.merchantName)).map(r => (
                  <TableRow key={r.id} sx={{ bgcolor: r.autoApprove ? '#f1f8e9' : 'inherit' }}>
                    <TableCell sx={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{r.merchantName}</TableCell>
                    <TableCell>
                      <Chip label={r.defaultPaymentType === 'company' ? '🏢 Комп.' : '💵 Личн.'} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip label={CATEGORY_LABELS[r.defaultCategoryId] || r.defaultCategoryId} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={!!r.autoApprove}
                        onChange={() => handleToggle(r.id, !!r.autoApprove)}
                        color="success"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Удалить">
                        <IconButton size="small" onClick={() => handleDelete(r.id)} color="error">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {search ? 'Ничего не найдено' : 'Правила появятся после первого ручного утверждения'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 2 }}>
          {rules.length} правил, {autoCount} авто-утверждение
        </Typography>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AutoApproveRulesDialog;
