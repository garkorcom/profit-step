import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, Chip, CircularProgress, Alert
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import UndoIcon from '@mui/icons-material/Undo';
import { db } from '../../firebase/firebase';
import { collection, query, where, getDocs, Timestamp, orderBy, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const COST_CATEGORY_LABELS: Record<string, string> = {
  materials: '🧱 Материалы',
  tools: '🛠️ Инструменты',
  reimbursement: '💷 Возмещение',
  fuel: '⛽ Топливо',
  housing: '🏠 Жилье (Рента)',
  food: '🍔 Питание',
  permit: '📄 Документы',
  other: '📦 Прочее',
};

interface ReconcileTx {
  id: string;
  date: string | Timestamp;
  rawDescription: string;
  cleanMerchant: string;
  amount: number;
  paymentType: 'company' | 'cash';
  categoryId: string;
  projectId: string | null;
  confidence: 'high' | 'low';
  status: 'draft' | 'approved' | 'ignored';
}

const ReconciliationPage: React.FC = () => {
  const [view, setView] = useState<'draft' | 'approved'>('draft');
  const [transactions, setTransactions] = useState<ReconcileTx[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const txQuery = view === 'draft'
        ? query(collection(db, 'bank_transactions'), where('status', '==', 'draft'))
        // If the orderBy fails due to missing index, we will display the Firebase error explicitly.
        : query(collection(db, 'bank_transactions'), where('status', '==', 'approved'), orderBy('updatedAt', 'desc'), limit(50));
        
      const txSnap = await getDocs(txQuery);
      const txData = txSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReconcileTx));
      setTransactions(txData);

      const prjQuery = query(collection(db, 'projects'), where('status', '==', 'active'));
      const prjSnap = await getDocs(prjQuery);
      setProjects(prjSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.id })));
    } catch (e: any) {
      console.error("Failed to fetch drafts/projects:", e);
      if (e.message?.includes('index')) {
        setErrorMsg("Требуется создать индекс Firestore для поля updatedAt. " + e.message);
      } else {
        setErrorMsg("Ошибка базы данных: " + e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = (id: string, field: keyof ReconcileTx, value: any) => {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleSplit = (id: string) => {
    setTransactions(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      
      const original = prev[idx];
      const halfAmount = parseFloat((original.amount / 2).toFixed(2));
      
      const splitA: ReconcileTx = { ...original, id: `${original.id}_splitA`, amount: halfAmount };
      const splitB: ReconcileTx = { ...original, id: `${original.id}_splitB`, amount: halfAmount };
      
      const newTransactions = [...prev];
      newTransactions.splice(idx, 1, splitA, splitB);
      return newTransactions;
    });
  };

  const getApiUrl = () => process.env.REACT_APP_FIREBASE_FUNCTIONS_URL || 'https://us-central1-profit-step.cloudfunctions.net/agentApi';

  const handleApproveAll = async () => {
    setSubmitting(true);
    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("No auth jwt");
      
      const payload = { transactions };
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) throw new Error(`API Error: ${resp.status} ${await resp.text()}`);
      await fetchData();
    } catch (e) {
      console.error("Approve failed", e);
      alert("Ошибка при сохранении: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async (transactionId: string) => {
    if (!window.confirm('Вы уверены, что хотите отменить утверждение и удалить созданную транзакцию (cost)?')) return;
    setSubmitting(true);
    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("No auth jwt");
      
      const resp = await fetch(`${getApiUrl()}/api/finance/transactions/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ transactionIds: [transactionId] })
      });

      if (!resp.ok) throw new Error(`API Error: ${resp.status}`);
      await fetchData();
    } catch (e) {
      console.error("Undo failed", e);
      alert("Ошибка при отмене: " + (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderDate = (d: string | Timestamp | any) => {
    if (!d) return '';
    if (typeof d === 'string') return new Date(d).toLocaleDateString();
    if (d.toDate) return d.toDate().toLocaleDateString();
    return '';
  };

  if (loading) return <Box p={4} textAlign="center"><CircularProgress /></Box>;

  const draftTotal = transactions.length;
  const draftHighConf = transactions.filter(t => t.confidence === 'high').length;
  const draftLowConf = draftTotal - draftHighConf;
  const autopilotPercent = draftTotal > 0 ? Math.round((draftHighConf / draftTotal) * 100) : 0;

  return (
    <Box p={3} sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="h4" fontWeight="bold">Reconciliation Hub</Typography>
          <Select size="small" value={view} onChange={e => setView(e.target.value as any)} sx={{ minWidth: 200, bgcolor: 'white' }}>
            <MenuItem value="draft">⏳ Черновики (Draft)</MenuItem>
            <MenuItem value="approved">✅ Недавно Утвержденные</MenuItem>
          </Select>
        </Box>
        
        <Box display="flex" alignItems="center" gap={2}>
          <Typography variant="subtitle1" color="text.secondary">
            Найдено: {transactions.length}
          </Typography>
          {view === 'draft' && (
            <Button 
              variant="contained" 
              color="success" 
              size="large"
              disabled={transactions.length === 0 || submitting}
              onClick={handleApproveAll}
            >
              {submitting ? 'Сохранение...' : 'Утвердить всё на экране'}
            </Button>
          )}
        </Box>
      </Box>

      {view === 'draft' && draftTotal > 0 && (
        <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 4, bgcolor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 2 }} elevation={0}>
          <Box>
            <Typography variant="body2" color="text.secondary">Автоматизировано ИИ (Отлично)</Typography>
            <Typography variant="h5" color="success.main" fontWeight="bold">{autopilotPercent}%</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">По правилам (Бесплатно)</Typography>
            <Typography variant="h6" color="success.main">{draftHighConf} шт.</Typography>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary">Угадано LLM (Внимание)</Typography>
            <Typography variant="h6" color="warning.main">{draftLowConf} шт.</Typography>
          </Box>
        </Paper>
      )}

      {errorMsg && <Alert severity="error" sx={{ mb: 3 }}>{errorMsg}</Alert>}

      <TableContainer component={Paper} elevation={3}>
        <Table size="small">
          <TableHead sx={{ backgroundColor: '#f1f5f9' }}>
            <TableRow>
              <TableCell><strong>Статус</strong></TableCell>
              <TableCell><strong>Дата</strong></TableCell>
              <TableCell><strong>Из Банка (Raw)</strong></TableCell>
              <TableCell><strong>Контрагент (ИИ)</strong></TableCell>
              <TableCell><strong>Сумма</strong></TableCell>
              <TableCell><strong>Тип Средств</strong></TableCell>
              <TableCell><strong>Категория</strong></TableCell>
              <TableCell><strong>Проект</strong></TableCell>
              <TableCell align="right"><strong>Действия</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map(t => {
              const isLowConfidence = view === 'draft' && t.confidence === 'low';
              const rowStyle = isLowConfidence 
                ? { backgroundColor: '#fefce8' } 
                : { backgroundColor: '#ffffff' };

              return (
                <TableRow key={t.id} sx={rowStyle}>
                  <TableCell>
                    {view === 'draft' ? (
                       isLowConfidence ? (
                        <Chip icon={<WarningAmberIcon />} label="ИИ Угадал" color="warning" size="small" variant="outlined" />
                       ) : (
                        <Chip icon={<CheckCircleIcon />} label="По правилу" color="success" size="small" variant="outlined" />
                       )
                    ) : (
                      <Chip icon={<CheckCircleIcon />} label="Утверждено" color="primary" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell>{renderDate(t.date)}</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem', color: 'text.secondary', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.rawDescription}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t.cleanMerchant}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold', color: t.amount < 0 ? 'error.main' : 'success.main' }}>
                    {view === 'draft' ? (
                      <input 
                        type="number" 
                        step="0.01"
                        value={t.amount} 
                        onChange={(e) => handleUpdate(t.id, 'amount', parseFloat(e.target.value) || 0)}
                        style={{ width: '80px', padding: '4px', border: '1px solid #ccc', borderRadius: '4px', textAlign: 'right' }}
                      />
                    ) : (
                      `$${Math.abs(t.amount).toFixed(2)}`
                    )}
                  </TableCell>
                  
                  <TableCell>
                    <Select
                      size="small"
                      value={t.paymentType || 'cash'}
                      onChange={(e) => handleUpdate(t.id, 'paymentType', e.target.value)}
                      sx={{ minWidth: 140, bgcolor: 'white' }}
                      disabled={view === 'approved'}
                    >
                      <MenuItem value="company">🏢 Компанейские</MenuItem>
                      <MenuItem value="cash">💵 Личные (Cash)</MenuItem>
                    </Select>
                  </TableCell>
                  
                  <TableCell>
                    <Select
                      size="small"
                      value={t.categoryId || 'other'}
                      onChange={(e) => handleUpdate(t.id, 'categoryId', e.target.value)}
                      sx={{ minWidth: 160, bgcolor: 'white' }}
                      disabled={view === 'approved'}
                    >
                      {Object.keys(COST_CATEGORY_LABELS).map(c => (
                        <MenuItem key={c} value={c}>{COST_CATEGORY_LABELS[c]}</MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  
                  <TableCell>
                    <Select
                      size="small"
                      value={t.projectId || ''}
                      onChange={(e) => handleUpdate(t.id, 'projectId', e.target.value)}
                      disabled={t.paymentType !== 'company' || view === 'approved'}
                      displayEmpty
                      sx={{ minWidth: 180, bgcolor: 'white' }}
                    >
                      <MenuItem value=""><em>-- Не выбран --</em></MenuItem>
                      {projects.map(p => (
                        <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                      ))}
                    </Select>
                  </TableCell>

                  <TableCell align="right">
                    {view === 'approved' ? (
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<UndoIcon />}
                        onClick={() => handleUndo(t.id)}
                        disabled={submitting}
                      >
                        Отменить
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        color="primary"
                        size="small"
                        onClick={() => handleSplit(t.id)}
                        disabled={submitting}
                        sx={{ minWidth: 'auto' }}
                      >
                        ✂️ Split
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            
            {transactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                  <Typography variant="h6" color="text.secondary">
                    {view === 'draft' ? "🎉 Нет выписок для сверки. Загрузите файл через Telegram." : "Список недавних утверждений пуст."}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default ReconciliationPage;
